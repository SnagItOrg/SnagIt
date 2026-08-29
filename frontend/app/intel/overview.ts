/**
 * The decision logic behind the Intel Overview.
 *
 * Separated from the components because this is where the dashboard can be
 * *wrong* rather than merely ugly: a spread that names the wrong route sends
 * an operator to the wrong market, and a coverage figure with the wrong
 * denominator makes a thin catalogue look complete. Neither failure is visible
 * in a screenshot, so both are tested here instead.
 *
 * Imports only `./types`, which is a plain const array and a set of type
 * aliases, so this runs under the root `tsx --test` harness with no React,
 * no Supabase and no DOM.
 */

import { MARKETS, type IntelProduct, type Market } from './types'

/** DK is the market Klup transacts in, so every comparison is anchored there. */
export const HOME_MARKET: Market = 'DK'
export const FOREIGN_MARKETS: readonly Market[] = MARKETS.filter((m) => m !== HOME_MARKET)

/**
 * One product's widest DK-anchored price difference.
 *
 * `amount` is `median(DK) − median(other)`, so its sign says which market is
 * dearer — and nothing else. The route is derived separately and written out
 * in words, because "Δ DK–DE = +6.084" does not tell anyone which way to
 * trade, and a reader who guesses will guess wrong half the time.
 *
 * Only pairs where BOTH markets carry observations qualify. A median compared
 * against a market we have never seen is not a spread, it is a blank.
 */
export type Spread = {
  market: Market
  dkMedian: number
  otherMedian: number
  amount: number
  dkCount: number
  otherCount: number
  /** The count the comparison actually rests on — the weaker of the two sides. */
  evidence: number
}

export function bestSpread(product: IntelProduct): Spread | null {
  const dk = product.markets[HOME_MARKET]
  if (dk.count === 0 || dk.median == null) return null

  let best: Spread | null = null
  for (const market of FOREIGN_MARKETS) {
    const other = product.markets[market]
    if (other.count === 0 || other.median == null) continue
    const amount = dk.median - other.median
    if (best == null || Math.abs(amount) > Math.abs(best.amount)) {
      best = {
        market,
        dkMedian: dk.median,
        otherMedian: other.median,
        amount,
        dkCount: dk.count,
        otherCount: other.count,
        evidence: Math.min(dk.count, other.count),
      }
    }
  }
  return best
}

/**
 * Which way the route runs.
 *
 * A positive amount means DK is the dearer market, so the trade buys abroad
 * and sells home. Zero is not a route.
 */
export type SpreadRoute = { buyIn: Market; sellIn: Market }

export function spreadRoute(spread: Spread): SpreadRoute | null {
  if (spread.amount === 0) return null
  return spread.amount > 0
    ? { buyIn: spread.market, sellIn: HOME_MARKET }
    : { buyIn: HOME_MARKET, sellIn: spread.market }
}

/**
 * A spread standing on a single listing on either side is an anomaly, not a
 * market level. It is still shown — hiding it would be its own distortion —
 * but it is always shown as thin.
 */
export const THIN_EVIDENCE_THRESHOLD = 2

export function isThinEvidence(spread: Spread): boolean {
  return spread.evidence < THIN_EVIDENCE_THRESHOLD
}

/* ── coverage ───────────────────────────────────────────────────────────── */

export type Coverage = {
  /** Product/market cells holding at least one usable observation. */
  populated: number
  /** Every cell the followed set could fill: products x tracked markets. */
  possible: number
  /** populated / possible, or null when there is nothing to divide. */
  ratio: number | null
}

/**
 * Cell coverage of the followed grid.
 *
 * The denominator is every (followed product x tracked market) pair, which is
 * the only denominator the loaded data actually supports. It is deliberately
 * unflattering: a catalogue that is monitored on one market scores 20%, and it
 * should, because four of its five cells really are empty.
 */
