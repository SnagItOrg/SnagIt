/**
 * PAN-17 — the catalogue tree in the sidebar.
 *
 * Two tests, matching the ticket's budget: one that an unpopulated root can
 * never render, and one that no price key can reach the sidebar payload.
 *
 * THE FIXTURE IS PRODUCTION, re-measured for this ticket on 2026-09-21. The
 * public catalogue is 49 products across 14 leaves under 6 roots, nothing
 * deeper than 13:
 *
 *   keyboards-and-synths  analog-synths              13
 *   electric-guitars      solid-body                  9
 *   keyboards-and-synths  drum-machines               6
 *   keyboards-and-synths  electric-pianos             5
 *   pro-audio             compressors-and-limiters    3
 *   acoustic-guitars      jumbo                       2
 *   effects-and-pedals    reverb                      2
 *   electric-guitars      semi-hollow                 2
 *   keyboards-and-synths  digital-synths              2
 *   acoustic-guitars      dreadnought                 1
 *   bass-guitars          4-string                    1
 *   pro-audio             channel-strips              1
 *   pro-audio             microphones                 1
 *   pro-audio             recording                   1
 *
 * IT IS A FIXTURE, NOT A LIVE ASSERTION, AND THAT DISTINCTION EARNED ITSELF
 * DURING THIS TICKET. The brief handed over 31 products / 8 leaves / 4 roots,
 * measured hours earlier; the re-measurement above found 49 / 14 / 6 because
 * the operator published in between. Nothing in `catalogue-tree.ts` names a
 * root, a leaf or a count, so that publish needed no deploy and this suite
 * needed no change to keep testing the right properties — the numbers here
 * only make the fixture concrete enough to reason about.
 *
 * The other eight renderable music roots hold zero, including `accessories`
 * and `parts` (D-IA-3). PAN-30's finding is that the taxonomy was never
 * missing a branch: 320 leaves exist and the catalogue occupies 14.
 *
 * `frontend/lib/catalogue-tree.ts` is import-free for the same reason
 * `catalogue.ts`, `home-categories.ts` and `subcategory-filter.ts` are — and
 * because `SideNav` is a client component that may gain no import edge to
 * `lib/browse` or the service-role client (wp4a-boundary.test).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FACET_SUBCATEGORIES,
  buildCatalogueTree,
  type CatalogueTreeRow,
} from '../../frontend/lib/catalogue-tree'

const row = (
  slug: string,
  root: string,
  leaf: string,
  overrides: Partial<CatalogueTreeRow> = {},
): CatalogueTreeRow => ({
  slug,
  canonical_name: slug,
  root_category_slug: root,
  root_category_name_da: root,
  root_category_name_en: root,
  subcategory_slug: `${root}/${leaf}`,
  subcategory_name_da: leaf,
  subcategory_name_en: leaf,
  ...overrides,
})

/** One entry per public, supported product — the 49 the catalogue serves. */
function productionRows(): CatalogueTreeRow[] {
  const shape: Array<[string, string, number]> = [
    ['keyboards-and-synths', 'analog-synths', 13],
    ['electric-guitars', 'solid-body', 9],
    ['keyboards-and-synths', 'drum-machines', 6],
    ['keyboards-and-synths', 'electric-pianos', 5],
    ['pro-audio', 'compressors-and-limiters', 3],
    ['acoustic-guitars', 'jumbo', 2],
    ['effects-and-pedals', 'reverb', 2],
    ['electric-guitars', 'semi-hollow', 2],
    ['keyboards-and-synths', 'digital-synths', 2],
    ['acoustic-guitars', 'dreadnought', 1],
    ['bass-guitars', '4-string', 1],
    ['pro-audio', 'channel-strips', 1],
    ['pro-audio', 'microphones', 1],
    ['pro-audio', 'recording', 1],
  ]
  return shape.flatMap(([root, leaf, n]) =>
    Array.from({ length: n }, (_, i) => row(`${leaf}-${i}`, root, leaf)),
  )
}

