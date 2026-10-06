/**
 * Tjek prisen (PAN-207): one test per state of the classifier.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { classify, listingsUnderAnswer, readLink } from '../../frontend/lib/price-check'
import { buildPopulationStats } from '../../frontend/lib/price-populations'

const rows = (prices: number[], source: string) =>
  prices.map((price) => ({ price, price_dkk: price, source, country: null, condition: null }))

// Eight observations: Q1 4.350, Q3 5.550 (Type 7).
const dkBand = buildPopulationStats('dk-asking', rows([4000, 4200, 4400, 4800, 5000, 5400, 6000, 6500], 'dba.dk'))
const soldBand = buildPopulationStats('reverb-sold', rows([3000, 3200, 3400, 3800, 4000, 4400, 5000, 5500], 'reverb'))

test('verdict: a DBA ad is placed in the Danish band, and only the Danish band', () => {
  const under = classify({ source: 'dba', cause: null, matched: true, priceDkk: 3500, populations: { 'dk-asking': dkBand }, dkAskingPrices: [] })
  assert.equal(under.state, 'verdict')
  assert.equal(under.verdict, 'under')
  assert.deepEqual(under.ranges.map((r) => r.market), ['dk-asking'])

  // A Thomann product gets its ranges, each labelled by market, and never a verdict.
  const thomann = classify({ source: 'thomann', cause: null, matched: true, priceDkk: 9000, populations: { 'reverb-sold': soldBand }, dkAskingPrices: [] })
  assert.equal(thomann.state, 'verdict')
  assert.equal(thomann.verdict, null)
  assert.deepEqual(thomann.ranges.map((r) => r.market), ['reverb-sold'])
})

test('not enough data: a Reverb band never judges a DBA ad', () => {
  const thinDk = buildPopulationStats('dk-asking', rows([4000, 5000], 'dba.dk'))
  const result = classify({
    source: 'dba', cause: null, matched: true, priceDkk: 3500,
    populations: { 'dk-asking': thinDk, 'reverb-sold': soldBand }, dkAskingPrices: [],
  })
  assert.deepEqual(result, { state: 'not_enough_data', verdict: null, ranges: [], dkFew: null })
  // A matched product that is not public arrives with no populations at all.
  assert.equal(classify({ source: 'thomann', cause: null, matched: true, priceDkk: null, populations: null, dkAskingPrices: [] }).state, 'not_enough_data')
})

test('not recognised: the ad was read but no product matched', () => {
  assert.equal(classify({ source: 'dba', cause: null, matched: false, priceDkk: 200, populations: null, dkAskingPrices: [] }).state, 'not_recognised')
})

test("can't read the link: each kind of link names its own cause", () => {
  assert.deepEqual(readLink('telecaster til salg'), { cause: 'not_a_link', query: null })
  assert.deepEqual(readLink('https://www.stark.dk/raw-hoevlet?id=1'), { cause: 'unsupported_site', query: null })
  assert.deepEqual(readLink('https://www.dba.dk/recommerce/forsale/search?q=telecaster'), { cause: 'not_single_ad', query: 'telecaster' })
  assert.deepEqual(readLink('https://www.dba.dk/sharedfavoritelist/km3EY07QLqj6'), { cause: 'not_single_ad', query: null })
  assert.deepEqual(readLink('https://www.dba.dk/recommerce/forsale/item/24525470?ref=share'), {
    source: 'dba', url: 'https://www.dba.dk/recommerce/forsale/item/24525470',
  })
  assert.deepEqual(readLink('https://www.dba.dk/25415330'), {
    source: 'dba', url: 'https://www.dba.dk/recommerce/forsale/item/25415330',
  })
  assert.equal(classify({ source: 'dba', cause: 'no_price', matched: true, priceDkk: null, populations: null, dkAskingPrices: [] }).state, 'cant_read')
})

test('PAN-109: 1–7 Danish prices are shown as a range with a caveat, never as a verdict', () => {
  const prices = [4000, 4600, 5200]
  const dk = buildPopulationStats('dk-asking', rows(prices, 'dba.dk'))
  const few = classify({
    source: 'dba', cause: null, matched: true, priceDkk: 3500,
    populations: { 'dk-asking': dk, 'reverb-sold': soldBand }, dkAskingPrices: prices,
  })
  assert.equal(few.state, 'not_enough_data')
  assert.equal(few.verdict, null)
  assert.deepEqual(few.dkFew, { n: 3, low: 4000, high: 5200, median: 4600 })
  // Reverb sold is a labelled reference beside it, not a band the ad is judged against.
  assert.deepEqual(few.ranges.map((r) => r.market), ['reverb-sold'])

  // Two prices: a range, but no median below n = 3.
  const two = buildPopulationStats('dk-asking', rows([4000, 5000], 'dba.dk'))
  assert.deepEqual(
    classify({ source: 'dba', cause: null, matched: true, priceDkk: 3500, populations: { 'dk-asking': two }, dkAskingPrices: [4000, 5000] }).dkFew,
    { n: 2, low: 4000, high: 5000, median: null },
  )
})

test('PAN-244: listings under the answer are Danish first, the pasted ad left out, five at most', () => {
  const l = (id: string, url: string, source: string, country: string | null) => ({ id, url, source, country })
  const wall = [
    l('a', 'https://reverb.com/item/1', 'reverb', null),
    l('b', 'https://www.dba.dk/recommerce/forsale/item/25415330/', 'dba.dk', 'DK'),
    l('c', 'https://www.dba.dk/recommerce/forsale/item/2?utm_source=x', 'dba.dk', 'DK'),
    l('d', 'https://www.kleinanzeigen.de/s-anzeige/3', 'kleinanzeigen', 'DE'),
    l('e', 'https://www.dba.dk/recommerce/forsale/item/4', 'dba.dk', 'DK'),
    l('f', 'https://reverb.com/item/5', 'reverb', null),
    l('g', 'https://www.finn.no/6', 'finn.no', 'NO'),
  ]
  // The short share link reads as the canonical ad URL, so 'b' is the pasted ad and leaves.
  const pasted = readLink('https://www.dba.dk/25415330')
  assert.ok('url' in pasted)
  assert.deepEqual(listingsUnderAnswer(wall, pasted.url).map((x) => x.id), ['c', 'e', 'a', 'd', 'f'])
})