export function coverage(products: IntelProduct[]): Coverage {
  const possible = products.length * MARKETS.length
  let populated = 0
  for (const product of products) {
    for (const market of MARKETS) {
      if (product.markets[market].count > 0) populated++
    }
  }
  return { populated, possible, ratio: possible > 0 ? populated / possible : null }
}

/** The tracked markets that carry at least one observation anywhere. */
export function marketsWithData(products: IntelProduct[]): Market[] {
  return MARKETS.filter((market) => products.some((p) => p.markets[market].count > 0))
}

export function hasAnyObservation(product: IntelProduct): boolean {
  return MARKETS.some((market) => product.markets[market].count > 0)
}

/** The single widest spread in the followed set, with the product that holds it. */
export function largestSpread(
  products: IntelProduct[],
): { product: IntelProduct; spread: Spread } | null {
  let best: { product: IntelProduct; spread: Spread } | null = null
  for (const product of products) {
    const spread = bestSpread(product)
    if (!spread) continue
    if (best == null || Math.abs(spread.amount) > Math.abs(best.spread.amount)) {
      best = { product, spread }
    }
  }
  return best
}

/** Scale reference for the diverging bars: the widest spread on screen. */
export function spreadScale(products: IntelProduct[]): number {
  let max = 0
  for (const product of products) {
    const spread = bestSpread(product)
    if (spread) max = Math.max(max, Math.abs(spread.amount))
  }
  return max
}

/* ── sorting and filtering ──────────────────────────────────────────────── */

export type SortKey = 'spread' | 'name'

function byName(a: IntelProduct, b: IntelProduct): number {
  return a.canonical_name.localeCompare(b.canonical_name, 'en')
}

/**
 * Sort within the evidence partition, never across it.
 *
 * A row with no observations has no spread to rank, so it cannot be ordered
 * against one that has — it can only be placed after. Callers render the two
 * groups as separate sections, which is what keeps the empty rows recoverable
 * instead of merely pushed off the bottom.
 */
export function sortProducts(products: IntelProduct[], key: SortKey): IntelProduct[] {
  const rows = [...products]
  if (key === 'name') return rows.sort(byName)
  return rows.sort((a, b) => {
    const sa = bestSpread(a)
    const sb = bestSpread(b)
    if (sa == null && sb == null) return byName(a, b)
    if (sa == null) return 1
    if (sb == null) return -1
    const diff = Math.abs(sb.amount) - Math.abs(sa.amount)
    return diff !== 0 ? diff : byName(a, b)
  })
}

export function partitionByEvidence(products: IntelProduct[]): {
  covered: IntelProduct[]
  uncovered: IntelProduct[]
} {
  const covered: IntelProduct[] = []
  const uncovered: IntelProduct[] = []
  for (const product of products) {
    ;(hasAnyObservation(product) ? covered : uncovered).push(product)
  }
  return { covered, uncovered }
}

export type IntelFilters = {
  /** Keep only products carrying observations on this market. */
  market: Market | 'all'
  availability: 'all' | 'with_data' | 'without_data'
  /** Absolute DKK floor on the widest spread. 0 disables the filter. */
  minSpread: number
}

export const DEFAULT_FILTERS: IntelFilters = {
  market: 'all',
  availability: 'all',
  minSpread: 0,
}

export function filterProducts(
  products: IntelProduct[],
  filters: IntelFilters,
): IntelProduct[] {
  return products.filter((product) => {
    if (filters.market !== 'all' && product.markets[filters.market].count === 0) return false

    if (filters.availability === 'with_data' && !hasAnyObservation(product)) return false
    if (filters.availability === 'without_data' && hasAnyObservation(product)) return false

    if (filters.minSpread > 0) {
      const spread = bestSpread(product)
      if (!spread || Math.abs(spread.amount) < filters.minSpread) return false
    }
    return true
  })
}

export function isFilterActive(filters: IntelFilters): boolean {
  return (
    filters.market !== DEFAULT_FILTERS.market ||
    filters.availability !== DEFAULT_FILTERS.availability ||
    filters.minSpread !== DEFAULT_FILTERS.minSpread
  )
}
