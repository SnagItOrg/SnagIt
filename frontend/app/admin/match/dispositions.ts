/**
 * The operator dispositions for /admin/match, and what each one writes.
 *
 * WHY THIS REPLACED A BOOLEAN. The page could express exactly one thing —
 * *this listing belongs to this product* — so an accessory, a wanted ad and a
 * genuinely wrong product were the identical rejection, and a confirmed match
 * was indistinguishable from an unreviewed automatic one.
 *
 * WHY THE FIRST DRAFT OF THIS MODULE WAS WRONG. It also offered a
 * `family_level` disposition mapped to `is_valid = true`, for "right family,
 * variant undeterminable". That is unsafe, and the reason is worth keeping in
 * the file it caused:
 *
 *   `is_valid = true` is not a review outcome. In the deployed system it is
 *   public listing eligibility AND price evidence for the selected product. A
 *   Chamberlin Rhythmate Model 30 at 18.618 DKK and a Model 45 at 38.520 DKK
 *   are both genuinely "the Rhythmate family", so both would have been written
 *   as true against the single `chamberlin-rhythmate` node — and the product
 *   page would have presented one price history mixing two instruments that
 *   differ by more than 2x, labelled as exact.
 *
 * `is_valid` is one three-valued axis. It cannot simultaneously carry review
 * disposition, classification depth, exact-product confidence, public listing
 * eligibility and price-evidence eligibility. Every disposition below therefore
 * resolves to an EXACT product or does not claim eligibility at all.
 *
 * The deferred depth-aware model — and the columns it needs — is specified in
 * `docs/admin-match-deferred-disposition-contract.md`. It is deliberately not
 * implemented here and deliberately not offered as a session-only control,
 * because a decision that vanishes at Save is worse than one the UI never
 * promised.
 *
 * MEASURED CONSTRAINTS (production, SELECT only, 2026-08-30):
 *
 *   - `kg_product` has no `parent_id`, `family`, `variant` or `clone_of` column.
 *   - `kg_relation` holds only `sibling` (117 rows) and `clone` (14). There is
 *     no parent/child relation type anywhere in the database.
 *   - `listing_product_match.explain` is `jsonb NOT NULL DEFAULT '{}'`, and the
 *     write path merges into `explain.admin_decision`, so the structured
 *     reasons below need no migration.
 *   - The public product route filters `.not('is_valid','is',false)`, which
 *     keeps NULL as well as true.
 *   - The candidate query excludes every listing that already carries a
 *     `listing_product_match` row, so a candidate on screen has none.
 *
 * Deliberately import-free, like `lib/catalogue.ts`, so the root `tsx --test`
 * harness can exercise it with no React, no Next.js and no build step.
 */

export type Disposition =
  /** The listing is this exact product. */
  | 'exact'
  /**
   * The listing is a different existing product, which the operator named.
   *
   * NOT a hierarchy claim. The picker is the same global admin product search,
   * which cannot demonstrate that the target is a child, a variant or a
   * relative of the reviewed product — only that it exists. Calling this
   * `existing_child`, as the first draft did, implied a relationship that
   * nothing establishes and nothing persists.
   */
  | 'move_to_existing_product'
  /** A part or accessory for the product, not the product. */
  | 'accessory'
  /** A buyer looking for one, not a seller offering one. */
  | 'wanted_ad'
  /** Not this product at all. */
  | 'wrong'
  /** Passed over without judgement. Writes nothing. */
  | 'skipped'

/**
 * The eligibility value each disposition writes.
 *
 * `true` is only ever reachable through a decision that names an EXACT product
 * — the reviewed one, or a target the operator explicitly selected.
 */
export const IS_VALID_FOR: Readonly<Record<Disposition, boolean | null>> = {
  exact:                   true,
  move_to_existing_product: true,
  accessory:               false,
  wanted_ad:               false,
  wrong:                   false,
  skipped:                 null,
}

/** Which dispositions reach the database. A skip is the absence of a decision. */
export const PERSISTS: Readonly<Record<Disposition, boolean>> = {
  exact:                   true,
  move_to_existing_product: true,
  accessory:               true,
  wanted_ad:               true,
  wrong:                   true,
  skipped:                 false,
}

