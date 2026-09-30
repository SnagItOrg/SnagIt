/**
 * PAN-192 — browse shows families: one family card replaces its models.
 *
 * Two properties, both of a pure function over the rows a grid renders, and
 * both silent when they break: a price on a family card looks like any other
 * price (PAN-94), and a family collapsing at one member hides a product behind
 * a card that says "1 modeller".
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { FAMILY_CARD_MIN_CHILDREN, collapseFamilies } from '../../frontend/lib/family-cards'

const rhodes = (slug: string, order: number, image_url: string | null) => ({
  slug,
  image_url,
  // Fields a browse row can carry that a family card must never inherit.
  active_listing_count: 9,
  price_dkk: 24000,
  family: { slug: 'rhodes', label: 'Rhodes Electric Piano', brand: 'Rhodes', order },
})

test('a family card carries no price field, and no listing count, ever (PAN-94)', () => {
  const [card] = collapseFamilies([
    rhodes('rhodes-mark-i-suitcase-73', 1, null),
    rhodes('rhodes-mark-i-stage-73', 0, 'https://img/stage-73.webp'),
  ])

  assert.equal(card?.kind, 'family')
  // An exact key set: a new key is how price evidence would arrive, so it has
  // to be written into this list to ship.
  assert.deepEqual(Object.keys(card!).sort(), ['brand', 'imageUrl', 'kind', 'label', 'modelCount', 'slug'])
  for (const key of Object.keys(card!)) {
    assert.equal(/price|band|median|verdict|listing|sold|msrp|currency/i.test(key), false, key)
  }
  // The image is the first member in reviewed order, not the first row served.
  assert.equal(card!.kind === 'family' && card!.imageUrl, 'https://img/stage-73.webp')
})

test('a family collapses at two members in the rendered set, and never at one', () => {
  assert.equal(FAMILY_CARD_MIN_CHILDREN, 2)
  const other = { slug: 'wurlitzer-200a', image_url: null, family: null }

  // One member (e.g. `?sub=` left only one): its own product card, unchanged.
  const one = collapseFamilies([other, rhodes('rhodes-mark-ii-stage-73', 2, null)])
  assert.deepEqual(one.map((c) => c.kind), ['product', 'product'])

  // Two members: one card, in the first member's position, replacing both.
  const two = collapseFamilies([
    rhodes('rhodes-mark-ii-stage-73', 2, null),
    other,
    rhodes('rhodes-mark-i-stage-88', 3, null),
  ])
  assert.deepEqual(two.map((c) => c.kind), ['family', 'product'])
  assert.equal(two[0]!.kind === 'family' && two[0]!.modelCount, 2)
})
