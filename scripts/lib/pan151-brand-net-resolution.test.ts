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
