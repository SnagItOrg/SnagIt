/**
 * PAN-151 — the dba brand net's resolver: the two PAN-125 collisions, and one
 * listing per resolution state.
 *
 * The fixture is a hand-built KG shaped like production's: model lines emerge
 * from several products sharing a word (Juno-60 / Juno-106 / Juno-D), a
 * line-label row ("Cube") and a bare-line alias ("juno") exist exactly as the
 * collision needs them, and MC-505 has a NULL model_name the way many real
 * rows do. Every title is a real dba.dk title from the 2026-09-25 dry run.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import type { Product } from '../../frontend/lib/matching/match-listings'
import {
  buildBrandNetContext,
  resolveBrandNetListing,
  type BrandNetResolution,
} from './brand-net-resolution'

const product = (slug: string, brand: string, model: string | null, canonical?: string): Product => ({
  id: slug,
  slug,
  canonical_name: canonical ?? `${brand} ${model}`,
  model_name: model,
  brand_name: brand.toLowerCase(),
  status: 'active',
  support_state: 'known',
})

const PRODUCTS: Product[] = [
  product('roland-juno-60', 'Roland', 'Juno-60'),
  product('roland-juno-106', 'Roland', 'Juno-106'),
  product('roland-juno-d', 'Roland', 'Juno-D'),
  product('roland-cube-street', 'Roland', 'Cube Street'),
  product('roland-cube-lite', 'Roland', 'Cube Lite'),
  // The KG writes `Cube` with a number, so "Cube 30X" is a model number.
  product('roland-cube-40gx', 'Roland', 'Cube-40GX'),
  // A row whose whole model name is a line — the collision's other half.
  product('roland-cube', 'Roland', 'Cube'),
  product('roland-jv-1080', 'Roland', 'JV-1080'),
  product('roland-mc-505', 'Roland', null, 'Roland MC-505'),
  product('fender-player-stratocaster', 'Fender', 'Player Stratocaster'),
  product('fender-american-ultra-stratocaster', 'Fender', 'American Ultra Stratocaster'),
  product('fender-telecaster-thinline', 'Fender', 'Telecaster Thinline'),
  product('fender-telecaster-custom', 'Fender', 'Telecaster Custom'),
  product('fender-telecaster-deluxe', 'Fender', 'Telecaster Deluxe'),
  product('yamaha-p-125', 'Yamaha', 'P-125'),
]
// "juno" as an alias is the PAN-125 collision in its most direct form.
const SYNONYMS = [{ alias: 'juno', canonical_query: 'roland-juno-106' }]

const ctx = buildBrandNetContext(PRODUCTS, [], SYNONYMS)
const resolve = (title: string, brand: string): BrandNetResolution =>
  resolveBrandNetListing({ title, description: title }, brand, ctx)

test('collision: a bare line token never resolves to a terminal product', () => {
  // Without the line rule, the alias sends this to Juno-106 at score 80, and
  // the "Cube" row takes the second title at score 70.
  assert.deepEqual(resolve('Roland Juno synthesizer', 'roland'),
    { kind: 'family_only', line: 'juno', detail: "bare line 'juno'" })
  assert.equal(resolve('Roland Cube guitarforstærker sort', 'roland').kind, 'family_only')
  // …while a terminal model on the same line still resolves.
  const juno106 = resolve('Roland Juno-106 synthesizer keyboard', 'roland')
  assert.equal(juno106.kind, 'kg_product')
  assert.deepEqual(juno106.kind === 'kg_product' && juno106.productIds, ['roland-juno-106'])
})

test('collision: G-1000 survives — a one-letter code is not a stop word', () => {
  for (const title of ['Roland G-1000 keyboard', 'ROLAND G1000', 'Klassisk Roland G-1000 Arranger Workstation (76 tangenter)']) {
    const r = resolve(title, 'roland')
    assert.equal(r.kind, 'candidate', title)
    assert.equal(r.kind === 'candidate' && r.model, 'g-1000', title)
  }
})

test('kg_product: by the matcher, and by a designator the KG holds under another spelling', () => {
  const byMatcher = resolve('Roland Juno-60 synthesizer', 'roland')
  assert.equal(byMatcher.kind === 'kg_product' && byMatcher.via, 'matcher')
  // "JV1080" is not the token "JV-1080", and MC-505's row has no model_name,
  // so the live matcher misses both; the KG still holds them.
  for (const [title, slug] of [['Roland XV3080 modul', null], ['Roland JV1080', 'roland-jv-1080'], ['Roland MC-505 groovebox', 'roland-mc-505']] as const) {
    const r = resolve(title, 'roland')
    if (slug === null) { assert.equal(r.kind, 'candidate', title); continue }
    assert.equal(r.kind, 'kg_product', title)
    assert.deepEqual(r.kind === 'kg_product' && [r.via, r.productIds], ['spelling', [slug]], title)
  }
})

test('candidate: a named model the KG does not hold, by code or by series + line', () => {
  const td = resolve('Roland TD-11 el-trommesæt', 'roland')
  assert.equal(td.kind === 'candidate' && td.model, 'td-11')
  const cube = resolve('Roland Cube 30X guitarforstærker sort', 'roland')
  assert.equal(cube.kind === 'candidate' && cube.model, 'cube-30x')
  const strat = resolve('Fender Road Worn Stratocaster', 'fender')
  assert.equal(strat.kind === 'candidate' && strat.model, 'road worn stratocaster')
})

test('family_only: a line with only facets — origin, year — around it', () => {
  assert.equal(resolve('Fender Stratocaster USA', 'fender').kind, 'family_only')
  // `Telecaster` is never numbered in the KG, so "63" is a year, not a model.
  assert.equal(resolve('Fender Telecaster 63 Mexico', 'fender').kind, 'family_only')
})

test('brand_only: this brand, and nothing that names a model', () => {
  assert.equal(resolve('Roland digitalpiano sort', 'roland').kind, 'brand_only')
  assert.equal(resolve('Fender fretless elbas sort', 'fender').kind, 'brand_only')
})

test('noise: sub-brand, other brand, part, accessory-for, wanted — and a product sold WITH a case is not', () => {
  const reason = (title: string, brand: string) => {
    const r = resolve(title, brand)
    return r.kind === 'noise' ? r.reason : r.kind
  }
  assert.equal(reason('Squier by Fender Stratocaster – sunburst, god stand', 'fender'), 'other_brand')
  assert.equal(reason('Yamaha P-125 klaver', 'roland'), 'other_brand')
  assert.equal(reason('Juno 106 voice chips', 'roland'), 'part_or_accessory')
  assert.equal(reason('Transporttaske til Roland FR1X harmonika', 'roland'), 'part_or_accessory')
  assert.equal(reason('Fender gigbag til guitar', 'fender'), 'part_or_accessory')
  assert.equal(reason('KØBES: Moog Matriarch', 'moog'), 'wanted_or_non_sale')
  assert.equal(reason('Digitalt klaver el-piano sort', 'roland'), 'unbranded')
  assert.equal(reason('Roland Juno-106 med flightcase', 'roland'), 'kg_product')
})

/* ── Round 2: the classes the round-1 hand audit found (21 of 75 wrong) ─────
 *
 * A second fixture, shaped like production's Fender rows: series words
 * (`American`, `Standard`) recur in front of several lines, the way the real
 * KG writes them, so the round-1 line rule would take them for lines. Every
 * title is a real dba.dk title from the 2026-09-25 dry run.
 */

