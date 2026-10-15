/**
 * scripts/lib/ai-validate-scope.ts
 *
 * Which listing_product_match rows the AI validation pass
 * (scripts/ai-validate-matches.ts) may decide. Import-free apart from the two
 * authorities it defers to, so the root test harness can exercise it.
 */

import { isCanonical, type CatalogueStateRow } from '../../frontend/lib/catalogue'
import { HUMAN_DECISION } from './rematch-verdicts'

/**
 * A row the pass may write: unreviewed (`is_valid IS NULL`) and never decided
 * by a person. An `is_valid = true/false` row and an `explain.admin_decision`
 * row are verdicts, and a writer never overrides a verdict (CLAUDE.md §2).
 */
export function isAiReviewable(match: { is_valid: boolean | null | undefined; explain: unknown }): boolean {
  return match.is_valid === null && !HUMAN_DECISION(match.explain)
}

/**
 * PAN-265, `--public-only`: the rows a public price can be built from — a
 * product whose page renders (`isCanonical`, the one authority) and a listing
 * on its wall (`is_active` is not false, the product route's own filter).
 */
export function inPublicScope(product: CatalogueStateRow | null | undefined, listing: { is_active?: boolean | null } | null | undefined): boolean {
  return listing != null && listing.is_active !== false && isCanonical(product)
}