/** Dispositions that confirm the listing belongs to a named exact product. */
export function isApproval(d: Disposition): boolean {
  return IS_VALID_FOR[d] === true
}

/** Dispositions that record a semantic rejection. */
export function isRejection(d: Disposition): boolean {
  return IS_VALID_FOR[d] === false
}

/**
 * The structured reason stored in `explain`, for rejections only.
 *
 * `listing_product_match.rejected_reason` keeps its existing constant value —
 * redefining a populated column is not part of this slice.
 */
export const REJECTION_REASON_FOR: Readonly<Partial<Record<Disposition, string>>> = {
  accessory: 'accessory',
  wanted_ad: 'wanted_ad',
  wrong:     'wrong_product',
}

/**
 * Refusal returned when a candidate already holds a match on the reviewed
 * product. Static, so it carries no listing data into an error surface.
 */
export const SOURCE_MATCH_CONFLICT =
  'Denne annonce har allerede et match på det aktuelle produkt. ' +
  'Ret matchet på produktsiden først — denne visning kan kun tildele ' +
  'annoncer, der ikke er matchet endnu.'

/** Does this disposition require the operator to have named a target product? */
export function requiresTargetProduct(d: Disposition): boolean {
  return d === 'move_to_existing_product'
}

/**
 * A single operator decision, as the client submits it.
 *
 * `target_product_id` is always an id that already exists in `kg_product` and
 * is verified server-side before anything is written. Nothing here creates a
 * product, a relation or a taxonomy row.
 */
export type DecisionInput = {
  listing_id: string
  disposition: Disposition
  /** Existing kg_product id for a move; null for every other disposition. */
  target_product_id: string | null
}

export type DecisionValidity =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Reject a decision the schema or the rules cannot honour.
 *
 * Runs on the server as well as the client, because the client is not the
 * authority on what may be written. Existence of the target is checked
 * separately, against the database — this function only enforces shape.
 */
export function validateDecision(
  input: DecisionInput,
  reviewedProductId: string,
): DecisionValidity {
  if (!input.listing_id) return { ok: false, error: 'listing_id required' }
  if (!(input.disposition in IS_VALID_FOR)) {
    return { ok: false, error: `unknown disposition: ${input.disposition}` }
  }
  if (requiresTargetProduct(input.disposition)) {
    if (!input.target_product_id) {
      return { ok: false, error: 'move_to_existing_product requires a target_product_id' }
    }
    if (input.target_product_id === reviewedProductId) {
      // Otherwise "move" would silently become "approve here".
      return { ok: false, error: 'the move target must differ from the reviewed product' }
    }
  } else if (input.target_product_id) {
    // A target on any other disposition would silently retarget the write.
    return { ok: false, error: 'target_product_id is only valid for move_to_existing_product' }
  }
  return { ok: true }
}

/**
 * Which product row a positive decision is written against.
 *
 * Only a move changes it, and only to a product the operator named.
 */
export function targetProductId(input: DecisionInput, reviewedProductId: string): string {
  return input.disposition === 'move_to_existing_product' && input.target_product_id
    ? input.target_product_id
    : reviewedProductId
}

/* ── planning the writes ──────────────────────────────────────────────── */

/** An existing `listing_product_match` row, as the planner needs to see it. */
export type PriorRow = {
  method: string
  score: number
  isValid: boolean | null
  explain: Record<string, unknown>
}

/** One row to upsert. Mirrors the columns `listing_product_match` actually has. */
export type PlannedRow = {
  listing_id: string
  product_id: string
  method: string
  score: number
  is_valid: boolean
  rejected_reason: string | null
  explain: Record<string, unknown>
}

export type PlanArgs = {
  decisions: readonly DecisionInput[]
  reviewedProductId: string
  /** Keyed `${listing_id}:${product_id}`. */
  priorByKey: Readonly<Record<string, PriorRow>>
  actorUserId: string | null
  decidedAt: string
  manualMethod: string
  manualScore: number
  rejectedReasonConstant: string
}

/**
 * The outcome of planning one submission.
 *
 * `conflict` is a refusal, not a partial success: no row is written at all, so
 * a submission either happens completely or does not happen.
 */
