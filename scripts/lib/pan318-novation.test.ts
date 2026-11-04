/**
 * scripts/lib/pan318-novation.test.ts
 *
 * PAN-318: Novation's Circuit and Bass Station lines. Nine imported rows are match targets once the PAN-318 SQL files run:
 * the Circuit (2015), Circuit Tracks, Circuit Rhythm and Circuit Mono Station, and the Bass Station (1993), Bass Station
 * II, Bass Station Rack, Super Bass Station and AFX Station. Each line is one `line`. Every title is a production or Reverb
 * sold title (2026-11-04) unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan318-novation.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan318-novation'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Novation ${model_name}`, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** The rows with the model names production holds, or pan318-identity sets (the Super Bass Station). */
const PRODUCTS: Product[] = [
  row('novation-Circuit', 'novation', 'Circuit'),
  row('novation-novation-circuit-tracks', 'novation', 'Circuit Tracks'),
  row('novation-circuit-rhythm', 'novation', 'Circuit Rhythm'),
  row('novation-circuit_mono_station', 'novation', 'Circuit Mono Station'),
  row('novation-bass-station', 'novation', 'Bass Station'),
  row('novation-novation-bass-station-ii', 'novation', 'Bass Station II'),
  row('novation-bass-station-rack', 'novation', 'Bass Station Rack'),
  row('novation-super-bass-station', 'novation', 'Super Bass Station'),
  row('novation-afx-station', 'novation', 'AFX Station'),
  // Rows production holds that these titles could stray onto.
  row('novation-drumstation', 'novation', 'Drumstation'),
  { ...row('roland-tb-303', 'roland', 'TB-303'), canonical_name: 'Roland TB-303' },
]

/** The MODEL identifiers pan318-identity writes: the glued "BassStation" spellings. */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [...M('novation-bass-station-rack', 'BassStation Rack'), ...M('novation-super-bass-station', 'Super BassStation', 'Superbass Station')]

const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['novation', 'roland', 'boss', 'yamaha', 'kurzweil', 'cirrus logic'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!config.promoted.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary, in its line, and the config lists the 9 rows', () => {
  assert.equal(config.promoted.length, 9)
  for (const slug of config.promoted) {
    assert.ok(['novation-circuit', 'novation-bass-station'].includes(LINE_BOUNDARIES[slug]?.line ?? ''), slug)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
})

test('the Circuits: the 2015 Circuit needs the maker and never reaches Tracks, Rhythm or Mono Station', () => {
  matches('novation-Circuit', ['Novation Circuit Groovebox 2015 - 2021 - Black', 'Novation Circuit Groovebox (OG)', 'Novation Circuit'])
  matches('novation-novation-circuit-tracks', ['Novation Circuit Tracks Groovebox 2021 - Present - Black', 'Novation Circuit Tracks +32gb card and case'])
  matches('novation-circuit-rhythm', ['Novation Circuit Rhythm Sample-Based Drum Machine [USED]', 'Novation Circuit Rhythm + UDG Travel Case'])
  matches('novation-circuit_mono_station', ['Novation Circuit Mono Station Paraphonic Synthesizer 2017 - 2021 - Black', 'Novation Circuit Mono Station paraphonisk analog synthesizer'])
  notOn([
    'Yamaha vss200 Circuit Bent Sampler Synthesizer', 'BOSS Metal Zone Distortion Guitar Pedal with Innovative Dual-Stage Gain Circuit, Three-Band EQ',
    'Kurzweil K2500/K2500R Engine Circuit Board', 'Novation Supernova II 2 DAC CS4391KZ TSOP Integrated Circuit Cirrus Logic',
    'Novation Circuit Rythm Groovebox 2021 - Present - Black', 'Decksaver DS-PC-CIRCUITTRACKS Novation Circuit Tracks / Rhythm Cover',
  ])
})

test('the Bass Stations: the 1993 keyboard never reaches the II, the Rack, the Super or the AFX', () => {
  matches('novation-bass-station', ['Novation Bass Station 25-Key Monophonic Synthesizer 1993 - Black', 'Novation Bass Station'])
  matches('novation-novation-bass-station-ii', ['Novation Bass Station II 25-Key Monophonic Synthesizer 2013 - Present - Black', 'Novation Bass Station II Synthesizer + Decksaver Cover'])
  matches('novation-bass-station-rack', [
    'Novation Bass Station Rack Monophonic Synthesizer 1994 - Black', 'Novation BassStation Rack Analogue Synthesizer Module',
    'Novation Bass Station Rack Analog synth MIDI/CV converter with PSU and Manual',
  ])
  matches('novation-super-bass-station', [
    'Novation Super Bass Station Monophonic Rackmount Synthesizer 1997 - Black', 'Novation Super Bass Station Rack', 'Novation Super BassStation rack',
    'Novation Superbass Station (1997) - "monophonic bass synthesis"',
  ])
  matches('novation-afx-station', ['Novation AFX Station 25-Key Monophonic Synthesizer 2020 - Present - Black'])
  // "Bass Station ll" is the II, and the Swifty Edition is the II's: neither is the 1993 keyboard.
  for (const t of ['Novation Bass Station ll Analog Synthesizer Keyboard, 25-Key', 'Novation Bass Station Swifty Edition Synthesizer']) assert.notEqual(decide(t), 'novation-bass-station', t)
  // A Rack compared to the TB-303 names two products: a tie.
  assert.equal(decide('Novation Bass Station Rack 1996 / Roland TB-303 emulator. Novation  1996 Black On Aluminum'), 'deferred:ambiguous_tie')
})
