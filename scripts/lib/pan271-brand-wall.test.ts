/**
 * scripts/lib/pan271-brand-wall.test.ts
 *
 * PAN-271: a brand wall — one brand's active listings in one kind, with or
 * without a model. The membership rule is pure (`selectBrandWallRows`), so it
 * is exercised here without a database on the trumpet titles live on DBA,
 * Finn, Blocket and Reverb on 2026-10-19: a matched listing is on the wall
 * through its product; an unmatched one needs the DBA brand net's query or
 * the brand's word, a kind word, and no accessory before a marker; a model is
 * named only when canonical; a verdict rides only on a named model; and the
 * row shape has nothing a brand-level band, median or verdict could ride in.
 *
 * Run: npx tsx --test scripts/lib/pan271-brand-wall.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BRAND_WALLS, getBrandWall } from '../../frontend/lib/brand-walls'
import { namesBrassAccessory, selectBrandWallRows, type BrandWallCueRow, type BrandWallMatchRow, type BrandWallProduct } from '../../frontend/lib/brand-wall'
import type { CardVerdict } from '../../frontend/lib/listing-verdicts'
import { ROUTE_ACCESS } from '../../frontend/lib/route-access'
import { groupBrandRows } from '../../frontend/lib/brand-page'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

const YAMAHA = 'Yamaha'
const wall = getBrandWall('yamaha', 'trompeter')!

const listing = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, price: 1900, currency: 'DKK', price_dkk: 1900, url: `https://www.dba.dk/${id}`, image_url: null,
  location: null, country: 'DK', source: 'dba.dk', platform: 'dba', condition: null, is_active: true,
  scraped_at: '2026-10-18T00:00:00Z', first_seen_at: `2026-10-${id.padStart(2, '0')}T00:00:00Z`, last_seen_at: null, ...extra,
})
const cueRow = (id: string, title: string, source_query: string | null = null, extra: Record<string, unknown> = {}): BrandWallCueRow =>
  ({ listing: listing(id, title, extra), source_query })
const matchRow = (id: string, product_id: string, title: string, score = 70, is_valid: boolean | null = null, extra: Record<string, unknown> = {}): BrandWallMatchRow =>
  ({ id: `m-${id}-${product_id}`, product_id, score, is_valid, listings: listing(id, title, extra) })

const PRODUCTS: BrandWallProduct[] = [
  { id: 'p-232', slug: 'yamaha-ytr-232', label: 'Yamaha YTR-232', canonical: true },
  { id: 'p-2330', slug: 'yamaha-ytr-2330', label: 'Yamaha YTR-2330', canonical: true },
  { id: 'p-8335', slug: 'yamaha-ytr-8335', label: 'Yamaha YTR-8335 Xeno', canonical: false },
]
const VERDICT: CardVerdict = { verdict: 'under', basisLabelKey: 'verdictBasisDk', fewN: null }
const verdicts = new Map<string, Map<string, CardVerdict>>([
  ['p-232', new Map([['04', VERDICT]])],
  ['p-8335', new Map([['09', VERDICT]])],
])

const select = (matchRows: BrandWallMatchRow[], cueRows: BrandWallCueRow[]) =>
  selectBrandWallRows({ brandName: YAMAHA, cues: wall.cues, products: PRODUCTS, matchRows, cueRows, verdicts })

test('the registry: one reviewed pair, trumpets first; anything else is not a wall', () => {
  assert.deepEqual(BRAND_WALLS.map((w) => `${w.brand}/${w.kind}`), ['yamaha/trompeter'])
  assert.equal(wall.leaf, 'band-and-orchestra/trumpets')
  assert.equal(getBrandWall('yamaha', 'trumpets'), null)
  assert.equal(getBrandWall('bach', 'trompeter'), null)
  assert.equal(getBrandWall('yamaha', ''), null)
})

test('an unmatched listing joins through the brand net or the brand word, with a kind word, and not as an accessory', () => {
  const rows = select([], [
    cueRow('01', 'Søren P. Sørensen trompet', 'Yamaha'),              // the net saw Yamaha in the description
    cueRow('02', 'Yamaha trompet messing med etui', null, { source: 'finn', url: 'https://www.finn.no/2' }),
    cueRow('03', 'yamaha ytr4335gll trompet', 'Yamaha'),              // a typo no row reads — still a Yamaha trumpet
    cueRow('05', 'Søren P. Sørensen trompet', null),                  // no net, no brand word: nothing says Yamaha
    cueRow('06', 'Yamaha YCR-231 lang Cornet', 'Yamaha'),             // a cornet shares the leaf
    cueRow('07', 'Yamaha John Hagstrom trumpet mouthpiece - silver', null, { source: 'reverb' }),
    cueRow('08', 'Lot of 4 Yamaha YAC 1666P Valve Casing Cleaning Rod For Trumpet New Old Stock', null, { source: 'reverb' }),
    cueRow('10', 'Yamaha Silent Brass ST7-9 system för trumpet/kornett', null, { source: 'blocket' }),
    cueRow('11', 'Yamaha PSR-E373 keyboard', 'Yamaha'),               // Yamaha, not a trumpet
    cueRow('12', 'Yamaha trompet', 'Yamaha', { is_active: false }),   // gone
  ])
  assert.deepEqual(rows.map((r) => r.id), ['06', '03', '02', '01'])
  for (const row of rows) {
    assert.equal(row.childSlug, null)
    assert.equal(row.childLabel, null)
    assert.equal(row.verdict, null, 'no model, no verdict')
  }
})

test('a matched listing is on the wall through its product; a model is named only when canonical', () => {
  const rows = select([
    matchRow('04', 'p-232', 'Yamaha YTR232 Trompet'),
    matchRow('09', 'p-8335', 'Yamaha YTR-8335RGS Xeno Bb Trumpet w/ Reversed Lead Pipe', 95),
    matchRow('13', 'p-2330', 'Yamaha YTR-2330 trompet med mundstykke', 70, false),  // adjudicated wrong
    matchRow('14', 'p-2330', 'Yamaha YTR-2330', 70, true, { is_active: false }),     // gone
  ], [])
  assert.deepEqual(rows.map((r) => [r.id, r.childSlug, r.verdict?.verdict ?? null]), [
    ['09', null, null],              // the Xeno is not canonical: on the wall, unnamed, unjudged
    ['04', 'yamaha-ytr-232', 'under'],
  ])
  assert.equal(rows[1].childLabel, 'Yamaha YTR-232')
})

test('one listing, one row: a matched listing is never re-admitted by its title, and the canonical product wins the attribution', () => {
  const rows = select([
    matchRow('15', 'p-8335', 'Yamaha YTR-2330 / YTR-8335 trompet', 95),
    matchRow('15', 'p-2330', 'Yamaha YTR-2330 / YTR-8335 trompet', 70),
    matchRow('16', 'p-2330', 'Yamaha YTR-2330 trompet'),
  ], [
    cueRow('16', 'Yamaha YTR-2330 trompet', 'Yamaha'),
  ])
  assert.deepEqual(rows.map((r) => [r.id, r.childSlug]), [['16', 'yamaha-ytr-2330'], ['15', 'yamaha-ytr-2330']])
})

test('newest first, a dateless row last, ties by id', () => {
  const rows = select([], [
    cueRow('20', 'Yamaha trompet', 'Yamaha', { first_seen_at: null }),
    cueRow('21', 'Yamaha trompet', 'Yamaha', { first_seen_at: '2026-10-01T00:00:00Z' }),
    cueRow('22', 'Yamaha trompet', 'Yamaha', { first_seen_at: '2026-10-18T00:00:00Z' }),
    cueRow('23', 'Yamaha trompet', 'Yamaha', { first_seen_at: '2026-10-18T00:00:00Z' }),
  ])
  assert.deepEqual(rows.map((r) => r.id), ['22', '23', '21', '20'])
})

test('the row shape: the seller\'s price and the listing\'s own link, and nothing a brand-level band could ride in', () => {
  const [row] = select([], [cueRow('30', 'Yamaha sølv trompet', 'Yamaha', { price: 8300, currency: 'NOK', price_dkk: 5800 })])
  assert.deepEqual(Object.keys(row).sort(), [
    'childLabel', 'childSlug', 'country', 'firstSeenAt', 'id', 'imageUrl', 'priceDkk', 'priceLabel', 'source', 'title', 'url', 'verdict',
  ])
  // The seller's number in the seller's currency, as lib/currency.ts writes it everywhere.
  assert.equal(row.priceLabel, 'NOK 8.300 kr')
  for (const key of Object.keys(row)) assert.equal(/band|median|p25|p75|typical|population|sold/i.test(key), false, key)
  // A listing with no price says so with null, never with a number.
  const [bare] = select([], [cueRow('31', 'Yamaha trompet', 'Yamaha', { price: null, price_dkk: null })])
  assert.equal(bare.priceLabel, null)
})

test('the accessory rule is the rows\' rule: a noun before a marker refuses, after one it keeps the horn', () => {
  assert.equal(namesBrassAccessory('Yamaha YTR-2330 mundstykke'), true)
  assert.equal(namesBrassAccessory('Yamaha YTR-2330 trompet med mundstykke og etui'), false)
  assert.equal(namesBrassAccessory('Trompet i etui'), false)
  assert.equal(namesBrassAccessory('Arban Conservatory Method bog for Trumpet'), true)
})

test('the route is classified public and data-gated, like the family route', () => {
  const rule = ROUTE_ACCESS.find((r) => r.route === '/brand/[brand]/[kind]')
  assert.equal(rule?.access, 'public_page_data_gated')
})

test('the page and the wall module compute no price evidence of their own', () => {
  const page = readFileSync(join(FRONTEND, 'app', '(shell)', 'brand', '[brand]', '[kind]', 'page.tsx'), 'utf8')
  const lib = readFileSync(join(FRONTEND, 'lib', 'brand-wall.ts'), 'utf8')
  for (const [name, src] of [['page.tsx', page], ['brand-wall.ts', lib]] as const) {
    assert.equal(/from '@\/lib\/(?:price-populations|statistics|public-product-price)'/.test(src), false, `${name} imports a price module`)
    assert.equal(/from '\.\/(?:price-populations|statistics)'/.test(src), false, `${name} imports a price module`)
    assert.equal(/buildPopulationStats|askingPopulations|median\(/.test(src), false, `${name} builds a population`)
  }
  // The verdict comes from the per-product pipeline and from nowhere else.
  assert.match(lib, /cardVerdictsByProduct\(/)
})

/* ── PAN-289: the brand page ───────────────────────────────────────────── */

