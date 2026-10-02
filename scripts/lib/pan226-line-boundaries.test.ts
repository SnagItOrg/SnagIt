/**
 * scripts/lib/pan226-line-boundaries.test.ts
 *
 * PAN-226: the Guild rows the promote SQL moves to `supported` (D-55 and the step-2 D-55E), with
 * the alias the promote SQL adds. On production titles (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan226-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const guild = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Guild ${model_name}`, model_name, brand_name: 'guild', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [guild('guild-d-55', 'D-55'), guild('guild-d-55e', 'D-55E')],
  [], [{ alias: 'Guild D55', canonical_query: 'guild-d-55' }], ['guild', 'martin', 'gibson'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-226: the D-55 and the electro D-55E are two models', () => {
  assert.equal(matchedSlug('Guild USA D-55 2014 - Sunburst'), 'guild-d-55')
  assert.equal(matchedSlug('Guild D55 Dreadnought Acoustic Natural 1976'), 'guild-d-55')
  assert.equal(matchedSlug('Guild USA D-55E 2017 - Present - Antique Burst'), 'guild-d-55e')
})

test('PAN-226: a framed advertisement is not the guitar', () => {
  assert.equal(matchedSlug('1979 Guild Guitars Color promotional Ad Framed Guild D-55 Acoustuc  Original'), null)
})
