/**
 * One decision contract, several entry points.
 *
 * WHY THIS EXISTS. Two admin surfaces wrote `listing_product_match.is_valid`
 * and only one of them recorded who decided:
 *
 *   /api/admin/match/approve            planDecisionWrites → explain.admin_decision ✓
 *   /api/admin/product/[slug]/reject    is_valid=false, rejected_reason        ✗
 *
 * So a rejection made from the product page was indistinguishable from one made
 * by the matcher. Worse, the richer route could not be used on the rows that
 * needed it: it is fed by the candidate query, which excludes every listing that
 * already has a match row — exactly the already-accepted rows an operator most
 * needs to overturn.
 *
 * This module closes both gaps. It reuses `planDecisionWrites` — the same
 * planner the batch flow uses, with the same provenance shape — and applies it
 * to a single, already-existing relation.
 *
 * SCOPE IS THE SAFETY PROPERTY. Every write is keyed on
 * `(listing_id, product_id)`. A listing may legitimately match several products:
 * "Roland Juno 6" is wrong on `roland-juno-106` and correct on `roland-juno-6`.
 * Rejecting it from one must not touch the other, so `product_id` is resolved
 * from the reviewed slug on the server and is never taken from the client.
 *
 * PRIOR EVIDENCE SURVIVES. `planDecisionWrites` carries the existing method,
 * score and `explain` forward, so a human decision annotates the matcher's
 * record rather than erasing it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  IS_VALID_FOR,
  MANUAL_METHOD,
  MANUAL_SCORE,
  REJECTION_REASON,
  planDecisionWrites,
  type Disposition,
// Relative, not '@/': the root `tsx --test` harness resolves this module
// directly and does not read the frontend tsconfig path aliases.
} from '../app/admin/match/dispositions'

/** Decisions the product-page review mode can express. */
export type ProductPageDecision = 'approve' | 'reject'

/**
 * `exact` is the approval the batch flow already uses for "this listing is this
 * product". `wrong` is its rejection for "this is a different product", which
 * is what every product-page rejection means — the operator is looking at the
 * product while saying the listing is not it.
 */
export const DISPOSITION_FOR: Readonly<Record<ProductPageDecision, Disposition>> = {
  approve: 'exact',
  reject: 'wrong',
}

export const DECISION_SOURCE = 'admin/product-page'

export interface ApplyDecisionResult {
  ok: boolean
  status: number
  error?: string
  isValid?: boolean
}

interface PriorMatchRow {
  method: string | null
  score: number | null
  is_valid: boolean | null
  rejected_reason: string | null
  explain: Record<string, unknown> | null
}

/**
 * Apply one decision to one existing relation.
 *
 * Returns a status rather than throwing so route handlers stay thin. A missing
 * relation is a 404, not a silent no-op: the operator asked to change something
 * that is not there, and reporting success would be a lie.
 */
