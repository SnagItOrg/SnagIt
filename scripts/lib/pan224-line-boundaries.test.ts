/**
 * scripts/lib/pan224-line-boundaries.test.ts
 *
 * PAN-224: the Heritage rows the promote SQL moves to `supported` (H-150, H-535 and the 4 step-2
 * models), with aliases the promote SQL adds. One test per hazard class, on production titles
 * (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan224-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const heritage = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Heritage ${model_name}`, model_name, brand_name: 'heritage', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    heritage('heritage-h-150', 'H-150'),
    heritage('heritage-standard-ii-h-150', 'Standard II H-150'),
    heritage('heritage-custom-shop-core-h-150', 'Custom Shop Core H-150'),
    heritage('heritage-h-535', 'H-535'),
    heritage('heritage-h-535-artisan-aged', 'H-535 Artisan Aged'),
  ],
  [],
  [
    { alias: 'Standard II Collection H-150', canonical_query: 'heritage-standard-ii-h-150' },
    { alias: 'Custom Shop Core Collection H-150', canonical_query: 'heritage-custom-shop-core-h-150' },
  ],
  ['heritage', 'gibson', 'fender'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-224: a series name lands on its own model', () => {
  assert.equal(matchedSlug('Heritage Standard Collection H-150 Dirty Lemon Burst 1240830'), 'heritage-h-150')
  assert.equal(matchedSlug('Heritage Standard II H-150 Dirty Lemon Burst'), 'heritage-standard-ii-h-150')
  assert.equal(matchedSlug('Heritage Standard II Collection H-150 - Chestnut Burst'), 'heritage-standard-ii-h-150')
  assert.equal(matchedSlug('Heritage Custom Shop Core Collection H-150 Artisan Aged - Ebony. NEW (Authorized Dealer)'), 'heritage-custom-shop-core-h-150')
  assert.equal(matchedSlug('Heritage H-535 Artisan Aged 2018 - 2020 - Antique Natural'), 'heritage-h-535-artisan-aged')
})

test('PAN-224: a series with no row is not the Standard', () => {
  assert.equal(matchedSlug('Heritage H-535 Standard-II 2026 - Translucent Cherry'), null)
  assert.equal(matchedSlug('Heritage H-535 Standard II Semi-Hollow Electric Guitar - Chestnut Burst Finish with Case and Pro setup'), null)
  assert.equal(matchedSlug('Heritage Custom Shop Factory Special H-150 Electric Guitar 60s Neck Gold Top HRT-015130114'), null)
  assert.equal(matchedSlug('Heritage H-150 Custom Shop Relic'), null)
})
