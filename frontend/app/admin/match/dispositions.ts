/**
 * The operator dispositions for /admin/match, and what each one writes.
 *
 * WHY THIS REPLACES A BOOLEAN. The page could express exactly one thing: *this
 * listing belongs to this product*. Every other judgement collapsed into the
 * same two buttons, so a Chamberlin Rhythmate Model 45 and a Model 30 were the
 * identical decision, an accessory and a wanted ad were the identical
 * rejection, and "I genuinely cannot tell" had no expression at all.
 *
 * The seven dispositions below are the judgements an operator actually makes.
 * They collapse onto the SAME three-valued eligibility axis the schema already
 * has — `is_valid` NULL / true / false — because that axis is what the public
 * product route reads, and this module does not get to redefine it.
 *
 * MEASURED CONSTRAINTS (production, SELECT only, 2026-08-30). These are why the
 * mapping is what it is rather than what it looks like it should be:
 *
 *   - `kg_product` has no `parent_id`, `family`, `variant` or `clone_of` column.
 *   - `kg_relation` holds only `sibling` (117 rows) and `clone` (14). There is
 *     no parent/child relation type, so no hierarchy is persisted anywhere in
 *     the database. The only parent→child model in the repository is
 *     `lib/families.ts`, which is reviewed code, not a table.
 *   - `listing_product_match.explain` is `jsonb NOT NULL DEFAULT '{}'` and the
 *     write path already merges into `explain.admin_decision`, so the structured
 *     detail below needs no migration.
 *   - The public product route filters `.not('is_valid','is',false)`, which
 *     keeps NULL *and* true. NULL is publicly visible.
 *   - The candidate route excludes every listing that already has a
 *     `listing_product_match` row, whatever its verdict. A candidate on screen
 *     therefore has NO row.
 *
 * Deliberately import-free, like `lib/catalogue.ts` and `match-state.ts`, so the
 * root `tsx --test` harness can exercise it with no React and no build step.
 */

export type Disposition =
  /** The listing is this exact product. */
  | 'exact'
  /** Right family/product, but the variant cannot be determined from the listing. */
  | 'family_level'
  /** Belongs on an existing child node, which the operator selected. */
  | 'existing_child'
  /** A part or accessory for the product, not the product. */
  | 'accessory'
  /** A buyer looking for one, not a seller offering one. */
  | 'wanted_ad'
  /** Not this product at all. */
  | 'wrong'
  /** Reviewed, and genuinely undecidable from what is stored. */
  | 'cannot_determine'
  /** Passed over without judgement. */
  | 'skipped'

/**
 * The eligibility value each disposition writes.
 *
 * `null` means the disposition writes NO ROW AT ALL — see `PERSISTS`. It does
 * not mean "write a row whose is_valid is null".
 */
export const IS_VALID_FOR: Readonly<Record<Disposition, boolean | null>> = {
  exact:            true,
  family_level:     true,
  existing_child:   true,
  accessory:        false,
  wanted_ad:        false,
  wrong:            false,
  cannot_determine: null,
  skipped:          null,
}

/**
 * Which dispositions reach the database.
 *
 * `cannot_determine` and `skipped` do not, and that is a measured conclusion
 * rather than a simplification.
 *
 * A candidate on screen has no `listing_product_match` row, so there is no
 * existing `is_valid = NULL` to *preserve* — the only way to "write NULL" is to
 * CREATE a row. The public product route keeps NULL, so that row would render
 * the listing as price evidence on the public page. "The operator reviewed this
 * and could not determine it" would become "this is evidence for this product".
 *
 * That is a public-eligibility change, so the safe reading of "preserve
 * is_valid = null" on this surface is to write nothing: absence and NULL are the
 * same fact to every reader, and absence cannot mislead the public page.
 *
 * The cost is that the *observation* is not durable. Making it durable needs a
 * column the public route excludes — a migration, and a product-owner decision.
 */
export const PERSISTS: Readonly<Record<Disposition, boolean>> = {
  exact:            true,
  family_level:     true,
  existing_child:   true,
  accessory:        true,
  wanted_ad:        true,
  wrong:            true,
  cannot_determine: false,
  skipped:          false,
}

/** Dispositions that confirm the listing belongs somewhere. */
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
 * changing the meaning of a populated column is not part of this slice.
 */
export const REJECTION_REASON_FOR: Readonly<Partial<Record<Disposition, string>>> = {
  accessory: 'accessory',
  wanted_ad: 'wanted_ad',
  wrong:     'wrong_product',
}

/** Does this disposition require the operator to have picked an existing node? */
export function requiresChildNode(d: Disposition): boolean {
  return d === 'existing_child'
}

/**
 * A single operator decision, as the client submits it.
 *
 * `node_id` is ALWAYS an id that already exists in `kg_product`. Nothing here
 * creates a node, and `variant_observation` is the escape hatch that makes that
 * possible: a Chamberlin Model 45 has no node, so the operator classifies at the
 * family and records the label they actually read on the listing. The label is
 * an audit string, never an identifier, and nothing resolves it back to a node.
 */
export type DecisionInput = {
  listing_id: string
  disposition: Disposition
  /** Existing kg_product id for `existing_child`; null for every other case. */
  node_id: string | null
  /** Free-text variant the operator observed but which has no node. */
  variant_observation: string | null
}

export type DecisionValidity =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Reject a decision the schema or the rules cannot honour.
 *
 * Validated on the server as well as the client, because the client is not the
 * authority on what may be written.
 */
export function validateDecision(input: DecisionInput): DecisionValidity {
  if (!input.listing_id) return { ok: false, error: 'listing_id required' }
  if (!(input.disposition in IS_VALID_FOR)) {
    return { ok: false, error: `unknown disposition: ${input.disposition}` }
  }
  if (requiresChildNode(input.disposition) && !input.node_id) {
    return { ok: false, error: 'existing_child requires an existing node_id' }
  }
  if (!requiresChildNode(input.disposition) && input.node_id) {
    // A node id on any other disposition would silently retarget the write.
    return { ok: false, error: 'node_id is only valid for existing_child' }
  }
  return { ok: true }
}

/**
 * Which product row a decision is written against.
 *
 * Only `existing_child` moves it. The operator said the listing belongs to a
 * child that already exists, so the match is recorded against that child — the
 * one product whose page should carry it. Every other disposition writes against
 * the product being reviewed.
 *
 * A family never aggregates listings (root `CLAUDE.md`), so leaving a
 * child-level listing on the family would put it where nothing renders it.
 */
export function targetProductId(input: DecisionInput, reviewedProductId: string): string {
  return input.disposition === 'existing_child' && input.node_id
    ? input.node_id
    : reviewedProductId
}