export async function applyProductPageDecision(
  admin: SupabaseClient,
  args: {
    slug: string
    listingId: string
    decision: ProductPageDecision
    actorUserId: string | null
    /**
     * Optional free-text note from the operator. The pre-existing route
     * accepted `reason` in its body, so the parameter is kept for backward
     * compatibility even though no in-repo client sends one today.
     */
    operatorNote?: string | null
  },
): Promise<ApplyDecisionResult> {
  const productRes = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', args.slug)
    .maybeSingle()

  if (productRes.error) return { ok: false, status: 500, error: productRes.error.message }
  if (!productRes.data) return { ok: false, status: 404, error: 'product not found' }

  const productId = (productRes.data as { id: string }).id

  // The prior row is read so its matcher provenance can be preserved, and so a
  // decision against a relation that does not exist is refused.
  const priorRes = await admin
    .from('listing_product_match')
    .select('method, score, is_valid, rejected_reason, explain')
    .eq('listing_id', args.listingId)
    .eq('product_id', productId)
    .maybeSingle()

  if (priorRes.error) return { ok: false, status: 500, error: priorRes.error.message }
  if (!priorRes.data) return { ok: false, status: 404, error: 'match not found' }

  const prior = priorRes.data as PriorMatchRow

  const rows = planDecisionWrites({
    // `target_product_id` is null: this surface never moves a listing. Moving
    // is the separate reassign flow, which owns its own contract.
    decisions: [{ listing_id: args.listingId, disposition: DISPOSITION_FOR[args.decision], target_product_id: null }],
    reviewedProductId: productId,
    priorByKey: {
      [`${args.listingId}:${productId}`]: {
        method: prior.method ?? MANUAL_METHOD,
        score: prior.score ?? MANUAL_SCORE,
        isValid: prior.is_valid ?? null,
        explain: prior.explain ?? {},
      },
    },
    actorUserId: args.actorUserId,
    decidedAt: new Date().toISOString(),
    manualMethod: MANUAL_METHOD,
    manualScore: MANUAL_SCORE,
    rejectedReasonConstant: REJECTION_REASON,
    decisionSource: DECISION_SOURCE,
  })

  if (rows.length !== 1) {
    return { ok: false, status: 500, error: 'decision produced no write' }
  }

  const row = rows[0]

  /**
   * A MORE SPECIFIC CAUSE IS NEVER OVERWRITTEN.
   *
   * `rejected_reason` is written by several producers: the matcher's brand
   * guard stores a collision cause, `scripts/ai-validate-matches.ts` stores the
   * model's stated reason, and `kg-merge-conflict.ts` preserves whichever
   * survives a merge. `planDecisionWrites` would replace any of them with the
   * generic `admin_rejected`, so an operator confirming a rejection the matcher
   * had already explained would erase the explanation.
   *
   * The generic constant is only written when there is nothing better to keep.
   * An approval still clears it, because the rejection it described no longer
   * holds.
   */
  if (!row.is_valid && prior.rejected_reason && prior.rejected_reason !== REJECTION_REASON) {
    row.rejected_reason = prior.rejected_reason
  }

  /**
   * Provenance and human reason coexist rather than compete. The structured
   * cause stays in the column; the operator's words go in the audit record, so
   * neither displaces the other.
   */
  const note = args.operatorNote?.trim()
  if (note) {
    const decision = row.explain.admin_decision as Record<string, unknown> | undefined
    if (decision) decision.operator_note = note
  }

  // Guard against a planner change ever widening the scope of a product-page
  // decision. This surface may only ever touch the relation under review.
  if (row.product_id !== productId || row.listing_id !== args.listingId) {
    return { ok: false, status: 500, error: 'refusing an out-of-scope write' }
  }

  const { error } = await admin
    .from('listing_product_match')
    .upsert([row], { onConflict: 'listing_id,product_id' })

  if (error) return { ok: false, status: 500, error: error.message }

  return { ok: true, status: 200, isValid: row.is_valid }
}


// ── Reassign ────────────────────────────────────────────────────────────────

export type ReassignOutcome =
  /** The target relation did not exist and was created. */
  | 'moved'
  /** The target relation already existed; only the source was resolved. */
  | 'already_linked'
  /** Target equals the product under review. Nothing to do. */
  | 'noop_same_product'

export interface ReassignResult {
  ok: boolean
  status: number
  error?: string
  outcome?: ReassignOutcome
}

/**
 * Move a listing to the product it really is — idempotently.
 *
 * THE BUG THIS REPLACES. The old route issued a single
 * `UPDATE ... SET product_id = <target>` scoped to the SOURCE pair. When the
 * listing already had a relation to the target — which is the normal case for
 * the listings most worth reassigning — the update collided with
 * `lpm_listing_product_unique (listing_id, product_id)` and Postgres error
 * 23505 was returned to the operator verbatim. Production proof: "Roland
 * Juno 6" holds valid relations to BOTH roland-juno-106 and roland-juno-6, so
 * moving it was impossible through the UI.
 *
 * THE MODEL. Reassignment is not one row moving. It is two decisions:
 *
 *   TARGET  this listing IS that product        -> is_valid = true
 *   SOURCE  this listing is NOT this product    -> is_valid = false
 *
 * Expressed that way the operation is naturally idempotent — repeating it
 * converges on the same two rows — and the target's prior state stops
 * mattering:
 *
 *   target true    keep it, re-affirm, reject the source   (no duplicate row)
 *   target null    approve it, reject the source
 *   target false   reopen it with a fresh decision, reject the source
 *   target absent  create it, reject the source
 *   target = source no write at all
 *
 * BOTH ROWS IN ONE STATEMENT. `upsert` on the unique constraint writes them
 * atomically, so there is no window where the listing belongs to both products
 * or to neither. That also removes the 23505 entirely: a conflict is now the
 * mechanism, not an error.
 *
 * `planWrites` is deliberately NOT used. Its conflict guard refuses a
 * reassignment when a prior row exists on the reviewed product — correct for
 * the candidate queue, where a prior row means the listing should be fixed
 * where it already lives, and exactly wrong here, where a prior source row is
 * the precondition.
 */
