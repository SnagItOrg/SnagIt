/**
 * Tjek prisen (PAN-207): one test per state of the classifier.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { classify, guessCandidates, guessProducts, listingsUnderAnswer, readLink, trigramSimilarity, type GuessCandidate } from '../../frontend/lib/price-check'
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

const P = (slug: string, name: string, model_name: string | null, brand_name: string | null): GuessCandidate =>
  ({ slug, name, model_name, brand_name, kind: 'product' })
const F = (slug: string, name: string, brand_name: string, aliases: string[]): GuessCandidate =>
  ({ slug, name, model_name: null, brand_name, kind: 'family', aliases })

test('PAN-244 part 2: the ranking — the row the title supports best, then the price in range, then the nearest; three at most', () => {
  const rows = [
    P('roland-juno-60', 'Roland Juno-60', 'Juno-60', 'roland'),
    P('roland-juno-6', 'Roland Juno-6', 'Juno-6', 'roland'),
    P('roland-juno-106', 'Roland Juno-106', 'Juno-106', 'roland'),
    P('sequential-prophet-5', 'Sequential Prophet-5', 'Prophet-5', 'sequential'),
    P('sequential-circuits-prophet-5', 'Sequential Circuits Prophet-5', 'Prophet-5', 'sequential circuits'),
    P('a-prophet-5-clone', 'A Prophet-5 Clone', 'Prophet-5', 'a'),
    P('b-prophet-5-desktop', 'B Prophet-5 Desktop', 'Prophet-5', 'b'),
    P('no-model', 'No Model', null, null),
  ]
  const rank = (title: string, price: number, ranges = new Map<string, { low: number; high: number }>()) =>
    guessProducts(title, price, guessCandidates(title, rows, null), ranges).map((g) => g.slug)
  // "juno 60" is "Juno-60", and the Juno-60 leads the other Junos the title does not name.
  assert.equal(rank('VINTAGE JUNO 60', 21000)[0], 'roland-juno-60')
  // Two rows the title supports in full ("Prophet-5" is all their names say beyond the brand) lead the two it
  // supports in part (a clone, a desktop); between the two, the one whose observed range holds the price leads.
  const ranges = new Map([
    ['sequential-circuits-prophet-5', { low: 15000, high: 25000 }],
    ['b-prophet-5-desktop', { low: 15000, high: 25000 }],
  ])
  const out = rank('Prophet 5 synth', 20000, ranges)
  assert.deepEqual(out.slice(0, 2), ['sequential-circuits-prophet-5', 'sequential-prophet-5'])
  assert.equal(out.length, 3)
})

test('PAN-245 stage 1: the candidate step — trigram neighbours, names in full and the offered brand\'s rows, behind the brand guard', () => {
  const rows = [
    P('roland-juno-60', 'Roland Juno-60', 'Juno-60', 'roland'),
    P('roland-juno-106', 'Roland Juno-106', 'Juno-106', 'roland'),
    P('roland-juno-stage', 'Roland Juno Stage', 'Juno Stage', 'roland'),
    P('fender-player-ii-stratocaster', 'Fender Player II Stratocaster', 'Player II Stratocaster', 'fender'),
    P('fender-american-standard-jazz-bass', 'Fender American Standard Jazz Bass', 'American Standard Jazz Bass', 'fender'),
    P('gibson-les-paul-standard-50s', 'Gibson Les Paul Standard 50s', 'Les Paul Standard 50s', 'gibson'),
    F('fender-stratocaster', 'Fender Stratocaster', 'fender', ['stratocaster', 'strat']),
    F('fender-jazz-bass', 'Fender Jazz Bass', 'fender', ['jazz bass', 'j-bass']),
  ]
  // pg_trgm's own numbers, as measured on PAN-245: the hyphen is no boundary, and "Juno-60" scores 0.50 against the title.
  assert.equal(trigramSimilarity('Juno 60', 'Juno-60'), 1)
  assert.equal(Math.round(trigramSimilarity('VINTAGE JUNO 60', 'Juno-60') * 100), 50)
  const slugs = (title: string, brand: string | null = null) => guessCandidates(title, rows, brand).map((c) => c.slug)
  // The trigram neighbours and the model name in full let the Juno-60 in; the drone shares no word with any row.
  assert.ok(slugs('VINTAGE JUNO 60').includes('roland-juno-60'))
  assert.deepEqual(slugs('DJI Mavic Air 2 drone med fjernbetjening'), [])
  // A variant the catalogue lacks: the family row comes in through its alias and its brand.
  assert.ok(slugs('Fender American Standard Stratocaster', 'fender').includes('fender-stratocaster'))
  // The brand guard: Squier is offered, so Fender's rows are out and nothing is guessed.
  assert.deepEqual(slugs('Squier Jazz Bass el-bas Korea', 'squier'), [])
  // The brand alone is not a guess.
  assert.deepEqual(slugs('Fender (US) 1979 Sienna Sunburst', 'fender'), [])
  // Ranked: the family, named in full and nearest by trigram, leads a variant with the same overlap.
  const title = 'Fender Vintage Stratocaster'
  assert.equal(guessProducts(title, 37500, guessCandidates(title, rows, 'fender'), new Map())[0]?.slug, 'fender-stratocaster')
})
