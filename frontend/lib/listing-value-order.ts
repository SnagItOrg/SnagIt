import type { Verdict } from './price-populations'

/**
 * Value ordering for the listing wall.
 *
 * WHAT THIS IS NOT. It is not a score, not a confidence, not a discount and not
 * a comparison of prices. It introduces no threshold and reads no population.
 * The only input is the verdict P2 already computed server-side and handed to
 * the card as a prop.
 *
 * WHY IT IS ONLY A PRESENTATION STATE. A product's wall mixes populations: the
 * same grid can hold a dk-asking, a de-asking and a reverb-asking listing, and
 * each verdict was measured INSIDE ITS OWN population. `under` therefore means
 * "below what this listing's own market usually asks" — it does not mean the
 * listing is cheaper in kroner than a `typical` one beside it. Ordering by the
 * category is a way of grouping like-for-like judgements on screen; it makes no
 * claim that the underlying prices are comparable, and it changes no price
 * basis. Sorting the numbers themselves across these populations would make
 * exactly that claim, which is why this module never looks at a price.
 *
 * Ordering is total and stable: rank first, then the position the caller
 * already had. Listings with no verdict keep their existing relative order and
 * follow every verdict-bearing listing, so an absent comparison is expressed by
 * the card's own empty state rather than by a fabricated label.
 */

/** Rank over the verdict states P2 already defines. Lower sorts first. */
export const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  under:   0,
  typical: 1,
  over:    2,
}

/** Every listing P2 could not place sorts after every listing it could. */
export const NO_VERDICT_RANK = 3

export function verdictRank(verdict: Verdict | null | undefined): number {
  return verdict ? VERDICT_RANK[verdict] : NO_VERDICT_RANK
}

/**
 * Stable ordering by verdict rank.
 *
 * The original index is the explicit tie-breaker rather than relying on the
 * engine's sort being stable, so the guarantee is one this module makes and a
 * test can hold it to.
 */
export function orderByVerdictRank<T>(
  items: readonly T[],
  verdictOf: (item: T) => Verdict | null | undefined,
): T[] {
  return items
    .map((item, index) => ({ item, index, rank: verdictRank(verdictOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)
}
