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

/**
 * PAN-265: a rejection reason that rests on a price comparison.
 *
 * 2,322 ai_pass1 rejections cite `kg_product.thomann_price_dkk` (measured
 * 2026-10-15), and many of those values were wrong: korg-minilogue-xd read 399
 * DKK, so 36 real minilogue XDs were rejected as "8–13× the Thomann price".
 * Price is never a reason for invalid. This is the same test as the
 * pan265-reset SQL, kept identical to it: Thomann, MSRP, or a price multiple
 * ("13×", "3x the"), but not a "2x12" cabinet or an "x2" quantity.
 */
const PRICE_MULTIPLE = /[0-9]\s*(?:x|×)(?![\p{L}\p{N}])/iu

export function citesPriceComparison(reason: string | null | undefined): boolean {
  if (typeof reason !== 'string') return false
  return /thomann|msrp/i.test(reason) || PRICE_MULTIPLE.test(reason)
}

/**
 * Why a NEW "invalid" may not be written, or null: its reason rests on price.
 * The prompt now gives only the product's own valid-listing median, so a reason
 * citing it, or any comparison above, is a price rejection. Left NULL for
 * /admin/match; price may make a match uncertain, never invalid.
 */
export function priceReasonGuard(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') return null
  return citesPriceComparison(reason) || /median/i.test(reason) ? 'price_reason' : null
}

/**
 * A label the eval must not treat as ground truth: an earlier AI rejection on a
 * price comparison, the rows the pan265-reset SQL returns to unreviewed.
 * `merged_into:` rejections are correct and stay.
 */
export function isPriceRejectionLabel(row: { is_valid: boolean | null; rejected_reason: string | null; explain: unknown }): boolean {
  if (row.is_valid !== false) return false
  const explain = row.explain as Record<string, unknown> | null
  if (!explain || typeof explain !== 'object' || !('ai_pass1' in explain) || 'admin_decision' in explain) return false
  if (typeof row.rejected_reason !== 'string' || row.rejected_reason.startsWith('merged_into:')) return false
  return citesPriceComparison(row.rejected_reason)
}

/** Below this share of its product's own valid-listing median, a price hints at a part (PAN-265). */
export const PART_PRICE_SHARE = 0.05

/**
 * Whether a listing's price is far below what this product's own adjudicated
 * listings cost. A hint for the model, never a verdict: on its own it can make a
 * match uncertain, never invalid. Null when there is no reference (fewer than
 * three valid listings, or no price).
 */
export function farBelowOwnMedian(priceDkk: number | null | undefined, ownValidMedianDkk: number | null | undefined): boolean | null {
  if (priceDkk == null || ownValidMedianDkk == null || !(priceDkk > 0) || !(ownValidMedianDkk > 0)) return null
  return priceDkk < PART_PRICE_SHARE * ownValidMedianDkk
}
