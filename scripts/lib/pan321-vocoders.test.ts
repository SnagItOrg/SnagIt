/**
 * scripts/lib/pan321-vocoders.test.ts
 *
 * PAN-321: the vocoders of other makers. Fifteen rows are match targets once the PAN-321 SQL files run: the Korg VC-10,
 * DVP-1, microKORG, microKORG S, microKORG XL and microKORG 2, the DigiTech Talker, and the TC Helicon VoiceLive 2, 3,
 * 3 Extreme, Play, Play GTX, Touch, Touch 2 and Rack. Every title is a production or Reverb sold title (2026-11-04) unless
 * marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan321-vocoders.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan321-vocoders'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** The rows with the model names production holds, or the PAN-321 create / identity files set. */
const PRODUCTS: Product[] = [
  row('korg-vc-10', 'korg', 'VC-10'), row('korg-dvp-1', 'korg', 'DVP-1'), row('korg-microkorg', 'korg', 'microKorg'),
  row('korg-microkorg-s', 'korg', 'microKORG S'), row('korg-microkorgxl', 'korg', 'MicroKorg XL'), row('korg-microkorg-2', 'korg', 'microKORG 2'),
  row('digitech-talker', 'digitech', 'Talker'),
  row('tc-helicon-voicelive-2', 'tc helicon', 'VoiceLive 2'), row('tc-helicon-voicelive-3', 'tc helicon', 'VoiceLive 3'),
  row('tc-helicon-voicelive-3-extreme', 'tc helicon', 'VoiceLive 3 Extreme'), row('tc-helicon-voicelive-play', 'tc helicon', 'VoiceLive Play'),
  row('tc-helicon-voicelive-play-gtx', 'tc helicon', 'VoiceLive Play GTX'), row('tc-helicon-voicelive-touch', 'tc helicon', 'VoiceLive Touch'),
  row('tc-helicon-voicelive-touch-2', 'tc helicon', 'VoiceLive Touch 2'), row('tc-helicon-voicelive-rack', 'tc helicon', 'VoiceLive Rack'),
]

/** The MODEL identifiers the PAN-321 identity file writes: the spellings the model tier cannot reach. */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [
  ...M('korg-microkorg', 'microKORG', 'Micro Korg'), ...M('korg-microkorg-s', 'microKORG S', 'microKORG-S', 'Micro Korg S'),
  ...M('korg-microkorgxl', 'microKORG XL', 'Micro Korg XL', 'microKORG XL Plus'), ...M('korg-microkorg-2', 'microKORG 2', 'Micro Korg 2'),
  ...M('tc-helicon-voicelive-2', 'Voice Live 2'), ...M('tc-helicon-voicelive-3', 'Voice Live 3'), ...M('tc-helicon-voicelive-3-extreme', 'Voice Live 3 Extreme'),
  ...M('tc-helicon-voicelive-play', 'Voice Live Play'), ...M('tc-helicon-voicelive-play-gtx', 'Voice Live Play GTX'),
  ...M('tc-helicon-voicelive-touch', 'Voice Live Touch'), ...M('tc-helicon-voicelive-touch-2', 'Voice Live Touch 2'), ...M('tc-helicon-voicelive-rack', 'Voice Live Rack'),
]

const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['korg', 'digitech', 'tc helicon', 'tc electronic', 'roland', 'decksaver'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!config.promoted.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary and the config lists the 15 rows', () => {
  assert.equal(config.promoted.length, 15)
  for (const slug of config.promoted) {
    assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
})

test('the Korg vocoders: each microKORG generation reaches its row; the XL+ is the XL', () => {
  matches('korg-vc-10', ['Korg VC-10 Vintage Vocoder - Microphone not Included', 'Korg VC-10 (Fully Serviced / Warranty / Original Mic)'])
  matches('korg-dvp-1', ['Korg DVP-1 Digital Voice Processor'])
  matches('korg-microkorg', ['Korg MicroKORG with Case', 'Korg MicroKORG Red/Black w/power supply and vocoder mic'])
  matches('korg-microkorg-s', ['Korg microKorg-S 37-Key Synthesizer/Vocoder', 'MicroKORG S  w/ vocoder synthesizer'])
  matches('korg-microkorgxl', ['Korg MicroKORG XL+ Synthesizer/Vocoder', 'Korg Micro Korg xl plus 2025 - Black', 'Korg microKORG XL Synthesizer/Vocoder with Gator Gig Bag'])
  matches('korg-microkorg-2', ['Korg Microkorg 2 mint with box and power supply', 'MicroKORG 2 (Open Box, Unused)'])
})

test('the VoiceLive series and the Talker: each reaches its row, the "Voice Live" spelling too', () => {
  matches('tc-helicon-voicelive-2', ['TC Helicon Voice Live 2 Extreme Edition'])
  matches('tc-helicon-voicelive-3', ['TC Helicon VoiceLive 3'])
  matches('tc-helicon-voicelive-3-extreme', ['Tc Helicon Voice Live 3 Extreme', 'TC-Helicon VoiceLive 3 Extreme Multi-Effect Unit'])
  matches('tc-helicon-voicelive-play', ['TC Helicon TC Helicon Voice Live Play Vocal Effects Processor Blue'])
  matches('tc-helicon-voicelive-play-gtx', ['TC Helicon VoiceLive Play GTX'])
  matches('tc-helicon-voicelive-touch', ['TC Helicon Voicelive Touch'])
  matches('tc-helicon-voicelive-touch-2', ['TC Helicon Voice Live Touch 2 Voice Live Touch 2 Black', 'TC-Helicon VoiceLive Touch 2'])
  matches('tc-helicon-voicelive-rack', ['TC Helicon Voicelive Rack Vocal Effects Rack Module'])
  matches('digitech-talker', ['DigiTech Talker Vocoder Pedal'])
  // "Talker" is a word: without the maker it is no Talker (synthetic).
  notOn(['Fender Talker amp vintage'])
})

test('mics, connectors, covers, cases, manuals and adapters name no vocoder row', () => {
  notOn([
    'Microphone Male Connector - Korg VC-10', 'Korg KORG microKorg Vocoder MIc', 'Analog Cases Korg MicroKorg/MicroKorg XL+ Pulse Case',
    'Korg - MicroKorg XL + - New Power Switch', 'Korg MicroKorg XL+ Owners Manual [USED]', 'Flyht Case Korg MicroKorg XL 2025 - black',
    'Korg KA183 9VDC 600mA Center Pin Negative For BEATLAB, MICROKORG, MICROKORGBK, MS2000, MS2000R',
    'Korg Other microKORG XL+ Digital Piano Keyboard Dust Cover by DCFY!® | Customize Color, Fabric & Padding Options',
  ])
})
