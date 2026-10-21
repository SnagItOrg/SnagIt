/**
 * scripts/lib/pan293-modern-classics.test.ts
 *
 * PAN-293: the modern classics. Forty-two rows become match targets: 25 Eventide pedals and racks, FMR Audio's RNC, RNP
 * and RNLA, TC Electronic's 2290 and 1210, and twelve Tube-Tech model rows (five that exist, seven listing-title rows
 * the identity file re-anchors); the Eventide H3000 and H910 and the Tube-Tech CL 1B and LCA 2B get boundaries too.
 * Price decides identity (Reverb's sold population, 2026-10-21). Every row requires its own word beside its maker:
 * "Space" is a Roland Space Echo, "Rose" a Floyd Rose, "H9" a Shure wireless band, "RNP" a Rupert Neve Portico, "1210"
 * a Technics turntable. Every title is a production title (SELECT, 2026-10-21), a Reverb sold or live title (read-only,
 * 2026-10-21) or a DBA ad live that day, unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan293-modern-classics.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { makerNamed } from '../../frontend/lib/matching/brand-guard'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan293-modern-classics'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})
const ev = (slug: string, name: string, model = name): Product => row(`eventide-${slug}`, 'eventide', `Eventide ${name}`, model)
const tt = (slug: string, model: string): Product => row(`tube-tech-${slug}`, 'tube-tech', `Tube-Tech ${model}`, model)

/** Every row the PAN-293 files make a match target or re-decide, with the model names the files leave or set. */
const PRODUCTS: Product[] = [
  ev('h9-max', 'H9 Max', 'H9'), ev('h9-core', 'H9 Core'), ev('h90', 'H90'),
  ev('timefactor', 'TimeFactor'), ev('pitchfactor', 'PitchFactor'), ev('modfactor', 'ModFactor'), ev('space', 'Space', 'Eventide Space'),
  ev('blackhole', 'Blackhole'), ev('micropitch', 'MicroPitch'), ev('ultratap', 'UltraTap'), ev('tricerachorus', 'TriceraChorus'),
  ev('riptide', 'Riptide'), ev('rose', 'Rose', 'Eventide Rose'), ev('knife-drop', 'Knife Drop'),
  ev('h3000', 'H3000'), ev('h910', 'H910'), ev('h949', 'H949'), ev('h969', 'H969'), ev('dsp4000', 'DSP4000'), ev('h8000', 'H8000'),
  ev('h7600', 'H7600'), ev('eclipse', 'Eclipse', 'Eventide Eclipse'), ev('orville', 'Orville'), ev('h9000', 'H9000'),
  ev('omnipressor', 'Omnipressor'), ev('sp2016', 'SP2016'), ev('instant-phaser', 'Instant Phaser'),
  row('fmr-audio-rnc', 'fmr audio', 'FMR Audio RNC 1773', 'RNC'),
  row('fmr-audio-rnp', 'fmr audio', 'FMR Audio RNP 8380', 'RNP'),
  row('fmr-audio-rnla', 'fmr audio', 'FMR Audio RNLA 7239', 'RNLA'),
  row('tc-electronic-2290', 'tc electronic', 'TC Electronic 2290', '2290'),
  row('tc-electronic-1210', 'tc electronic', 'TC Electronic 1210', '1210'),
  tt('cl-1a', 'CL 1A'), tt('cl1b', 'CL 1B'), tt('cl2a', 'CL 2A'), tt('lca-2b', 'LCA 2B'), tt('pe-1c', 'PE 1C'), tt('me-1b', 'ME 1B'),
  tt('mp-1a', 'MP 1A'), tt('mp-2a', 'MP 2A'), tt('mec-1a', 'MEC 1A'), tt('smc-2b', 'SMC 2B'), tt('smc-2bm', 'SMC 2BM'),
  tt('hlt-2a', 'HLT 2A'), tt('ssa-2a', 'SSA 2A'), tt('eq-1a', 'EQ 1A'),
  // Brand protection: the rows an Eventide, TC or Tube-Tech word could stray onto, as production holds them.
  row('roland-re-201', 'roland', 'Roland RE-201 Space Echo', 'RE-201'),
  row('boss-re-20', 'boss', 'Boss RE-20 Space Echo', 'RE-20'),
  row('warm-audio-wa-1b', 'warm audio', 'Warm Audio WA-1B', 'WA-1B'),
]

