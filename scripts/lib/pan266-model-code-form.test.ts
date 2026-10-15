/**
 * scripts/lib/pan266-model-code-form.test.ts
 *
 * PAN-266: a model code is read in one form whatever the seller's spelling — glued, spaced or
 * hyphenated, with its generation glued or apart — so "Roland SP404 MKII" (DBA 24878338, the
 * owner's third ad) names the SP-404 MkII as "SP-404MKII" and "SP 404MKII" already did. The
 * titles are the live DBA ads of 2026-10-15 and the trusted production matches the recall
 * harness turned up; synthetic ones are marked.
 *
 * Run: npx tsx --test scripts/lib/pan266-model-code-form.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, expandJunior, modelCodeForm, type Product } from '../../frontend/lib/matching/match-listings'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name,
  status: 'active', support_state: 'supported',
})

// The production spellings: the MKII row is "SP-404MKII" (glued), the Ai is "U 87 Ai" (spaced).
const index = buildMatchIndex([
  row('roland-SP-404', 'roland', 'SP-404'),
  row('roland-sp-404-mkii', 'roland', 'SP-404MKII'),
  row('roland-sp-404sx', 'roland', 'SP-404SX'),
  row('roland-tr-808', 'roland', 'TR-808'),
  row('roland-juno-106', 'roland', 'Juno-106'),
  row('roland-juno-60', 'roland', 'Juno-60'),
  row('roland-sh-01a', 'roland', 'SH-01A'),
  row('roland-svc-350', 'roland', 'SVC-350'),
  row('roland-vp-330', 'roland', 'VP-330'),
  row('korg-ms-20', 'korg', 'MS-20'),
  row('boss-ds-1', 'boss', 'DS-1'),
  row('neumann-u87ai', 'neumann', 'U 87 Ai'),
  row('neumann-u87', 'neumann', 'U87'),
  row('yamaha-dx7', 'yamaha', 'DX7'),
  row('martin-d-28', 'martin', 'D-28'),
  row('warm-audio-wa73', 'warm audio', 'WA73'),
  row('warm-audio-wa73-eq', 'warm audio', 'WA73-EQ'),
  row('neve-1073', 'neve', '1073'),
  row('fender-blues-junior', 'fender', 'Blues Junior'),
  row('fender-blues-junior-iii', 'fender', 'Blues Junior III'),
  row('gretsch-g6122t-62-vintage-select-country-gentleman', 'gretsch', 'G6122T-62'),
  row('gretsch-g6122t-players-edition-country-gentleman', 'gretsch', 'G6122T'),
], [], [], ['roland', 'korg', 'boss', 'neumann', 'yamaha', 'martin', 'warm audio', 'neve', 'fender', 'gretsch'])

function slugOf(title: string): string | null {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug ?? null : null
}

test('the code form: one spelling for glued, spaced and hyphenated codes and their generation', () => {
  assert.equal(modelCodeForm('SP-404MKII'), 'sp 404 ii')
  assert.equal(modelCodeForm('sp404 mkii'), 'sp 404 ii')
  assert.equal(modelCodeForm('SP-404 MK2'), 'sp 404 ii')
  assert.equal(modelCodeForm('sp 404 mk ii'), 'sp 404 ii')
  assert.equal(modelCodeForm('TR808'), 'tr 808')
  assert.equal(modelCodeForm('Juno-106'), 'juno 106')
  assert.equal(modelCodeForm('U 87 Ai'), 'u 87 ai')
  assert.equal(modelCodeForm('u87ai'), 'u 87ai')
  // What follows the digits stays glued: a letter suffix, a hyphenated number, a short hyphenated suffix.
  assert.equal(modelCodeForm('D28E'), 'd 28e')
  assert.equal(modelCodeForm('DX7-2'), 'dx 7-2')
  assert.equal(modelCodeForm('G6122T-62'), 'g 6122t-62')
  assert.equal(modelCodeForm('WA73-EQ'), 'wa 73-eq')
  assert.equal(modelCodeForm('2-1176'), '2-1176')
  // A hyphenated word is a word.
  assert.equal(modelCodeForm('Juno-60-Keyboard'), 'juno 60 keyboard')
})

test('the three SP-404 ads: the glued "SP404 MKII" lands beside the two that already matched', () => {
  assert.equal(slugOf('Roland SP404 MKII'), 'roland-sp-404-mkii')
  assert.equal(slugOf('Roland SP-404MKII sampler'), 'roland-sp-404-mkii')
  assert.equal(slugOf('Roland SP 404MKII Linear Wave Sampler'), 'roland-sp-404-mkii')
  assert.equal(slugOf('Roland SP-404 MKII'), 'roland-sp-404-mkii')
  assert.equal(slugOf('Roland SP-404 MK2'), 'roland-sp-404-mkii')  // synthetic
  assert.equal(slugOf('Roland SP404MK2'), 'roland-sp-404-mkii')  // synthetic
  // The plain SP-404 and the SX keep their own rows.
  assert.equal(slugOf('Roland SP404'), 'roland-SP-404')  // synthetic
  assert.equal(slugOf('Roland SP-404SX'), 'roland-sp-404sx')
  assert.equal(slugOf('Roland SP404SX'), 'roland-sp-404sx')  // synthetic
})

test('glued codes across brands: the DBA and trusted-match titles the old form missed', () => {
  assert.equal(slugOf('Roland SH01a Synthesizer'), 'roland-sh-01a')
  assert.equal(slugOf('Pedalværkstedet boss DS1, Boss Ds1 Pedalværkstedet'), 'boss-ds-1')
  assert.equal(slugOf('Neumann u87 Ai'), 'neumann-u87ai')
  assert.equal(slugOf('Neumann U87 AI (KUN MIKROFON)'), 'neumann-u87ai')
  assert.equal(slugOf('Korg MS20 Synthesizer - Black 1978 original'), 'korg-ms-20')
  assert.equal(slugOf('Roland Juno106'), 'roland-juno-106')
  assert.equal(slugOf('Roland Juno-60-Keyboard'), 'roland-juno-60')
  assert.equal(slugOf('Roland TR808'), 'roland-tr-808')  // synthetic
  assert.equal(slugOf('Fender Blues Jr. forstærker'), 'fender-blues-junior')
  assert.equal(slugOf('Fender Blues Jr III rørforstærker'), 'fender-blues-junior-iii')
  // "Jr." is a title rewrite, so the base row's boundary sees "mk3" and refuses it; the III row's
  // "III" is not in the title, so the ad lands nowhere rather than on the wrong page.
  assert.equal(expandJunior('fender blues jr. mk3'), 'fender blues junior mk3')
  assert.equal(slugOf('Fender blues Jr. mk3'), null)
})

test('a suffix is part of the code: D28E, DX7-2 and WA73-EQ are not the D-28, the DX7 and the WA73', () => {
  assert.equal(slugOf('Martin D28E'), null)  // synthetic
  assert.equal(slugOf('Martin D-28E'), null)  // synthetic
  assert.equal(slugOf('Yamaha DX7-2 inc kuffert + 1 stk. hukommelseskort'), null)
  assert.equal(slugOf('Roland TR8080'), null)  // synthetic
  assert.equal(slugOf('Gretsch G6122T-62 Vintage Select Country Gentleman Walnut Stain'), 'gretsch-g6122t-62-vintage-select-country-gentleman')
  assert.equal(slugOf('Warm Audio WA73-EQ Single Ch Neve 1073-Style Microphone Pre amp'), 'warm-audio-wa73-eq')
})

test('a line-refused member that is only referenced is not a second product', () => {
  // The spaced form deferred this before PAN-266 too: the Neve row's boundary refuses
  // "1073 Style", and step 5b then read the refused row as a rival.
  assert.equal(slugOf('Warm Audio WA73-EQ Single Ch Neve 1073 Style Microphone Pre amp'), 'warm-audio-wa73-eq')
  // A real second product still ties: the SVC-350 ad that also names the VP-330.
  const d = decideMatch('ROLAND SVC-350 VOCODER vintage 11band vocoder VP 330', index)
  assert.equal(d.kind === 'deferred' && d.reason, 'ambiguous_tie')
})

test('the part and reference guards read the code form when the code form made the match', () => {
  const spring = decideMatch('ORIGINAL Roland Key Spring for Juno106', index)  // synthetic
  assert.equal(spring.kind === 'deferred' && spring.reason, 'non_product_intent')
  const copy = decideMatch('Korg MS20 type', index)  // synthetic
  assert.equal(copy.kind === 'deferred' && copy.reason, 'copy_or_reference')
  // The audit payload says which form matched.
  const d = decideMatch('Roland SP404 MKII', index)
  assert.equal(d.kind === 'matched' && d.best.explain.code_form, true)
  const plain = decideMatch('Roland SP-404MKII sampler', index)
  assert.equal(plain.kind === 'matched' && plain.best.explain.code_form, undefined)
})
