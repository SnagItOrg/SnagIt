/**
 * PAN-192 — browse shows families: one family card replaces its models.
 *
 * Two properties, both of a pure function over the rows a grid renders, and
 * both silent when they break: a price on a family card looks like any other
 * price (PAN-94), and a family collapsing at one member hides a product behind
 * a card that says "1 modeller".
 *
 * Owner decision 2026-09-30: the card now says "N til salg", the sum of its
 * members' active listing counts. That one count is admitted BY NAME below; the
 * price ban is unchanged.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { FAMILY_CARD_MIN_CHILDREN, collapseFamilies } from '../../frontend/lib/family-cards'

const rhodes = (slug: string, order: number, image_url: string | null, active_listing_count = 9) => ({
  slug,
  image_url,
  active_listing_count,
  // A field a browse row can carry that a family card must never inherit.
  price_dkk: 24000,
  family: { slug: 'rhodes', label: 'Rhodes Electric Piano', brand: 'Rhodes', order },
})

test('a family card carries no price field, ever (PAN-94), and one summed listing count', () => {
  const [card] = collapseFamilies([
    rhodes('rhodes-mark-i-suitcase-73', 1, null, 7),
    rhodes('rhodes-mark-i-stage-73', 0, 'https://img/stage-73.webp', 5),
  ])

  assert.equal(card?.kind, 'family')
  // An exact key set: a new key is how price evidence would arrive, so it has
  // to be written into this list to ship.
  assert.deepEqual(
    Object.keys(card!).sort(),
    ['activeListingCount', 'brand', 'imageUrl', 'kind', 'label', 'modelCount', 'slug'],
  )
  for (const key of Object.keys(card!)) {
    assert.equal(/price|dkk|band|median|p25|p75|verdict|sold|msrp|currency|deal/i.test(key), false, key)
  }
  // The one listing-shaped key admitted, by name: a count, never an amount. It
  // is the sum of the members it replaced ("12 til salg"), not a price.
  const listingKeys = Object.keys(card!).filter((key) => /listing/i.test(key))
  assert.deepEqual(listingKeys, ['activeListingCount'])
  assert.equal(card!.kind === 'family' && card!.activeListingCount, 12)
  // The image is the first member in reviewed order, not the first row served.
  assert.equal(card!.kind === 'family' && card!.imageUrl, 'https://img/stage-73.webp')
})

test('a family collapses at two members in the rendered set, and never at one', () => {
  assert.equal(FAMILY_CARD_MIN_CHILDREN, 2)
  const other = { slug: 'wurlitzer-200a', image_url: null, active_listing_count: 3, family: null }

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
