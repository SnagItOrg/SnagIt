/**
 * scripts/lib/pan203-line-boundaries.test.ts
 *
 * PAN-203: the Warm Audio rows the promote SQL moves to `supported`, with the model names and
 * spelling aliases it sets, beside the originals Warm Audio copies (Neumann U 87 Ai / U 47 fet /
 * U 67, Universal Audio 1176LN and LA-2A, Neve 1073, Tube-Tech CL 1B). One test per hazard
 * class, on production titles (read-only snapshot 2026-10-01) unless marked synthetic. Every
 * test fails on the matcher before this change except the last two, which guard against
 * refusing too much.
 *
 * Run: npx tsx --test scripts/lib/pan203-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const wa = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Warm Audio ${model_name}`, model_name, brand_name: 'warm audio',
  status: 'active', support_state: 'supported',
})
const orig = (slug: string, brand: string, canonical: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: canonical, model_name, brand_name: brand, status: 'active', support_state: 'supported',
})

const WARM_AUDIO = [
  wa('warm-audio-wa87', 'WA-87'),
  wa('warm-audio-wa-87-r2', 'WA-87 R2'),
  wa('warm-audio-wa-87jr', 'WA-87jr'),
  wa('warm-audio-wa-87jr-se', 'WA-87jr SE'),
  wa('warm-audio-wa47', 'WA-47'),
  wa('warm-audio-wa-47jr', 'WA-47jr'),
  wa('warm-audio-wa-47jr-se', 'WA-47jr SE'),
  wa('warm-audio-wa73', 'WA73'),
  wa('warm-audio-wa73-eq', 'WA73-EQ'),
  wa('warm-audio-wa273', 'WA273'),
  wa('warm-audio-warm-audio-wa273-eq', 'WA273-EQ'),
  wa('warm-audio-wa76', 'WA76'),
  wa('warm-audio-warm-audio-wa-mpx', 'WA-MPX'),
  wa('warm-audio-wa-2mpx', 'WA-2MPX'),
  wa('warm-audio-wa-84', 'WA-84'),
  wa('warm-audio-wa2a', 'WA-2A'),
  wa('warm-audio-wa-19', 'WA-19'),
  wa('warm-audio-wa-67', 'WA-67'),
  wa('warm-audio-wa-cx24', 'WA-CX24'),
  wa('warm-audio-warm-audio-wa-8000', 'WA-8000'),
  wa('warm-audio-warm-audio-wa-44', 'WA-44'),
  wa('warm-audio-warm-audio-wa-1b', 'WA-1B'),
]
const ORIGINALS = [
  orig('neumann-u87ai', 'neumann', 'Neumann U 87 Ai', 'U 87 Ai'),
  orig('neumann-u47-fet', 'neumann', 'Neumann U 47 fet', 'U 47 fet'),
  orig('neumann-u67', 'neumann', 'Neumann U 67', 'U 67'),
  orig('ua-1176ln', 'universal audio', 'Universal Audio 1176LN', '1176LN'),
  orig('ua-la-2a', 'universal audio', 'Universal Audio LA-2A', 'LA-2A'),
  orig('neve-1073', 'neve', 'Neve 1073', '1073'),
  orig('tube-tech-cl1b', 'tube-tech', 'Tube-Tech CL 1B', 'CL 1B'),
]
// The production identifiers on these rows (kg_identifier, SKU / MODEL).
const idents = [
  { product_id: 'p-warm-audio-wa73', type: 'SKU', value: 'WA73' },
  { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U87Ai' },
  { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U 87 Ai' },
]
// A subset of the spelling aliases the promote SQL adds (canonical_query = the slug).
const synonyms = [
  { alias: 'WA87 R2', canonical_query: 'warm-audio-wa-87-r2' },
  { alias: 'Wa 87 Jr', canonical_query: 'warm-audio-wa-87jr' },
  { alias: 'WA-87JR-SE', canonical_query: 'warm-audio-wa-87jr-se' },
  { alias: 'WA-87jr SE-N', canonical_query: 'warm-audio-wa-87jr-se' },
  { alias: 'WA-47 Jr', canonical_query: 'warm-audio-wa-47jr' },
  { alias: 'WA-19N', canonical_query: 'warm-audio-wa-19' },
  { alias: 'WA-2 MPX', canonical_query: 'warm-audio-wa-2mpx' },
]
const BRANDS = ['warm audio', 'neumann', 'universal audio', 'neve', 'tube-tech', 'teletronix']
const index = buildMatchIndex([...WARM_AUDIO, ...ORIGINALS], idents, synonyms, BRANDS)
// The originals alone: today's state, where no Warm Audio row is a match target.
const originalsOnly = buildMatchIndex(ORIGINALS, idents.filter((i) => !i.product_id.startsWith('p-warm')), [], BRANDS)

const matchedSlug = (title: string, idx = index): string | null => {
  const d = decideMatch(title, idx)
  return d.kind === 'matched' ? idx.productById.get(d.best.product_id)!.slug : null
}
const expectAll = (slug: string | null, titles: string[], idx = index) => {
  for (const t of titles) assert.equal(matchedSlug(t, idx), slug, t)
}

test('WA-87 line: the original WA-87, the R2, the jr and the jr SE stay apart', () => {
  expectAll('warm-audio-wa87', [
    'Warm Audio WA-87 Large Diaphragm Multipattern Condenser Microphone 2016 - 2020 - Nickel',
    'Warm Audio WA-87 (Original Version) Large Diaphragm Multipattern Condenser Microphone',
  ])
  expectAll('warm-audio-wa-87-r2', [
    'Warm Audio WA-87 R2 Large Diaphragm Multipattern Condenser Microphone 2020 - Present - Nickel',
    'Warm Audio WA87 R2 Large-diaphragm Condenser Microphone (Black)',
  ])
  expectAll('warm-audio-wa-87jr', ['Warm Audio WA-87jr Large-Diaphragm Condenser Microphone (Black)', 'Warm Audio Wa87 Jrn Wa 87 Jr Nickel'])
  expectAll('warm-audio-wa-87jr-se', [
    'Warm Audio WA-87jr SE Large-Diaphragm Cardioid Condenser Microphone (Black)',
    'Warm Audio WA-87JR SE-N Large-Diaphragm Cardioid Condenser Microphone (Nickel)',
    'Warm Audio WA-87JR-SE Large-Diaphragm Cardioid Condenser Microphone - Black',
  ])
  // Never the R1: a "2020 - Present" R2 listing that omits "R2", and a jr written with quotes.
  expectAll(null, [
    'Warm Audio WA-87 Large Diaphragm Multipattern Condenser Microphone 2020 - Present - Nickel',
    'Warm Audio WA-87 “jr” Large Diaphragm Condenser Microphone Studio Essentials- Black',
  ])
})

test('WA-47 line: the tube WA-47 is never a jr, a jr SE, the WA-47F or the titanium WA-47T', () => {
  expectAll('warm-audio-wa47', ['Warm Audio WA-47 Large Diaphragm Multipattern Tube Condenser Microphone 2018 - Present - Nickel'])
  expectAll('warm-audio-wa-47jr', ['Warm Audio WA-47 Jr FET Condenser Microphone (Nickel)', 'Warm Audio WA-47jr Large Diaphragm Multipattern FET Condenser Microphone'])
  expectAll('warm-audio-wa-47jr-se', ['Warm Audio WA-47jr SE Large-Diaphragm Condenser Microphone (Black)'])
  expectAll(null, [
    'Warm Audio Wa 47 T',
    'Warm Audio WA-47 Large Diaphragm Multipattern Tube Condenser Microphone 2024 - Present - Titanium',
    // synthetic: the fet model written with a space
    'Warm Audio WA-47 F FET condenser microphone',
  ])
})

test('1073 line: WA73, WA73-EQ, WA273 and WA273-EQ; an EQ title is never the plain preamp', () => {
  expectAll('warm-audio-wa73', ['Warm Audio WA73 Single Channel Neve 1073-Style Microphone Preamp Mic Pre'])
  expectAll('warm-audio-wa73-eq', ['Warm Audio WA73-EQ Single Channel Neve 1073-Style Microphone Preamp Mic Pre w/EQ'])
  expectAll('warm-audio-wa273', ['Warm Audio WA273 Preamp - 2nd Hand'])
  expectAll('warm-audio-warm-audio-wa273-eq', ['Warm Audio WA273-EQ Dual Channel British Mic Pre + EQ'])
  // "WA73 EQ" is the WA73-EQ (its model name with a space), never the WA73 (synthetic spelling).
  expectAll('warm-audio-wa73-eq', ['Warm Audio WA73 EQ 1073 style preamp'])
  // A "WA273" that says EQ is unclear between the two: it lands on neither.
  expectAll(null, ['Warm Audio WA273 1073 Style Two Channel Microphone Preamp And EQ'])
})

test('WA76 vs the two-channel D2 / A2; WA-MPX vs WA-2MPX', () => {
  expectAll('warm-audio-wa76', ['Warm Audio WA76 Limiting Amplifier 2014 - Present - Black'])
  expectAll(null, ['Warm Audio Wa76 D2', 'Warm Audio WA76 D2 2025', 'Warm Audio Wa76 A2'])
  expectAll('warm-audio-wa-2mpx', ['Warm Audio WA-2MPX Dual-Channel Tube Mic Preamp', 'Warm Audio WA-2 MPX  dual Tube PreAmp'])
  expectAll('warm-audio-warm-audio-wa-mpx', ['Warm Audio WA-MPX Single Channel Tube Mic Preamp'])
})

test('pairs and packs are never the single unit; the two-channel units keep "dual" and "stereo"', () => {
  expectAll(null, [
    'Warm Audio WA-87 R2 Pair (2x) - Mint / Like New - Original Boxes',
    'Warm Audio WA-87 R2 TS Large-diaphragm Condenser Microphone Stereo Pair - Limited-edition Titanium',
    'Warm Audio WA-2A Stereo Pair',
    'Warm Audio WA-47 Large-diaphragm Tube Condenser Microphone (3-pack)',
    'Warm Audio WA-47 Large-diaphragm Tube Condenser Microphone (2-pack)',
    '(2) Warm Audio WA76 Limiting Amplifier 2014 - Present - Black',
    'WARM AUDIO WA-84 Black Coppia Stereo',
    'Warm Audio WA-84 Microphone Stereo Pair-Nickel *USA Small Business*',
    'Warm Audio WA-1B Tube Opto Compressor [PAIR]',
  ])
  expectAll('warm-audio-wa-cx24', [
    'Warm Audio WA-CX24 Stereo Tube Condenser Microphone w/Tweed Case, PSU, IEC Cable, Gotham 9-Pin Cable, Wood Box & 2x Shockmount',
    'WARM AUDIO WA-CX24 Dual Capsule Studio Tube Microphone',
  ])
})

test('parts, modified units and units for repair are never the product', () => {
  expectAll(null, [
    'Warm Audio Flight Case Per Wa 67',
    'WARM AUDIO Flight Case per WA-67',
    'Revive Audio Modified: Warm Audio WA73 1-Channel British Microphone Preamp',
    'Warm Audio WA-47 M7 Capsule ZenPro Mod Edition',
    'Warm Audio WA-87 R2 ZenPro Mod',
    'Warm Audio WA-8000 Upgraded by Erikson Labs w. Sony Capsule and new Internals',
    'WARM AUDIO WA-87 R2 MULTI-PATTERN LARGE DIAPHRAGM CONDENSER MIC MICROPHONE- BLACK W/ TAB-FUNKENWERK AMI T13 TRANSFORMER',
  ])
})

test('clone guard, direction 1: a Warm Audio title never lands on the original it copies', () => {
  const titles = [
    // production
    'Warm Audio WA-87 R2 (Nickel) U87 Style Large Diaphragm Mic Condenser Microphone',
    'Warm Audio WA-47F Neumann/Telefunken U47 Replica. Large-diaphragm FET Condenser Mic',
    'Warm Audio WA-67 Neumann U67 Style Large Diaphragm Mic Tube Microphone',
    'Warm Audio WA76 1176 Compressor Rev. D',
    'Warm Audio WA273-EQ  2 CH 1073 STYLE MIC PRE W/EQ',
    'Warm Audio WA-1B Tube Tech CL1B-Style All-Tube Optical Compressor',
    'Warm Audio WA-2A Leveling Amplifier - LA-2A Style Tube Compressor',
    // synthetic: no "style", no "clone", the original named in full
    'Warm Audio WA76-D2 Universal Audio 1176LN stereo',
    'Warm Audio WA-1B Tube-Tech CL 1B',
    'Neumann U 87 Ai Warm Audio',
    'Neumann U47 fet Warm Audio WA-47F',
    'Universal Audio 1176LN WA76',
    'Warm Audio WA73 Neve 1073',
    'Warm Audio WA-2A Universal Audio LA-2A',
  ]
  const originals = new Set(ORIGINALS.map((p) => p.slug))
  for (const idx of [index, originalsOnly]) {
    for (const t of titles) {
      const s = matchedSlug(t, idx)
      assert.ok(s === null || !originals.has(s), `${t} -> ${s}`)
    }
  }
})

test('clone guard, direction 2: a title led by the maker of an original never lands on a Warm Audio row', () => {
  // synthetic: comparison and bundle titles that lead with the original's maker
  expectAll(null, [
    'Neve 1073 Warm Audio WA73',
    'Teletronix LA-2A Warm Audio WA-2A',
    'Universal Audio 1176LN Warm Audio WA76',
    'Tube-Tech CL 1B Warm Audio WA-1B',
    'Neumann U87 Ai vs Warm Audio WA-87 R2',
  ])
})

test('the originals still match their own titles', () => {
  expectAll('neumann-u87ai', ['Neumann U87Ai Large Diaphragm Condenser Microphone'])
  expectAll('ua-1176ln', ['Universal Audio 1176LN Limiting Amplifier'])
  expectAll('tube-tech-cl1b', ['Tube-Tech CL 1B Compressor'])
  expectAll('neve-1073', ['Neve 1073 Mic Pre'])
  for (const t of ['Universal Audio 1176LN Limiting Amplifier', 'Tube-Tech CL 1B Compressor']) {
    assert.equal(matchedSlug(t, originalsOnly), matchedSlug(t, index), t)
  }
})

test('Warm Audio titles naming the original, bundles and features still land on their own row', () => {
  expectAll('warm-audio-wa76', ['Warm Audio WA76 1176 Compressor Rev. D', 'Warm Audio WA76 Compressor (1176 Clone)'])
  expectAll('warm-audio-wa73', ['Warm Audio WA73 Single-Channel Microphone Preamp, Presonus HD9 Headphone Bundle'])
  expectAll('warm-audio-warm-audio-wa-1b', ['Warm Audio WA-1B All-Tube Transformer-Balanced Optical Compressor'])
  expectAll('warm-audio-warm-audio-wa-8000', ['Warm Audio WA-8000 Large Diaphragm Tube Condenser Microphone black carrying case included'])
  expectAll('warm-audio-warm-audio-wa-44', ['Warm Audio WA-44 Studio Ribbon Microphone Dual Capsule'])
  expectAll('warm-audio-wa-19', ['Warm Audio WA-19N Dynamic Cardioid Studio Microphone (Nickel)'])
  expectAll('warm-audio-wa2a', ['Warm Audio WA2A WA-2A LA-2A Style Tube Compressor w/ Cinemag I/O Transformers'])
})