test('PAN-289: the brand page groups its rows by kind, links a kind on to its wall, and holds no price', () => {
  const place = (root: string, leaf: string, name: string) => ({
    root_category_slug: root, root_category_name_da: root, root_category_name_en: root,
    subcategory_slug: `${root}/${leaf}`, subcategory_name_da: name, subcategory_name_en: name,
  })
  const names = { synthesizers: { name_da: 'Synthesizere', name_en: 'Synthesizers' } }
  const kinds = groupBrandRows('yamaha', [
    { placement: place('band-and-orchestra', 'trumpets', 'Trompeter'), product: { slug: 'yamaha-ytr-2330' } },
    { placement: place('keyboards-and-synths', 'analog-synths', 'Analoge synths'), product: { slug: 'yamaha-cs-80' } },
    { placement: place('keyboards-and-synths', 'digital-synths', 'Digitale synths'), product: { slug: 'yamaha-dx7' } },
    // A row the catalogue cannot place is dropped, as the sidebar drops it.
    { placement: { ...place('x', 'y', 'z'), subcategory_slug: null }, product: { slug: 'yamaha-unplaced' } },
  ], names)
  // Most models first: the two synth leaves are ONE kind, the group.
  assert.deepEqual(kinds.map((k) => [k.kind.slug, k.href, k.wall, k.products.map((p) => p.slug)]), [
    ['synthesizers', '/browse/keyboards-and-synths/synthesizers', null, ['yamaha-cs-80', 'yamaha-dx7']],
    ['trumpets', '/browse/band-and-orchestra/trumpets', '/brand/yamaha/trompeter', ['yamaha-ytr-2330']],
  ])
  // An exact key set: nothing a price, a band or a verdict could travel in.
  assert.deepEqual(Object.keys(kinds[0]).sort(), ['href', 'kind', 'products', 'root', 'wall'])
  // Another brand's rows in the same leaf get no wall: walls are per brand.
  assert.equal(groupBrandRows('roland', [{ placement: place('band-and-orchestra', 'trumpets', 'Trompeter'), product: {} }], names)[0].wall, null)
})

test('PAN-289: the brand page reads no price module, and its route is classified', () => {
  const page = readFileSync(join(FRONTEND, 'app', '(shell)', 'brand', '[brand]', 'page.tsx'), 'utf8')
  const imports = page.match(/from '[^']+'/g) ?? []
  for (const mod of imports) assert.equal(/price|verdict|band|median/i.test(mod), false, mod)
  const rule = ROUTE_ACCESS.find((r) => r.route === '/brand/[brand]')
  assert.equal(rule?.access, 'public_page_data_gated')
})
