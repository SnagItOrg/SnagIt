/**
 * scripts/lib/pan223-line-boundaries.test.ts
 *
 * PAN-223: the Suhr rows the promote SQL moves to `supported` (Classic S, Classic T and the 7
 * step-2 models), with the aliases the promote SQL adds. One test per hazard class, on production
 * titles (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan223-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const suhr = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Suhr ${model_name}`, model_name, brand_name: 'suhr', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    suhr('suhr-classic-s', 'Classic S'),
    suhr('suhr-classic-s-antique', 'Classic S Antique'),
    suhr('suhr-custom-shop-classic-s', 'Custom Shop Classic S'),
    suhr('suhr-classic-t', 'Classic T'),
    suhr('suhr-classic-t-antique', 'Classic T Antique'),
    suhr('suhr-mateus-asato-signature-classic-t', 'Mateus Asato Signature Classic T'),
    { id: 'p-gibson-les-paul-classic', slug: 'gibson-les-paul-classic', canonical_name: 'Gibson Les Paul Classic', model_name: 'Les Paul Classic', brand_name: 'gibson', status: 'active', support_state: 'supported' },
  ],
  [],
  [
    { alias: 'Suhr Classic S Custom', canonical_query: 'suhr-custom-shop-classic-s' },
    { alias: 'Suhr Classic T Mateus Asato Signature', canonical_query: 'suhr-mateus-asato-signature-classic-t' },
  ],
  ['suhr', 'fender', 'prs', 'gibson'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-223: the longer model name wins inside a line', () => {
  assert.equal(matchedSlug('Suhr Classic S HSS with Rosewood Fretboard 2018 - Present - Surf Green'), 'suhr-classic-s')
  assert.equal(matchedSlug('Suhr Classic S Antique Roasted - Olympic White'), 'suhr-classic-s-antique')
  assert.equal(matchedSlug('Suhr Classic T Antique Trans Butterscotch'), 'suhr-classic-t-antique')
  // A limited edition without its own row stays on the production model.
  assert.equal(matchedSlug('Suhr Classic T Roasted Pine LE - Mary Kay'), 'suhr-classic-t')
})

test('PAN-223: a custom build and a signature model are not the production guitar', () => {
  assert.equal(matchedSlug('Suhr Classic S Custom - Trans Brown'), 'suhr-custom-shop-classic-s')
  assert.equal(matchedSlug('SUHR Classic T Mateus Asato Signature Lollar Gold-Foil - Gold'), 'suhr-mateus-asato-signature-classic-t')
  assert.equal(matchedSlug('SUHR Classic T Andre Nieri Signature - Swamp Ash Body & Flamed Maple Top - Nieri Burst'), null)
  assert.equal(matchedSlug('Suhr Classic T Trans Orange Flame Maple Custom Order 2007'), null)
  // Custom Shop Antique has no row: neither the Antique nor the Custom Shop row takes it.
  assert.equal(matchedSlug('Suhr Classic S Antique Custom Model 2020 - Surf Green'), null)
})

test('PAN-223: another maker\'s guitar is not a Suhr, and keeps its own match', () => {
  // "Classic T" is also a Gibson model year suffix; two such titles hold a live Gibson match today.
  assert.equal(matchedSlug('Gibson Les Paul Classic T 2017 - Gold Top Rare finish!'), 'gibson-les-paul-classic')
  assert.equal(matchedSlug('PRS PRS S2 McCarty 594 Thinline  2020 - Vintage Cherry + Suhr Thornbuckers + Locking Tuners'), null)
})
