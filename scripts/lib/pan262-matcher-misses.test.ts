/**
 * scripts/lib/pan262-matcher-misses.test.ts
 *
 * PAN-262: four matcher misses the DBA brand net exposed, each on its real DBA title (2026-10-13)
 * with the boundary cases beside it. Synthetic titles are marked.
 *
 * Run: npx tsx --test scripts/lib/pan262-matcher-misses.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, hyphenateMartinCodes, lineBoundaryRefusal, type Product } from '../../frontend/lib/matching/match-listings'
import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'
import { RULE_WORDS, gluedMartinCode, releaseVerdict } from '../pan262-rematch'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name,
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex([
  row('shure-sm7b', 'shure', 'SM7B'),
  row('roland-sh-1000', 'roland', 'SH-1000'),
  row('roland-sh-2000', 'roland', 'SH-2000'),
  row('martin-d-18', 'martin', 'D-18'),
  row('martin-d-28', 'martin', 'D-28'),
  row('martin-d-28-authentic-1937', 'martin', 'D-28 Authentic 1937'),
  row('martin-hd-28', 'martin', 'HD-28'),
  row('martin-om-28', 'martin', 'OM-28'),
  row('martin-000-28', 'martin', '000-28'),
], [{ product_id: 'p-shure-sm7b', type: 'MODEL', value: 'SM7B' }], [], ['shure', 'roland', 'martin', 'tc-helicon'])

function slugOf(title: string): string | null {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug ?? null : null
}

test('Danish "til" names what a part is FOR, like "for"; "til salg" and a price never do', () => {
  const d = decideMatch('GoXLR (perfekt til Shure SM7b)', index)
  assert.equal(d.kind === 'deferred' && d.reason, 'non_product_intent')
  assert.equal(slugOf('Pop filter for Shure SM7B'), null)  // synthetic: the English form still holds
  assert.equal(slugOf('Shure SM7B til salg'), 'shure-sm7b')  // synthetic
  assert.equal(slugOf('Shure SM7B sælges til 2500 kr'), 'shure-sm7b')  // synthetic
})

test('Martin D, HD, OM and 000 codes read with or without the hyphen, only in a Martin title', () => {
  // The three real titles are now read as the D-28 and refused by the boundaries that already
  // held for the hyphenated form: Reimagined is still the owner's call, Custom Shop has no row.
  assert.equal(hyphenateMartinCodes('martin d28 reimagined'), 'martin d-28 reimagined')
  assert.equal(lineBoundaryRefusal(hyphenateMartinCodes('martin d28 reimagined'), 'martin-d-28'), 'other_member:reimagined')
  assert.equal(lineBoundaryRefusal(hyphenateMartinCodes('martin d28 custom shop expert authentic 1937'), 'martin-d-28-authentic-1937'), 'other_member:custom shop')
  assert.equal(slugOf('Martin D28 Reimagined'), null)
  assert.equal(slugOf('Martin D28 custom shop expert Authentic 1937'), null)
  // Synthetic: the plain glued forms land on their rows.
  assert.equal(slugOf('Martin D28 Standard Series med kuffert'), 'martin-d-28')
  assert.equal(slugOf('Martin D18 2019'), 'martin-d-18')
  assert.equal(slugOf('Martin HD28'), 'martin-hd-28')
  assert.equal(slugOf('Martin OM28 Natural'), 'martin-om-28')
  assert.equal(slugOf('Martin 00028'), 'martin-000-28')
  // A suffix is another model, as "D-28E" is; a serial is not a 0-18; no Martin, no rewrite.
  assert.equal(slugOf('Martin D28E Natural'), null)
  assert.equal(hyphenateMartinCodes('martin d-28 #018'), 'martin d-28 #018')
  assert.equal(hyphenateMartinCodes('roland d50 synthesizer'), 'roland d50 synthesizer')
})

test('Shenandoah is another Martin line, never the D-18', () => {
  assert.equal(slugOf('1984 Martin D-18 Shenandoah'), null)
  assert.equal(lineBoundaryRefusal('1984 martin d-18 shenandoah', 'martin-d-18'), 'other_member:shenandoah')
  assert.equal(slugOf('1984 Martin D-18'), 'martin-d-18')  // synthetic: the year alone is a facet
})

test('"tangenter" sold on their own are a part; keys described by a size or an adjective are the instrument', () => {
  const d = decideMatch('ORIG ! ROLAND SH 1000 / 2000 SYNTHESIZER TANGENTER.', index)
  assert.equal(d.kind === 'deferred' && d.reason, 'non_product_intent')
  assert.equal(detectNonProductIntent('orig ! roland sh 1000 / 2000 synthesizer tangenter.')?.token, 'tangenter')
  // Keys described by an adjective are the instrument's: a trusted Juno-106 match (2026-10-07 dump).
  assert.equal(detectNonProductIntent('roland juno-106 – fuldt fungerende – meget flot stand – hvide tangenter'), null)
  // Synthetic: a keyboard size, or an inclusion marker before the noun, keeps the instrument too.
  assert.equal(slugOf('Roland SH-1000 37 tangenter'), 'roland-sh-1000')
  assert.equal(detectNonProductIntent('yamaha p-125 digital piano 88 vægtede tangenter'), null)
  assert.equal(slugOf('Roland SH-1000 med tangenter'), 'roland-sh-1000')
  // A number that is a model, not a size, does not describe the keys.
  assert.equal(detectNonProductIntent('roland juno 106 tangenter')?.token, 'tangenter')
})

test('the re-match releases a live row only on evidence against its product, and keeps "til salg"', () => {
  // The rows named on the ticket, each is_valid NULL in production.
  assert.equal(releaseVerdict('GoXLR (perfekt til Shure SM7b)', 'shure-sm7b', index).release, true)
  assert.equal(releaseVerdict('ORIG ! ROLAND SH 1000 / 2000 SYNTHESIZER TANGENTER.', 'roland-sh-1000', index).release, true)
  assert.equal(releaseVerdict('1984 Martin D-18 Shenandoah', 'martin-d-18', index).why, 'line boundary: other_member:shenandoah')
  // Synthetic: the rule word alone moves nothing.
  assert.deepEqual(releaseVerdict('Shure SM7B til salg', 'shure-sm7b', index), { release: false, why: 'stays' })
  assert.equal(releaseVerdict('Mikrofon til podcast', 'shure-sm7b', index).release, false)
  assert.ok(RULE_WORDS.test('Shure SM7B til salg') && !RULE_WORDS.test('Tilbud: Shure SM7B'))
  assert.ok(gluedMartinCode('Martin D28 Reimagined') && !gluedMartinCode('Martin D-28 Reimagined'))
})
