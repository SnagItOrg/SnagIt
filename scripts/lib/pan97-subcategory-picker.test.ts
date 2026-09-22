/**
 * PAN-97 — the admin subcategory picker narrows, and names its parents.
 *
 * Two tests, matching the ticket's budget: one on narrowing, one on the parent
 * label. `frontend/lib/subcategory-filter.ts` is import-free for the same
 * reason `publication.ts` is — the rules the picker must not restate have to be
 * exercisable without React in scope.
 *
 * The fixture is the real hierarchy, verified against production on
 * 2026-09-20: `kg_category` holds 340 rows — 20 roots, 320 children under 14
 * parents, every one of those parents a music root. Thirteen leaf names occur
 * under more than one root.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  filterSubcategories,
  subcategoryLabel,
  type SubcategoryOption,
} from '../../frontend/lib/subcategory-filter'

const leaf = (name: string, parent: string | null, classifies = true): SubcategoryOption => ({
  id: `${parent ?? 'orphan'}/${name}`,
  name,
  parent_name: parent,
  classifies,
})

/** Real rows, including the pairs the flat list put three hundred apart. */
const OPTIONS: SubcategoryOption[] = [
  leaf('Solid Body', 'Electric Guitars'),
  leaf('Semi-Hollow', 'Electric Guitars'),
  leaf('Hollow Body', 'Electric Guitars'),
  leaf('Electric Guitars', 'Electric Guitars'),
  leaf('Baritone', 'Electric Guitars'),
  leaf('Baritone', 'Acoustic Guitars'),
  leaf('Baritone', 'Band and Orchestra'),
  leaf('Hi-Hats', 'Drums and Percussion'),
  leaf('Patchbays', 'Pro Audio'),
  leaf('Power Supplies', 'Accessories'),
  leaf('Wireless Systems', 'Pro Audio'),
  leaf('Reverb', 'Effects and Pedals'),
  leaf('Reverb', 'Pro Audio'),
]

test('PAN-97: the picker narrows, and narrowing is all it does', () => {
  // The complaint, in one assertion: everything is offered until something is
  // typed, and the full list stays reachable rather than hidden behind a
  // mandatory query.
  assert.equal(filterSubcategories(OPTIONS, '').length, OPTIONS.length)
  assert.equal(filterSubcategories(OPTIONS, '   ').length, OPTIONS.length)

  // The journey that motivated the ticket: `Solid Body` without the scroll.
  assert.deepEqual(
    filterSubcategories(OPTIONS, 'solid').map(subcategoryLabel),
    ['Electric Guitars › Solid Body'],
  )

  // Substring, not prefix — `hollow` has to find `Semi-Hollow`, which is the
  // row two of the eight hand-classified guitars actually belonged in.
  assert.deepEqual(
    filterSubcategories(OPTIONS, 'hollow').map(subcategoryLabel),
    ['Electric Guitars › Semi-Hollow', 'Electric Guitars › Hollow Body'],
  )

  // The parent is searchable too, so a root narrows to its own leaves and the
  // distance between Solid Body and Semi-Hollow collapses to adjacent rows.
  const electric = filterSubcategories(OPTIONS, 'electric guitars')
  assert.equal(electric.length, 5)
  assert.ok(electric.every((c) => c.parent_name === 'Electric Guitars'))

  // Terms are AND-ed and order-independent; a match is a match, and the
  // server's alphabetical order is preserved rather than re-ranked.
  assert.deepEqual(
    filterSubcategories(OPTIONS, 'guitars solid').map(subcategoryLabel),
    filterSubcategories(OPTIONS, 'solid guitars').map(subcategoryLabel),
  )
  assert.deepEqual(filterSubcategories(OPTIONS, 'solid guitars').map(subcategoryLabel), [
    'Electric Guitars › Solid Body',
  ])

  // Case does not matter, and a query that matches nothing returns nothing —
  // never a silent fallback to the whole list.
  assert.equal(filterSubcategories(OPTIONS, 'SOLID BODY').length, 1)
  assert.deepEqual(filterSubcategories(OPTIONS, 'theremin'), [])
})

test('PAN-97: every option carries its parent, so same-named leaves are distinct', () => {
  // Thirteen leaf names repeat across roots in production. Unlabelled, the
  // three `Baritone` rows are indistinguishable — and unpickable correctly.
  const baritones = filterSubcategories(OPTIONS, 'baritone')
  assert.equal(baritones.length, 3)
  assert.deepEqual(baritones.map(subcategoryLabel), [
    'Electric Guitars › Baritone',
    'Acoustic Guitars › Baritone',
    'Band and Orchestra › Baritone',
  ])
  assert.equal(new Set(baritones.map(subcategoryLabel)).size, 3)

  // `Reverb` is a leaf name under two roots AND a marketplace Klup scrapes;
  // the parent is the only thing that says which is meant.
  assert.deepEqual(filterSubcategories(OPTIONS, 'reverb').map(subcategoryLabel), [
    'Effects and Pedals › Reverb',
    'Pro Audio › Reverb',
  ])

  // The known `kg_category` oddity: `Electric Guitars` is both a root and a
  // child of itself (ac2fb209… is the root, ff45171f… its child). Labelling
  // must not hide the row or collapse it into its own parent — it reads as one
  // more leaf, which is what it is. Out of scope to fix; in scope not to break.
  assert.equal(
    subcategoryLabel(leaf('Electric Guitars', 'Electric Guitars')),
    'Electric Guitars › Electric Guitars',
  )

  // A leaf whose parent could not be resolved is a broken hierarchy, not a
  // root: show the bare name rather than inventing a parent.
  assert.equal(subcategoryLabel(leaf('Orphan', null)), 'Orphan')
})
