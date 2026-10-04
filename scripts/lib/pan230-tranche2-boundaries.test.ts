/**
 * scripts/lib/pan230-tranche2-boundaries.test.ts
 *
 * PAN-230 step 5, tranche 2: the six legendary rows the second promote SQL moves to `supported` —
 * Manley Massive Passive, Variable Mu and ELOP (the standard versions; the ELOP+ is its own page), the 2007– API 550A, the vintage
 * Neve 1073 module and the 1970s "Metal Knob" 33609 — with the aliases it adds and without the ones it
 * detaches. On production titles (the unmatched active titles naming each model, read-only snapshot
 * 2026-10-03, decided 2026-10-04).
 *
 * Run: npx tsx --test scripts/lib/pan230-tranche2-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

const PRODUCTS: Product[] = [
  row('manley-massive-passive', 'manley', 'Manley Massive Passive', 'Massive Passive'),
  row('manley-variable-mu', 'manley', 'Manley Variable MU', 'Variable MU'),
  row('manley-elop', 'manley', 'Manley ELOP', 'ELOP'),
  row('api-550a', 'api', 'API 550A', '550A'),
  row('neve-1073', 'neve', 'Neve 1073', '1073'),
  row('neve-33609', 'neve', 'Neve 33609', '33609'),
]

/** The aliases the promote SQL adds; the Mastering / Anniversary / AMS / BAE ones it detaches are not here. */
const ALIASES = [
  { alias: 'Manley Labs Variable-Mu', canonical_query: 'manley-variable-mu' },
  { alias: 'Manley Variable-Mu', canonical_query: 'manley-variable-mu' },
]

const index = buildMatchIndex(PRODUCTS, [], ALIASES, ['manley', 'api', 'neve', 'warm audio', 'universal audio', 'shure', 'chandler limited', 'bae audio'])

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-230 tranche 2: the standard Massive Passive, never the Mastering Version, an anniversary edition, a plug-in or a bundle', () => {
  assert.equal(matchedSlug('Manley Labs Massive Passive Stereo Tube Equalizer 2000s - Purple'), 'manley-massive-passive')
  assert.equal(matchedSlug('Manley Massive Passive Stereo EQ Regular'), 'manley-massive-passive')
  assert.equal(matchedSlug('Manley Labs Massive Passive Stereo Tube Equalizer with T-Bar Modification 2000s - Purple'), 'manley-massive-passive')
  assert.equal(matchedSlug('Manley Labs Massive Passive Mastering Version Stereo Tube Equalizer 2000s - Purple'), null)
  assert.equal(matchedSlug('Manley Massive Passive XXV Anniversary Edition Stereo Tube EQ'), null)
  assert.equal(matchedSlug('Universal Audio UAD Manley Massive Passive EQ Plug-In'), null)
  assert.equal(matchedSlug('Manley Massive Passive Stereo Tube EQ, Ultimate Support MC-125, ATH-M50X, ErnieBall XLR Bundle'), null)
})

test('PAN-230 tranche 2: the standard Variable Mu in every spelling, never the Mastering Version, the Nu Mu or a plug-in', () => {
  assert.equal(matchedSlug('Manley Labs Variable MU Stereo Tube Compressor Limiter with High-Pass Filter 2010s - Purple'), 'manley-variable-mu')
  assert.equal(matchedSlug('Manley Labs Variable-Mu Stereo Tube Compressor Limiter with 6386 Tubes'), 'manley-variable-mu')
  assert.equal(matchedSlug('Manley Variable Mu'), 'manley-variable-mu')
  assert.equal(matchedSlug('Manley Labs Variable MU Stereo Tube Compressor Limiter Mastering Version 2008 - Purple'), null)
  assert.equal(matchedSlug('Manley Labs Variable Mu® Mastering 2023 - Blue'), null)
  assert.equal(matchedSlug('UAD Manley Variable Mu Limiter Compressor Plug-in (Activation Card)'), null)
})

