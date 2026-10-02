/**
 * scripts/lib/pan218-line-boundaries.test.ts
 *
 * PAN-218: the Gretsch rows the promote SQL moves to `supported` (the G5420T and the 14 step-2
 * models), with the model names the promote SQL sets. One test per hazard class, on production
 * titles (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan218-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const gretsch = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Gretsch ${model_name}`, model_name, brand_name: 'gretsch', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    gretsch('gretsch-g5420t-electromatic', 'G5420T'),
    gretsch('gretsch-g5420t-electromatic-classic', 'G5420T Electromatic Classic'),
    gretsch('gretsch-g6122t-62-vintage-select-country-gentleman', 'G6122T-62'),
    gretsch('gretsch-g6122t-players-edition-country-gentleman', 'G6122T'),
    gretsch('gretsch-g6128t-gh-george-harrison-duo-jet', 'G6128T-GH'),
    gretsch('gretsch-g6128t-53-vintage-select-duo-jet', 'G6128T-53'),
    gretsch('gretsch-g6136-55-vintage-select-falcon', 'G6136-55'),
  ],
  [], [], ['gretsch', 'gibson', 'epiphone'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-218: a model code lands on its own model, never on a sibling', () => {
  assert.equal(matchedSlug("Gretsch G6128T-53 Vintage Select '53 Duo Jet with TV Jones Super’Trons"), 'gretsch-g6128t-53-vintage-select-duo-jet')
  assert.equal(matchedSlug('Gretsch G6128T-GH George Harrison Signature Duo Jet 2011 - Present - Black'), 'gretsch-g6128t-gh-george-harrison-duo-jet')
  assert.equal(matchedSlug('Gretsch G6122T-62 Vintage Select Country Gentleman Walnut Stain'), 'gretsch-g6122t-62-vintage-select-country-gentleman')
  // "G6122T" is the Players Edition; the hyphenated code is not it.
  assert.equal(matchedSlug('Gretsch G6122T Players Edition Country Gentleman with String-Thru Bigsby 2016 - 2020 - Walnut Stain'), 'gretsch-g6122t-players-edition-country-gentleman')
})

test('PAN-218: the G5420T generations are two rows', () => {
  assert.equal(matchedSlug('Gretsch G5420T Electromatic Classic Single-Cut with Bigsby - Walnut Stain'), 'gretsch-g5420t-electromatic-classic')
  assert.equal(matchedSlug('Gretsch G5420T Electromatic 2016 - 2020 - Orange Stain'), 'gretsch-g5420t-electromatic')
})

test('PAN-218: a Custom Shop build of a production model is refused', () => {
  assert.equal(matchedSlug('Guitarra Electrica GRETSCH George Harrison TRIBUTE Custom Shop Duo Jet G6128T-GH'), null)
  assert.equal(matchedSlug('Gretsch Custom Shop Masterbuilt G6136-55 Falcon Vintage White DEMO (917)'), null)
})
