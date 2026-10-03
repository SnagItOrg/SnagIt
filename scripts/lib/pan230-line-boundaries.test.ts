/**
 * scripts/lib/pan230-line-boundaries.test.ts
 *
 * PAN-230 step 5, tranche 1: the 14 legendary rows the PAN-230 promote SQL moves to `supported`, with
 * the model names it sets and the aliases it adds. On production titles (the unmatched active titles
 * naming each model, read-only snapshot 2026-10-03), plus each row's Reverb page title where the pool
 * held no clean unit.
 *
 * Run: npx tsx --test scripts/lib/pan230-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** The promoted state: the 14 rows, the KM 184 that the KM 84 must not take, and the model names the promote SQL sets. */
const PRODUCTS: Product[] = [
  row('shure-sm57', 'shure', 'Shure SM57', 'SM57'),
  row('shure-sm7b', 'shure', 'Shure SM7B', 'SM7B'),
  row('peavey-5150', 'peavey', 'Peavey 5150', '5150'),
  row('marshall-2555-silver-jubilee', 'marshall', 'Marshall 2555 Silver Jubilee', '2555 Silver Jubilee'),
  row('mxr-m117r-flanger', 'mxr', 'MXR M117R Flanger', 'M117R'),
  row('sony-c800g', 'sony', 'Sony C800G', 'C800G'),
  row('sony-c-37a', 'sony', 'Sony C-37A', 'C-37A'),
  row('fender-6g15-reverb-unit', 'fender', 'Fender 6G15 Reverb Unit', '6G15'),
  row('neumann-km-84', 'neumann', 'Neumann KM 84', 'KM 84'),
  row('neumann-km-184', 'neumann', 'Neumann KM 184', 'KM 184'),
  row('suhr-pt100', 'suhr', 'Suhr PT100', 'PT100'),
  row('roland-sdd-320-dimension-d', 'roland', 'Roland SDD-320 Dimension D', 'SDD-320'),
  row('ampex-atr-102', 'ampex', 'Ampex ATR-102', 'ATR-102'),
  row('ua-la-2a', 'universal audio', 'Universal Audio LA-2A', 'LA-2A'),
  row('ua-la-3a', 'universal audio', 'Universal Audio LA-3A', 'LA-3A'),
]

/** The aliases the promote SQL adds (every one carries the brand or the model's own name). */
const ALIASES = [
  { alias: "Ampex ATR102", canonical_query: 'ampex-atr-102' },
  { alias: "Silver Jubilee 2555", canonical_query: 'marshall-2555-silver-jubilee' },
  { alias: "JCM25/50", canonical_query: 'marshall-2555-silver-jubilee' },
  { alias: "JCM 25/50", canonical_query: 'marshall-2555-silver-jubilee' },
  { alias: "MXR M-117R", canonical_query: 'mxr-m117r-flanger' },
  { alias: "MXR M117 R", canonical_query: 'mxr-m117r-flanger' },
  { alias: "Dunlop M-117R", canonical_query: 'mxr-m117r-flanger' },
  { alias: "Neumann KM84", canonical_query: 'neumann-km-84' },
  { alias: "Neumann KM-84", canonical_query: 'neumann-km-84' },
  { alias: "Neumann KM84i", canonical_query: 'neumann-km-84' },
  { alias: "Neumann KM-84i", canonical_query: 'neumann-km-84' },
  { alias: "Neumann KMi-84", canonical_query: 'neumann-km-84' },
  { alias: "Roland Dimension D", canonical_query: 'roland-sdd-320-dimension-d' },
  { alias: "Shure SM57-LC", canonical_query: 'shure-sm57' },
  { alias: "Shure SM57-LCE", canonical_query: 'shure-sm57' },
  { alias: "Shure SM-57", canonical_query: 'shure-sm57' },
  { alias: "Shure SM 57", canonical_query: 'shure-sm57' },
  { alias: "Shure SM-7B", canonical_query: 'shure-sm7b' },
  { alias: "Shure SM 7B", canonical_query: 'shure-sm7b' },
  { alias: "Sony C37A", canonical_query: 'sony-c-37a' },
  { alias: "Sony C-800G", canonical_query: 'sony-c800g' },
  { alias: "Sony C 800G", canonical_query: 'sony-c800g' },
  { alias: "Sony C800-G", canonical_query: 'sony-c800g' },
  { alias: "Suhr PT-100", canonical_query: 'suhr-pt100' },
  { alias: "Suhr PT 100", canonical_query: 'suhr-pt100' },
  { alias: "Universal Audio LA2A", canonical_query: 'ua-la-2a' },
  { alias: "Teletronix LA2A", canonical_query: 'ua-la-2a' },
  { alias: "Universal Audio LA3A", canonical_query: 'ua-la-3a' },
  { alias: "Urei LA3A", canonical_query: 'ua-la-3a' },
  { alias: "Urei LA 3A", canonical_query: 'ua-la-3a' },
  { alias: "Urei LA-3A", canonical_query: 'ua-la-3a' },
]

