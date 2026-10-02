/**
 * scripts/lib/pan220-line-boundaries.test.ts
 *
 * PAN-220: the PRS rows the promote SQL moves to `supported` (the four rows PRS had and the 11
 * step-2 models). One test per hazard class, on production titles (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan220-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const prs = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `PRS ${model_name}`, model_name, brand_name: 'prs', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    prs('prs-custom-22', 'Custom 22'),
    prs('prs-custom-22-piezo', 'Custom 22 Piezo'),
    prs('prs-custom-24', 'Custom 24'),
    prs('prs-custom-24-08', 'Custom 24-08'),
    prs('prs-mccarty-594', 'McCarty 594'),
    prs('prs-mccarty-594-singlecut', 'McCarty 594 Singlecut'),
    prs('prs-s2-mccarty-594', 'S2 McCarty 594'),
    prs('prs-s2-mccarty-594-singlecut', 'S2 McCarty 594 Singlecut'),
    prs('prs-silver-sky', 'Silver Sky'),
  ],
  [], [], ['prs', 'fender', 'gibson'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-220: the longer model name wins inside a line', () => {
  assert.equal(matchedSlug('PRS Custom 22 Stoptail 10-Top 2003 - Violin Amber'), 'prs-custom-22')
  assert.equal(matchedSlug('PRS Custom 22 Piezo Artist Package 2021 - Faded Whale Blue Nickle'), 'prs-custom-22-piezo')
  assert.equal(matchedSlug('PRS Custom 24 08 Mango Top Limited Edition Purple Mist'), 'prs-custom-24-08')
  assert.equal(matchedSlug('PRS McCarty 594 Singlecut Red Tiger (350)'), 'prs-mccarty-594-singlecut')
  assert.equal(matchedSlug('PRS S2 McCarty 594 Singlecut - Burnt Amber Burst'), 'prs-s2-mccarty-594-singlecut')
  assert.equal(matchedSlug('PRS S2 McCarty 594 Black Amber (967)'), 'prs-s2-mccarty-594')
})

test('PAN-220: a Core row refuses what it is not', () => {
  // Private Stock, a model with no row (12-string, SE), a typo of Singlecut.
  assert.equal(matchedSlug('2008 PRS Private Stock Custom 22 #1822'), null)
  assert.equal(matchedSlug('PRS Custom 22/12 Charcoal Smokewrap 12-String Electric Guitar 2008 Pre-Owned'), null)
  assert.equal(matchedSlug('PRS Paul Reed Smith SE Custom 22 2008 MIK HH Vintage Sunburst Electric Guitar'), null)
  assert.equal(matchedSlug('PRS PRS McCarty 594 Singelcut Ten Top 2023 - Yellow Tiger'), null)
})

test('PAN-220: Silver Sky parts and a wiring harness are not the guitar', () => {
  assert.equal(matchedSlug('PRS Silver Sky John Mayer Signature Electric Guitar Polar Blue'), 'prs-silver-sky')
  assert.equal(matchedSlug('PRS Silver Sky Knobs - White  - Set of 3'), null)
  assert.equal(matchedSlug('PRS Silver Sky height adjustment tubing & washer kit'), null)
  assert.equal(matchedSlug('PRS McCarty 594 Drop In - 2 volume, 2 Push/Pull Tone'), null)
})
