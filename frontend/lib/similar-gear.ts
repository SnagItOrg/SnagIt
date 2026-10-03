/**
 * Similar gear on a product page (PAN-235): which products to show and why.
 *
 * Import-free on purpose, like `lib/catalogue.ts`: the rule is testable from
 * plain Node, and the route that feeds it cannot restate it.
 *
 * Sources, strongest first:
 *   1. explicit `kg_relation` rows — clone, successor, predecessor,
 *      alternative; `sibling` rows are shown as "alternative";
 *   2. navigation-family siblings (`lib/families.ts`);
 *   3. derived "same type": the same subcategory, legendary and classic
 *      first, then most listed, and within ×0.5–×2 of this product's median
 *      asking price when both sides have one.
 *
 * Eligibility is NOT decided here. The route passes every candidate through
 * `isCanonical()` first, so a private product or a family label never enters;
 * this module orders, de-duplicates, drops the product itself and caps.
 */

export type SimilarReason =
  | 'clone'
  | 'original'
  | 'successor'
  | 'predecessor'
  | 'alternative'
  | 'same_family'
  | 'same_type'

export interface SimilarCandidate {
  slug: string
  /** 2 legendary, 1 classic, 0 standard — `browse_product_projection.tier_rank`. */
  tier_rank: number
  active_listing_count: number
  /** Median asking price in DKK over the product's own live listings, or null. */
  median_dkk: number | null
}

export interface SimilarPick<T extends SimilarCandidate> {
  candidate: T
  reason: SimilarReason
}

export const SIMILAR_MAX = 8
/** "Similar price" means within this factor of the product's median, either way. */
export const SIMILAR_PRICE_RATIO = 2

/**
 * The reason a `kg_relation` row gives, seen from the page of `viewing`.
 * A row reads "`from` is a <type> of `to`": a clone row on the original's page
 * shows the clone, and on the clone's page shows the original.
 */
export function relationReason(
  type: string,
  direction: 'from_is_other' | 'to_is_other',
): SimilarReason | null {
  const other = direction === 'from_is_other'
  switch (type) {
    case 'clone': return other ? 'clone' : 'original'
    case 'successor': return other ? 'successor' : 'predecessor'
    case 'predecessor': return other ? 'predecessor' : 'successor'
    case 'alternative':
    case 'sibling': return 'alternative'
    default: return null
  }
}

const byStrength = <T extends SimilarCandidate>(a: T, b: T) =>
  b.tier_rank - a.tier_rank || b.active_listing_count - a.active_listing_count || a.slug.localeCompare(b.slug)

function similarPrice(self: number | null, other: number | null): boolean {
  if (self == null || other == null || self <= 0 || other <= 0) return true
  const ratio = other / self
  return ratio >= 1 / SIMILAR_PRICE_RATIO && ratio <= SIMILAR_PRICE_RATIO
}

export function rankSimilar<T extends SimilarCandidate>(
  self: { slug: string; median_dkk: number | null },
  explicit: ReadonlyArray<SimilarPick<T>>,
  family: readonly T[],
  sameType: readonly T[],
): SimilarPick<T>[] {
  const out: SimilarPick<T>[] = []
  const seen = new Set<string>([self.slug])
  const take = (candidate: T, reason: SimilarReason) => {
    if (seen.has(candidate.slug) || out.length >= SIMILAR_MAX) return
    seen.add(candidate.slug)
    out.push({ candidate, reason })
  }
  for (const pick of [...explicit].sort((a, b) => byStrength(a.candidate, b.candidate))) take(pick.candidate, pick.reason)
  for (const c of [...family].sort(byStrength)) take(c, 'same_family')
  for (const c of [...sameType].sort(byStrength)) {
    if (similarPrice(self.median_dkk, c.median_dkk)) take(c, 'same_type')
  }
  return out
}
