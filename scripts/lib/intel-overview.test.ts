/**
 * /intel Overview — the decision logic.
 *
 * The dashboard's dangerous failures are silent ones: a route that names the
 * wrong market, a coverage figure with a flattering denominator, a sort that
 * ranks an empty row above an evidenced one. None of those show up in a
 * screenshot, so they are pinned here.
 *
 * `app/intel/overview.ts` imports only `app/intel/types.ts`, which is a const
 * array and some type aliases, so this runs under the root `tsx --test`
 * harness with no React and no Supabase.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_FILTERS,
  FOREIGN_MARKETS,
  HOME_MARKET,
  bestSpread,
  coverage,
  filterProducts,
  hasAnyObservation,
  isThinEvidence,
  largestSpread,
  marketsWithData,
  partitionByEvidence,
  sortProducts,
  spreadScale,
  spreadRoute,
} from '../../frontend/app/intel/overview'
import { MARKETS, type IntelProduct, type Market, type MarketStats } from '../../frontend/app/intel/types'

function stats(count: number, median: number | null): MarketStats {
  if (count === 0) return { count: 0, min: null, p25: null, median: null, p75: null, max: null }
  return { count, min: median, p25: median, median, p75: median, max: median }
}

/** A product with only the axes these tests read. */
function product(
  name: string,
  medians: Partial<Record<Market, [count: number, median: number]>>,
): IntelProduct {
  const markets = {} as Record<Market, MarketStats>
  for (const market of MARKETS) {
    const entry = medians[market]
    markets[market] = entry ? stats(entry[0], entry[1]) : stats(0, null)
  }
  return {
    id: name,
    canonical_name: name,
    trend: null,
    markets,
    listings: [],
    delta_dk_de: null,
    delta_dk_se: null,
    delta_dk_no: null,
    delta_dk_us: null,
    best_delta: null,
  }
}

/* ── spread and route ───────────────────────────────────────────────────── */

test('spread: DK is the anchor and the foreign markets are the other four', () => {
  assert.equal(HOME_MARKET, 'DK')
  assert.deepEqual([...FOREIGN_MARKETS], ['DE', 'SE', 'NO', 'US'])
})

test('spread: the widest absolute difference wins, not the largest positive one', () => {
  const p = product('p', { DK: [3, 10000], DE: [2, 12000], SE: [4, 30000] })
  const s = bestSpread(p)!
  // DK-SE is -20.000; DK-DE is only -2.000. Ranking on the signed value would
  // have picked DE and buried the bigger opportunity.
  assert.equal(s.market, 'SE')
  assert.equal(s.amount, -20000)
})

test('spread: a pair needs observations on BOTH sides', () => {
  assert.equal(bestSpread(product('p', { DK: [2, 10000] })), null, 'DK alone is not a spread')
  assert.equal(bestSpread(product('p', { DE: [2, 10000] })), null, 'no DK anchor')
  assert.equal(bestSpread(product('p', {})), null)
})

test('spread: evidence is the weaker side, so one listing cannot be hidden behind twenty', () => {
  const s = bestSpread(product('p', { DK: [1, 25000], US: [20, 300] }))!
  assert.equal(s.dkCount, 1)
  assert.equal(s.otherCount, 20)
  assert.equal(s.evidence, 1)
  assert.equal(isThinEvidence(s), true)
  assert.equal(isThinEvidence(bestSpread(product('p', { DK: [2, 25000], US: [2, 300] }))!), false)
})

test('route: a positive amount means DK is dearer, so the trade buys abroad', () => {
  // DK 25.000 vs DE 21.605 -> +3.395. Buy the cheap market, sell the dear one.
  const dearHome = bestSpread(product('p', { DK: [1, 25000], DE: [3, 21605] }))!
  assert.equal(dearHome.amount > 0, true)
  assert.deepEqual(spreadRoute(dearHome), { buyIn: 'DE', sellIn: 'DK' })
})