/**
 * The MODEL identifiers the PAN-293 identity file writes (and the CL 1B's seed SKU production holds): the spellings the
 * model tier cannot reach from its one phrase ("Time Factor", "H3000-D/SE", "DSP 4000B", "TC 1210"), and the
 * predecessors that are their successor's row by price ("H3500", "LCA 2A", "PE 1B", "ME 1A"). Every one is safe
 * without a brand word only because each row's boundary requires its maker.
 */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [
  ...M('eventide-timefactor', 'Time Factor'), ...M('eventide-pitchfactor', 'Pitch Factor'), ...M('eventide-modfactor', 'Mod Factor'),
  ...M('eventide-blackhole', 'Black Hole'), ...M('eventide-micropitch', 'Micro Pitch'), ...M('eventide-ultratap', 'Ultra Tap'),
  ...M('eventide-tricerachorus', 'Tricera Chorus'), ...M('eventide-h9-core', 'H9 Standard'),
  ...M('eventide-h3000', 'H3500', 'H3500B', 'H3500-DFX', 'H3500B-DFX', 'H-3500', 'H3000-B', 'H3000-S', 'H3000-SE', 'H3000-D/SE', 'H3000-D/SX'),
  ...M('eventide-h8000', 'H8000FW', 'H8000A'), ...M('eventide-h9000', 'H9000R'), ...M('eventide-dsp4000', 'DSP4000B', 'DSP 4000B'),
  ...M('eventide-instant-phaser', 'PS-101', 'PS101'),
  ...M('fmr-audio-rnc', 'RNC1773', 'Really Nice Compressor'), ...M('fmr-audio-rnp', 'RNP8380', 'Really Nice Preamp'),
  ...M('fmr-audio-rnla', 'RNLA7239', 'Really Nice Leveling Amplifier'),
  ...M('tc-electronic-2290', 'TC 2290', 'TC2290'), ...M('tc-electronic-1210', 'TC 1210', 'TC1210'),
  ...M('tube-tech-lca-2b', 'LCA 2A', 'LCA2A', 'LCA-2A'), ...M('tube-tech-pe-1c', 'PE 1B', 'PE1B', 'PE-1B'),
  ...M('tube-tech-me-1b', 'ME 1A', 'ME1A', 'ME-1A'),
  { product_id: 'p-tube-tech-cl1b', type: 'SKU', value: 'CL 1B' },
]

/** Listing titles production holds as live score-80 aliases on the Tube-Tech rows (synonym, 2026-10-21). */
const SYNONYMS = [
  ['Tube-Tech Upgraded & Modified LCA 2B Dual Channel Tube VCA Compressor / Limiter', 'tube-tech-lca-2b'],
  ['Tube-Tech CL 1A Mono Opto Compressor Vintage Rare Lydkraft pre CL1B CL-1B CL1A', 'tube-tech-cl-1a'],
  ['Tube-Tech CL 1B (Brand New Unopened Box)', 'tube-tech-cl1b'],
].map(([alias, canonical_query]) => ({ alias, canonical_query }))

const index = buildMatchIndex(PRODUCTS, IDENTS, SYNONYMS, [
  'eventide', 'fmr audio', 'tc electronic', 'tube-tech', 'roland', 'boss', 'shure', 'warm audio', 'rupert neve designs', 'strymon', 'mxr', 'suhr',
])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notOurs = (title: string) => {
  const d = String(decide(title))
  assert.ok(![...config.promoted, ...config.supportedToday].includes(d), `${title} → ${d}`)
}

