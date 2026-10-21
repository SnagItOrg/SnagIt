/**
 * scripts/lib/pan266-search-family.test.ts
 *
 * PAN-266: a query that names two or more public products never answers "not followed".
 * Measured live on 2026-10-15: `roland sp-404` resolved to "unsupported" although the SP-404 MkII
 * and SP-404SX were public (the exact hit was the private plain SP-404, and the refusal degraded
 * to "nearest"); `fender player jazz bass` answered "unsupported" with four Fender amps as the
 * nearest, because no scoring rule read the query as a sub-phrase of the three public Player
 * Jazz Basses.
 *
 * Run: npx tsx --test scripts/lib/pan266-search-family.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSearchIndex, productEntity, type SearchProductRow } from '../../frontend/lib/search-index'
import { applyEligibility, resolveQuery } from '../../frontend/lib/search-resolver'

const row = (slug: string, canonical_name: string, model_name: string, brand: string): SearchProductRow =>
  ({ slug, canonical_name, model_name, era: null, year_released: null, kg_brand: { name: brand } })

const INDEX = buildSearchIndex(
  [
    row('roland-sp-404', 'Roland SP-404', 'SP-404', 'Roland'),
    row('roland-sp-404-mkii', 'Roland SP-404 MkII', 'SP-404MKII', 'Roland'),
    row('roland-sp-404sx', 'Roland SP-404SX', 'SP-404SX', 'Roland'),
    row('roland-sp-404a', 'Roland SP-404A', 'SP-404A', 'Roland'),
    row('roland-tr-808', 'Roland TR-808', 'TR-808', 'Roland'),
    row('fender-player-ii-jazz-bass', 'Fender Player II Jazz Bass', 'Player II Jazz Bass', 'Fender'),
    row('fender-player-plus-jazz-bass', 'Fender Player Plus Jazz Bass', 'Player Plus Jazz Bass', 'Fender'),
    row('fender-player-ii-modified-active-jazz-bass', 'Fender Player II Modified Active Jazz Bass', 'Player II Modified Active Jazz Bass', 'Fender'),
    row('fender-65-twin-reverb-reissue', "Fender '65 Twin Reverb Reissue", "'65 Twin Reverb Reissue", 'Fender'),
    row('moog-minimoog', 'Moog Minimoog', 'Minimoog', 'Moog'),
    row('moog-matriarch', 'Moog Matriarch', 'Matriarch', 'Moog'),
    row('moog-minitaur', 'Moog Minitaur', 'Minitaur', 'Moog'),
  ].map(productEntity),
  [],
)

const PUBLIC = new Set([
  'roland-sp-404-mkii', 'roland-sp-404sx', 'roland-tr-808',
  'fender-player-ii-jazz-bass', 'fender-player-plus-jazz-bass', 'fender-player-ii-modified-active-jazz-bass',
  'fender-65-twin-reverb-reissue', 'moog-minimoog', 'moog-matriarch', 'moog-minitaur',
])
const resolve = (q: string, publicSlugs = PUBLIC) => applyEligibility(resolveQuery(q, INDEX), publicSlugs, new Set())

test('a family-level query whose exact hit is private offers the public members, never "not followed"', () => {
  for (const q of ['roland sp-404', 'roland sp404', 'sp-404']) {
    const outcome = resolve(q)
    assert.equal(outcome.outcome, 'disambiguation', q)
    assert.equal(outcome.navigateTo, null, q)
    assert.deepEqual(outcome.candidates.map((c) => c.slug).sort(), ['roland-sp-404-mkii', 'roland-sp-404sx'], q)
    assert.deepEqual(outcome.suggestions, [], q)
  }
})

test('one public member is still "not followed, here is the nearest"', () => {
  const outcome = resolve('roland sp-404', new Set(['roland-sp-404-mkii', 'roland-tr-808']))
  assert.equal(outcome.outcome, 'unsupported')
  assert.deepEqual(outcome.suggestions.map((c) => c.slug), ['roland-sp-404-mkii'])
  assert.deepEqual(outcome.candidates, [])
})

test('an exact public hit still navigates', () => {
  assert.equal(resolve('roland sp-404 mkii').navigateTo, '/product/roland-sp-404-mkii')
  assert.equal(resolve('roland sp-404sx').navigateTo, '/product/roland-sp-404sx')
})

test('a sub-phrase of several identities is a disambiguation of exactly those', () => {
  const basses = resolve('fender player jazz bass')
  assert.equal(basses.outcome, 'disambiguation')
  assert.deepEqual(
    basses.candidates.map((c) => c.slug).sort(),
    ['fender-player-ii-jazz-bass', 'fender-player-ii-modified-active-jazz-bass', 'fender-player-plus-jazz-bass'],
  )
  // The series alone names the same three; the amp is not a Player.
  assert.deepEqual(
    resolve('fender player').candidates.map((c) => c.slug).sort(),
    ['fender-player-ii-jazz-bass', 'fender-player-ii-modified-active-jazz-bass', 'fender-player-plus-jazz-bass'],
  )
})
