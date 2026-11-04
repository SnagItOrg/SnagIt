/**
 * scripts/lib/pan320-roland-vt-vp.test.ts
 *
 * PAN-320: the Boss VT-1, the Roland VT-3 and VT-4, and the Boutique VP-03 become match targets once the PAN-320 SQL
 * files run; the VP-330, VP-550, VP-770 and VP-9000 are supported already. The VP-03 re-creates the VP-330 and shares its
 * line, so a title naming both is the Boutique. Every title is a production or Reverb sold title (2026-11-04) unless
 * marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan320-roland-vt-vp.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan320-roland-vt-vp'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

const PRODUCTS: Product[] = [
  row('boss-vt-1-voice-transformer', 'boss', 'Boss VT-1 Voice Transformer', 'VT-1'),
  row('roland-vt-3', 'roland', 'Roland VT-3', 'VT-3'),
  row('roland-vt-4', 'roland', 'Roland VT-4', 'VT-4'),
  row('roland-vp-03', 'roland', 'Roland VP-03', 'VP-03'),
  row('roland-vp-330', 'roland', 'Roland VP-330', 'VP-330'),
  row('roland-vp-550', 'roland', 'Roland VP-550', 'VP-550'),
  row('roland-vp-770', 'roland', 'Roland VP-770', 'VP-770'),
  row('roland-vp-9000', 'roland', 'Roland VP-9000', 'VP-9000'),
  // A row production holds that a "VT40X" title could stray onto.
  row('vox-vt40x', 'vox', 'Vox VT40X', 'VT40X'),
]

const index = buildMatchIndex(PRODUCTS, [], [], ['boss', 'roland', 'vox', 'korg'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }

test('every row has a boundary and the config lists the 4 rows promoted and the 4 VP rows supported', () => {
  assert.deepEqual([...config.promoted].sort(), ['boss-vt-1-voice-transformer', 'roland-vp-03', 'roland-vt-3', 'roland-vt-4'])
  for (const slug of [...config.promoted, ...config.supportedToday]) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  assert.equal(LINE_BOUNDARIES['roland-vp-03'].line, LINE_BOUNDARIES['roland-vp-330'].line)
})

test('each VT reaches its row; the VP-03 is the Boutique, never the 1979 VP-330', () => {
  matches('boss-vt-1-voice-transformer', ['Boss VT-1 Voice Transformer 1996 - 2005 - Yellow', 'Boss VT-1 Voice Transformer #6'])
  matches('roland-vt-3', ['Roland VT-3 vokal transformer', 'Roland AIRA VT-3 Voice Transformer'])
  matches('roland-vt-4', ['Roland Vt-4 (Voice-Transformer)', 'Roland VT-4 Voice Transformer'])
  matches('roland-vp-03', ['Roland VP-03 Boutique Series Vocoder Plus Synthesizer Module', 'Roland Boutique VP-03 with K-25m Keyboard'])
  // Synthetic: the Boutique sold as "the VP-330 in miniature" is the Boutique.
  matches('roland-vp-03', ['Roland VP-03 Boutique Vocoder (VP-330 in miniature)'])
  matches('roland-vp-330', ['Roland VP-330 Vocoder Plus 1979'])
  // A VT-1 compared with a VT-3 names two products: a tie.
  assert.equal(decide('Boss VT-1 Voice Transformer VOCODER mic vintage effect Roland vt-3 autotune'), 'deferred:ambiguous_tie')
})
