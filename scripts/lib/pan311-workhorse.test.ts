/**
 * scripts/lib/pan311-workhorse.test.ts
 *
 * PAN-311 step 2: the workhorse amps and pedals. Thirty rows become match targets once the PAN-311 create SQL runs on
 * the owner's word. Run in memory over every source's active unmatched titles (read-only, 2026-11-01), eight of them
 * reached a title that is not the row: a part or a 1x12 cabinet under the Hot Rod Deluxe's name, a guitar or bass sold
 * with the Rumble 15 or the Katana-50, a JVM410H head with its cabinet, the 1980s Super Cube 40, the Katana amp sold
 * with a GT-1, a GT-1000 with the ME-80's bag, and the Carbon Copy Deluxe and Mini. Each case here is a production
 * title; each boundary must refuse its case and keep the row's own titles.
 *
 * Run: npx tsx --test scripts/lib/pan311-workhorse.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** The eight rows with a boundary, as the PAN-311 create file writes them. */
const PRODUCTS: Product[] = [
  row('fender-hot-rod-deluxe', 'fender', 'Fender Hot Rod Deluxe', 'Hot Rod Deluxe'),
  row('fender-rumble-15', 'fender', 'Fender Rumble 15', 'Rumble 15'),
  row('boss-katana-50', 'boss', 'Boss Katana-50', 'Katana-50'),
  row('marshall-jvm410h', 'marshall', 'Marshall JVM410H', 'JVM410H'),
  row('roland-cube-40', 'roland', 'Roland Cube-40', 'Cube-40'),
  row('boss-gt-1', 'boss', 'Boss GT-1', 'GT-1'),
  row('boss-me-80', 'boss', 'Boss ME-80', 'ME-80'),
  row('mxr-carbon-copy', 'mxr', 'MXR Carbon Copy', 'Carbon Copy'),
]
const index = buildMatchIndex(PRODUCTS, [], [])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notMatched = (title: string) => {
  const d = decide(title)
  assert.ok(d === 'none' || d === 'rejected' || String(d).startsWith('deferred:'), `${title} → ${d}`)
}

test('the Hot Rod Deluxe is the combo: its transformer and its 1x12 cabinet sold alone are not', () => {
  matches('Fender Hot Rod Deluxe guitarforstærker 40W', 'fender-hot-rod-deluxe')
  matches('Fender Special Run (FSR) Hot Rod Deluxe lll rørforstærker mintgrøn', 'fender-hot-rod-deluxe')
  notMatched('Udgangs transformator 005-0438-000 til Fender f.eks Hot Rod Deluxe (radiorør)')
  notMatched('Fender Hot Rod Deluxe 112 Guitarkabinet')
  notMatched('Fender Hot Rod Deluxe kabinet med Celestion Cream Back 1x12')
})

test('a guitar or bass sold with the Rumble 15 or the Katana-50 is a set, not the amp', () => {
  matches('Fender Rumble 15 basforstærker sort', 'fender-rumble-15')
  matches('Boss Katana 50 Gen 3 1x12 Combo', 'boss-katana-50')
  // The glued "L" hides Squier from the brand guard (kleinanzeigen.de).
  notMatched('LSquier Precision Bass+ Fender Rumble 15 Verstärker komplett oder')
  notMatched('Guitarsæt- Stratocaster G&L Legacy + Boss Katana 50 forstærker + Guitartaske')
})

test('a JVM410H head with its cabinet is the pair (owner, 2026-10-14)', () => {
  matches('Marshall JVM410H, 100Watt', 'marshall-jvm410h')
  notMatched('Guitarforstærker, Marshall JVM410h + 1960A Lead 4x12 cab, 120 W')
})

test('the Super Cube 40 is not the Cube-40', () => {
  matches('Roland Cube 40', 'roland-cube-40')
  matches('Roland Cube-40 guitarforstærker creme', 'roland-cube-40')
  notMatched('Roland Super Cube 40.')
})

test('the Katana sold with a GT-1 and a GT-1000 with the ME-80 bag are not the pedals', () => {
  matches('Boss GT-1 Effect Processor', 'boss-gt-1')
  matches('Boss ME-80 guitar multieffektpedal', 'boss-me-80')
  notMatched('Boss Katana guitarforstærker + Boss GT-1 multieffekt pedal')
  notMatched('BOSS GT-1000 Guitar Effects Processor, Boss CB-ME80 Carry Bag Bundle')
})

test('the Carbon Copy Deluxe and Mini are their own pedals', () => {
  matches('MXR Carbon Copy Analog Delay', 'mxr-carbon-copy')
  notMatched('MXR Carbon Copy Deluxe Delay')
  notMatched('MXR Carbon Copy mini')
  notMatched('MXR Carbon Copy Mini Analog Delay M299 | Med originalkartong & tillbehör')
})
