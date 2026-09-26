/**
 * scripts/lib/pan153-identity-phrase.test.ts
 *
 * PAN-153: the live matcher read a model name out of a title that names a
 * different identity. One test per collision class (PAN-52 D6):
 *
 *   1. suffix: "Telecaster Custom" + "Shop" — the model borrows the first word
 *      of the sub-brand "Custom Shop" (live on two supported products);
 *   2. prefix: "Classic" + "Player Stratocaster" — the model borrows the last
 *      word of the series "Classic Player" (found by PAN-151).
 *
 * Every title below is a real production listing title.
 *
 * Run: npx tsx --test scripts/lib/pan153-identity-phrase.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMatchIndex,
  decideMatch,
  type Product,
} from '../../frontend/lib/matching/match-listings'

const product = (slug: string, model_name: string, brand_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name,
  status: 'active', support_state: 'supported',
})

const TELE_CUSTOM   = product('fender-telecaster-custom', 'Telecaster Custom', 'fender')
const LP_CUSTOM     = product('gibson-les-paul-custom', 'Les Paul Custom', 'gibson')
// `known` in production today; D9 names it as the next Stratocaster terminal.
const PLAYER_STRAT  = product('fender-player-stratocaster', 'Player Stratocaster', 'fender')

const index = buildMatchIndex([TELE_CUSTOM, LP_CUSTOM, PLAYER_STRAT], [], [])
const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('a model name that borrows the "Custom" of "Custom Shop" is not that model', () => {
  for (const title of [
    'Fender Telecaster Custom Shop 52',
    "Fender 62's Telecaster Custom Shop LTD (Abigail Ybarra)",
    'Fender Telecaster custom shop',
    'Gibson Les Paul Custom shop R8 2017',
    'Gibson Les Paul Custom Shop MS 1958 Iced Tea',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }

  // "Custom Shop" standing apart from the model name costs nothing.
  for (const [title, slug] of [
    ['Gibson Les Paul Custom - Custom shop', 'gibson-les-paul-custom'],
    ['2016 Gibson – Les Paul Custom Custom Shop Silver Burst', 'gibson-les-paul-custom'],
  ]) {
    assert.equal(matchedSlug(title), slug, title)
  }
  // PAN-154 moved three former examples out: the line boundaries refuse them,
  // not this guard. The Telecaster Custom "Excludes Custom Shop" (frozen
  // boundary), and a Custom Shop 1957 VOS is a Les Paul Custom reissue.
  for (const title of [
    '2006 Fender Custom Shop 1962 Telecaster Custom NOS',
    'Fender Custom Shop Telecaster Custom Journeyman Relic Ltd Fat 50s',
    'Gibson Custom Shop 1957 Les Paul Custom Black Beauty VOS – 2-pickup',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }
})

test('a model name that borrows the "Player" of "Classic Player" is not that model', () => {
  for (const title of [
    'Fender Custom Shop Classic Player Stratocaster 2004 Sunburst Guitar',
    'Fender Classic Player Stratocaster – Tausch',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }

  assert.equal(matchedSlug('Fender Player Stratocaster HSS'), 'fender-player-stratocaster')
})
