/**
 * scripts/lib/pan317-ableton.test.ts
 *
 * PAN-317: Ableton's hardware. Five rows are match targets once the PAN-317 SQL files run: the Push (2013), Push 2,
 * Push 3 controller, Push 3 standalone and Move. They are one line, so a refusal separates two members. Every title is
 * a production or Reverb sold title (2026-11-04) unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan317-ableton.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan317-ableton'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

const PRODUCTS: Product[] = [
  row('ableton-push', 'ableton', 'Ableton Push', 'Push'),
  row('ableton-push-2', 'ableton', 'Ableton Push 2', 'Push 2'),
  row('ableton-push-3', 'ableton', 'Ableton Push 3', 'Push 3'),
  row('ableton-push-3-standalone', 'ableton', 'Ableton Push 3 Standalone', 'Push 3 Standalone'),
  row('ableton-move', 'ableton', 'Ableton Move', 'Move'),
  // Rows production holds that these titles could stray onto.
  row('roland-tr-8s', 'roland', 'Roland TR-8S', 'TR-8S'),
  row('akai-apc40-mkii', 'akai', 'Akai APC40 MKII', 'APC40 MKII'),
]

const index = buildMatchIndex(PRODUCTS, [], [], ['ableton', 'akai', 'roland', 'novation', 'yamaha', '360 systems', 'kurzweil', 'oberheim'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!config.promoted.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary in the one Ableton line, and the config lists the 5 rows', () => {
  assert.equal(config.promoted.length, 5)
  for (const slug of config.promoted) {
    assert.equal(LINE_BOUNDARIES[slug]?.line, 'ableton', slug)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
})

test('each Push reaches its row, never its successor; the Push 3 standalone and controller never cross', () => {
  matches('ableton-push', ['Ableton Push Controller 2013 - 2014 - Black', 'NEW: Ableton Push V1 Controller BLACK', 'Akai Ableton Push 1 by Akai'])
  matches('ableton-push-2', [
    'Ableton Push 2 Controller 2015 - 2022 - Black', 'Ableton Push 2 w/ Live Intro', 'Ableton Push 2 + Decksaver Cover + 3DWaves Stand',
    'Ableton Push 2 MIDI Controller, Complete Original Box, Power Supply & Decksaver Cover - Fully Tested',
  ])
  matches('ableton-push-3', [
    'Ableton Push 3 Controller 2023 - Present - Black', 'Ableton Push 3', 'Ableton Push 3 Controller (NOT standalone)',
    'Ableton Push 3 Controller [non-standalone] BOXED & COMPLETE barely used protective film still on scr',
    'B-Stock - Ableton Push 3 Tethered Controller 2024 w/ Ableton Live Intro 12 - WITH WARRANTY',
  ])
  matches('ableton-push-3-standalone', [
    'Ableton Push 3 Standalone Workstation 2023 - Present - Black', 'Ableton Push 3 Standalone (With Decksaver!)',
    'Ableton Push 3 Standalone + 2 TB SSD upgrade + Decksaver', 'Push 3 Standalone + Ableton 12 Suite full license transfer',
  ])
  matches('ableton-move', ['Ableton Move Standalone Workstation 2024 - Present - Grey'])
})

test('push buttons, "must move", stands, covers and cases name no Ableton row', () => {
  notOn([
    '360 systems - midi bass - Small Push Button - white', 'Oberheim OB-X - Complete set (38 pcs) of Push Button Switches',
    'Decksaver Ableton Push 3 Dust Cover', 'Headliner (Ableton Push 3) Stand 2026 - Walnut', 'Ableton Push 1 stand walnut',
    'Ableton Push 2 / 3 22.5° Stand – DAW Midi Controller Desktop Mount', 'Acrylic Dust Cover for Ableton Push 2',
    // Synthetic: "Move" is a word.
    'Akai APC40 MKII - must move, Ableton ready',
  ])
  // A Push sold "must move" is the Push (synthetic): the Move row needs "Ableton Move".
  matches('ableton-push-2', ['Ableton Push 2 Controller - must move this week'])
})

test('a title naming two Ableton products stays a tie', () => {
  // Synthetic: two units in one ad.
  assert.equal(decide('Ableton Push 2 and Ableton Move'), 'deferred:ambiguous_tie')
})
