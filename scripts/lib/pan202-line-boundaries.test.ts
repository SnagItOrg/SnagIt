/**
 * scripts/lib/pan202-line-boundaries.test.ts
 *
 * PAN-202: the Neumann rows the promote SQL moves to `supported`, with the model
 * names and spelling aliases it sets, beside the public U 87 Ai. One test per
 * hazard class, on real production titles (read-only snapshot 2026-10-01). Every
 * test fails on the matcher before this change except the bundle test, which
 * guards the owner-pending Studio Sets on the public U 87 Ai. The last test guards
 * against refusing too much; it fails before this change too, because rows that
 * share a model name (the U 47 fet and its Collector's Edition, the two U 67 rows)
 * tie without their boundaries.
 *
 * Run: npx tsx --test scripts/lib/pan202-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const product = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Neumann ${model_name}`, model_name, brand_name: 'neumann',
  status: 'active', support_state: 'supported',
})
const CE = 'neumann-neumann-u47-fet-collectors-edition'

const products = [
  product('neumann-u87ai', 'U 87 Ai'),
  product('neumann-u87', 'U 87'),
  product('neumann-u47', 'U 47'),
  product('neumann-u47-fet', 'U 47 fet'),
  product(CE, 'U 47 fet'),
  product('neumann-u67', 'U 67'),
  product('neumann-u67-reissue', 'U 67'),
  product('neumann-kh-120-a', 'KH 120'),
  product('neumann-kh-120-ii', 'KH 120 II'),
  product('neumann-kh-80', 'KH 80'),
  product('neumann-kms-104', 'KMS 104'),
  product('neumann-kms-104-plus', 'KMS 104 Plus'),
  product('neumann-km-184', 'KM 184'),
  product('neumann-tlm-102', 'TLM 102'),
  product('neumann-tlm-103', 'TLM 103'),
  product('neumann-tlm-49', 'TLM 49'),
  product('neumann-ndh-20', 'NDH 20'),
  product('neumann-mt-48', 'MT 48'),
]
// The production identifiers on the two rows that hold any (kg_identifier, SKU / MODEL).
const idents = [
  { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U87Ai' },
  { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U 87 Ai' },
  { product_id: 'p-neumann-u47', type: 'SKU', value: 'U47' },
  { product_id: 'p-neumann-u47', type: 'MODEL', value: 'U 47' },
]
// A subset of the spelling aliases the promote SQL adds (canonical_query = the slug).
const synonyms = [
  { alias: 'U47 fet', canonical_query: 'neumann-u47-fet' },
  { alias: 'U47 fet', canonical_query: CE },
  { alias: 'U67', canonical_query: 'neumann-u67' },
  { alias: 'U67', canonical_query: 'neumann-u67-reissue' },
  { alias: 'U87', canonical_query: 'neumann-u87' },
  { alias: 'KH120', canonical_query: 'neumann-kh-120-a' },
  { alias: 'KH120 II', canonical_query: 'neumann-kh-120-ii' },
  { alias: 'KM184', canonical_query: 'neumann-km-184' },
  { alias: 'KMS104', canonical_query: 'neumann-kms-104' },
  { alias: 'KMS104 Plus', canonical_query: 'neumann-kms-104-plus' },
  { alias: 'TLM102', canonical_query: 'neumann-tlm-102' },
]
const BRANDS = ['neumann', 'warm audio', 'jj audio', 'beesneez']
const index = buildMatchIndex(products, idents, synonyms, BRANDS)

const matchedSlug = (title: string, idx = index): string | null => {
  const d = decideMatch(title, idx)
  return d.kind === 'matched' ? idx.productById.get(d.best.product_id)!.slug : null
}
const expectAll = (slug: string | null, titles: string[], idx = index) => {
  for (const t of titles) assert.equal(matchedSlug(t, idx), slug, t)
}

test('pairs and stereo sets are never the single mic or monitor (decision 2)', () => {
  expectAll(null, [
    'Neumann U 87 Ai Large Diaphragm Multipattern Condenser Microphone Stereo Pair - 2024 - Nickel',
    'Neumann U 87 Ai Stero Set w/Case & Shockmounts - Barely Used!',
    'Neumann KM 184 mt Small Diaphragm Cardioid Condenser Microphone Matched Stereo Pair 1993 - Present - Matte Black',
    'NEUMANN KM 184 MT STEREO SET Coppia di Microfoni a Condesatore',
    'Neumann KM 184 Stereo Microphone Set (Black)',
    'Two Neumann KM 184 mt Small Diaphragm Cardioid Condenser Microphone 1993 - Present - Matte Black',
    'Neumann KH 120 II DSP Powered Studio Monitor Pair - Anthracite',
    'Neumann KH-80 DSP Active 4" Studio Monitor (Pair) Black',
    'Neumann TLM 103 (Matched Pair)',
    'Vintage Neumann U47 fet microophones x 3, ex Decca studios',
  ])
})

test('the tube U 47 refuses the fet and the Collector\'s Edition, also when its "U47" SKU fires', () => {
  expectAll('neumann-u47-fet', [
    'Neumann U47 FET Vintage (1979)',
    'Neumann U 47 fet Large Diaphragm Cardioid Condenser Microphone 1969 - 1986 - Nickel',
  ])
  expectAll(CE, [
    "Neumann U47 FET Collector's Edition",
    'Neumann U47 FET Collector’s Edition Mic',
    "Neumann U 47 fet Collector's Edition Condenser Microphone (Open Box)",
  ])
  // Without the fet rows the only candidate is the tube row's own SKU-tier hit (score 95):
  // the boundary removes it, so a fet unit never lands on the tube U 47.
  const tubeOnly = buildMatchIndex([product('neumann-u47', 'U 47')], idents, [], BRANDS)
  const d = decideMatch('Neumann U47 FET Vintage (1979)', tubeOnly)
  assert.equal(d.kind, 'none')
  expectAll(null, ["Neumann U47 FET Collector's Edition", 'Neumann U-47a 1961 - Nickel', 'Neumann U 47 made by Wagner - Nickel'], tubeOnly)
  expectAll('neumann-u47', ['Vintage 1961 Neumann U47 Microphone - NICE!', 'Neumann U 47 1950s - VF14 - M7 - Original PSU'], tubeOnly)
})

test('U 87 against U 87 Ai: the pre-Ai row refuses every Ai spelling, the Ai row the pre-Ai cues', () => {
  expectAll(null, [
    // neumann-u87 refuses "Ai" however it is written; the public row holds no "U87 Ai" alias.
    'Neumann U87 Ai - Nickel',
    'Neumann U87 PAIR Vintage 1970-1980\'s (NOT Ai series)',
    'Neumann U 87 Rhodium Edition Set – 50th Anniversary Limited Edition (Serial No. 176/500)',
    // Frozen: "U 87 Ai (1986-) ONLY; the vintage U 87/U87i is a different circuit and price."
    'Neumann U 87 Ai Large Diaphragm Multipattern Condenser Microphone 1977-85Nickel',
  ])
  expectAll('neumann-u87ai', [
    'Neumann U87Ai Studio Condenser Microphone + Box PROAUDIOSTAR',
    'Neumann U 87 A i 1980s Condenser Microphone. 2nd Generation. U87A i U87Ai U87 Ai. 60812',
    'Neumann U 87 Ai Large Diaphragm Multipattern Condenser Microphone 1986 - Present - Nickel',
  ])
})

test('KH 120 A / II / D, KMS 104 / Plus / D, U 67 vintage / reissue, KM 184 / SKM 184', () => {
  expectAll('neumann-kh-120-ii', ['Neumann KH 120 II Two-Way Active Studio Monitor - Single', 'Neumann KH120 II MK2 (Grey) 245W 5.25" Powered Reference Monitor Active Speaker'])
  expectAll(null, ['Neumann KH120 MKII 5.25" Active Studio Monitor with DSP - 2 Monitors 2025 -  Gray', 'Neumann KH 120 D Digital Studio Monitor'])
  expectAll('neumann-kms-104-plus', ['Neumann KMS 104 Plus Handheld Condenser Microphone (Black)', 'Neumann KMS104 Plus Cardioid Microphone with KMS Pouch'])
  expectAll(null, ['Neumann KMS 104 D Digital Vocal Microphone – Mint Condition'])
  expectAll('neumann-u67-reissue', ['Neumann U67 Reissue', 'Neumann U67 Set', 'Neumann U67 Studio Tube Microphone Set - Re-Issue - B-Stock'])
  expectAll('neumann-u67', ['Neumann U67 Vintage (1964) #2876', 'Vintage Telefunken Neumann U67 Tube Condenser Microphone'])
  expectAll(null, [
    'Neumann Max Kirchner U67 re-issue edition 2022 - Silver',
    'Neumann U 67 SLO Special Limited Offer Reissue Tube Condenser Microphone 1991 - 1992. Perfect U67.',
  ])
  expectAll(null, ['Neumann KM184 (Nickel) Mic Microphone Matched Stereo Pair SKM184 KM184NI'])
})

test('the Neumann parts vocabulary: named parts, capsules, heads, PSUs, mounts, logos, broken units', () => {
  expectAll(null, [
    'NEUMANN EA87 (Nickel) (U87ai dedicated suspension) (Official Japanese product) (Neumann)',
    'Neumann BV08 Genuine Neumann U47 Transformer (NOS)',
    'Neumann K47 Capsule U47 / M49 / U47Fet',
    'Neumann NU67  power supply for Neumann U67 for sale',
    'Neumann U67 power supply Excellent Vintage',
    'Neumann U67  Tube KK 67 microphone head set',
    'Neumann U67 lotto parts original ( five pz)',
    'Telefunken U47 neumann logo original',
    'Neumann KMS104 KMS105 Badge (Red)',
    'Neumann U 87 Ai mt Large Diaphragm Multipattern Condenser Microphone • NEEDS REPAIR!!',
    'Neumann MT 48 MIDI Adapter Set',
    'NEW: JJ Audio Huskey Pup 47: This tube mic is a smaller version of the JJ Audio Huskey  ( U47 )',
    'Neumann TLM 103 D digital Microphone Mint w Accessories',
    'Neumann TLM 103 75th Anniversary Package with EA1 Shockmount 2010s - Silver',
  ])
})

test('the public U 87 Ai keeps its Studio Sets and mic + mount bundles (decision 3, owner pending)', () => {
  expectAll('neumann-u87ai', [
    'Neumann U 87 Ai Studio Set 2010 - Present - Nickel',
    'Neumann U 87 Ai Set Z with Shockmount 1986 - Present - Nickel',
    'Neumann U 87 Ai Large-diaphragm Condenser Mic (Nickel), Neumann WS87 Windscreen, Boseen Mic Shock Mount, ErnieBall XLR Cable, Mic Stand Bundle',
    'Neumann U 87 Ai Condenser Microphone. Mint, like new! U87Ai U87. EA87 Mount. SN 167319',
    'NEUMANN Neumann U87Ai mt Studio Set (Matte Black) (Dedicated Suspension and Case Set) (Official Japanese Product)',
    '*Neumann U 87 Ai sans suspension',
    'Neumann U 87 Ai MT - Purple Badge - West Berlin Era - Serial 54098 - MINT',
  ])
})

test('the instrument still matches: markers, finishes, retail titles, headphones and interfaces', () => {
  const titles: [string, string][] = [
    ['Neumann U67 1965 - with Power Supply/Cable/Shock Mount', 'neumann-u67'],
    ['Neumann TLM 103 with EA1 Shockmount - Nickel', 'neumann-tlm-103'],
    ['NEUMANN TLM 49 Microfono cardioide a capsula larga', 'neumann-tlm-49'],
    ['Neumann TLM102 Studio Set (Black) Condenser Microphone with EA4 Shockmount', 'neumann-tlm-102'],
    ['Neumann TLM 103 Condenser Microphone (Black), ErnieBall XLR Cable, AT ATH-M20X Bundle', 'neumann-tlm-103'],
    ['NEUMANN KM 184 MT Cardioid Studio Condenser Miniature Microphone with clip and windscreen - Black', 'neumann-km-184'],
    ['Neumann KH 120 II Two Way, DSP-powered Nearfied Monitor - White', 'neumann-kh-120-ii'],
    ['Neumann KH 80 DSP Studio Monitor (Single)', 'neumann-kh-80'],
    ['Neumann NDH 20 Closed-back Studio Headphones  Bundle with Mogami Gold Studio Microphone Cable - 25-foot', 'neumann-ndh-20'],
    ['NEUMANN MT 48 U (Audio Interface) (Dante Ready compatible) (Touchscreen) (Built-in DSP effects) (Neumann) (MT48 U)', 'neumann-mt-48'],
    ['1951 Neumann U47 VF14 Telefunken Badged Microphone Chrome Basket Amazing Condition', 'neumann-u47'],
    ['Neumann U47 + spare VF14 - BARGAIN - ABOUT THE BEST YOU WILL FIND late 50s-early 60\'s - Silver', 'neumann-u47'],
  ]
  for (const [title, slug] of titles) assert.equal(matchedSlug(title), slug, title)
})
