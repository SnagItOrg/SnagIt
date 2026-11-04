/**
 * scripts/lib/pan319-elektron.test.ts
 *
 * PAN-319: Elektron. Fourteen rows are match targets once the PAN-319 SQL files run (the Analog Four, Analog Rytm and
 * Octatrack wait on the owner). A generation shares its line with its successor, so the refusal separates them. Every
 * title is a production or Reverb sold title (2026-11-04) unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan319-elektron.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan319-elektron'

const row = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Elektron ${model_name}`, model_name, brand_name: 'elektron', status: 'active', support_state: 'supported',
})

/** The rows with the model names production holds, or the PAN-319 create / identity files set. */
const PRODUCTS: Product[] = [
  row('elektron-digitakt', 'Digitakt'), row('elektron-digitakt-ii', 'Digitakt II'),
  row('elektron-digitone', 'Digitone'), row('elektron-digitone-ii', 'Digitone II'), row('elektron-digitone-keys', 'Digitone Keys'),
  row('elektron-analog-heat', 'Analog Heat'), row('elektron-analog-heat-fx', 'Analog Heat +FX'), row('elektron-analog-keys', 'Analog Keys'),
  row('elektron-syntakt', 'Syntakt'), row('elektron-model-samples', 'Model:Samples'), row('elektron-model-cycles', 'Model:Cycles'),
  row('elektron-machinedrum-sps-1', 'Machinedrum'), row('elektron-monomachine-sfx-6', 'Monomachine'), row('elektron-tonverk', 'Tonverk'),
]

/** The identifiers: the Machinedrum's two seed SKUs (production), and pan319-identity's Model:* spellings. */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [
  { product_id: 'p-elektron-machinedrum-sps-1', type: 'SKU', value: 'Machinedrum SPS-1' }, { product_id: 'p-elektron-machinedrum-sps-1', type: 'SKU', value: 'SPS-1' },
  ...M('elektron-model-samples', 'Model Samples', 'Model: Samples'), ...M('elektron-model-cycles', 'Model Cycles', 'Model: Cycles'),
]

const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['elektron', 'korg', 'roland', 'fender', 'yamaha'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!config.promoted.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary and the config lists the 14 rows', () => {
  assert.equal(config.promoted.length, 14)
  for (const slug of config.promoted) {
    assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
})

test('a generation never reaches its successor; the Digitone Keys and Heat +FX are their own rows', () => {
  matches('elektron-digitakt', ['Elektron Digitakt (MKI) Sampler & Drum Machine + 3D-Printed Stand – Excellent Condition', 'Elektron Digitakt I with hard dust cover'])
  matches('elektron-digitakt-ii', ['Elektron Digitakt II 2024 - Present - Black', 'Elektron Digitakt II inkl. PL-2s - Protective Lid - Bundle Set'])
  matches('elektron-digitone', ['Elektron Digitone 8-Voice Digital Synthesizer with Decksaver', 'Elektron Digitone MKI (2017) + Dust Cover'])
  matches('elektron-digitone-ii', ['Elektron Digitone II 16-Voice Digital Synthesizer 2024 - Present - Black'])
  matches('elektron-digitone-keys', ['Elektron Digitone Keys 37-key Digital FM Synthesizer 2019 - Present - Black'])
  matches('elektron-analog-heat', ['Elektron Analog Heat MK1 Sound Prozessor + Fast Neuwertig + OVP + 1,5J Garantie', 'Elektron Analog Heat - Stereo Analog Sound Processor Effect FX Module'])
  matches('elektron-analog-heat-fx', ['Elektron Analog Heat +FX Dynamic Sound Processor [USED]'])
  matches('elektron-analog-keys', ['Elektron Analog Keys + Decksaver- Trade Considered'])
  matches('elektron-syntakt', ['Elektron Syntakt E25 Remix Edition 2024 Silver + Decksaver & Extras', 'Elektron Syntakt inkl. ECC-7 Carry Bag - Bundle Set'])
  matches('elektron-model-samples', ['Elektron Model:Samples 2019 - 2020 - White', 'Elektron Model: Samples 6-Track Groovebox, Nearly New', 'Elektron Model Samples'])
  matches('elektron-model-cycles', ['Elektron Model:Cycles 6-track FM Based Groovebox with Protective Lid'])
  matches('elektron-machinedrum-sps-1', ['Elektron Machinedrum SPS-1UW+ MKII & MegaCommand', 'Elektron Machinedrum SPS1 UW+drive MK2 og MCL'])
  matches('elektron-tonverk', ['Elektron Tonverk 8-Voice Sampler w/ Decksaver'])
  // "Digitakt with 2 cables" is not the Digitakt II (synthetic): the mark must follow the name.
  matches('elektron-digitakt', ['Elektron Digitakt with 2 cables'])
})

test("Elektron's own lids, rack kits, power supplies, bags and sound packs name no row", () => {
  notOn([
    'PSU-4b alimentation pour Model:Samples Elektron', 'Elektron PSU-2b Octatrack Mono & Machinedrum',
    'ECC-5b Sacoche pour Model:Samples / Cycles Elektron', 'Elektron Model:Cycles Preset Pack by RedStripeDown',
    'Elektron PROTECTIVE LID PL-2S : BRAND NEW :  [DETROIT MODULAR]', 'Decksaver Elektron Digitakt / Digitone Cover',
  ])
  // A rack converter that fits three boxes names three products, so it is none of them.
  notOn(['Fraction Industries Elektron Digitakt / Digitone / AnalogHeat Rack Converter 2020 Black'])
})