test('route: a negative amount reverses the route, and zero is not a route', () => {
  const cheapHome = bestSpread(product('p', { DK: [3, 12500], DE: [6, 13038] }))!
  assert.equal(cheapHome.amount < 0, true)
  assert.deepEqual(spreadRoute(cheapHome), { buyIn: 'DK', sellIn: 'DE' })

  const level = bestSpread(product('p', { DK: [3, 12500], DE: [6, 12500] }))!
  assert.equal(level.amount, 0)
  assert.equal(spreadRoute(level), null, 'an equal pair must not be dressed up as a trade')
})

test('route: the direction is not readable from the column name alone', () => {
  // Both of these are "delta DK-DE" rows. They are opposite trades. This is
  // the whole reason the route is written out rather than inferred.
  const a = bestSpread(product('a', { DK: [2, 25000], DE: [2, 21000] }))!
  const b = bestSpread(product('b', { DK: [2, 21000], DE: [2, 25000] }))!
  assert.notDeepEqual(spreadRoute(a), spreadRoute(b))
})

/* ── coverage ───────────────────────────────────────────────────────────── */

test('coverage: the denominator is every product x every tracked market', () => {
  const products = [
    product('a', { DK: [1, 100], DE: [1, 100] }),
    product('b', { DK: [1, 100] }),
  ]
  const c = coverage(products)
  assert.equal(c.possible, 2 * MARKETS.length, 'the denominator must not shrink to what is filled')
  assert.equal(c.populated, 3)
  assert.equal(c.ratio, 3 / 10)
})

test('coverage: a cell counts on any observation, not on a median being useful', () => {
  const c = coverage([product('a', { DK: [1, 100] })])
  assert.equal(c.populated, 1)
  assert.equal(c.possible, MARKETS.length)
})

test('coverage: an empty followed set divides by nothing rather than reporting zero', () => {
  const c = coverage([])
  assert.equal(c.possible, 0)
  assert.equal(c.ratio, null)
})

test('coverage: a market counts as covered on one observation anywhere', () => {
  const products = [product('a', { DK: [1, 100] }), product('b', { US: [2, 200] })]
  assert.deepEqual(marketsWithData(products), ['DK', 'US'])
  assert.deepEqual(marketsWithData([product('a', {})]), [])
})

/* ── the headline number ────────────────────────────────────────────────── */

test('largest spread: picks the widest across products and keeps its sample counts', () => {
  const wide = product('wide', { DK: [1, 22000], DE: [6, 39001] })
  const narrow = product('narrow', { DK: [3, 12500], DE: [6, 13038] })
  const best = largestSpread([narrow, wide])!
  assert.equal(best.product.canonical_name, 'wide')
  assert.equal(best.spread.amount, -17001)
  assert.equal(best.spread.dkCount, 1)
  assert.equal(best.spread.otherCount, 6)
  assert.equal(isThinEvidence(best.spread), true, 'a one-listing side must be flagged, not promoted')
})

test('largest spread: absent when nothing can be compared', () => {
  assert.equal(largestSpread([]), null)
  assert.equal(largestSpread([product('a', { DK: [2, 100] })]), null)
})

test('scale: the bar reference is the widest spread present, and zero when there is none', () => {
  assert.equal(spreadScale([product('a', { DK: [1, 100], DE: [1, 400] })]), 300)
  assert.equal(spreadScale([product('a', {})]), 0)
})

/* ── sorting and partitioning ───────────────────────────────────────────── */

test('sort: spread order ranks on magnitude, so a big discount outranks a small premium', () => {
  const small = product('small', { DK: [2, 10000], DE: [2, 11000] })
  const big = product('big', { DK: [2, 30000], DE: [2, 10000] })
  const order = sortProducts([small, big], 'spread').map((p) => p.canonical_name)
  assert.deepEqual(order, ['big', 'small'])
})