test('every promoted row has a boundary, the config lists 42 rows, and the two families hold six of them', () => {
  assert.equal(config.promoted.length, 42)
  assert.equal(new Set([...config.promoted, ...config.supportedToday]).size, 46)
  for (const slug of [...config.promoted, ...config.supportedToday]) {
    assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
  const fam = (slug: string) => NAVIGATION_FAMILIES.find((f) => f.slug === slug)!
  assert.deepEqual(fam('eventide-factor-pedals').children, ['eventide-timefactor', 'eventide-pitchfactor', 'eventide-modfactor', 'eventide-space'])
  assert.deepEqual(fam('eventide-h9-pedals').children, ['eventide-h9-max', 'eventide-h9-core'])
  for (const f of ['eventide-factor-pedals', 'eventide-h9-pedals']) {
    for (const c of fam(f).children) {
      assert.ok(config.promoted.includes(c), c)
      // A family label must never equal a child's name (catalogue-audit, family_label_equals_child_name).
      assert.notEqual(fam(f).label.toLowerCase(), PRODUCTS.find((p) => p.slug === c)!.canonical_name.toLowerCase())
    }
  }
})

test('the sellers\' names of the three makers count for the confidence floor', () => {
  assert.ok(makerNamed('tube tech cl 1b - compressor (mono)', 'tube-tech'))
  assert.ok(makerNamed('tubetech cl1b tube optical compressor', 'tube-tech'))
  assert.ok(makerNamed('fmr rnc1773 really nice compressor', 'fmr audio'))
  assert.ok(makerNamed('t.c. electronic tc 2290 dynamic digital delay', 'tc electronic'))
  assert.ok(makerNamed('t.c electronic 1210', 'tc electronic'))
  assert.equal(makerNamed('rupert neve designs rnp2 mbc portico ii', 'fmr audio'), false)
})

test('the H9: the Max, a bare H9 and the Dark are one row, the Core and the Standard the other; the H90 is its own', () => {
  matches('Eventide H9 Max Harmonizer Effects Processor', 'eventide-h9-max')
  matches('Eventide H9 Max Dark - w/power supply', 'eventide-h9-max')
  matches('Eventide H9 Harmonizer effektpedal', 'eventide-h9-max') // DBA
  matches('Eventide H9 Max With Mission SP-H9 Expression Pedal', 'eventide-h9-max')
  matches('Eventide H9 Max with Barn 3 OX9', 'eventide-h9-max')
  matches('Eventide H9 Core Harmonizer Multi-Effect Pedal', 'eventide-h9-core')
  matches('Eventide H9 Core with Barn3 OX9 Switch', 'eventide-h9-core')
  matches('Eventide H9 Standard', 'eventide-h9-core') // synthetic: the identifier
  // The tier word apart from the code names no Core candidate (the model tier reads "H9 Core" as one phrase), but the
  // Max row refuses it: the title is no row, never the Max.
  notOurs('Eventide H9 Harmonizer Standard Multi-Effect Pedal w/Original Box +Power Supply | Fast Shipping!')
  matches('Eventide H90 Harmonizer - som ny!', 'eventide-h90') // DBA
  matches('Eventide H90 Harmonizer and Mission H9 Controller Pedal', 'eventide-h90')
  notOurs('Eventide H9 Max + H9 Core')
  notOurs('Eventide H9 Max  AND H9 Core Harmonizer/Effect Processors')
  notOurs('Shure BLX288/SM58-H9 Dual Handheld Wireless Microphone System 512 to 542 MHz')
  notOurs('Shure BLX288/SM58 Dual Channel Wireless Handheld Microphone System - H9 Band  - BLACK')
  matches('Eventide H9000', 'eventide-h9000') // DBA: the H9000 rack, never the H9
})

test('the Factor pedals and the Space: each its own word beside Eventide; a two-pedal title, a PSU and a Space Echo are no row', () => {
  matches('Eventide TimeFactor', 'eventide-timefactor') // DBA
  matches('Eventide Timefactor Twin Delay Looper W/ OEM POWER SUPPLY Studio Quality Time Factor Midi In, Out', 'eventide-timefactor')
  matches('Eventide TimeFactor (with T1M aux switch & power supply)', 'eventide-timefactor')
  matches('Eventide Pitchfactor', 'eventide-pitchfactor') // DBA
  matches('Eventide Mod Factor Modulation Guitar Effects Pedal with Power Supply modfactor', 'eventide-modfactor')
  matches('Eventide Space', 'eventide-space') // DBA
  matches('Eventide Space Reverb Pedal with Power Supply', 'eventide-space')
  notOurs('Eventide Space Reverb Pedal and Eventide Timefactor Delay Pedal - package deal')
  notOurs('230v U.K. power for Eventide Space, PitchFactor, TimeFactor, ModFactor, etc.')
  notOurs('Eventide Powerfactor 2 Strømforsyning') // DBA
  notOurs('Eventide Pitchfactor Pitch Factor Parts / Repair')
  notOurs('Restand Eventide Space & xFactor Stand - Desktop Stand')
  notOurs('Eventide-Time Factor, VooDoo Labs Sparkle Overdrive')
  notOurs('Boss RE-2 Space Echo guitarpedal') // DBA
  notOurs('Roland Space Echo RE-150 bånd-eko effektprocessor') // DBA
  notOurs('Death by Audio Space Bender') // DBA
  notOurs('Myvolts.com Eventide SPACE reverb Power adapter')
})

test('the dot9 pedals, the Rose and the Knife Drop; a Floyd Rose, a plug-in and a pedal bundle are not', () => {
  matches('Eventide Blackhole Reverb Pedal', 'eventide-blackhole') // synthetic, the CSP's own words
  matches('Mint Eventide Blackhole Reverb W/ Power Supply Mint Condition', 'eventide-blackhole')
  matches('Eventide MicroPitch Delay Pedal 2021 - Red - w/box/candy/power supply', 'eventide-micropitch')
  matches('Eventide MicroPitch Delay Pitch Shift Pedal (Like H3000/H910)', 'eventide-micropitch')
  matches('Eventide UltraTap Pedal - with preset overlays', 'eventide-ultratap')
  matches('Eventide TriceraChorus Pedal plus a One Spot Power Supply', 'eventide-tricerachorus')
  matches('Eventide Riptide Overdrive/Vibrato Pedal + Gator 9V Power Supply Combo', 'eventide-riptide')
  matches('Eventide Rose Delay', 'eventide-rose') // DBA
  matches('Eventide Rose Bucket Brigade Delay with Auxiliary Foot Controller', 'eventide-rose')
  matches('Eventide Third Man Hardware Knife Drop 2024 - Present - Black / Yellow, w/Barn3 Footswitch', 'eventide-knife-drop')
  notOurs('Guitar Pedals Bundle Eventide Tricerachorus, Suhr Shiba Drive, MXR UniVibe')
  notOurs('Eventide Blackhole Plug-in (Download)') // synthetic
  notOurs('Jackson elektrisk guitar sort King V Floyd Rose') // DBA
  notOurs('Gretsch Tennessee Rose 6119-62 - Japan Med originalt garantibevis.') // DBA
  notOurs('ESP Custom Shop Eclipse Singlecut Les Paul FR Floyd Rose Guitar MIJ Japan') // DBA
  notOurs('Third Man Records Knife Drop Sub-Octave Fuzz/Synth (Nearly New)')
})

test('the racks: the H3500 is the H3000\'s row, the variants reach their row, and the parts, plug-ins and remotes stay out', () => {
  matches('Eventide H3000 Ultra-Harmonizer 1980s - Black', 'eventide-h3000')
  matches('Eventide H3000-D/SE Ultra-Harmonizer 1980s - Black', 'eventide-h3000')
  matches('Eventide H3000 B Broadcaster Version Ultra-Harmonizer', 'eventide-h3000')
  matches('Eventide H3500B-DFX Dynamic Ultra-Harmonizer 1990s', 'eventide-h3000')
  matches('Eventide H3000 Upgraded to H3500B-DFX', 'eventide-h3000')
  matches('Eventide H910 Harmonizer 1970s - Black', 'eventide-h910')
  matches('Eventide Clockworks H910 Harmonizer', 'eventide-h910')
  matches('Eventide H 910', 'eventide-h910')
  matches('Eventide Harmonizer Model H949 - Pro Serviced - vintage classic! (like H910 H3000)', 'eventide-h949')
  matches('Eventide H969 Harmonizer, pro serviced', 'eventide-h969')
  matches('Eventide DSP 4000B', 'eventide-dsp4000')
  matches('Eventide H8000FW 8-Channel Digital Effects Processor', 'eventide-h8000')
  matches('Eventide H8000A 8-Channel Digital Effects Processor 2010s - Silver', 'eventide-h8000')
  matches('☆ VERY CLEAN !☆RARE !☆ EVENTIDE H7600 *24bit 96khz Multi Effects Processor☆ H3000 * H8000 ☆AMAZING', 'eventide-h7600')
  matches('Eventide Eclipse V4 OS 4.01 Multi-effects Processor', 'eventide-eclipse')
  matches('Eventide H9000R multieffekt rack-processor', 'eventide-h9000') // DBA
  matches('Eventide H9000 with Dante Card', 'eventide-h9000')
  matches('Eventide Orville Harmonizer', 'eventide-orville') // synthetic, the CSP's title
  matches('Eventide SP 2016 Stereo Reverb Signal Processor SP2016 #39207', 'eventide-sp2016')
  matches('Eventide Clockworks PS101 Instant Phaser Vintage Rack Module', 'eventide-instant-phaser')
  matches('Eventide Omnipressor Model 2830 Dynamic Effects Processor', 'eventide-omnipressor') // the CSP's title
  notOurs('Eventide Omnipressor Model 2830Au 50th Anniversary Dynamic Effects Processor 2023 - Present - Black')
  notOurs('Eventide H910 Harmonizer® Plug-In (Download)')
  notOurs('Eventide H910 Bundle')
  notOurs('Eventide Clockworks Bundle H910 H949 Omnipressor SP2016 (Activation Card)')
  notOurs('Eventide H3000 Factory Mk II')
  notOurs('Eventide H3000 Band Delays Mk II (Download)')
  notOurs('☆ Eventide H3000 to H3500B-DFX MAXIMUM Preset OS Upgrade! EVERY Possible Preset ☆ Lifetime Warranty')
  notOurs('Eventide - H3000 , H3500 - New Square Front Switch with led')
  notOurs('Eventide H3000 Harmonizer - DALLAS BATTERY BACKED RAM')
  notOurs('Eventide H3000 H3500 Ultra Harmonizer Memory RAM backup batteries NVRAM SRAM -Used but working')
  notOurs('Original Eventide H3000 D/SX & D/SE ROM set V2.17.  Update/return your Harmonizer to factory spec!')
  notOurs('EVENTIDE H3000 SERVICE MANUAL W SCHEMATICS')
  notOurs('Eventide H3000 Transformer')
  notOurs('H3000/H3500 Power Supply')
  notOurs('Eventide H9000 Dante Expansion Card')
  notOurs('Eventide EVE / NET Remote for H7600 / H8000 / Orville RARE!')
  notOurs('dbx 408 with DBX 303 card (used in Eventide H910/H949/Marshall Time Modulator)')
  notOurs('Eventide PS101 Instant Phaser Replacement Lamp Set')
  notOurs('Eventide FL201 Instant Flanger') // DBA: no row
})

test('FMR Audio: each unit by its code beside FMR or its full name; a racked pair, the 500-series units and a Portico are not', () => {
  matches('FMR Audio Really Nice Compressor RNC 1773', 'fmr-audio-rnc')
  matches('FMR Audio RNC1773 rnc 1773 Really Nice Compressor with Power Supply + Box', 'fmr-audio-rnc')
  matches('FMR Audio RNC Compressor mint! with cables', 'fmr-audio-rnc')
  matches('FMR Audio Really Nice Preamp RNP 8380 + Power Supply', 'fmr-audio-rnp')
  matches('FMR Audio RNLA 7239 Compressor w/ power supply', 'fmr-audio-rnla')
  matches('FMR Audio Really Nice Leveling Amplifier RNLA 7239', 'fmr-audio-rnla')
  notOurs('FMR Audio RNP and RNC in Funk Logic 1RU Rack')
  notOurs('FMR Audio RNLA, RNC, and RNP in 1U Rack')
  notOurs('FMR Audio RNC500 Really Nice Compressor 500 Series - TWO Available - Module 2010s - White')
  notOurs('FMR Audio RNLA 500 Really Nice Leveling Amplifier')
  notOurs('FMR Audio RNC As-is')
  notOurs('FMR Audio PBC-6A Mono Compressor')
  notOurs('Rupert Neve Designs Rnp2 Mbc Portico Ii Master Buss Converter')
  notOurs('Geo Fennel FMR 700 modtager i kuffert') // DBA
})

test('TC Electronic: the 2290 and 1210 racks beside "TC"; the 2290 P pedal, the -DT controllers, a Technics 1210 and the 0144 are not', () => {
  matches('TC Electronic 2290 Dynamic Digital Delay', 'tc-electronic-2290')
  matches('T.C. Electronic TC 2290 Dynamic Digital Delay Effects Processor 8 Seconds !!! CLEAN', 'tc-electronic-2290')
  matches('TC Electronic TC2290 Dynamic Digital Delay', 'tc-electronic-2290')
  matches('Tc 2290 delay', 'tc-electronic-2290') // DBA
  matches('TC 2290 - højeste serienummer', 'tc-electronic-2290') // DBA
  matches('TC Electronic 2290 Dynamic Digital Delay + TC 0144 Foot Controller', 'tc-electronic-2290')
  matches('TC Electronic 1210 Spatial Expander Stereo Chorus Flanger w/ 2 XLR Cables #34741', 'tc-electronic-1210')
  matches('TC 1210 spatial expander', 'tc-electronic-1210')
  matches('T.C Electronic 1210', 'tc-electronic-1210')
  notOurs('TC Electronic 2290 P Dynamic Digital Delay 2023 - Present - Black')
  notOurs('2290P TC Electronic 2290 P Delay / Modulation / Echo effects / Like New!')
  notOurs('TC Electronic 2290 Dynamic Digital Delay Pedal')
  notOurs('TC Electronic 2290-DT Desktop Delay Plugin Controller 2018 - Present - Black')
  notOurs('TC Electronic TC1210-DT')
  notOurs('TC Electronic TC 0144 Controller Pedal For TC2290 Digital Delay!')
  notOurs('tc electronic  - 2290 - Push Button switch')
  notOurs('Battery Replacement Kit for TC Electronic G-Force, 2290 ect')
  notOurs('TC Electronic 19 Inch Rack or desktop Stand for DVR250 TC1210 TC2290 TC8210 Black')
  notOurs('TC Electronic 8210 / 1210 / 2290 / DVR250')
  notOurs('Technics Støvlåg hængsel for SL-1210 MKII') // DBA
  notOurs('Moeck 1210 soprano Blockfløjte') // DBA
  notOurs('Free The Tone Flight Time FT-2Y digital delay pedal til guitar') // DBA, found by "2290"
})

test('Tube-Tech: each model by its code; a predecessor within 25 % is its successor\'s row; bundles, pairs, mods and copies are not', () => {
  matches('Tube-Tech CL 1B Mono Opto Compressor 2010s - Blue', 'tube-tech-cl1b')
  matches('Tube Tech CL 1B - Compressor (Mono)', 'tube-tech-cl1b')
  matches('TubeTech CL1B Tube Optical Compressor', 'tube-tech-cl1b')
  matches('Tube-Tech CL1B Lyndcraft 2020s - Blue', 'tube-tech-cl1b')
  matches('Tube-Tech CL 1B Mono Opto Compressor NEW in the box. CL1B CL-1B Tube Tech. USA 22835', 'tube-tech-cl1b')
  // The CL 1A sells apart in recent years and keeps its row; its sellers name the CL 1B it preceded.
  matches('Tube-Tech CL 1A Mono Opto Compressor Vintage Rare Lydkraft pre CL1B CL-1B CL1A', 'tube-tech-cl-1a')
  matches('Tube-Tech CL 1A Mono Opto Compressor 1980s. SN 635! CL1A CL-1A. CL 1B CL1B', 'tube-tech-cl-1a')
  matches('Tube-Tech  CL 2A Dual-Channel Tube Opto Compressor CL2A', 'tube-tech-cl2a')
  matches('Tubetech CL2A Dual Channel version of CL1B :: Open Box, Ships ASAP', 'tube-tech-cl2a')
  matches('Tube-Tech LCA 2B Dual Channel Tube VCA Compressor / Limiter 2010s - Blue', 'tube-tech-lca-2b')
  matches('Tube-Tech LCA2B Stereo Valve Compressor', 'tube-tech-lca-2b')
  matches('Tube-Tech LCA 2A Dual Channel Tube VCA Compressor / Limiter 2010s - Blue', 'tube-tech-lca-2b')
  matches('Tube-Tech PE 1C Program Equalizer 2010s - Blue', 'tube-tech-pe-1c')
  matches('Tube-Tech PE 1B Program Equalizer - NOS Excellent!', 'tube-tech-pe-1c')
  matches('Tube-Tech ME 1B Midrange Equalizer • Near MINT • Tested', 'tube-tech-me-1b')
  matches('Tube-Tech ME-1A Middle-Range Tube-Based Equalizer EQ Rare 3rd Prototype An ME-1B but hardwired! ME1A', 'tube-tech-me-1b')
  matches('Tube-Tech MP 1A 2-Channel Mic Pre / DI 2000s - Blue', 'tube-tech-mp-1a')
  matches('Tube-Tech MP2A Dual Mic Preamp and DI', 'tube-tech-mp-2a')
  matches('Tube-Tech MEC-1A Recording Channel 2010s - Blue', 'tube-tech-mec-1a')
  matches('Tube Tech MEC 1A  Mic Preamp Recording Channel + Top Zustand + 2 Jahre Garantie', 'tube-tech-mec-1a')
  matches('Tube-Tech SMC-2B Stereo Multiband Compressor  (NEW TUBES / CALIBRATED)', 'tube-tech-smc-2b')
  matches('Tube-Tech SMC 2BM Stereo Mastering Multiband Compressor', 'tube-tech-smc-2bm')
  matches('Tube-Tech HLT 2A Stereo Hi and Lo Shelving Equalizer 2010s - Blue', 'tube-tech-hlt-2a')
  matches('Tube-Tech SSA 2A Stereo Summing Amplifier 2000s - Blue', 'tube-tech-ssa-2a')
  matches('Tube Tech EQ 1A Pultec Style Equalizer', 'tube-tech-eq-1a')
  notOurs('Tube-Tech MEC 1A + MP 2A + LCA 2B Dual Channel Tube VCA Compressor + Rack')
  notOurs('Upgraded & Modified Tube-Tech LCA 2B Dual Channel Tube VCA Compressor / Limiter')
  notOurs('Modified Stereo Mastering Suite Pair: Tubetech LCA2B + EQP2 - stereo compressor and stereo EQ')
  notOurs('Tube-Tech PE 1C Program Equalizer Pair')
  notOurs('Couple of Tube-Tech PE 1C Program Equalizer - Pultec style passive EQ')
  notOurs('Tube-Tech CL 1B & PE 1C Compressor and Equalizer')
  notOurs('Tube-Tech Brochure Pack 1998 -CL1B, MEC1A, LCA2B, MP1A, etc')
  notOurs('Warm Audio WA-1B Tube Tech CL1B-Style All-Tube Optical Compressor')
  notOurs('Tubetech LCA 2A —Vari Mu compressor limiter   read DISCRIPTION  " as is"')
  notOurs('Tube-Tech SMC 2A') // DBA: no SMC 2A row
  notOurs('Tube-Tech MMC 1A Microphone Amplifier and Multiband Compressor 2010s - Blue') // 9 sold: no row
  notOurs('Tube tech pultec eq') // DBA
})