export async function applyReassign(
  admin: SupabaseClient,
  args: { slug: string; listingId: string; targetSlug: string; actorUserId: string | null },
): Promise<ReassignResult> {
  const [sourceRes, targetRes] = await Promise.all([
    admin.from('kg_product').select('id').eq('slug', args.slug).maybeSingle(),
    admin.from('kg_product').select('id').eq('slug', args.targetSlug).maybeSingle(),
  ])
  if (sourceRes.error) return { ok: false, status: 500, error: sourceRes.error.message }
  if (targetRes.error) return { ok: false, status: 500, error: targetRes.error.message }
  if (!sourceRes.data) return { ok: false, status: 404, error: 'source product not found' }
  if (!targetRes.data) return { ok: false, status: 404, error: 'target product not found' }

  const sourceId = (sourceRes.data as { id: string }).id
  const targetId = (targetRes.data as { id: string }).id

  // Choosing the product you are already reviewing is not an error, and it is
  // not a write either.
  if (sourceId === targetId) {
    return { ok: true, status: 200, outcome: 'noop_same_product' }
  }

  const priorRes = await admin
    .from('listing_product_match')
    .select('product_id, method, score, is_valid, rejected_reason, explain')
    .eq('listing_id', args.listingId)
    .in('product_id', [sourceId, targetId])

  if (priorRes.error) return { ok: false, status: 500, error: priorRes.error.message }

  const priors = (priorRes.data ?? []) as Array<{
    product_id: string
    method: string | null
    score: number | null
    is_valid: boolean | null
    rejected_reason: string | null
    explain: Record<string, unknown> | null
  }>
  const sourcePrior = priors.find((r) => r.product_id === sourceId)
  const targetPrior = priors.find((r) => r.product_id === targetId)

  if (!sourcePrior) return { ok: false, status: 404, error: 'match not found' }

  const decidedAt = new Date().toISOString()
  const priorByKey: Record<string, { method: string; score: number; isValid: boolean | null; explain: Record<string, unknown> }> = {}
  for (const r of priors) {
    priorByKey[`${args.listingId}:${r.product_id}`] = {
      method: r.method ?? MANUAL_METHOD,
      score: r.score ?? MANUAL_SCORE,
      isValid: r.is_valid ?? null,
      explain: r.explain ?? {},
    }
  }

  const plan = (disposition: Disposition, targetProductId: string | null) =>
    planDecisionWrites({
      decisions: [{ listing_id: args.listingId, disposition, target_product_id: targetProductId }],
      reviewedProductId: sourceId,
      priorByKey,
      actorUserId: args.actorUserId,
      decidedAt,
      manualMethod: MANUAL_METHOD,
      manualScore: MANUAL_SCORE,
      rejectedReasonConstant: REJECTION_REASON,
      decisionSource: DECISION_SOURCE,
    })

  const targetRows = plan('move_to_existing_product', targetId)
  const sourceRows = plan('wrong', null)
  if (targetRows.length !== 1 || sourceRows.length !== 1) {
    return { ok: false, status: 500, error: 'reassign produced no write' }
  }

  const targetRow = targetRows[0]
  const sourceRow = sourceRows[0]

  // Scope guard: this operation may only ever touch these two pairs.
  if (targetRow.product_id !== targetId || sourceRow.product_id !== sourceId) {
    return { ok: false, status: 500, error: 'refusing an out-of-scope write' }
  }
  if (!IS_VALID_FOR['move_to_existing_product'] || IS_VALID_FOR['wrong']) {
    return { ok: false, status: 500, error: 'disposition contract changed unexpectedly' }
  }

  // A more specific rejection cause on the source survives, as elsewhere.
  if (sourcePrior.rejected_reason && sourcePrior.rejected_reason !== REJECTION_REASON) {
    sourceRow.rejected_reason = sourcePrior.rejected_reason
  }

  const { error } = await admin
    .from('listing_product_match')
    .upsert([targetRow, sourceRow], { onConflict: 'listing_id,product_id' })

  if (error) return { ok: false, status: 500, error: error.message }

  return {
    ok: true,
    status: 200,
    outcome: targetPrior ? 'already_linked' : 'moved',
  }
}