const index = buildMatchIndex(PRODUCTS, [], ALIASES,
  ['shure', 'peavey', 'marshall', 'mxr', 'sony', 'fender', 'neumann', 'suhr', 'roland', 'ampex', 'universal audio', 'warm audio', 'manley', 'boss', 'behringer'])

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-230: the SM57 and the SM7B are the mic, not a screen, a clip set or a bundle', () => {
  assert.equal(matchedSlug('Shure SM57 Cardioid Dynamic Microphone 1984 - Present - Black'), 'shure-sm57')
  assert.equal(matchedSlug('Shure SM57-LC Cardioid Dynamic Instrument Microphone'), 'shure-sm57')
  assert.equal(matchedSlug('SHURE SM57 DYNAMIC MICROPHONE with SHURE A2WS WINDSCREEN and BAG MINT MINT MINT'), 'shure-sm57')
  assert.equal(matchedSlug('Shure RK244G Screen and Grille for SM57 and 545'), null)
  assert.equal(matchedSlug('Shure SM7B Cardioid Dynamic Microphone 2001 - Present - Black'), 'shure-sm7b')
  assert.equal(matchedSlug('Shure SM7B Cardioid Dynamic Studio Vocal Microphone, includes standard and close-talk windscreens'), 'shure-sm7b')
  assert.equal(matchedSlug('Shure A7WS Broadcast-Style Windscreen for SM7, SM7A, and SM7B'), null)
  assert.equal(matchedSlug('Shure SRH840A+SM7B SM7B Studio Vocal Microphone and SRH840A Monitoring Headphones'), null)
  assert.equal(matchedSlug('Manley Massive Passive Stereo Tube EQ, Shure SM7B Cardioid, ErnieBall XLR Bundle'), null)
})

test('PAN-230: the 5150 head is not its combo, a cabinet, a retube kit or a cover', () => {
  assert.equal(matchedSlug('Peavey 5150 "Block Letter" 2-Channel 120-Watt Guitar Amp Head'), 'peavey-5150')
  assert.equal(matchedSlug('Peavey 5150 Combo 2x12 #08388636 Second Hand'), null)
  assert.equal(matchedSlug("Peavey 5150 Standard Option JJ Retube(TM) Kit with 6L6GC's"), null)
  assert.equal(matchedSlug('Amp Head Cover PEAVEY 5150  1992 to 2004 Black dust cover nylon Water resistant'), null)
})

test('PAN-230: the 1987–88 2555 is not the 2555X reissue, a stack or a retube kit', () => {
  assert.equal(matchedSlug('Marshall JCM25/50 "Silver Jubilee" Model 2555 2-Channel 100-Watt Guitar Amp Head 1987 - 1988'), 'marshall-2555-silver-jubilee')
  assert.equal(matchedSlug('Marshall Silver Jubilee 2555X Reissue 2-Channel 100-Watt Guitar Amp Head 2015 - Present - Silver'), null)
  assert.equal(matchedSlug('Marshall Silver Jubilee 2555 100W Head with Footswitch & Matching 2551A/2551B'), null)
  assert.equal(matchedSlug("Marshall 2555 Silver Jubilee Standard JJ Retube(TM) Kit with EL34's"), null)
})

test('PAN-230: the M117R reissue in every spelling, never the 1976 M-117', () => {
  assert.equal(matchedSlug('MXR M117R Flanger 2004 - Present - Black'), 'mxr-m117r-flanger')
  assert.equal(matchedSlug('MXR M-117R Flanger Pedal'), 'mxr-m117r-flanger')
  assert.equal(matchedSlug('MXR - Flanger #M117R'), 'mxr-m117r-flanger')
  assert.equal(matchedSlug('New MXR M-117 Flanger Epic Guitar Effect pedal, Help Support Smal Business & Buy It Here !'), null)
})

test('PAN-230: the Sony mics are the mic, not the tubes sold for it, a clone, a pair or a capsule', () => {
  assert.equal(matchedSlug('Sony C800G 2010s - Black'), 'sony-c800g')
  assert.equal(matchedSlug('Sony C-800G Vacuum Tube Condenser Microphone w/ Power Supply'), 'sony-c800g')
  assert.equal(matchedSlug('1 x Rare Sealed True NOS 6AU6A Hitachi Mic / Pre / Tuner / Vocal Tube ~ Sony C800g ~ WA8000 ~ MK1 + more ~ Pre'), null)
  assert.equal(matchedSlug('JJ Audio Akita (Sony c800g clone)'), null)
  assert.equal(matchedSlug('Sony C-37A Tube Condenser Microphone 1960s - Blue'), 'sony-c-37a')
  assert.equal(matchedSlug("Sony C-37A Tube Condenser Microphone Pair w PSU's (1959 and 1963)"), null)
  assert.equal(matchedSlug('Sony C-37a Capsule Only  part # A-8262983A vintage. NEW OLD STOCK'), null)
})

