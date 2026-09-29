/**
 * PAN-170 — parts sold under a product are not sales of it.
 *
 * The Juno-106's 40 Reverb sold rows as they stood on production 2026-09-28
 * (prices SELECTed; categories as api.reverb.com returns them). Ten are parts
 * at 47–1,093 kr. There are enough of them to drag Q1 to 4,369 kr, so the
 * Tukey fence, which is anchored on Q1, keeps them, and the page published
 * "4.369 kr – 16.003 kr typisk spænd".
 *
 * Eight of the ten are filed under Reverb's "Parts". Two were filed by their
 * sellers as something else (a 70 kr knob under "Pro Audio / Outboard Gear /
 * Utility", a 1,093 kr output board as a synth), so the category does not see
 * them. Once the other eight are gone the fence does, and the band is the one
 * a perfect hand-labelling gives.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPopulationStats,
  isPartOrAccessoryListing,
  type PriceObservation,
} from '../../frontend/lib/price-populations'

const PARTS = [{ uuid: '1f99c852-9d20-4fd3-a903-91da9c805a5e', full_name: 'Parts' }]
const SYNTH = [
  { uuid: 'c577b406-a405-45ec-a8eb-56fbe628fa19', full_name: 'Keyboards and Synths / Synths / Analog Synths' },
  { uuid: 'd2688e49-3cca-4cf6-95d0-c105e8e5c3bd', full_name: 'Keyboards and Synths / Synths / Keyboard Synths' },
]

const UTILITY = [{ uuid: '4a1f4a3a-c266-4771-b473-ec547b835e55', full_name: 'Pro Audio / Outboard Gear / Utility' }]

const JUNO_106_PARTS = [47, 59, 102, 157, 164, 266, 305, 548]
const JUNO_106_SYNTHS = [
  7644, 10866, 11465, 11864, 12168, 12739, 13240, 13259, 13435, 13717, 14037, 14053, 14085, 14332, 14379,
  14650, 15255, 15287, 15976, 16029, 18343, 18436, 20669, 20751, 23397, 24258, 24343, 25667, 25667, 78346,
]

type SoldRow = { price: number; reverb_categories: unknown }
const rows: SoldRow[] = [
  ...JUNO_106_PARTS.map((price) => ({ price, reverb_categories: PARTS })),
  ...JUNO_106_SYNTHS.map((price) => ({ price, reverb_categories: SYNTH })),
  // The two mis-filed parts: invisible to the category, caught by the fence.
  { price: 70, reverb_categories: UTILITY },
  { price: 1093, reverb_categories: SYNTH },
]
// The mapping /api/product/[slug] applies to a sold row.
const observe = (r: SoldRow): PriceObservation =>
  ({ price: r.price, price_dkk: r.price, source: 'reverb', country: null, condition: null })
const band = (s: ReturnType<typeof buildPopulationStats>) => [s.q1, s.median, s.q3].map((v) => Math.round(v ?? NaN))

test('PAN-170: the Juno-106 band is built from the synth, not the knobs sold for it', () => {
  // The fence alone: the parts are Q1, so it cannot see them.
  assert.deepEqual(band(buildPopulationStats('reverb-sold', rows.map(observe))), [4369, 13717, 16003])

  const kept = rows.filter((r) => !isPartOrAccessoryListing(r.reverb_categories))
  assert.equal(kept.length, 40 - JUNO_106_PARTS.length)
  assert.deepEqual(band(buildPopulationStats('reverb-sold', kept.map(observe))), [13259, 14379, 18436])

  // A part filed under an instrument root, which a check on the root alone misses.
  assert.equal(isPartOrAccessoryListing([{ full_name: 'Keyboards and Synths / Keyboard and Synth Parts' }]), true)
  // Not yet backfilled: kept, so an unrecorded row is never worse than before 060.
  assert.equal(isPartOrAccessoryListing(null), false)
})