test('PAN-230 tranche 2: the standard ELOP, never the ELOP+ (its own page), Langevin\'s ELOP, the CORE strip or a manual', () => {
  assert.equal(matchedSlug('Manley Labs ELOP Dual Channel Electro-Optical Leveling Amplifier / Compressor 2000s - Purple'), 'manley-elop')
  assert.equal(matchedSlug('Manley Stereo ELOP Electro-Optical Compressor/Limiter'), 'manley-elop')
  assert.equal(matchedSlug('Manley Labs ELOP+ Dual-Channel Electo-Optical Tube Compressor / Limiter 2010s - Purple'), null)
  assert.equal(matchedSlug('Manley ELOP+'), null)
  assert.equal(matchedSlug('Manley ELOP + Stereo Limiter Compressor'), null)
  assert.equal(matchedSlug('Manley ELOP Plus Dual Channel Tube Compressor'), null)
  assert.equal(matchedSlug('Manley Labs Langevin ELOP Limiter'), null)
  assert.equal(matchedSlug('Manley Labs CORE-Channel Strip with Microphone and Preamp ELOP Compressor'), null)
  assert.equal(matchedSlug('Manley Labs Elop Manual unknown - paper/plastic'), null)
  assert.equal(matchedSlug('Manley ELOP+ Vacuum Tube Limiter/Compressor, (2) KRK RP5G4 Studio Monitor Bundle'), null)
})

test('PAN-230 tranche 2: the 2007– API 550A, never a 1970s original, the Saul Walker editions, a pair, a loaded console or a power supply', () => {
  assert.equal(matchedSlug('API 550A 500 Series 3-Band Equalizer Module 2007 - Present - Black'), 'api-550a')
  assert.equal(matchedSlug('API 550A Special Edition 500 Series 3-band Equalizer'), 'api-550a')
  assert.equal(matchedSlug('API 550A'), 'api-550a')
  assert.equal(matchedSlug('Vintage API 550A 500 Series Equalizer. 550 A. Huntington, NY. 1970s. Original Opamps 7289'), null)
  assert.equal(matchedSlug('API 550A Classic 2006 Saul Walker 500 Series Equalizer Pair. Rare! Like The Vintage'), null)
  assert.equal(matchedSlug('API 550A 500 Series 3-Band Equalizer matched pair'), null)
  assert.equal(matchedSlug('API The Box 2 Console Mixer Golden. Loaded With 550A Anniversary Edition. Perfect!'), null)
  assert.equal(matchedSlug('12-15V, 1.5 AMP Regulated Power Supply For API 312 512 525 550 550A 550B 553 560'), null)
})

test('PAN-230 tranche 2: the vintage 1073 module, never an AMS Neve reissue, a clone, a pair, the parts trade or a module list', () => {
  assert.equal(matchedSlug('Neve 1073 Mic / Line Input vintage Module 1970s'), 'neve-1073')
  assert.equal(matchedSlug('Neve 1073 Vintage'), 'neve-1073')
  assert.equal(matchedSlug('AMS Neve 1073 CH Horizontal Mic Preamp / EQ Module 2010s - Blue'), null)
  assert.equal(matchedSlug('Neve 1073 DPX'), null)
  assert.equal(matchedSlug('Brent Averill Neve 1073'), null)
  assert.equal(matchedSlug('Audio maintenance Limited AML NEVE 1073 2023 - Black'), null)
  assert.equal(matchedSlug('Neve 1073 (Pair, Racked) preamp'), null)
  assert.equal(matchedSlug('Neve 1073 80 Series Module Thumb Screws (4) 1081 1066 1084 1272 2254 New OEM'), null)
  assert.equal(matchedSlug('Neve 18 Way Connector Male Amphenol 18 pin Neve 1073 133-018-21'), null)
  assert.equal(matchedSlug('Neve 1075 (1073) Vintage Mic Preamp / EQ Module w/Rack - Plug & Play - Awesome!'), null)
})

test('PAN-230 tranche 2: the "Metal Knob" 33609, never the AMS Neve /J, /JD, /N, the later C, a transformer out of one or a Siemens module', () => {
  assert.equal(matchedSlug('Neve 33609 Discrete Stereo Compressor / Limiter Metal Knob 1970s - Blue'), 'neve-33609')
  assert.equal(matchedSlug('Vintage Neve 33609 Stereo compressor'), 'neve-33609')
  assert.equal(matchedSlug('AMS Neve 33609/J Stereo Limiter / Compressor 2010s - Blue'), null)
  assert.equal(matchedSlug('Neve 33609/N Discrete Stereo Compressor/Limiter 2U 19-inch Rack-Mount'), null)
  assert.equal(matchedSlug('Neve 33609/C Discrete Stereo Compressor / Limiter 33609 Rev C Rare Vintage'), null)
  assert.equal(matchedSlug('Marinair 1173/1 LO 1173/1 T1684 vintage output transformer from Neve console/Neve 33114 33609'), null)
  assert.equal(matchedSlug('PAIR -Siemens  WSW 601433 discrete diode compressor limiter modules c 1970 original vintage u73 u273 Neve 33609'), null)
})