export type WritePlan =
  | { outcome: 'conflict'; conflicts: string[]; message: string }
  | { outcome: 'write'; rows: PlannedRow[] }
  | { outcome: 'noop' }

/**
 * Turn operator decisions into the exact rows to write.
 *
 * ONE ROW PER DECISION. An assignment writes the target and nothing else.
 *
 * An earlier draft also demoted any positive match left on the reviewed
 * product, so that a listing could not be price evidence for two products at
 * once. That was correct as an intention and wrong as a first release: it made
 * one operator decision into two row writes whose combined effect is only safe
 * if they land together. They did land together — the route issues a single
 * multi-row upsert, which is one `INSERT ... ON CONFLICT` statement and
 * therefore atomic — but nothing in the code said so, no test pinned it, and
 * the guarantee rested on an implicit property of PostgREST rather than on
 * anything this repository asserts. A safety property that holds by accident is
 * one refactor away from not holding.
 *
 * `planWrites` removes the question instead of answering it: the two-row case
 * is refused up front, so the writer only ever emits one row per decision.
 */
export function planDecisionWrites(args: PlanArgs): PlannedRow[] {
  const rows: PlannedRow[] = []

  for (const decision of args.decisions) {
    if (!PERSISTS[decision.disposition]) continue

    const productId = targetProductId(decision, args.reviewedProductId)
    const prior = args.priorByKey[`${decision.listing_id}:${productId}`]
    const isValid = IS_VALID_FOR[decision.disposition] === true
    const reassigned = productId !== args.reviewedProductId

    rows.push({
      listing_id: decision.listing_id,
      product_id: productId,
      // Existing matcher provenance survives a human confirmation: overwriting
      // a MODEL/95 row with FUZZY/1 would discard the evidence that produced it.
      method: prior?.method ?? args.manualMethod,
      score: prior?.score ?? args.manualScore,
      is_valid: isValid,
      rejected_reason: isValid ? null : args.rejectedReasonConstant,
      explain: {
        ...(prior?.explain ?? {}),
        admin_decision: {
          decision: isValid ? 'approved' : 'rejected',
          disposition: decision.disposition,
          actor_user_id: args.actorUserId,
          decided_at: args.decidedAt,
          decision_source: 'admin/match',
          // Which product the operator was reviewing when they assigned it
          // elsewhere. Audit only — no row is written against that product.
          ...(reassigned ? { reviewed_product_id: args.reviewedProductId } : {}),
          ...(REJECTION_REASON_FOR[decision.disposition]
            ? { rejection_reason: REJECTION_REASON_FOR[decision.disposition] }
            : {}),
        },
      },
    })
  }

  return rows
}

/**
 * Plan a submission, refusing the case that would need more than one write.
 *
 * `/api/admin/match/candidates` excludes any listing that already holds a
 * `listing_product_match` row for the reviewed product, whatever its verdict.
 * So a candidate reaching this UI has no row on the reviewed product, and
 * assigning it elsewhere is a single insert with nothing left behind.
 *
 * When that invariant does not hold — a stale tab, a concurrent operator, a
 * row written between the sweep and the save — the submission is REFUSED. It is
 * not compensated for, and it is not partially applied: rewriting a persisted
 * match is a different operation, it needs both ends to move together, and the
 * transactional writer it requires is specified in
 * `docs/admin-match-deferred-disposition-contract.md` rather than approximated
 * here.
 */
export function planWrites(args: PlanArgs): WritePlan {
  const conflicts: string[] = []

  for (const decision of args.decisions) {
    if (!PERSISTS[decision.disposition]) continue
    if (!requiresTargetProduct(decision.disposition)) continue
    // Any row at all, whatever its verdict: changing a persisted match is the
    // operation being refused, not just demoting a positive one.
    if (args.priorByKey[`${decision.listing_id}:${args.reviewedProductId}`]) {
      conflicts.push(decision.listing_id)
    }
  }

  if (conflicts.length > 0) {
    return { outcome: 'conflict', conflicts, message: SOURCE_MATCH_CONFLICT }
  }

  const rows = planDecisionWrites(args)
  return rows.length === 0 ? { outcome: 'noop' } : { outcome: 'write', rows }
}
