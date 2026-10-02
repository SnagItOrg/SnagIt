/**
 * scripts/lib/pan222-line-boundaries.test.ts
 *
 * PAN-222: the Rickenbacker rows the promote SQL moves to `supported` (4001, 4003, 360/12 and the
 * step-2 4003S). One test per hazard class, on production titles (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan222-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const ric = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Rickenbacker ${model_name}`, model_name, brand_name: 'rickenbacker', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [ric('rickenbacker-4001', '4001'), ric('rickenbacker-4003', '4003'), ric('rickenbacker-4003s', '4003S'), ric('rickenbacker-360-12', '360/12')],
  [], [], ['rickenbacker', 'ibanez', 'fender'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-222: a number lands on its own model', () => {
  assert.equal(matchedSlug('Rickenbacker 4001 1974 - Mapleglo'), 'rickenbacker-4001')
  assert.equal(matchedSlug('Rickenbacker 4003 Bass, FireGlo'), 'rickenbacker-4003')
  assert.equal(matchedSlug('Rickenbacker 4003S JetGlo (735)'), 'rickenbacker-4003s')
  assert.equal(matchedSlug('Rickenbacker 360/12 12-String Jetglo'), 'rickenbacker-360-12')
})

test('PAN-222: a suffixed reissue is not the base model', () => {
  assert.equal(matchedSlug('Rickenbacker 4001 V63 2001 [Used]'), null)
  assert.equal(matchedSlug('Rickenbacker 360/12C63 FireGlo (688)'), null)
})

test('PAN-222: parts are not the bass', () => {
  assert.equal(matchedSlug('Rickenbacker Bass Thumb Rest for Older 4001 Series - No-Drill Tug Bar, Ergonomic Grip - Black'), null)
  assert.equal(matchedSlug('Rickenbacker 4003 Scratchplate - White (5003484)'), null)
  assert.equal(matchedSlug('Rickenbacker 4001 Wiring Rickenbacker 4001'), null)
})