test('sort: a row with no spread always sorts last, whichever way the list arrived', () => {
  const empty = product('aaa-empty', {})
  const priced = product('zzz-priced', { DK: [2, 10000], DE: [2, 11000] })
  assert.deepEqual(
    sortProducts([empty, priced], 'spread').map((p) => p.canonical_name),
    ['zzz-priced', 'aaa-empty'],
  )
  assert.deepEqual(
    sortProducts([priced, empty], 'spread').map((p) => p.canonical_name),
    ['zzz-priced', 'aaa-empty'],
  )
})

test('sort: alphabetical is a plain name order and does not smuggle in a ranking', () => {
  const rows = [product('Wurlitzer 200A', {}), product('ARP 2600', { DK: [2, 1], DE: [2, 9] })]
  assert.deepEqual(
    sortProducts(rows, 'name').map((p) => p.canonical_name),
    ['ARP 2600', 'Wurlitzer 200A'],
  )
})

test('sort: ties fall back to the name, so the order is stable between renders', () => {
  const b = product('b', { DK: [2, 10000], DE: [2, 11000] })
  const a = product('a', { DK: [2, 20000], DE: [2, 21000] })
  assert.deepEqual(
    sortProducts([b, a], 'spread').map((p) => p.canonical_name),
    ['a', 'b'],
  )
})

test('partition: rows with no observation are separated, never dropped', () => {
  const priced = product('priced', { DK: [1, 100] })
  const empty = product('empty', {})
  const { covered, uncovered } = partitionByEvidence([priced, empty])
  assert.deepEqual(covered.map((p) => p.canonical_name), ['priced'])
  assert.deepEqual(uncovered.map((p) => p.canonical_name), ['empty'])
  assert.equal(covered.length + uncovered.length, 2, 'a product was lost')
  assert.equal(hasAnyObservation(empty), false)
})

/* ── filters ────────────────────────────────────────────────────────────── */

test('filters: the default set is inert and returns everything', () => {
  const rows = [product('a', { DK: [1, 100] }), product('b', {})]
  assert.equal(filterProducts(rows, DEFAULT_FILTERS).length, 2)
})

test('filters: the market filter keeps products observed on that market', () => {
  const rows = [product('has-de', { DE: [1, 100] }), product('no-de', { DK: [1, 100] })]
  assert.deepEqual(
    filterProducts(rows, { ...DEFAULT_FILTERS, market: 'DE' }).map((p) => p.canonical_name),
    ['has-de'],
  )
})

test('filters: availability recovers the no-data rows rather than hiding them for good', () => {
  const rows = [product('priced', { DK: [1, 100] }), product('empty', {})]
  assert.deepEqual(
    filterProducts(rows, { ...DEFAULT_FILTERS, availability: 'without_data' }).map(
      (p) => p.canonical_name,
    ),
    ['empty'],
  )
  assert.deepEqual(
    filterProducts(rows, { ...DEFAULT_FILTERS, availability: 'with_data' }).map(
      (p) => p.canonical_name,
    ),
    ['priced'],
  )
})

test('filters: the spread threshold is on magnitude, so it keeps discounts too', () => {
  const premium = product('premium', { DK: [2, 30000], DE: [2, 10000] })
  const discount = product('discount', { DK: [2, 10000], DE: [2, 30000] })
  const small = product('small', { DK: [2, 10000], DE: [2, 11000] })
  const kept = filterProducts([premium, discount, small], {
    ...DEFAULT_FILTERS,
    minSpread: 10000,
  }).map((p) => p.canonical_name)
  assert.deepEqual(kept.sort(), ['discount', 'premium'])
})

test('filters: a product with no comparable pair cannot satisfy a spread threshold', () => {
  const rows = [product('dk-only', { DK: [9, 10000] })]
  assert.equal(filterProducts(rows, { ...DEFAULT_FILTERS, minSpread: 1 }).length, 0)
})
