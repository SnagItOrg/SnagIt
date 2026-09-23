/**
 * scripts/lib/pan99-csp-ranking.test.ts
 *
 * PAN-99. The Reverb CSP resolver attached "Yamaha DX7 Data ROM Cartridge" to
 * `yamaha-dx7` — legendary, public — while a CSP whose slug was identical to
 * the product slug sat in the same response. Every candidate scored 1.0, and
 * the tie was settled by `used_total`: the cartridge had 54 used listings, the
 * synthesizer 44. Inventory popularity decided identity.
 *
 * These three lock out exactly that, and nothing wider:
 *   1. an exact slug match wins outright, even against a better-scoring rival;
 *   2. a scored tie is broken by specificity then csp_id, so the result does
 *      not depend on the order Reverb returned;
 *   3. the real DX7 candidate set resolves to the synthesizer.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  rankCandidates,
  scoreMatch,
  type RankableCandidate,
} from './reverb-csp-ranking'

// The three CSPs Reverb returned for canonical "Yamaha DX7", with the
// used_total values recorded in attributes.reverb_csp_correction on the row.
const DX7_CANONICAL = 'Yamaha DX7'
const DX7_SLUG = 'yamaha-dx7'
const DX7_CSPS: RankableCandidate[] = [
  { csp_id: 140919, slug: 'yamaha-dx7-data-rom-cartridge', title: 'Yamaha DX7 Data ROM Cartridge' },
  { csp_id: 2459,   slug: 'yamaha-dx7',                    title: 'Yamaha DX7 Digital FM Synthesizer' },
  { csp_id: 140918, slug: 'yamaha-dx7-data-cartridge',     title: 'Yamaha DX7 Data RAM Cartridge' },
].map(c => ({ ...c, score: scoreMatch(DX7_CANONICAL, c.title) }))

test('ranking: an exact slug match wins outright, even against a higher score', () => {
  // The rival is a perfect 1.0 with fewer extra tokens; the exact-slug
  // candidate is deliberately made worse on every other key.
  const ranked = rankCandidates('korg-monotron', 'Korg Monotron', [
    { csp_id: 2506, slug: 'korg-monotron-delay-ribbon-synthesizer-2', title: 'Korg Monotron Delay Ribbon Synthesizer', score: 1 },
    { csp_id: 28771, slug: 'korg-monotron', title: 'Korg Monotron Ribbon Controller Analog Synthesizer', score: 0.5 },
  ])

  assert.equal(ranked[0].csp_id, 28771, 'the candidate whose slug equals the product slug must win')
})

test('ranking: a scored tie is broken deterministically, not by response order', () => {
  // No exact slug on offer, all three tied at 1.0 — the situation `used_total`
  // used to arbitrate. Specificity decides, then csp_id, and every permutation
  // of the input must produce the same order.
  // Extra distinct tokens beyond {akai, lpd8}: the first two carry 4 each
  // (mkii, midi, pad, controller), the third carries 9.
  const tied: RankableCandidate[] = [
    { csp_id: 900, slug: 'akai-lpd8-mkii-midi-pad-controller', title: 'Akai LPD8 MKII MIDI Pad Controller', score: 1 },
    { csp_id: 100, slug: 'akai-lpd8-wireless-special-edition', title: 'Akai LPD8 Wireless Bluetooth Portable USB MIDI Pad Controller Special Edition', score: 1 },
    { csp_id: 500, slug: 'akai-lpd8-mk2-midi-pad-controller', title: 'Akai LPD8 MKII MIDI Pad Controller', score: 1 },
  ]
  const expected = [500, 900, 100]

  const permutations = [
    [tied[0], tied[1], tied[2]],
    [tied[2], tied[1], tied[0]],
    [tied[1], tied[0], tied[2]],
    [tied[1], tied[2], tied[0]],
  ]
  for (const order of permutations) {
    const ranked = rankCandidates('akai-lpd8', 'Akai LPD8', order)
    // Specificity puts the two 4-extra-token titles ahead of the 9-token one;
    // csp_id breaks the remaining tie between the two identical titles.
    assert.deepEqual(ranked.map(c => c.csp_id), expected, 'ranking must not depend on input order')
  }
})

test('ranking: the DX7 candidate set resolves to the synthesizer, not the cartridge', () => {
  // The precondition that made this a bug: recall-only scoring saturates, so
  // all three are indistinguishable on score alone.
  assert.deepEqual(DX7_CSPS.map(c => c.score), [1, 1, 1], 'all three CSP titles are supersets of the canonical name')

  const ranked = rankCandidates(DX7_SLUG, DX7_CANONICAL, DX7_CSPS)

  assert.equal(ranked[0].csp_id, 2459)
  assert.equal(ranked[0].title, 'Yamaha DX7 Digital FM Synthesizer')
  assert.notEqual(ranked[0].csp_id, 140919, 'the data cartridge must never be the chosen identity')
})
