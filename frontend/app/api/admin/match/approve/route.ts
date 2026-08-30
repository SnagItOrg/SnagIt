import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'
import {
  IS_VALID_FOR,
  PERSISTS,
  REJECTION_REASON_FOR,
  targetProductId,
  validateDecision,
  type DecisionInput,
  type Disposition,
} from '@/app/admin/match/dispositions'

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

/**
 * Accept the two legacy id arrays as dispositions.
 *
 * The page no longer sends this shape, but a tab left open across a deploy
 * would, and silently dropping its save would lose the operator's work. The
 * mapping is the honest one: the old check meant "this is the product" and the
 * old cross meant "this is not".
 */
function fromLegacyArrays(approved: string[], rejected: string[]): DecisionInput[] {
  return [
    ...approved.map((id) => ({
      listing_id: id, disposition: 'exact' as Disposition,
      node_id: null, variant_observation: null,
    })),
    ...rejected.map((id) => ({
      listing_id: id, disposition: 'wrong' as Disposition,
      node_id: null, variant_observation: null,
    })),
  ]
}

// POST /api/admin/match/approve
// Body: { product_id, decisions: DecisionInput[] }
// Legacy body: { product_id, listing_ids?, rejected_listing_ids? }
export async function POST(req: NextRequest) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { userId } = await getCurrentAdminState()

  const body = (await req.json()) as {
    product_id?: string
    decisions?: unknown
    listing_ids?: unknown
    rejected_listing_ids?: unknown
  }

  const reviewedProductId = body.product_id
  if (!reviewedProductId) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 })
  }

  const decisions: DecisionInput[] = Array.isArray(body.decisions)
    ? (body.decisions as DecisionInput[])
    : fromLegacyArrays(
        Array.isArray(body.listing_ids)
          ? (body.listing_ids.filter((v) => typeof v === 'string') as string[])
          : [],
        Array.isArray(body.rejected_listing_ids)
          ? (body.rejected_listing_ids.filter((v) => typeof v === 'string') as string[])
          : [],
      )

  if (decisions.length === 0) {
    return NextResponse.json({ saved: 0, skipped: 0, failed: [] })
  }

  // One listing may carry only one disposition per submission. Two would race
  // on the same unique index and the winner would be decided by array order.
  const seen = new Set<string>()
  for (const d of decisions) {
    if (seen.has(d.listing_id)) {
      return NextResponse.json(
        { error: `duplicate decision for listing ${d.listing_id}` },
        { status: 400 },
      )
    }
    seen.add(d.listing_id)
  }

  // The client is not the authority on what may be written.
  for (const d of decisions) {
    const check = validateDecision(d)
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 })
    }
  }

  /**
   * `cannot_determine` and `skipped` are recorded outcomes that write nothing.
   *
   * A candidate reaching this route has no `listing_product_match` row — the
   * candidate query excludes every listing that has one. So there is no
   * `is_valid = NULL` to preserve; writing NULL would CREATE a row, and the
   * public product route keeps NULL, which would publish a listing the operator
   * explicitly could not resolve. Absence is the only safe encoding of "no
   * verdict" that this schema offers without a migration.
   */
  const writable = decisions.filter((d) => PERSISTS[d.disposition])
  const skipped = decisions.length - writable.length

  if (writable.length === 0) {
    return NextResponse.json({ saved: 0, skipped, failed: [] })
  }

  const admin = getSupabaseAdmin()

  // `existing_child` writes against the child the operator picked, so a single
  // submission can touch more than one product row.
  const targets = writable.map((d) => ({
    decision: d,
    productId: targetProductId(d, reviewedProductId),
  }))

  const { data: existingRows, error: readErr } = await admin
    .from('listing_product_match')
    .select('listing_id, product_id, method, score, explain')
    .in('product_id', Array.from(new Set(targets.map((t) => t.productId))))
    .in('listing_id', writable.map((d) => d.listing_id))

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }

  const existing = new Map(
    (existingRows ?? []).map((r) => [
      `${r.listing_id as string}:${r.product_id as string}`,
      {
        method: r.method as string,
        score: r.score as number,
        explain: (r.explain ?? {}) as Record<string, unknown>,
      },
    ]),
  )

  const decidedAt = new Date().toISOString()

  const rows: DecisionRow[] = targets.map(({ decision, productId }) => {
    const prior = existing.get(`${decision.listing_id}:${productId}`)
    const isValid = IS_VALID_FOR[decision.disposition] === true
    const retargeted = productId !== reviewedProductId

    return {
      listing_id: decision.listing_id,
      product_id: productId,
      // Existing matcher provenance survives a human confirmation: overwriting
      // a MODEL/95 row with FUZZY/1 would discard the evidence that produced it.
      method: prior?.method ?? MANUAL_METHOD,
      score: prior?.score ?? MANUAL_SCORE,
      is_valid: isValid,
      // The column keeps its existing constant meaning; the structured reason
      // lives in `explain`, because redefining a populated column is not part
      // of this slice.
      rejected_reason: isValid ? null : REJECTION_REASON,
      explain: {
        ...(prior?.explain ?? {}),
        admin_decision: {
          decision: isValid ? 'approved' : 'rejected',
          disposition: decision.disposition,
          actor_user_id: userId,
          decided_at: decidedAt,
          decision_source: 'admin/match',
          ...(retargeted ? { reviewed_product_id: reviewedProductId } : {}),
          ...(decision.variant_observation
            // An observed variant with no node. An audit string, never an
            // identifier — nothing resolves it back to a node, and no node is
            // created for it.
            ? { variant_observation: decision.variant_observation }
            : {}),
          ...(REJECTION_REASON_FOR[decision.disposition]
            ? { rejection_reason: REJECTION_REASON_FOR[decision.disposition] }
            : {}),
        },
      },
    }
  })

  // lpm_listing_product_unique (listing_id, product_id) makes this idempotent:
  // repeating a decision converges on one row, and changing one updates it.
  const { error } = await admin
    .from('listing_product_match')
    .upsert(rows, { onConflict: 'listing_id,product_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    saved: rows.length,
    skipped,
    saved_listing_ids: rows.map((r) => r.listing_id),
    failed: [],
  })
}
