/**
 * scripts/lib/pan282-memory-man.test.ts
 *
 * PAN-282: the Electro-Harmonix Memory Man line. Twelve rows become match targets (5 that existed as `known` since
 * migration 056 — renamed, re-categorised and anchored to their Reverb page by the PAN-282 identity file — and 7
 * created 2026-10-21 with a verified Reverb page each). Nine are the `memory-man` family; the Memory Boy, Deluxe
 * Memory Boy and Memory Toy are their own products outside it. Four rows share the model name "Deluxe Memory Man"
 * (the pedal has carried it since 1976), so the era is read by the line boundary: the vintage unit needs a year of
 * its run, "vintage", a face colour or an EH model number (owner: a bare "Deluxe Memory Man" never goes to vintage),
 * the Reissue needs 1996–2007 / "reissue" / "big box", the XO needs "XO" or a year from 2008, the Tap Tempo needs
 * "tap tempo" or a bare "TT", and a bare "Deluxe Memory Man" names no row. Measured on the 136 Reverb titles that
 * name a Memory Man, Memory Boy or Memory Toy (production SELECT, 2026-10-21) and the two DBA ads live that day.
 * Every title is a production title unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan282-memory-man.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { makerNamed } from '../../frontend/lib/matching/brand-guard'
import config from '../rematch-configs/pan282-memory-man'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-282 files make a match target, with the model names the create / identity files set. */
const PRODUCTS: Product[] = [
  row('ehx-deluxe-memory-man-vintage', 'electro-harmonix', "Electro-Harmonix Vintage '70s Deluxe Memory Man", 'Deluxe Memory Man'),
  row('ehx-memory-man', 'electro-harmonix', 'Electro-Harmonix Memory Man Solid State Echo', 'Memory Man'),
  row('ehx-deluxe-memory-man-reissue', 'electro-harmonix', 'Electro-Harmonix Deluxe Memory Man Reissue (1996–2007)', 'Deluxe Memory Man'),
  row('ehx-deluxe-memory-man-tap-tempo', 'electro-harmonix', 'Electro-Harmonix Deluxe Memory Man Tap Tempo (Panasonic MN3005)', 'Deluxe Memory Man'),
  row('ehx-memory-man-stereo-hazarai', 'electro-harmonix', 'Electro-Harmonix Stereo Memory Man with Hazarai', 'Stereo Memory Man with Hazarai'),
  row('ehx-deluxe-memory-man-xo', 'electro-harmonix', 'Electro-Harmonix Deluxe Memory Man XO (2008–present)', 'Deluxe Memory Man'),
  row('ehx-deluxe-memory-man-1100-tt', 'electro-harmonix', 'Electro-Harmonix Deluxe Memory Man 1100-TT', 'Deluxe Memory Man 1100-TT'),
  row('ehx-deluxe-memory-man-550-tt', 'electro-harmonix', 'Electro-Harmonix Deluxe Memory Man 550-TT', 'Deluxe Memory Man 550-TT'),
  row('ehx-memory-man-nano', 'electro-harmonix', 'Electro-Harmonix Nano Deluxe Memory Man', 'Nano Deluxe Memory Man'),
  row('ehx-memory-boy', 'electro-harmonix', 'Electro-Harmonix Memory Boy', 'Memory Boy'),
  row('ehx-deluxe-memory-boy', 'electro-harmonix', 'Electro-Harmonix Deluxe Memory Boy', 'Deluxe Memory Boy'),
  row('ehx-memory-toy', 'electro-harmonix', 'Electro-Harmonix Memory Toy', 'Memory Toy'),
  // Brand protection: a supported delay a Memory Man title could stray onto.
  row('boss-dm-2', 'boss', 'Boss DM-2', 'DM-2'),
]
/**
 * The identifiers the PAN-282 identity file writes: the Hazarai's own word and initials, the Nano's split spellings,
 * and the two TT codes, which a title can carry away from the model name ("… Tap Tempo Delay Pedal | 1100-TT").
 */
