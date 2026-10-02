/**
 * scripts/lib/pan225-line-boundaries.test.ts
 *
 * PAN-225: the Taylor rows the promote SQL moves to `supported` (314ce, 814ce, GS Mini and the 14
 * step-2 models), with aliases the promote SQL adds. One test per hazard class, on production
 * titles (read-only snapshot 2026-10-02).
 *
 * Run: npx tsx --test scripts/lib/pan225-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const taylor = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Taylor ${model_name}`, model_name, brand_name: 'taylor', status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    taylor('taylor-314ce', '314ce'),
    taylor('taylor-314ce-studio', '314ce Studio'),
    taylor('taylor-814ce', '814ce'),
    taylor('taylor-814ce-dlx', '814ce DLX'),
    taylor('taylor-next-generation-814ce', 'Next Generation 814ce'),
    taylor('taylor-builders-edition-814ce', "Builder's Edition 814ce"),
    taylor('taylor-next-generation-builders-edition-814ce', "Next Generation Builder's Edition 814ce"),
    taylor('taylor-gs-mini', 'GS Mini'),
    taylor('taylor-gs-mini-mahogany', 'GS Mini Mahogany'),
    taylor('taylor-gs-mini-e-koa', 'GS Mini-e Koa'),
    taylor('taylor-gs-mini-e-koa-plus', 'GS Mini-e Koa Plus'),
  ],
  [],
  [
    { alias: '814ce Next Generation', canonical_query: 'taylor-next-generation-814ce' },
    { alias: "Builder's Edition 814ce Next Generation", canonical_query: 'taylor-next-generation-builders-edition-814ce' },
  ],
  ['taylor', 'martin', 'gibson'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('PAN-225: the longer model name wins inside a line', () => {
  assert.equal(matchedSlug('Taylor 314ce with V-Class Bracing - 2025 - Tobacco Sunburst'), 'taylor-314ce')
  assert.equal(matchedSlug('Taylor 314ce Studio Special Edition 2024 - Natural'), 'taylor-314ce-studio')
  assert.equal(matchedSlug('Taylor 814ce DLX with V-Class Bracing 2018 Natural'), 'taylor-814ce-dlx')
  assert.equal(matchedSlug("Taylor Builder's Edition 814ce Acoustic-Electric Guitar"), 'taylor-builders-edition-814ce')
  assert.equal(matchedSlug('Taylor 814ce Next Generation Grand Auditorium Acoustic-Electric Natural'), 'taylor-next-generation-814ce')
  // Both words: the model that carries both, in either order.
  assert.equal(matchedSlug("Taylor Next Generation Builder's Edition 814ce Honduran Rosewood/Sinker Redwood (083)"), 'taylor-next-generation-builders-edition-814ce')
  assert.equal(matchedSlug("Taylor Builder's Edition 814ce Next Generation Grand Auditorium Acoustic-Electric Natural"), 'taylor-next-generation-builders-edition-814ce')
})

test('PAN-225: the plain 814ce refuses what it is not', () => {
  assert.equal(matchedSlug('Taylor 814ce Builders Ed. w/Case-Honduran Rosewood & Adirondack Spruce Serial#: 1203145007'), null)
  assert.equal(matchedSlug('Taylor 814ce Gold Label Grand Auditorium  - Koa Sunburst Serial#: 1205205044'), null)
  assert.equal(matchedSlug('Taylor 314ce N Nylon String Acoustic Electric Guitar'), null)
})

test('PAN-225: the GS Mini woods are separate models', () => {
  assert.equal(matchedSlug('Taylor GS Mini Sapele Acoustic Guitar - Natural'), 'taylor-gs-mini')
  assert.equal(matchedSlug('Taylor GS Mini Mahogany Acoustic Guitar - Natural'), 'taylor-gs-mini-mahogany')
  assert.equal(matchedSlug('Taylor GS Mini e Koa Acoustic Electric Guitar'), 'taylor-gs-mini-e-koa')
  assert.equal(matchedSlug('Taylor GS Mini-e Koa Plus Acoustic-electric Guitar - Shaded Edgeburst'), 'taylor-gs-mini-e-koa-plus')
  // No row for the plain Koa or the figured-koa LTD.
  assert.equal(matchedSlug('Taylor GS Mini Koa - 2nd Hand'), null)
  assert.equal(matchedSlug('Taylor GS Mini-e LTD Figured Koa Acoustic-Electric Natural'), null)
})