const R2_PRODUCTS: Product[] = [
  product('fender-player-stratocaster', 'Fender', 'Player Stratocaster'),
  product('fender-american-ultra-stratocaster', 'Fender', 'American Ultra Stratocaster'),
  product('fender-american-professional-ii-stratocaster', 'Fender', 'American Professional II Stratocaster'),
  product('fender-american-vintage-ii-stratocaster', 'Fender', 'American Vintage II Stratocaster'),
  product('fender-american-standard-telecaster', 'Fender', 'American Standard Telecaster'),
  product('fender-telecaster-custom', 'Fender', 'Telecaster Custom'),
  product('fender-telecaster-deluxe', 'Fender', 'Telecaster Deluxe'),
  product('fender-telecaster-thinline', 'Fender', 'Telecaster Thinline'),
  product('fender-mustang-bass', 'Fender', 'Mustang Bass'),
  product('fender-american-standard-jazz-bass', 'Fender', 'American Standard Jazz Bass'),
  product('fender-vintera-ii-60s-jazz-bass', 'Fender', "Vintera II '60s Jazz Bass"),
  product('fender-american-standard-precision-bass', 'Fender', 'American Standard Precision Bass'),
  product('fender-precision-bass-57-reissue', 'Fender', "Precision Bass '57 Reissue"),
  product('fender-twin-reverb-vintage', 'Fender', 'Twin Reverb (vintage)'),
  product('fender-65-twin-reverb-reissue', 'Fender', "'65 Twin Reverb Reissue"),
  product('fender-deluxe-reverb-vintage', 'Fender', 'Deluxe Reverb (vintage)'),
  product('roland-juno-d', 'Roland', 'Juno-D'),
  product('roland-juno-106', 'Roland', 'Juno-106'),
  product('roland-sh-1000', 'Roland', 'SH-1000'),
  product('roland-sh-2000', 'Roland', 'SH-2000'),
  product('roland-sp-404', 'Roland', 'SP-404'),
  product('roland-sp-404-mkii', 'Roland', 'SP-404 MKII'),
]
const r2 = buildBrandNetContext(R2_PRODUCTS, [], [])
const resolve2 = (title: string, brand: string): BrandNetResolution =>
  resolveBrandNetListing({ title, description: title }, brand, r2)
