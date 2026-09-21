/**
 * PAN-86 — the category shelf on the logged-out homepage.
 *
 * Three tests, matching the ticket's budget: one that the out-of-scope
 * verticals can never reach the shelf, one that the count on a card is the
 * count the destination page can honour, and one that emptiness survives to
 * the render instead of being filtered away.
 *
 * The fixture is production, read on 2026-09-21. `kg_category` holds 20 roots:
 * 15 `music`, 2 `design` (`danish-modern`, `design-objects`) and 3 `other`
 * (`cycling`, `photography`, `tech`). Four music roots have public, supported
 * products — keyboards-and-synths 19, electric-guitars 10, effects-and-pedals
 * 1, pro-audio 1, totalling the 31 rows the public catalogue serves — and the
 * other eleven have none.
 *
 * `frontend/lib/home-categories.ts` is import-free for the same reason
 * `catalogue.ts` and `publication.ts` are: the scope predicate has to be
 * exercisable without Next or a Supabase client in scope.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildHomeCategories,
  type HomeCategoryRow,
} from '../../frontend/lib/home-categories'

const root = (
  slug: string,
  domain: string | null,
  overrides: Partial<HomeCategoryRow> = {},
): HomeCategoryRow => ({
  id: `id:${slug}`,
  slug,
  name_da: slug,
  name_en: slug,
  domain,
  parent_id: null,
  image_url: null,
  ...overrides,
})

/** All 20 roots, exactly as production holds them. */
const ROOTS: HomeCategoryRow[] = [
  root('accessories', 'music'),
  root('acoustic-guitars', 'music'),
  root('amps', 'music'),
  root('band-and-orchestra', 'music'),
  root('bass-guitars', 'music'),
  root('dj-and-lighting-gear', 'music'),
  root('drums-and-percussion', 'music'),
  root('effects-and-pedals', 'music'),
  root('electric-guitars', 'music'),
  root('folk-instruments', 'music'),
  root('home-audio', 'music'),
  root('keyboards-and-synths', 'music'),
  root('music-gear', 'music'),
  root('parts', 'music'),
  root('pro-audio', 'music'),
  root('danish-modern', 'design'),
  root('design-objects', 'design'),
  root('cycling', 'other'),
  root('photography', 'other'),
  root('tech', 'other'),
]

/** One entry per public, supported product — the 31 the catalogue serves. */
const PUBLIC_ROOT_IDS: Array<string | null> = [
  ...Array.from({ length: 19 }, () => 'id:keyboards-and-synths'),
  ...Array.from({ length: 10 }, () => 'id:electric-guitars'),
  'id:effects-and-pedals',
  'id:pro-audio',
]

test('PAN-86: the shelf is scoped by domain, and scope fails closed', () => {
  const shelf = buildHomeCategories(ROOTS, PUBLIC_ROOT_IDS)
  const slugs = shelf.map((c) => c.slug)

  // The five out-of-scope verticals are inactive by product decision
  // (CLAUDE.md preamble). They must never render, and the shelf must never be
  // the surface that quietly reactivates one.
  for (const forbidden of ['danish-modern', 'design-objects', 'cycling', 'photography', 'tech']) {
    assert.equal(slugs.includes(forbidden), false, `${forbidden} reached the homepage`)
  }
  assert.equal(shelf.length, 15)

  // FAIL-CLOSED, not deny-listed. A root whose domain cannot be read, or whose
  // domain is one nobody has taught this function about, is dropped rather
  // than admitted — so a sixth vertical arriving tomorrow renders nothing
  // instead of renders by default.
  const withUnknowns = buildHomeCategories(
    [...ROOTS, root('watches', 'horology'), root('unreadable', null)],
    PUBLIC_ROOT_IDS,
  )
  assert.equal(withUnknowns.length, 15)

  // A child category is not a root, however right its domain looks.
  const withChild = buildHomeCategories(
    [...ROOTS, root('solid-body', 'music', { parent_id: 'id:electric-guitars' })],
    PUBLIC_ROOT_IDS,
  )
  assert.equal(withChild.length, 15)
})

test('PAN-86: a card never prints a number its destination cannot honour', () => {
  const shelf = buildHomeCategories(ROOTS, PUBLIC_ROOT_IDS)
  const byslug = new Map(shelf.map((c) => [c.slug, c]))

  // THE DEFECT THIS TEST EXISTS FOR: a tile advertised 268 listings in front
  // of a page that followed nothing. keyboards-and-synths carries 862 active
  // listings and 19 public products; the card is required to say 19, because
  // 19 is what /browse/keyboards-and-synths puts on the screen.
  assert.equal(byslug.get('keyboards-and-synths')?.product_count, 19)
  assert.equal(byslug.get('electric-guitars')?.product_count, 10)
  assert.equal(byslug.get('effects-and-pedals')?.product_count, 1)
  assert.equal(byslug.get('pro-audio')?.product_count, 1)

  // The card count and the leaf page's `total_public_products` are the same
  // derivation over the same rows: both are "public supported rows whose
  // root_category_id is this root". Asserted per root rather than in total, so
  // two roots cannot cancel each other's error out.
  for (const category of shelf) {
    const servedByLeafPage = PUBLIC_ROOT_IDS.filter((id) => id === category.id).length
    assert.equal(category.product_count, servedByLeafPage, `${category.slug} count drifted`)
  }

  // Every counted row is a row the catalogue serves: the totals reconcile to
  // the 31 public supported products and to nothing larger.
  assert.equal(
    shelf.reduce((sum, c) => sum + c.product_count, 0),
    PUBLIC_ROOT_IDS.length,
  )
})

test('PAN-86: empty roots reach the shelf, and the useful ones lead', () => {
  const shelf = buildHomeCategories(ROOTS, PUBLIC_ROOT_IDS)

  // Option 3, the product decision: emptiness is visible BEFORE the click.
  // Filtering these out is what /browse does, and it is the behaviour this
  // shelf deliberately does not copy — eleven roots with nothing behind them
  // still render, each able to say so.
  const empty = shelf.filter((c) => c.product_count === 0)
  assert.equal(empty.length, 11)

  // Order is total and locale-independent — populated first by count, then by
  // name_en — so the server and the client cannot disagree about it.
  assert.deepEqual(
    shelf.slice(0, 4).map((c) => c.slug),
    ['keyboards-and-synths', 'electric-guitars', 'effects-and-pedals', 'pro-audio'],
  )
  assert.deepEqual(
    shelf.slice(4).map((c) => c.slug),
    [
      'accessories',
      'acoustic-guitars',
      'amps',
      'band-and-orchestra',
      'bass-guitars',
      'dj-and-lighting-gear',
      'drums-and-percussion',
      'folk-instruments',
      'home-audio',
      'music-gear',
      'parts',
    ],
  )
})
