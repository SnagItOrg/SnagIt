/**
 * scripts/lib/ai-validate-scope.ts
 *
 * Which listing_product_match rows the AI validation pass
 * (scripts/ai-validate-matches.ts) may decide. Import-free apart from the two
 * authorities it defers to, so the root test harness can exercise it.
 */

import { isCanonical, isFamilyLabelSlug, type CatalogueStateRow } from '../../frontend/lib/catalogue'
import { lineBoundaryRefusal } from '../../frontend/lib/matching/match-listings'
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

/**
 * PAN-265: why the pass may not call this match valid, or null.
 *
 * The eval of 2026-10-15 (89.7 %) failed one way only: 14 of 18 errors were a
 * variant or edition called valid on a broader product ("American Ultra II
 * Telecaster" on `fender-telecaster`, "'50s J-45 Original" on `gibson-j-45`).
 * There is no single "line-named" flag in the code, so the guard reads the two
 * authorities that already draw that line:
 *
 *   family_label      the product is a navigation family's own row
 *                     (FAMILY_SLUGS, isFamilyLabelSlug): a line, never a priced
 *                     product or a match target.
 *   line_boundary:…   the matcher's PAN-154 line boundary refuses this title for
 *                     this product, because it names another member of the line
 *                     (lineBoundaryRefusal, the function the matcher itself uses).
 *
 * Not LINE_BOUNDARIES membership: 665 rows carry an entry, most of them specific
 * models with parts cues, so "in the map" would forbid nearly every valid.
 */
export function variantGuard(title: string, productSlug: string | null | undefined): string | null {
  if (!productSlug) return null
  if (isFamilyLabelSlug(productSlug)) return 'family_label'
  const cue = lineBoundaryRefusal(title, productSlug)
  return cue ? `line_boundary:${cue}` : null
}

/**
 * The verdict the pass writes: the model's, except that a guarded match is
 * never valid. A guarded "valid" is left NULL for /admin/match rather than
 * turned into a rejection the model did not make; "invalid" passes through.
 */
export function guardedIsValid(decided: boolean | null, guard: string | null): boolean | null {
  return decided === true && guard != null ? null : decided
}
