/**
 * PAN-235: the similar-gear ranking rule, on the cases that decide the shelf.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { rankSimilar, relationReason, SIMILAR_MAX } from '../../frontend/lib/similar-gear'

const c = (slug: string, tier_rank = 0, active_listing_count = 0, median_dkk: number | null = null) =>
  ({ slug, tier_rank, active_listing_count, median_dkk })

test('explicit relations come first, then family, then same type; the product itself and repeats are dropped', () => {
  const picks = rankSimilar(
    { slug: 'roland-juno-106', median_dkk: 9000 },
    [{ candidate: c('behringer-ju-06', 0, 40), reason: 'clone' }],
    [c('roland-juno-60', 2, 60), c('roland-juno-106', 2, 90), c('roland-juno-6', 0, 17)],
    [c('roland-juno-60', 2, 60), c('yamaha-dx7', 2, 61, 5000)],
  )
  assert.deepEqual(
    picks.map((p) => `${p.reason}:${p.candidate.slug}`),
    ['clone:behringer-ju-06', 'same_family:roland-juno-60', 'same_family:roland-juno-6', 'same_type:yamaha-dx7'],
  )
})

test('same type prefers legendary and classic, then the most listed, and skips a price outside ×0.5–×2 when both have one', () => {
  const picks = rankSimilar(
    { slug: 'x', median_dkk: 10000 },
    [],
    [],
    [c('cheap', 2, 99, 4000), c('pricey', 0, 80, 25000), c('standard-busy', 0, 50, 12000), c('classic', 1, 1, 9000), c('unpriced', 0, 5)],
  )
  assert.deepEqual(picks.map((p) => p.candidate.slug), ['classic', 'standard-busy', 'unpriced'])
})

test('the shelf is capped', () => {
  const many = Array.from({ length: 12 }, (_, i) => c(`p${i}`, 0, 12 - i))
  assert.equal(rankSimilar({ slug: 'x', median_dkk: null }, [], [], many).length, SIMILAR_MAX)
})

test('a relation row is read from the page it is shown on', () => {
  assert.equal(relationReason('clone', 'from_is_other'), 'clone')
  assert.equal(relationReason('clone', 'to_is_other'), 'original')
  assert.equal(relationReason('successor', 'to_is_other'), 'predecessor')
  assert.equal(relationReason('sibling', 'from_is_other'), 'alternative')
  assert.equal(relationReason('compatible', 'from_is_other'), null)
})
