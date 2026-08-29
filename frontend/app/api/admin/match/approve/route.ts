import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'

/**
 * Durable supervised feedback for /admin/match.
 *
 * These rows are a human decision record, nothing more. `is_valid = false` is a
 * label an operator applied to one (listing, product) pair; it does not train
 * the Haiku scorer and no automatic learning reads it. Any such use would be a
 * separate, deliberate piece of work.
 *
 * WHAT WAS BROKEN. The page had a check and a cross, but only the check reached
 * the server, and even that never wrote `is_valid` — so a confirmed match stayed
 * indistinguishable from an unreviewed automatic one. The cross was pure React
 * state: it removed the row from the list, survived until reload, and recorded
 * nothing. An operator could reject the same wrong listing every day forever.
 */

/** Values `listing_product_match.method` is allowed to hold (CHECK constraint). */
const MANUAL_METHOD = 'FUZZY'
/** `score` is a smallint with a 0..100 CHECK. New manual rows keep the existing value. */
const MANUAL_SCORE = 1
const REJECTION_REASON = 'admin_rejected'

type DecisionRow = {
  listing_id: string
  product_id: string
  method: string
  score: number
  is_valid: boolean
  rejected_reason: string | null
  explain: Record<string, unknown>
}

// POST /api/admin/match/approve
// Body: { product_id: string, listing_ids?: string[], rejected_listing_ids?: string[] }
export async function POST(req: NextRequest) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { userId } = await getCurrentAdminState()

  const body = (await req.json()) as {
    product_id?: string
    listing_ids?: unknown
    rejected_listing_ids?: unknown
  }

  const productId = body.product_id
  const approvedIds = Array.isArray(body.listing_ids)
    ? (body.listing_ids.filter((v) => typeof v === 'string') as string[])
    : []
  const rejectedIds = Array.isArray(body.rejected_listing_ids)
    ? (body.rejected_listing_ids.filter((v) => typeof v === 'string') as string[])
    : []

  if (!productId) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 })
  }
  if (approvedIds.length === 0 && rejectedIds.length === 0) {
    return NextResponse.json({ approved: 0, rejected: 0 })
  }

  // One listing cannot be both confirmed and rejected in the same submission.
  const conflicting = approvedIds.filter((id) => rejectedIds.includes(id))
  if (conflicting.length > 0) {
    return NextResponse.json(
      { error: 'a listing cannot be both approved and rejected' },
      { status: 400 },
    )
  }

  const admin = getSupabaseAdmin()
  const touched = [...approvedIds, ...rejectedIds]

  /**
   * Read the rows we are about to write.
   *
   * The previous implementation upserted a flat `{method:'FUZZY', score:1}` over
   * whatever was already there, so confirming a MODEL/95 match silently rewrote
   * it as FUZZY/1 and discarded the matcher's evidence. Reversing a decision
   * would have done it again. Existing provenance is preserved and only the
   * decision fields move.
   */
  const { data: existingRows, error: readErr } = await admin
    .from('listing_product_match')
    .select('listing_id, method, score, explain')
    .eq('product_id', productId)
    .in('listing_id', touched)

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }

  const existing = new Map(
    (existingRows ?? []).map((r) => [
      r.listing_id as string,
      {
        method: r.method as string,
        score: r.score as number,
        explain: (r.explain ?? {}) as Record<string, unknown>,
      },
    ]),
  )

  const decidedAt = new Date().toISOString()

  function rowFor(listingId: string, isValid: boolean): DecisionRow {
    const prior = existing.get(listingId)
    return {
      listing_id: listingId,
      product_id: productId as string,
      method: prior?.method ?? MANUAL_METHOD,
      score: prior?.score ?? MANUAL_SCORE,
      is_valid: isValid,
      // Cleared on approval so a reversed rejection leaves no stale reason behind.
      rejected_reason: isValid ? null : REJECTION_REASON,
      // `explain` is the only structured audit field on this table — there is no
      // actor or updated_at column — so the decision record lives beside the
      // matcher's own keys rather than replacing them.
      explain: {
        ...(prior?.explain ?? {}),
        admin_decision: {
          decision: isValid ? 'approved' : 'rejected',
          actor_user_id: userId,
          decided_at: decidedAt,
          decision_source: 'admin/match',
        },
      },
    }
  }

  const rows: DecisionRow[] = [
    ...approvedIds.map((id) => rowFor(id, true)),
    ...rejectedIds.map((id) => rowFor(id, false)),
  ]

  // The unique index lpm_listing_product_unique (listing_id, product_id) makes
  // this idempotent: repeating a decision converges on the same single row, and
  // changing one updates that row instead of adding a second.
  const { error } = await admin
    .from('listing_product_match')
    .upsert(rows, { onConflict: 'listing_id,product_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ approved: approvedIds.length, rejected: rejectedIds.length })
}
