/**
 * scripts/lib/pan204-line-boundaries.test.ts
 *
 * PAN-204: the Martin rows the promote SQL moves to `supported` (the 8 known base rows and the 11
 * step-2 models) beside the supported `martin-d-28`, with the spelling aliases the promote SQL adds.
 * One test per hazard class, on production titles (read-only snapshot 2026-10-01) unless marked
 * synthetic. Six of the eight fail on origin/main's matcher; the body-size and spelling tests pass
 * there and guard against this change refusing too much.
 *
 * Run: npx tsx --test scripts/lib/pan204-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, lineBoundaryRefusal, type Product } from '../../frontend/lib/matching/match-listings'
import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'

const martin = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Martin ${model_name}`, model_name, brand_name: 'martin',
  status: 'active', support_state: 'supported',
})

const MARTIN = [
  martin('martin-0-18', '0-18'),
  martin('martin-00-18', '00-18'),
  martin('martin-000-18', '000-18'),
  martin('martin-000-18-modern-deluxe', '000-18 Modern Deluxe'),
  martin('martin-000-28', '000-28'),
  martin('martin-000-28-modern-deluxe', '000-28 Modern Deluxe'),
  martin('martin-000-28-shawn-mendes', '000-28 Shawn Mendes'),
  martin('martin-om-28', 'OM-28'),
  martin('martin-om-28-modern-deluxe', 'OM-28 Modern Deluxe'),
  martin('martin-d-18', 'D-18'),
  martin('martin-d-18-authentic-1937', 'D-18 Authentic 1937'),
  martin('martin-d-18-satin', 'D-18 Satin'),
  martin('martin-d-18-molly-tuttle', 'D-18 Molly Tuttle'),
  martin('martin-d-28', 'D-28'),
  martin('martin-d-28-modern-deluxe', 'D-28 Modern Deluxe'),
  martin('martin-d-28-authentic-1937', 'D-28 Authentic 1937'),
  martin('martin-d-28-satin', 'D-28 Satin'),
  martin('martin-d-28-billy-strings', 'D-28 Billy Strings'),
  martin('martin-hd-28', 'HD-28'),
  martin('martin-d-42-modern-deluxe', 'D-42 Modern Deluxe'),
]
// The spelling aliases the promote SQL adds (canonical_query = the slug), measured on the snapshot.
const synonyms = [
  { alias: 'Martin 00028', canonical_query: 'martin-000-28' },
  { alias: 'D42 Modern Deluxe', canonical_query: 'martin-d-42-modern-deluxe' },
  { alias: 'D-42L Modern Deluxe', canonical_query: 'martin-d-42-modern-deluxe' },
  { alias: 'Modern Deluxe OM-28', canonical_query: 'martin-om-28-modern-deluxe' },
  { alias: 'Martin - D-18 - Authentic 1937', canonical_query: 'martin-d-18-authentic-1937' },
]
const BRANDS = ['martin', 'gibson', 'guild', 'sigma', 'eastman']
const index = buildMatchIndex(MARTIN, [], synonyms, BRANDS)

function slugOf(title: string): string | null {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug ?? null : null
}
function expect(cases: Array<[string, string | null]>): void {
  for (const [title, slug] of cases) assert.equal(slugOf(title), slug, title)
}

test('body sizes never collide: 0 / 00 / 000 / OM and D / HD stay apart', () => {
  expect([
    ['Martin 0-18 Natural', 'martin-0-18'],
    ['Martin 00-18 Standard Series Acoustic Guitar', 'martin-00-18'],
    ['Martin 000-18 Standard Series Acoustic Guitar - Natural Aging Toner', 'martin-000-18'],
    ['Martin 000-28 Standard Series Acoustic Guitar w/Case', 'martin-000-28'],
    ['Martin OM-28 Standard Series Orchestra Model Acoustic Guitar', 'martin-om-28'],
    ['Martin D-18 Standard Series Acoustic Guitar w/Case', 'martin-d-18'],
    ['Martin HD-28 Standard Series Acoustic Guitar w/Case', 'martin-hd-28'],
    ['Martin D-28 Standard Series Acoustic Guitar w/Case', 'martin-d-28'],
    // A suffixed model is another model: Clapton's 000-28EC, the OM-28E with electronics.
    ['Martin 000-28EC', null],
    ['Martin OM-28E Modern Deluxe Sitka Spruce / Rosewood OM 2019 - Present - Natural', null],
  ])
})

test('each base refuses its series siblings, which take the title (one line, step 5b)', () => {
  expect([
    ['Martin D-28 Modern Deluxe Dreadnought Acoustic Guitar #6278', 'martin-d-28-modern-deluxe'],
    ['Martin D-28 Authentic 1937 VTS Guatemalan Rosewood (104)', 'martin-d-28-authentic-1937'],
    ['Martin D-28 Satin 2025 Spec (103)', 'martin-d-28-satin'],
    ['Martin D-18 Authentic 1937 VTS Aged (989)', 'martin-d-18-authentic-1937'],
    ['MARTIN D-18 Satin, Natural', 'martin-d-18-satin'],
    ['Martin D-18 Molly Tuttle Signature Acoustic Gloss Vintage Sunburst', 'martin-d-18-molly-tuttle'],
    ['Martin 000-18 Modern Deluxe Spruce VTS/Mahogany Acoustic Guitar - Natural', 'martin-000-18-modern-deluxe'],
    ['Martin 000-28 Modern Deluxe Vintage Series Acoustic Guitar w/Case', 'martin-000-28-modern-deluxe'],
    ['Martin Standard 000-28 Shawn Mendes Signature - Ebony Fingerboard, Natural', 'martin-000-28-shawn-mendes'],
    ['Martin OM-28 Modern Deluxe Sitka Spruce / Rosewood OM 2021', 'martin-om-28-modern-deluxe'],
    // Series without a row stay unmatched rather than landing on the base.
    ['Martin D-18 Modern Deluxe Acoustic Guitar', null],
    ['Martin D-18 Street Legend Dreadnought Acoustic Guitar', null],
    ['Martin - Super HD-28 - Acoustic Guitar - Natural - with  Hardshell Case - x0248 (10Y25SUPERHD28-0248)', null],
    ['Martin OM-28 Marquis 2007 [1202123] (09/10)', null],
    ['Martin D-28 Rich Robinson Signature Acoustic Guitar Pre-Owned', null],
    ['Martin D-28 Marquis USATO cod. 51826', null],
    // Custom Shop is a category, not a model (manager decision): no row, so unmatched.
    ['Martin Custom Shop 0-18 Adirondack Spruce/Mahogany Natural (Serial #M3070257)', null],
    ['Martin OM-28 Custom Adirondack Spruce/Guatemalan Rosewood Back&Sides 2024', null],
    ['MARTIN USED ​​CTM 000-28 Adironduck Spruce Martin', null],
    // The Joe Bonamassa 00-18 has no Reverb CSP and no row (owner).
    ['Martin 00-18 Joe Bonamassa Acoustic Guitar 1937 Joe Bonamassa Sunburst', null],
  ])
})

test('era policy: a 1898–1969 build year or Brazilian rosewood is never the 1970+ base', () => {
  expect([
    ['1938 Martin 000-28', null],
    ['Martin 00-18 1946 - 1964 - Natural', null],
    ['C. F. Martin  0-18 Flat Top Acoustic Guitar (1929), ser. #40226, Hoffe Molded fiberglass hard shell case.', null],
    ['Martin 0-18 KH c.1928 Koa Conversion Acoustic Guitar - Excellent', null],
    ['Martin 00-18 1917 - Brazilian RW model', null],
    ['Super Clean! 1969 Martin 000-28 Brazilian Rosewood Acoustic Guitar Natural + HSC', null],
    ['1969 Martin D-28', null],
    // 1970 on is the base; the year is a facet.
    ['Martin 0-18 1972 Natural Stunner with Case', 'martin-0-18'],
    ['1981 Martin HD-28 – Rosewood Dreadnought – 4.70 lbs – w/ OHSC', 'martin-hd-28'],
    ['Martin Standard Series HD-28 2005 - 2017', 'martin-hd-28'],
    // A serial number is not a year.
    ['Martin 00-18 Natural #175391', 'martin-00-18'],
  ])
})

test('spec years name a modern guitar, not a build year', () => {
  expect([
    ['Martin HD-28 1933 Ambertone', 'martin-hd-28'],
    ['MARTIN 000-28 Acoustic Guitar, Gloss 1935 Sunburst', 'martin-000-28'],
    ['Martin OM-28 Standard Series - 1935 Sunburst', 'martin-om-28'],
    ['Martin D-28 Satin 1935 Burst Acoustic Guitar Satin 1935 Sunburst w/ Case', 'martin-d-28-satin'],
    ['Martin D-18 Authentic 1937', 'martin-d-18-authentic-1937'],
    ['Martin - D-28 Authentic 1937 Vintage Tone System', 'martin-d-28-authentic-1937'],
  ])
  // "1955 CFM IV" is the 70th-anniversary edition (no row), refused for the edition, not the year.
  assert.equal(lineBoundaryRefusal('martin 000-18 1955 cfm iv 70th (543)', 'martin-000-18'), 'other_member:cfm')
  assert.equal(lineBoundaryRefusal('martin 00-18 joe bonamassa 1937 sunburst top', 'martin-00-18'), 'other_member:bonamassa')
})

test('"Billy Strings" is an artist, not a set of strings; strings sold with it still defer', () => {
  expect([
    ['Martin D-28 Billy Strings', 'martin-d-28-billy-strings'],
    ['Martin D-28 Billy Strings Custom Shop Artist Edition Acoustic Guitar w/Case', 'martin-d-28-billy-strings'],
    ['Martin - D-28 - Billy Strings', null],
  ])
  assert.equal(detectNonProductIntent('Martin D-28 Billy Strings'), null)
  assert.equal(detectNonProductIntent('Martin D-28 Billy Strings + new strings')?.token, 'strings')  // synthetic
  assert.equal(detectNonProductIntent('Martin MA540 Authentic Acoustic Strings')?.token, 'strings')  // synthetic
  // On the base D-28 the artist is an edition, with or without "Signature".
  assert.equal(lineBoundaryRefusal('martin d-28 billy strings (198)', 'martin-d-28'), 'other_member:billy strings')
})

test('never-Martin names, merchandise and case model numbers are refused; a bare case never is', () => {
  expect([
    ['Martin D-28 Silhouette Lighted Wall Clock', null],
    ['Martin D-28 keychain', null],  // synthetic: the Thomann page martin-d-28 pointed at
    ['Martin C331 000-Size 12-Fret Acoustic Guitar Case for 000-18', null],  // synthetic, Reverb's case name
    ['Mario Martin custom made 000-28 copy', null],  // synthetic
    ['Martin Logan speakers, not a D-28', null],  // synthetic
    ['MARTIN - HD-28 + CASE + K&K PURE MINI', 'martin-hd-28'],
    ['Martin HD-28 Dreadnought Acoustic Guitar, Solid Spruce/Rosewood, w/Hardshell Case', 'martin-hd-28'],
    ['Martin D-28 Acoustic Guitar, Natural with Hard Case', 'martin-d-28'],
  ])
  for (const title of ['martin committee trompet (kenosha)', 'neve  vr / martin sound  - cbea events board for flying faders',
    'vintage ikea "jakob" swivel stol – design af chris martin', '1956 gibson lg-2 3/4, sunburst, ex-martin barre']) {
    assert.ok(lineBoundaryRefusal(title, 'martin-d-28')?.startsWith('other_member:'), title)
  }
})

test('handedness and measured spellings: D-42L is the D-42 Modern Deluxe; "00028" is the 000-28', () => {
  expect([
    ['Martin D-42L Modern Deluxe Acoustic Guitar - Natural w/OHSC + FREE $299 Plek & Setup #556', 'martin-d-42-modern-deluxe'],
    ['Martin D42 Modern Deluxe 2022', 'martin-d-42-modern-deluxe'],
    ['Martin D-42 Modern Deluxe Left Handed Acoustic Guitar - Natural Auth Dealer, Get Plek\'d Free! 149', 'martin-d-42-modern-deluxe'],
    ['Martin 00028', 'martin-000-28'],
    ['Martin Modern Deluxe OM-28 Sitka VTS/East Indian Rosewood Natural (Serial #M3086454)', 'martin-om-28-modern-deluxe'],
    ['Martin - D-18 - Authentic 1937 VTS - Acoustic Guitar - Natural (10D18AUTHENTIC1937VTS)', 'martin-d-18-authentic-1937'],
    ['Martin D-28 - LEFTY', 'martin-d-28'],
    // A bare D-42L is the Standard Series D-42, which has no row.
    ['Martin D-42L Natural (Pre-Owned, 2020, EC) #2405949', null],
  ])
})

test('martin-d-28 regression: its live matches, title by title (snapshot 2026-10-01)', () => {
  // All four carry admin_decision (pan-95 qualification); the PAN-204 re-match skips them, so the
  // 1942 D-28 stays approved until the owner decides. The matcher alone now refuses it.
  expect([
    ['Martin D-28 Dreadnought Acoustic Guitar Natural', 'martin-d-28'],
    ['Martin D-28 Ambertone 2025 Spec (805)', 'martin-d-28'],
    ['Martin D-28 Standard Series Left-Handed Acoustic Guitar w/Case', 'martin-d-28'],
    ['Martin D-28 82272 (1942)', null],
  ])
  // Its frozen boundary is kept: "Reimagined" is still refused (owner decision pending).
  assert.equal(lineBoundaryRefusal('martin d-28 reimagined', 'martin-d-28'), 'other_member:reimagined')
})