test('PAN-230: the 6G15 needs a year or a period word, and is never the reissue or a transformer', () => {
  assert.equal(matchedSlug('Fender Reverb Unit 6G15 1963 - 1966 - Black'), 'fender-6g15-reverb-unit')
  assert.equal(matchedSlug('Vintage Fender 6G15 Reverb Unit - 1962'), 'fender-6g15-reverb-unit')
  assert.equal(matchedSlug("1990s Fender '63 Spring Reverb Unit Reissue 6G15"), null)
  assert.equal(matchedSlug('Pacific Transformer Fender 6G15 Brownface Reverb Unit Output Transformer'), null)
  assert.equal(matchedSlug('Fender 6G15 Reverb Unit'), null)
})

test('PAN-230: the KM 84 is one mic, never the KM 184, a pair or a trio', () => {
  assert.equal(matchedSlug('Neumann KM 84 Small Diaphragm Cardioid Condenser Microphone 1966 - 1992 - Nickel'), 'neumann-km-84')
  assert.equal(matchedSlug('Neumann KM84'), 'neumann-km-84')
  assert.equal(matchedSlug('Neumann KM 184 Small Diaphragm Cardioid Condenser Microphone'), 'neumann-km-184')
  assert.equal(matchedSlug('Neumann KM 84 Small Diaphragm Cardioid Condenser Microphone Stereo Pair 1966 - 1992 - Nickel'), null)
  assert.equal(matchedSlug('Matched Trio Neumann  Km84 1980 - Black'), null)
})

test('PAN-230: the PT100 head is not its cabinets', () => {
  assert.equal(matchedSlug('Suhr PT100 Pete Thorn Signature Edition 3-Channel 100-Watt Guitar Amp Head 2014 - Present - Black'), 'suhr-pt100')
  assert.equal(matchedSlug('Suhr PT-100. Pete Thorn Signature, 100W (UK), 240V'), 'suhr-pt100')
  assert.equal(matchedSlug('Suhr PT100 4X12 Speaker Cabinet'), null)
  assert.equal(matchedSlug('Suhr PT100 2x12'), null)
})

test('PAN-230: the SDD-320 in both word orders, never its PCB or rack ears', () => {
  assert.equal(matchedSlug('Roland SDD-320 Dimension D 1979 - 1987 - Black'), 'roland-sdd-320-dimension-d')
  assert.equal(matchedSlug('ROLAND DIMENSION D SDD-320 sdd 320 Vintage Chorus'), 'roland-sdd-320-dimension-d')
  assert.equal(matchedSlug('Roland SDD 320 Dimension D PCB'), null)
  assert.equal(matchedSlug('Rack ears to fit the Roland SVC-350 SPV-355 SBF-325 SDD-320 units with screws'), null)
})

test('PAN-230: the ATR-102 is the machine, not a card, the remote, a stand or a plug-in', () => {
  assert.equal(matchedSlug('1976 Ampex ATR-102 1/2" 2-Track Reel Tape Recorder Master Analog Restored'), 'ampex-atr-102')
  assert.equal(matchedSlug('Ampex ATR-102 4 Channel Remote Control Unit'), null)
  assert.equal(matchedSlug('Ampex ATR-102 STAND ONLY for 1/2" 2-Track Reel-to-Reel Vintage Mastering Tape Recorder as is'), null)
  assert.equal(matchedSlug('Universal Audio UAD Ampex ATR-102 Mastering Tape Recorder Plug-In'), null)
})

test('PAN-230: the LA-2A hardware reissue, never the UAFX pedal, a plug-in, the LA-610, a pair or a clone', () => {
  assert.equal(matchedSlug('Universal Audio LA-2A Leveling Amplifier / Optical Compressor 2000 - Present - Gray'), 'ua-la-2a')
  assert.equal(matchedSlug('Universal Audio Teletronix LA-2A Classic Leveling Amplifier'), 'ua-la-2a')
  assert.equal(matchedSlug('UNIVERSAL AUDIO TELETRONIX LA2A Legendary Optical Tube Compression Amplifier'), 'ua-la-2a')
  assert.equal(matchedSlug('Universal Audio Teletronix LA-2A Studio Compressor 2023 - Present - Silver'), null)
  assert.equal(matchedSlug('Universal Audio UAFX Teletronix LA-2A Studio Compressor Guitar Pedal'), null)
  assert.equal(matchedSlug('Universal Audio UAD Teletronix LA-2A Leveler Plug-In Collection'), null)
  assert.equal(matchedSlug('Universal Audio LA-2A - (1 of 2) Sequential Pair'), null)
  assert.equal(matchedSlug('Universal Audio LA-610 MkII Solo 610 Tube Mic Pre + LA2A LA-2A Style Compressor'), null)
  assert.equal(matchedSlug('Warm Audio WA-2A Tube Opto Compressor'), null)
})

test('PAN-230: the LA-3A, never a plug-in or a pair', () => {
  assert.equal(matchedSlug('Universal Audio LA-3A Reissue Audio Leveler 2000s - Black Panel'), 'ua-la-3a')
  assert.equal(matchedSlug('Universal Audio LA-3A Reissue Audio Leveler Stereo Pair 2000s - Black Panel'), null)
  assert.equal(matchedSlug('UAD Teletronix LA-3A Classic Audio Leveler Plug-in (Activation Card)'), null)
})