test('PAN-17: an unpopulated branch cannot render, and depth stops at two', () => {
  const tree = buildCatalogueTree(productionRows())
  const slugs = tree.map((c) => c.slug)

  // D-IA-1, AND IT IS STRUCTURAL RATHER THAN A FILTER. The tree is built FROM
  // the product rows, so a root with nothing behind it contributes nothing to
  // build from. There is no `product_count > 0` test that could be forgotten,
  // and an empty branch is not merely hidden — it is unrepresentable.
  assert.deepEqual(slugs, [
    'keyboards-and-synths',
    'electric-guitars',
    'pro-audio',
    'acoustic-guitars',
    'effects-and-pedals',
    'bass-guitars',
  ])
  assert.equal(tree.length, 6)

  // The eight empty music roots, `accessories` and `parts` among them
  // (D-IA-3), reach nothing.
  for (const empty of [
    'accessories', 'parts', 'amps',
    'drums-and-percussion', 'band-and-orchestra', 'dj-and-lighting-gear',
    'folk-instruments', 'home-audio', 'music-gear',
  ]) {
    assert.equal(slugs.includes(empty), false, `${empty} reached the sidebar`)
  }

  // Handing it a root with no rows cannot add one: the only input is rows.
  // The only way to widen this tree is to publish a product, which is what
  // D-IA-1 asks for.
  assert.equal(buildCatalogueTree([]).length, 0)

  // TWO LEVELS, PLUS PRODUCTS. `subcategories` holds no nested `subcategories`
  // key, so a third taxonomy level is not representable — generation, year and
  // colour are filters, and a family is not a taxonomy level (CLAUDE.md §7).
  // D-IA-5 falls out of the same rule: `effects-and-pedals` exposes its one
  // populated leaf and none of the 29 empty ones.
  const effects = tree.find((c) => c.slug === 'effects-and-pedals')
  assert.deepEqual(effects?.subcategories.map((s) => s.slug), ['reverb'])
  // Two levels of ordering, both populated-first: pro-audio's four leaves sort
  // by count and then by name, never by the taxonomy's own alphabet.
  assert.deepEqual(
    tree.find((c) => c.slug === 'pro-audio')?.subcategories.map((s) => s.slug),
    ['compressors-and-limiters', 'channel-strips', 'microphones', 'recording'],
  )
  for (const category of tree) {
    for (const sub of category.subcategories) {
      assert.equal('subcategories' in sub, false, `${sub.slug} grew a third level`)
      // The bare leaf slug, exactly as /browse/<root> reports it, so the two
      // surfaces name the same leaf the same way.
      assert.equal(sub.slug.includes('/'), false)
    }
  }

  // Counts reconcile to the rows served, per node and in total — so two
  // branches cannot cancel each other's error out. Since PAN-121 round 2 a
  // root's products are its kinds' plus its facets'; since round 3 a node's
  // count and its membership list are the same set.
  assert.equal(tree.reduce((n, c) => n + c.product_count, 0), 49)
  for (const category of tree) {
    assert.equal(category.product_slugs.length, category.product_count)
    for (const sub of category.subcategories) {
      assert.equal(sub.product_slugs.length, sub.product_count, `${sub.slug} membership drifted`)
      for (const slug of sub.product_slugs) {
        assert.ok(category.product_slugs.includes(slug), `${slug} is in a kind but not its root`)
      }
    }
  }

  // PAN-121 round 2 — ONLY A KIND IS A NODE. A facet leaf never becomes a
  // subcategory; its products belong to the root alone. An unlisted leaf is a
  // kind, so nothing leaves the navigation without being listed.
  const keys = tree.find((c) => c.slug === 'keyboards-and-synths')
  assert.deepEqual(keys?.subcategories.map((s) => s.slug), ['drum-machines', 'electric-pianos'])
  assert.equal(keys?.product_count, 26)
  assert.equal(keys?.subcategories.reduce((n, s) => n + s.product_count, 0), 11)
  assert.deepEqual(tree.find((c) => c.slug === 'electric-guitars')?.subcategories, [])
  for (const category of tree) {
    for (const sub of category.subcategories) {
      assert.equal(
        FACET_SUBCATEGORIES.has(`${category.slug}/${sub.slug}`),
        false,
        `${category.slug}/${sub.slug} is a facet and must not be a node`,
      )
    }
  }
  const unlisted = buildCatalogueTree([row('new-0', 'keyboards-and-synths', 'modular-synths')])
  assert.deepEqual(unlisted[0].subcategories.map((s) => s.slug), ['modular-synths'])

  // No LEAF_PRODUCT_LIMIT any more (round 3): the tree enumerates no
  // products, so a big leaf costs the sidebar one row, whatever its size.

  // FAIL-CLOSED PLACEMENT. A row the tree cannot place does not invent a
  // branch and does not land at the top level; it is dropped, and the counts
  // drop with it, so no node ever advertises a product that is not under it.
  const unplaceable = buildCatalogueTree([
    ...productionRows(),
    row('no-root', 'x', 'y', { root_category_slug: null }),
    row('no-leaf', 'keyboards-and-synths', 'analog-synths', { subcategory_slug: null }),
  ])
  assert.equal(unplaceable.length, 6)
  assert.equal(unplaceable.reduce((n, c) => n + c.product_count, 0), 49)
})

