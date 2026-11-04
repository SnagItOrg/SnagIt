/**
 * scripts/lib/pan322-tc.test.ts
 *
 * PAN-322: TC Electronic's TonePrint pedals and later racks, and TC Helicon's vocal pedals. Twenty-one rows are match
 * targets once the PAN-322 SQL files run; the 2290 and 1210 (PAN-293) are unchanged. Every title is a production or
 * Reverb sold title (2026-11-04) unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan322-tc.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan322-tc'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name, status: 'active', support_state: 'supported',
})
const TE = 'tc electronic'
const PRODUCTS: Product[] = [
  row('tc-electronic-flashback', TE, 'Flashback'), row('tc-electronic-flashback-x4', TE, 'Flashback X4'),
  row('tc-electronic-hall-of-fame', TE, 'Hall of Fame'), row('tc-electronic-hall-of-fame-2', TE, 'Hall of Fame 2'),
  row('tc-electronic-hall-of-fame-2-x4', TE, 'Hall of Fame 2 X4'), row('tc-electronic-corona', TE, 'Corona'),
  row('tc-electronic-vortex', TE, 'Vortex'), row('tc-electronic-shaker', TE, 'Shaker'), row('tc-electronic-viscous-vibe', TE, 'Viscous Vibe'),
  row('tc-electronic-m5000', TE, 'M5000'), row('tc-electronic-g-force', TE, 'G-Force'), row('tc-electronic-m-one', TE, 'M-One'),
  row('tc-electronic-m-one-xl', TE, 'M-One XL'), row('tc-electronic-m300', TE, 'M300'), row('tc-electronic-m3000', TE, 'M3000'),
  row('tc-electronic-d-two', TE, 'D-Two'), row('tc-electronic-g-major', TE, 'G-Major'), row('tc-electronic-g-major-2', TE, 'G-Major 2'),
  row('tc-helicon-harmony-singer', 'tc helicon', 'Harmony Singer'), row('tc-helicon-mic-mechanic', 'tc helicon', 'Mic Mechanic'),
  row('tc-helicon-perform-v', 'tc helicon', 'Perform-V'),
  row('tc-electronic-2290', TE, '2290'), row('tc-electronic-1210', TE, '1210'),
]

/** The MODEL identifiers the PAN-322 identity file writes: the glued and Roman spellings. */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [
  ...M('tc-electronic-flashback-x4', 'Flashback 2 X4', 'Flashback 2X4'), ...M('tc-electronic-hall-of-fame-2-x4', 'Hall of Fame 2X4'),
  ...M('tc-electronic-g-major-2', 'G-Major II', 'G Major II', 'GMajor 2', 'GMajor2'),
]

const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['tc electronic', 'tc helicon', 'behringer', 'fender', 'gibson', 'boss', 'mxr'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!config.promoted.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary and the config lists the 21 rows', () => {
  assert.equal(config.promoted.length, 21)
  for (const slug of [...config.promoted, ...config.supportedToday]) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
})

test('the TonePrint pedals: the Flashback 2 and Minis are the Flashback; the X4s and Hall of Fame 2 are their own', () => {
  matches('tc-electronic-flashback', ['TC Electronic Flashback 2 Delay Pedal', 'TC Electronic Flashback Mini delay guitarpedal', 'TC Electronic Flashback'])
  matches('tc-electronic-flashback-x4', ['TC Electronic Flashback X4 – Delay & Looper-pedal', 'TC Electronic Flashback 2 X4 Delay Pedal', 'TC Electronic Flashback 2X4 Delay-Looper Pedal Restock Deal'])
  matches('tc-electronic-hall-of-fame', ['TC Electronic Hall of Fame Mini – Reverb med TonePrint', 'TC Electronic Hall of Fame Reverb'])
  matches('tc-electronic-hall-of-fame-2', ['TC Electronic Hall of Fame 2 Reverb'])
  matches('tc-electronic-hall-of-fame-2-x4', ['TC Electronic Hall of Fame 2 X4 Reverb 2019 - Present - Red', 'TC Electronic Hall of Fame 2x4 Reverb Pedal'])
  matches('tc-electronic-corona', ['TC Electronic Corona Chorus guitarpedal'])
  matches('tc-electronic-viscous-vibe', ['TC Electronic Viscous Vibe guitar effektpedal'])
  // The Hall of Fame 2 Mini's price is unmeasured; a Triple Flashback is another pedal.
  notOn(['TC Electronic Hall of Fame 2 Mini Reverb', 'T.C. Electronic Triple Flashback Delay'])
})

test('the racks: each reaches its row; the M-One XL and G-Major 2 are their own; the 2290 and 1210 are unchanged', () => {
  matches('tc-electronic-g-force', ['TC Electronic G-Force multieffekt rack-processor', 'TC Electronic G Force'])
  matches('tc-electronic-g-major', ['TC electronic G-Major', 'TC Electronic G-Major – Multieffektprocessor'])
  matches('tc-electronic-g-major-2', ['TC Electronic G-Major 2 – Guitar multieffekt (Rack-enhed)', 'TC Electronic G-Major II'])
  matches('tc-electronic-m-one', ['TC Electronic M-One Dual Effects Processor'])
  matches('tc-electronic-m-one-xl', ['TC Electronic M-One XL 24-Bit Dual Engine/Effects Processor'])
  matches('tc-electronic-m5000', ['TC Electronic M5000 Digital Multi-Effects Unit'])
  matches('tc-electronic-m300', ['TC Electronic M300 Dual Engine Processor'])
  matches('tc-electronic-d-two', ['TC Electronic D-Two Multi-Tap Delay'])
  matches('tc-electronic-2290', ['TC Electronic 2290 Dynamic Digital Delay'])
})

test('several pedals in one ad, other makers\' namesakes and software name no row', () => {
  notOn([
    'TC Electronic Flashback X4 og andre guitarpedaler', 'TC Electronic Spark booster og Viscous Vibe guitarpedaler',
    'TC Electronic guitarpedaler – JIMS 800, 550, Tailspin, Mimiq, Vortex', 'GForce M-Tron Pro - Complete Virtual Instrument',
    'Behringer HM300 Heavy Metal Pedal 2010s - Standard', 'Fender Stratocaster USA FSR Ltd. 2009 Corona', 'TC Electronic ATAC Remote Control for M5000',
  ])
})

test('TC Helicon is not TC Electronic: its vocal pedals reach their rows', () => {
  matches('tc-helicon-mic-mechanic', ['TC Helicon Mic Mechanic reverb og echo til vokal'])
  matches('tc-helicon-harmony-singer', ['TC-Helicon Harmony Singer 2'])
  matches('tc-helicon-perform-v', ['TC Helicon Perform-V'])
})