const reading = (r: BrandNetResolution): string =>
  r.kind === 'kg_product' ? `kg_product ${r.via} ${r.productIds.join('|')}`
    : r.kind === 'candidate' ? `candidate ${r.model}`
      : r.kind === 'family_only' ? `family_only ${r.line}`
        : r.kind === 'noise' ? `noise ${r.reason}` : r.kind

test('r2: a series word is not a line — it qualifies the line written after it', () => {
  // Round 1 read `american` as a line: "family_only american".
  assert.equal(reading(resolve2("Fender American Vintage '62 Stratocaster", 'fender')),
    'candidate american vintage 62 stratocaster')
  assert.equal(reading(resolve2('Fender Standard Upgrade Mexico stratocaster', 'fender')),
    'candidate standard upgrade stratocaster')
})

test('r2: a series read after the line, around a generic word, or as Custom Shop', () => {
  for (const [title, expected] of [
    // after the line, `Pro` held by the KG as "Professional"
    ['Fender Stratocaster American Pro II HSS', 'kg_product spelling fender-american-professional-ii-stratocaster'],
    ['Fender Jazz Bass Vintera II 60s', 'kg_product spelling fender-vintera-ii-60s-jazz-bass'],
    ['Fender Stratocaster Player II', 'candidate player ii stratocaster'],
    // around a generic word
    ["2009 Fender Classic Series '50s Stratocaster – Surf Green, meget velholdt", 'candidate classic series 50s stratocaster'],
    // Custom Shop is the matcher's own identity phrase; the year is its model
    ['Fender Custom Shop 1959 Stratocaster LIMITED EDITION Sunburst Guitar', 'candidate custom shop 1959 stratocaster'],
    ['Fender Telecaster Custom Shop', 'candidate custom shop telecaster'],
    ['Fender Custom Shop Telecaster 63 Limited Edition', 'candidate custom shop 63 telecaster'],
    // …but after a named series, the year is when it was built
    ['Fender Custom Shop Classic Player Stratocaster 2004 Sunburst Guitar', 'candidate custom shop classic player stratocaster'],
    // a signature artist
    ['Fender Stratocaster Eric Clapton signature', 'candidate eric clapton stratocaster'],
    // an unheld name keeps its own words: "Pro Reverb" is not "Professional Reverb"
    ['Fender Pro Reverb', 'candidate pro reverb'],
    // the seller's "'65 Twin Reverb" is the KG's "'65 Twin Reverb Reissue"
    ['Fender 65 Twin Reverb guitarforstærker', 'kg_product spelling fender-65-twin-reverb-reissue'],
  ]) assert.equal(reading(resolve2(title, 'fender')), expected, title)
})