test('PAN-17: no price, band, median or verdict can reach the sidebar', () => {
  const tree = buildCatalogueTree(productionRows())

  // ASSERTED STRUCTURALLY, THE WAY PAN-56 DOES IT — by the shape of the object
  // rather than by comparing a value. A test that checked `price === undefined`
  // would pass for a payload that had simply not been given one yet; these
  // assertions fail the moment a field a price COULD travel in is added.
  const forbidden = /price|band|median|verdict|kup|deal|dkk|msrp|value|cost|amount/i

  for (const category of tree) {
    assert.deepEqual(
      Object.keys(category).sort(),
      ['name_da', 'name_en', 'product_count', 'product_slugs', 'slug', 'subcategories'],
    )
    // Round 3: membership is bare slugs — no object, so no key a price could
    // be added under.
    for (const slug of category.product_slugs) assert.equal(typeof slug, 'string')
    for (const key of Object.keys(category)) {
      assert.equal(forbidden.test(key), false, `category.${key}`)
    }

    for (const sub of category.subcategories) {
      assert.deepEqual(
        Object.keys(sub).sort(),
        ['name_da', 'name_en', 'product_count', 'product_slugs', 'slug'],
      )
      for (const key of Object.keys(sub)) {
        assert.equal(forbidden.test(key), false, `subcategory.${key}`)
      }
      for (const slug of sub.product_slugs) assert.equal(typeof slug, 'string')
    }
  }

  // The count is the one number on this surface, and it counts PRODUCTS —
  // never listings, which is the larger and more flattering number that made
  // a homepage tile advertise 268 in front of a page that followed nothing
  // (PAN-86). A listing count is not on the row shape this module reads.
  const keyboards = tree.find((c) => c.slug === 'keyboards-and-synths')
  assert.equal(keyboards?.product_count, 26)

  // A price offered on the INPUT is not a way in either: the row type names
  // seven fields and the builder copies no other.
  const withPrice = buildCatalogueTree([
    { ...row('juno-106', 'keyboards-and-synths', 'analog-synths'), price_dkk: 4500 } as
      CatalogueTreeRow & { price_dkk: number },
  ])
  assert.deepEqual(withPrice[0].product_slugs, ['juno-106'])
  assert.equal(JSON.stringify(withPrice).includes('4500'), false)
})