const IDENTS = [
  ['ehx-memory-man-stereo-hazarai', 'Hazarai'], ['ehx-memory-man-stereo-hazarai', 'SMMH'],
  ['ehx-memory-man-nano', 'Nano Memory Man'], ['ehx-memory-man-nano', 'Nano Dlx Memory Man'], ['ehx-memory-man-nano', 'Memory Man Nano'],
  ['ehx-deluxe-memory-man-1100-tt', '1100-TT'], ['ehx-deluxe-memory-man-550-tt', '550-TT'],
].map(([slug, value]) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))

const index = buildMatchIndex(PRODUCTS, IDENTS, [])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notMatched = (title: string) => {
  const d = decide(title)
  assert.ok(d === 'none' || d === 'rejected' || String(d).startsWith('deferred:'), `${title} → ${d}`)
}

test('every promoted row has a boundary, the config lists 12 rows and the identity file writes 7 identifiers', () => {
  assert.equal(config.promoted.length, 12)
  for (const slug of config.promoted) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  assert.equal(new Set(config.promoted).size, 12)
  assert.equal(IDENTS.length, 7)
  // The nine family rows share one line, so a refusal within it separates members instead of deferring (step 5b).
  for (const slug of config.promoted.filter((s) => !/boy|toy/.test(s))) assert.equal(LINE_BOUNDARIES[slug].line, 'memory-man', slug)
})

test('"EHX" and "Electro Harmonix" name Electro-Harmonix for the confidence floor', () => {
  assert.ok(makerNamed('ehx nano deluxe memory man', 'electro-harmonix'))
  assert.ok(makerNamed('electro harmonix deluxe memory man 1100-tt', 'electro-harmonix'))
  assert.ok(makerNamed('electro-harmonix deluxe memory man xo', 'electro harmonix'))
  assert.equal(makerNamed('boss dm-2 delay', 'electro-harmonix'), false)
})

test('the 1100-TT, 550-TT, XO and Nano carry their names in every spelling Reverb writes', () => {
  matches('Electro-Harmonix Deluxe Memory Man 1100-TT', 'ehx-deluxe-memory-man-1100-tt')
  matches('Electro Harmonix Deluxe Memory Man 1100-TT', 'ehx-deluxe-memory-man-1100-tt')
  matches('Electro-Harmonix Deluxe Memory Man 1100-TT Tap Tempo 1100Ms Analog Delay 2011 - Present - Blue', 'ehx-deluxe-memory-man-1100-tt')
  matches('Electro-Harmonix Deluxe Memory Man 1100ms Tap Tempo Delay Pedal | 1100-TT', 'ehx-deluxe-memory-man-1100-tt')
  matches('Electro-Harmonix EHX Deluxe Memory Man 1100-TT Analog Delay with Tap Tempo', 'ehx-deluxe-memory-man-1100-tt')
  matches('Electro-Harmonix Deluxe Memory Man 550-TT', 'ehx-deluxe-memory-man-550-tt')
  matches('Electro-Harmonix Deluxe Memory Man 550-TT - Panasonic MN3008', 'ehx-deluxe-memory-man-550-tt')
  matches('Electro-Harmonix Deluxe Memory Man 550-TT Tap Tempo 550Ms Analog Delay 2012 - Present - Green', 'ehx-deluxe-memory-man-550-tt')
  matches('Electro-Harmonix Deluxe Memory Man 550-TT Delay Pedal with Tap Tempo Pedal', 'ehx-deluxe-memory-man-550-tt')
  matches('EHX Deluxe Memory Man XO', 'ehx-deluxe-memory-man-xo')
  matches('Electro-Harmonix Deluxe Memory Man XO Analog Delay / Chorus / Vibrato', 'ehx-deluxe-memory-man-xo')
  matches('Electro-Harmonix XO Deluxe Memory Man Analog Delay with Chorus/Vibrato', 'ehx-deluxe-memory-man-xo')
  matches('ELECTRO-HARMONIX DELUXE MEMORY MAN XO : BRAND NEW :  [DETROIT MODULAR]', 'ehx-deluxe-memory-man-xo')
  matches('Electro-Harmonix Deluxe Memory Man XO Analog Delay Guitar Effects Pedal - Analogman Mod', 'ehx-deluxe-memory-man-xo')
  matches('Electro-Harmonix Deluxe Memory Man (2008 - Present)', 'ehx-deluxe-memory-man-xo')  // the Reverb page's own title
  matches('Electro-Harmonix Nano Deluxe Memory Man 2021 - Present - Silver / Black', 'ehx-memory-man-nano')
  matches('Electro Harmonix [Autumn SUPER SALE] [WEB Exclusive Inventory Clearance Sale] NANO DELUXE MEMORY MAN', 'ehx-memory-man-nano')
  matches('Electro Harmonix Deluxe Memory Man Nano Analog Delay Echo Effects Pedal EHX', 'ehx-memory-man-nano')
  matches('!!!NEW!!! Electro-Harmonix Deluxe Nano Memory Man', 'ehx-memory-man-nano')
  matches('Electro-Harmonix - Nano Dlx Memory Man Delay', 'ehx-memory-man-nano')
  matches('Electro-Harmonix pedal Nano Memory man Deluxe', 'ehx-memory-man-nano')
  matches('Pédale de Guitare Electro-Harmonix Nano Deluxe Memory Man', 'ehx-memory-man-nano')
})

