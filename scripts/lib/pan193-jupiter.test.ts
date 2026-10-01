/**
 * scripts/lib/pan193-jupiter.test.ts
 *
 * PAN-193: 216 active Reverb "Jupiter 4/6/8" listings had no match. The
 * matcher was not what missed them. 147 are legacy rows that no run has
 * evaluated since new-inflow matching took over, because that path only
 * matches the listings each scrape run inserts. Run through `decideMatch`,
 * every genuine Jupiter-4 and Jupiter-8 title in them matches.
 *
 * What the matcher got wrong is the other direction. A re-match of those rows
 * would have filed parts under the Jupiter-4, because their titles name it
 * only as what the part fits: "… Key Spring (070-052) for Jupiter-4, …".
 *
 * Every title below is a real production listing title.
 *
 * Run: npx tsx --test scripts/lib/pan193-jupiter.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMatchIndex,
  decideMatch,
  lineBoundaryRefusal,
  type Product,
} from '../../frontend/lib/matching/match-listings'

const product = (slug: string, model_name: string, support_state: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Roland ${model_name}`, model_name, brand_name: 'roland',
  status: 'active', support_state,
})

const index = buildMatchIndex(
  [
    product('roland-jupiter-4', 'Jupiter-4', 'supported'),
    product('roland-jupiter-8', 'Jupiter-8', 'supported'),
    // `known` in production: an identity, never a match target.
    product('roland-jupiter-6', 'Jupiter-6', 'known'),
  ],
  [], [],
  ['roland', 'yamaha', 'waldorf', 'arp', 'ppg', 'oberheim'],
)
const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('the Jupiter titles PAN-193 named match; keyword spam and the Jupiter-6 do not', () => {
  for (const [title, slug] of [
    ['Roland JUPITER 4', 'roland-jupiter-4'],
    ['Rare, Roland Jupiter 4 early version (BA662 filters) serviced !', 'roland-jupiter-4'],
    ['Roland Jupiter-4 ✅MIDI upgrade optional ✅ Legendary early Compunicator Synth ✅ Raw & Screaming 70s Analog Power ✅ Fully Checked & Cleaned ✅ Iconic Thick Chorus Engine ✅ Worldwide Shipping - Roland Jupiter 4', 'roland-jupiter-4'],
    // A "for" that does not govern the model leaves the instrument alone.
    ["Roland Jupiter-8 61-Key Synthesizer 1981 - 1985, 12-bit, Black. *EXTRA* :  Kenton's  Retrofit MIDI Kit for J8 !", 'roland-jupiter-8'],
  ] as const) {
    assert.equal(matchedSlug(title), slug, title)
  }

  for (const title of [
    'Yamaha DX1 + 2 Voice ROM Cartridges ✅RARE Vintage from 80s Synthesizer ✅ Excellent Condition ✅ Cleaned & Fully Checked ✅ Worldwide Shipping ✅LEGEND LIKE ROLAND JUPITER 8 -  Yamaha CS80 - Waldorf Wave -',
    'Waldorf Wave ✅ 16-Voice - Optimal Thermal Stability ✅ULTAR RARE From ´90s✅ Serviced ✅ USB Upgrade✅ Synthesizer LEGEND Like Yamaha CS, ARP Quadra, PPG WAVE, Jupiter 8, Oberheim',
    'ROLAND Jupiter 6 Vintage Synth JP-6 Clean condition  6 voice //ARMENS//',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }
})

test('a title that names the product only as what a part is for is not the product', () => {
  for (const title of [
    'ORIGINAL Roland 1P Key Holder (064-056) for Jupiter-4, System-100/700, SH-1/2/3/3A/5/7, RS-505, VP-330, Promars, etc',
    'ORIGINAL Roland Key Spring (070-052/070-058) for Jupiter-4, System-100/700, SH-1/2/3/3A/5/7, RS-505, VP-330, Promars, etc',
    'hamburg·wave MIDI-/CPU-upgrade kit for Roland Jupiter-4',
    'AC power switch (220V) for Roland Jupiter 8',
  ]) {
    // PAN-200: the Roland parts vocabulary (LINE_BOUNDARIES) now refuses "Key Holder" at
    // step 2, before step 5c; either stop writes no row.
    const d = decideMatch(title, index)
    const refused = d.kind === 'none' && lineBoundaryRefusal(title.toLowerCase(), 'roland-jupiter-4') !== null
    assert.ok((d.kind === 'deferred' && d.reason === 'non_product_intent') || refused, title)
  }
})