test('r2: facets never join a name — a vintage dealer title stays family-only', () => {
  for (const title of [
    '1977 Fender Stratocaster Hardtail Natural Ash Vintage 70s American USA HT Guitar',
    'Fender Precision Bass 1968 ARTIST OWNED American Vintage 60s',
    '1966 Fender Precision Bass Vintage American 60s EX-Artist',
    'Fender Stratocaster elektrisk guitar sunburst Japan',
  ]) assert.equal(resolve2(title, 'fender').kind, 'family_only', title)
})

test('r2: a matched model NAME written with more identity in front is a longer model', () => {
  // PAN-154 (owner decision 2026-09-26): the Mustang Bass is a family and
  // `fender-mustang-bass` its 1966–81 original, so the matcher no longer calls
  // a Pawn Shop or a yearless "Mustang Bass" that product. The resolver then
  // reads them without the KG's two-word model name.
  assert.equal(reading(resolve2('Fender Pawn Shop Mustang Bass', 'fender')), 'candidate pawn shop mustang')
  assert.equal(reading(resolve2('Fender American Professional II Telecaster Deluxe NEW USA Dark Night Guitar', 'fender')),
    'candidate american professional ii telecaster deluxe')
  // …while the model on its own, or with a facet in front, stays the KG's.
  assert.equal(reading(resolve2('1971 Fender Mustang Bass', 'fender')), 'kg_product matcher fender-mustang-bass')
  assert.equal(reading(resolve2('1971 Fender Telecaster Thinline American Vintage 70s Guitar', 'fender')),
    'kg_product matcher fender-telecaster-thinline')
})

test('r2: Danish part titles are noise; a key count or a replaced part is not', () => {
  for (const [title, brand] of [
    ['ORIG ! ROLAND SH 1000 / 2000 SYNTHESIZER TANGENTER.', 'roland'],
    ['VINTAGE ! ORIG , ROLAND SH 2000 ,CONTROL PLADE , 1973.', 'roland'],
    ['Fender stemmeskruer', 'fender'],
    ['VINTAGE !  ORIGINAL , FENDER RHODES TINE SCREW', 'fender'],
    ['Fender 8" 8 ohm guitarhøjttaler', 'fender'],
  ]) assert.equal(reading(resolve2(title, brand)), 'noise part_or_accessory', title)
  assert.equal(reading(resolve2('Roland Juno-D Synthesizer – 61 Tangenter, Mange Lyde', 'roland')),
    'kg_product matcher roland-juno-d')
  assert.equal(reading(resolve2('Fender Blues Junior, udskiftet højtaler', 'fender')), 'candidate blues junior')
})

test('r2: a code written in capitals is a model; a roman numeral is not a code', () => {
  assert.equal(reading(resolve2('Roland Paraphonic RS 505 synthesizer keyboard', 'roland')), 'candidate rs-505')
  assert.equal(reading(resolve2('Roland MM-4 MIDI Thru Box', 'roland')), 'candidate mm-4')
  assert.equal(reading(resolve2('Fender Champion II 50 guitarforstærker', 'fender')), 'candidate champion ii')
  // A generation after the code is part of it: the MKII, not both rows.
  assert.equal(reading(resolve2('Roland SP404 MKII', 'roland')), 'kg_product spelling roland-sp-404-mkii')
  assert.equal(reading(resolve2('Roland JUNO-Gi Synthesizer', 'roland')), 'candidate juno-gi')
  // `Cube` is a line the KG numbers, so a short code after it is the model.
  assert.equal(reading(resolve('Roland Cube xl forstærker med subzero mikrofon og stativ', 'roland')), 'candidate cube-xl')
})

test('r2: a name beside the brand counts in any case, and before a brand that ends the title', () => {
  for (const [title, expected] of [
    ['Fender pro Junior IV ltd guitarforstærker tweed', 'candidate pro junior iv'],
    ['Fender super sonic 22', 'candidate super sonic 22'],
    ['FUZZ WAH, Andet mærke FENDER CLASSIC FUZZ WAH', 'candidate classic fuzz wah'],
    ['Stratacoustic Fender', 'candidate stratacoustic'],
    // …but a description is not a name
    ['Fender akustisk basguitar natur', 'brand_only'],
    ['Roland elektriske trommer', 'brand_only'],
  ] as const) assert.equal(reading(resolve2(title, title.toLowerCase().includes('roland') ? 'roland' : 'fender')), expected, title)
})