test('the four "Deluxe Memory Man" rows are told apart by their era, and a bare one names no row', () => {
  // Vintage: a year of its run, "vintage", a face or finish, or an EH model number (owner, 2026-10-21). The first four
  // are Reverb titles live on 2026-10-21 (owner's screenshot; none is in `listings` yet); "4 knobs" is the unit's
  // layout, not a knob for sale.
  matches('Electro Harmonix deluxe memory man vintage 4 knobs', 'ehx-deluxe-memory-man-vintage')
  matches('Electro-Harmonix Deluxe Memory Man 1977 - Silver / Blue', 'ehx-deluxe-memory-man-vintage')
  matches('Electro-Harmonix Deluxe Memory Man 1976 - 1978 - Silver / Blue', 'ehx-deluxe-memory-man-vintage')
  matches('Electro-Harmonix DELUXE MEMORY MAN 1977', 'ehx-deluxe-memory-man-vintage')
  matches("Vintage '70s Electro-Harmonix Deluxe Memory Man", 'ehx-deluxe-memory-man-vintage')  // the Reverb page title
  matches('Electro-Harmonix Deluxe Memory Man Silver / Blue', 'ehx-deluxe-memory-man-vintage')  // synthetic: the finish alone
  matches('Electro-Harmonix Deluxe Memory Man 1978 Blue Face SAD1024', 'ehx-deluxe-memory-man-vintage')
  matches('Electro-Harmonix EH-7850 Deluxe Memory Man 1981 black face', 'ehx-deluxe-memory-man-vintage')
  matches('Electro Harmonix Deluxe Memory Man EH 7550 squelch', 'ehx-deluxe-memory-man-vintage')
  matches("Electro-Harmonix Deluxe Memory Man 80's", 'ehx-deluxe-memory-man-vintage')
  // Reissue (1996–2007): its years, "reissue" or the "big box". Synthetic, from the Reverb page title.
  matches('Electro-Harmonix Deluxe Memory Man Reissue (1996 - 2007)', 'ehx-deluxe-memory-man-reissue')
  matches('Electro-Harmonix Deluxe Memory Man Big Box 1998', 'ehx-deluxe-memory-man-reissue')
  matches('Electro-Harmonix Deluxe Memory Man 2003', 'ehx-deluxe-memory-man-reissue')
  matches("Vintage 90's Electro-Harmonix Deluxe Memory Man big box", 'ehx-deluxe-memory-man-reissue')  // "vintage" to its seller
  // Tap Tempo: "tap tempo" or a bare "TT" without 1100 / 550.
  matches('Electro-Harmonix Deluxe Memory Man Tap Tempo', 'ehx-deluxe-memory-man-tap-tempo')  // synthetic
  matches('EHX Deluxe Memory Man w/ Tap Tempo', 'ehx-deluxe-memory-man-tap-tempo')  // synthetic
  matches('Electro-Harmonix Deluxe Memory Man TT 2010', 'ehx-deluxe-memory-man-tap-tempo')  // synthetic
  // Bare, or with a year no row owns: no row. The first two are the DBA ads live on 2026-10-21.
  notMatched('Electro-Harmonix Deluxe Memory Man')
  notMatched('Electro-Harmonix Deluxe Memory Man ')
  notMatched('Electro-Harmonix Deluxe Memory Man 1992')  // synthetic
  notMatched('EHX DMM TT')  // synthetic: initials name no model
})

