/**
 * Tjek prisen (PAN-207): one test per state of the classifier.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { classify, readLink } from '../../frontend/lib/price-check'
import { buildPopulationStats } from '../../frontend/lib/price-populations'

const rows = (prices: number[], source: string) =>
  prices.map((price) => ({ price, price_dkk: price, source, country: null, condition: null }))

// Eight observations: Q1 4.350, Q3 5.550 (Type 7).
const dkBand = buildPopulationStats('dk-asking', rows([4000, 4200, 4400, 4800, 5000, 5400, 6000, 6500], 'dba.dk'))
const soldBand = buildPopulationStats('reverb-sold', rows([3000, 3200, 3400, 3800, 4000, 4400, 5000, 5500], 'reverb'))

test('verdict: a DBA ad is placed in the Danish band, and only the Danish band', () => {
  const under = classify({ source: 'dba', cause: null, matched: true, priceDkk: 3500, populations: { 'dk-asking': dkBand } })
  assert.equal(under.state, 'verdict')
  assert.equal(under.verdict, 'under')
  assert.deepEqual(under.ranges.map((r) => r.market), ['dk-asking'])

  // A Thomann product gets its ranges, each labelled by market, and never a verdict.
  const thomann = classify({ source: 'thomann', cause: null, matched: true, priceDkk: 9000, populations: { 'reverb-sold': soldBand } })
  assert.equal(thomann.state, 'verdict')
  assert.equal(thomann.verdict, null)
  assert.deepEqual(thomann.ranges.map((r) => r.market), ['reverb-sold'])
})

test('not enough data: a Reverb band never judges a DBA ad', () => {
  const thinDk = buildPopulationStats('dk-asking', rows([4000, 5000], 'dba.dk'))
  const result = classify({
    source: 'dba', cause: null, matched: true, priceDkk: 3500,
    populations: { 'dk-asking': thinDk, 'reverb-sold': soldBand },
  })
  assert.deepEqual(result, { state: 'not_enough_data', verdict: null, ranges: [] })
  // A matched product that is not public arrives with no populations at all.
  assert.equal(classify({ source: 'thomann', cause: null, matched: true, priceDkk: null, populations: null }).state, 'not_enough_data')
})

test('not recognised: the ad was read but no product matched', () => {
  assert.equal(classify({ source: 'dba', cause: null, matched: false, priceDkk: 200, populations: null }).state, 'not_recognised')
})

test("can't read the link: each kind of link names its own cause", () => {
  assert.deepEqual(readLink('telecaster til salg'), { cause: 'not_a_link', query: null })
  assert.deepEqual(readLink('https://www.stark.dk/raw-hoevlet?id=1'), { cause: 'unsupported_site', query: null })
  assert.deepEqual(readLink('https://www.dba.dk/recommerce/forsale/search?q=telecaster'), { cause: 'not_single_ad', query: 'telecaster' })
  assert.deepEqual(readLink('https://www.dba.dk/sharedfavoritelist/km3EY07QLqj6'), { cause: 'not_single_ad', query: null })
  assert.deepEqual(readLink('https://www.dba.dk/recommerce/forsale/item/24525470?ref=share'), {
    source: 'dba', url: 'https://www.dba.dk/recommerce/forsale/item/24525470',
  })
  assert.equal(classify({ source: 'dba', cause: 'no_price', matched: true, priceDkk: null, populations: null }).state, 'cant_read')
})
