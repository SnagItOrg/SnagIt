import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState, requireAdminInRoute } from '@/lib/admin-auth'
import {
  PERSISTS,
  planWrites,
  requiresTargetProduct,
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
      listing_id: id, disposition: 'exact' as Disposition, target_product_id: null,
    })),
    ...rejected.map((id) => ({
      listing_id: id, disposition: 'wrong' as Disposition, target_product_id: null,
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
    const check = validateDecision(d, reviewedProductId)
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

  /**
   * A move target is verified against the database before anything is written.
   *
   * The client sends an id it got from the admin product search, but the client
   * is not the authority: an id that does not resolve to an active `kg_product`
   * would otherwise be written into `listing_product_match.product_id`, whose
   * foreign key would either reject the whole batch or — for a real but
   * inactive row — quietly attach the listing to something unreviewable.
   */
  const moveTargets = Array.from(
    new Set(
      writable
        .filter((d) => requiresTargetProduct(d.disposition))
        .map((d) => d.target_product_id as string),
    ),
  )

  if (moveTargets.length > 0) {
    const { data: targetRows, error: targetErr } = await admin
      .from('kg_product')
      .select('id')
      .eq('status', 'active')
      .in('id', moveTargets)

    if (targetErr) {
      return NextResponse.json({ error: targetErr.message }, { status: 500 })
    }
    const found = new Set((targetRows ?? []).map((r) => r.id as string))
    const missing = moveTargets.filter((id) => !found.has(id))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `unknown or inactive target product: ${missing.join(', ')}` },
        { status: 400 },
      )
    }
  }

  // A move writes against the product the operator named, so one submission can
  // touch more than one product row. Both ends are read below, because a move
  // has to see whether it is leaving a positive match behind.
  const touchedProductIds = Array.from(new Set([reviewedProductId, ...moveTargets]))

  const { data: existingRows, error: readErr } = await admin
    .from('listing_product_match')
    .select('listing_id, product_id, method, score, is_valid, explain')
    // The reviewed product is always included: a move has to be able to see
    // whether a positive match is being left behind on it.
    .in('product_id', touchedProductIds)
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
        isValid: (r.is_valid ?? null) as boolean | null,
        explain: (r.explain ?? {}) as Record<string, unknown>,
      },
    ]),
  )

  const decidedAt = new Date().toISOString()

  const plan = planWrites({
    decisions: writable,
    reviewedProductId,
    priorByKey: Object.fromEntries(existing),
    actorUserId: userId,
    decidedAt,
    manualMethod: MANUAL_METHOD,
    manualScore: MANUAL_SCORE,
    rejectedReasonConstant: REJECTION_REASON,
  })

  /**
   * Refused before anything is written.
   *
   * Reassigning a candidate that already holds a match on the reviewed product
   * would need two rows to move together — the new match and the old one — and
   * this route issues one statement and makes no transactional claim. The
   * candidate query means this should not arise; when it does, the operator is
   * told to fix the existing match where that operation belongs.
   */
  if (plan.outcome === 'conflict') {
    return NextResponse.json(
      { error: plan.message, conflicts: plan.conflicts },
      { status: 409 },
    )
  }

  if (plan.outcome === 'noop') {
    return NextResponse.json({ saved: 0, rows_written: 0, skipped, saved_listing_ids: [], failed: [] })
  }

  const rows: DecisionRow[] = plan.rows

  // THE ONLY MUTATION IN THIS ROUTE. One statement, one row per decision.
  //
  // lpm_listing_product_unique (listing_id, product_id) makes it idempotent:
  // repeating a decision converges on that one row, and changing a decision
  // updates it rather than adding a second. No other product's matches are
  // touched, because no other product appears in `rows`.
  const { error } = await admin
    .from('listing_product_match')
    .upsert(rows, { onConflict: 'listing_id,product_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    saved: writable.length,
    rows_written: rows.length,
    skipped,
    saved_listing_ids: Array.from(new Set(rows.map((r) => r.listing_id))),
    failed: [],
  })
}