test('the original non-deluxe Memory Man needs a vintage signal, and the vintage Stereo Memory Man names no row', () => {
  matches('Electro-Harmonix Memory Man Solid State Echo / Analog Delay Line', 'ehx-memory-man')  // the Reverb page title
  matches('Electro-Harmonix Memory Man Solid State Echo / Chorus', 'ehx-memory-man')  // the EH 7810 page title: the same row
  matches('Electro-Harmonix Memory Man EH 7810 1979', 'ehx-memory-man')  // synthetic
  matches('Vintage 1977 Electro Harmonix Memory Man', 'ehx-memory-man')  // synthetic
  notMatched('Electro-Harmonix Memory Man')  // synthetic
  notMatched('Electro-Harmonix Stereo Memory Man Echo / Chorus')  // the EH 7811: no row
  notMatched('Electro-Harmonix Stereo Memory Man Reissue with 24V Adapter')
})

test('the Stereo Memory Man with Hazarai is its word, its initials or its name', () => {
  matches('Electro-Harmonix Memory Man Stereo with Hazarai', 'ehx-memory-man-stereo-hazarai')  // the Reverb page title
  matches('Electro-Harmonix Stereo Memory Man with Hazarai Delay/Looper', 'ehx-memory-man-stereo-hazarai')  // synthetic
  matches('EHX SMMH', 'ehx-memory-man-stereo-hazarai')  // synthetic
})

test('the Memory Boy, Deluxe Memory Boy and Memory Toy are their own rows outside the line', () => {
  matches('Electro-Harmonix Deluxe Memory Boy', 'ehx-deluxe-memory-boy')  // DBA, 2026-10-21
  matches('Electro-Harmonix Deluxe Memory Boy – Analog Delay', 'ehx-deluxe-memory-boy')  // DBA, 2026-10-21
  matches('Electro-Harmonix Memory Boy', 'ehx-memory-boy')  // the Reverb page title
  matches('Electro-Harmonix Memory Toy', 'ehx-memory-toy')  // the Reverb page title
  // A two-product title is not either product (step 5b).
  notMatched('Electro-Harmonix Deluxe Memory Man XO + Memory Boy')  // synthetic
  matches('Boss DM-2 Delay', 'boss-dm-2')
})

test("the pedal trade's extras are not the pedal", () => {
  notMatched('Electro-Harmonix Black Knob for Hot Tubes, Hot Wax, MEL9, Deluxe Memory Man XO')
  notMatched('Overlay Dust Cover for Electro-Harmonix Deluxe Memory Man 1100-TT')
  notMatched('Overlay Dust Cover for Electro-Harmonix Deluxe Memory Man 550-TT')
  notMatched('Power Supply/AC Adapter Replacement for Electro-Harmonix XO Deluxe Memory Man')
  notMatched('Power Supply Replacement For The Electro Harmonix (Ehx) Nano Deluxe Memory Man Adapter 9 V')
  notMatched('Electro-Harmonix Deluxe Memory Man 550-TT Manual, Catalog & Registration Card  2010s')
  notMatched('Replacement for Boss 9V PSA Adapter Guitar Pedal Power Supply, 9V 1000mA 6-10ft Power Cord for Boss DS-1,BD-2,DD-7,RV-6,DD-500... for MXR EHX TC Electronic Strymon and More. (10FT)')
  matches('Electro-Harmonix Nano Deluxe Memory Man w/original box and paperwork', 'ehx-memory-man-nano')
  // Two recall costs of the shared rules, accepted (no row is wrong): an inclusion marker AFTER the noun does not keep
  // the pedal, and a chip named after "with" is not read as the unit's spec the way pickups are (listing-intent.ts).
  notMatched('EHX Nano Deluxe Memory Man, 9v Power Supply Included')
  notMatched('Electro-Harmonix Deluxe Memory Man Tap Tempo with Panasonic MN3005 Chip')  // the Reverb page title
})
