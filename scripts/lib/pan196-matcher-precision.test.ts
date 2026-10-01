/**
 * scripts/lib/pan196-matcher-precision.test.ts
 *
 * PAN-196: a dry run over the ~44,100 active listings no run had evaluated
 * would have matched Prophet-5 at 64% precision, Wurlitzer 200A at 53%, OB-Xa
 * at 57% and ATR-700 at 31%. Four rules close most of it:
 *
 *   1. a model inside a list of models is what a part fits, not the offer;
 *   2. the measured parts vocabulary;
 *   3. a quantity has no single-unit price;
 *   5. the copy/reference guard reads the spaced form of the model too.
 *
 * Each rule is tested with the titles it must stop and the titles it must
 * leave alone. Every title is a real production listing title unless it says
 * otherwise.
 *
 * Run: npx tsx --test scripts/lib/pan196-matcher-precision.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, lineBoundaryRefusal, type Product } from '../../frontend/lib/matching/match-listings'
import { detectNonProductIntent, earliestInclusionMarker } from '../../frontend/lib/matching/listing-intent'
import { tokenFollowedByReference, tokenInModelList } from '../../frontend/lib/matching/brand-guard'

const product = (slug: string, brand: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand} ${model_name}`, model_name, brand_name: brand.toLowerCase(),
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    product('sequential-prophet-5', 'Sequential', 'Prophet-5'),
    product('roland-juno-6', 'Roland', 'Juno-6'),
    product('roland-juno-60', 'Roland', 'Juno-60'),
    product('roland-sh-101', 'Roland', 'SH-101'),
    product('roland-tr-606', 'Roland', 'TR-606'),
    product('boss-es-5', 'Boss', 'ES-5'),
    product('boss-ds-1', 'Boss', 'DS-1'),
    product('boss-ab-2', 'Boss', 'AB-2'),
    product('wurlitzer-200a', 'Wurlitzer', '200A'),
    product('yamaha-dx7', 'Yamaha', 'DX7'),
    product('oberheim-ob-xa', 'Oberheim', 'OB-Xa'),
    product('ampex-atr-700', 'Ampex', 'ATR-700'),
  ],
  [], [],
  ['sequential', 'roland', 'boss', 'wurlitzer', 'yamaha', 'oberheim', 'ampex'],
)

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}
const deferral = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'deferred' ? `${d.reason}${d.intent ? ':' + d.intent : ''}` : null
}
/**
 * PAN-200: the Roland parts and copy vocabulary (LINE_BOUNDARIES) now refuses some
 * Roland titles below at step 2, before the rule under test is reached. Either stop
 * writes no row, so both count.
 */
const stops = (title: string, reason: string): boolean => {
  if (deferral(title) === reason) return true
  return decideMatch(title, index).kind === 'none' &&
    index.products.some((p) => lineBoundaryRefusal(title.toLowerCase(), p.slug) !== null)
}

// ── Rule 1: a list of models means a part ────────────────────────────────────

test('rule 1: a model inside a list of models is what a part fits', () => {
  for (const title of [
    'Sequential Circuits - Prophet 5/10/T8 - New panel switch with led black',
    'Black knob Sequential Circuits Prophet-5 / 10',
    'Sequential Circuits Prophet 5 / Prophet T8 / Prophet 600 / Pro-One / Pro-8 / Six-trak - Pitch & Mod Wheel',
    'Roland  - Juno-6/60/106 , HS-60 ,CSQ-100/600 - 3 Position Toggle Switch',
    'Roland - SH-101 , SH-2 , SH-09 - New Rotary Switch 4 Position',
    'Boss ES-5/MS-3 QuadAux',
    'Vintage Roland TB-303 / TR-606 Carrying Bag Case (As-Is / Sticky Vinyl)',
    'Battery Door Roland TB-303, TR-606',
    '9V AC Power Adapter for Boss PSA-120S Guitar Distortion Effects Pedal DS-1 RC-1 RC-3 TU-2 TU-3 SD-1 RV-6 DD-3 DD-7',
    'Jellinghaus DX Programmer Midi Controller for Yamaha DX DX1 DX5 DX7 Synthesizer Rare Vintage Synth',
  ]) {
    assert.ok(stops(title, 'non_product_intent:part_or_accessory'), title)
  }
})

test('rule 1: the instrument, and the same model written twice, still match', () => {
  for (const [title, slug] of [
    ['Sequential Prophet-5 Rev 4', 'sequential-prophet-5'],
    ['Sequential Prophet 5 Rev3 61-Key 5-Voice Polyphonic Synthesizer 1980 - 1984 + Flight case', 'sequential-prophet-5'],
    ['Sequential Circuits Prophet-5  Rev3.3  120 Programs w/Factory MIDI', 'sequential-prophet-5'],
    ['Wurlitzer 200 / 200A – Fully Restored – Custom Automotive-Grade Color Finish', 'wurlitzer-200a'],
    ['Wurlitzer 200A 64-Key Electric Piano 1974 - 1983 - Black', 'wurlitzer-200a'],
    ['Roland Juno-60', 'roland-juno-60'],
    ['Roland TR-606 Drumatix 1980s - Silver', 'roland-tr-606'],
    ['Roland TR-606 [092300] (07/01)', 'roland-tr-606'],
  ] as const) {
    assert.equal(matchedSlug(title), slug, title)
  }
  // Not a list: one neighbour joined by a space, a fraction, an alias, a year.
  assert.equal(tokenInModelList('arp 2600 3620 keyboard 1970s - black', '2600'), false)
  assert.equal(tokenInModelList('korg mono/poly mp-4 monophonic/polyphonic synthesizer w/ gig bag', 'Mono/Poly'), false)
  assert.equal(tokenInModelList('ampex atr-700 1/4" full track reel to reel', 'ATR-700'), false)
  assert.equal(tokenInModelList('roland jupiter-8 / jp-8', 'Jupiter-8'), false)   // constructed
  assert.equal(tokenInModelList('gibson custom shop 1957 sj-200 / sj200 antique natural 2024', '1957 SJ-200'), false)
  assert.equal(tokenInModelList('gibson es 330/330t:øk', 'ES-330'), false)
  assert.equal(tokenInModelList('neumann u 87 ai 02 c1990 w/ shock mount & new pop filter', 'U 87 Ai'), false)
  assert.equal(tokenInModelList('roland juno-106, 61 keys', 'Juno-106'), false)   // constructed
  assert.equal(tokenInModelList('boss dm-2 delay 1983 s/n 274600 with mn3205 bbd and mn3102 clockdriver japan', 'DM-2'), false)
})

// ── Rule 2: the parts vocabulary ─────────────────────────────────────────────

test('rule 2: the measured parts vocabulary defers the part', () => {
  for (const [title, token] of [
    ['Ampex ATR-700 1/4" 2 Track Reel to Reel Tape Deck Head Stack Assembly', 'head stack'],
    ['BLACK Wurlitzer 200a Legs set of four', 'legs'],
    ['Wurlitzer electric 200 200A leg plates with screws', 'plates'],
    ['Wurlitzer 200 / 200A Vintage Electric Piano Damper Arm Original-Bass', 'damper'],
    ['Original Wurlitzer 200 Wurlitzer 200A Hammers', 'hammers'],
    ['YAMAHA DX7 VOICE ROM VRC-106 SYNTHESIZER GROUP', 'voice rom'],
    ['Yamaha DX7 VRC-106 Synthesizer Group - Factory Voice Data ROM', 'data rom'],
    ['16-fach Ramkarte für Yamaha DX7', 'ramkarte'],
    ["SoundsDivine 'Brass' - Sequential Prophet 5/10 Rev.4 Presets", 'presets'],
    ['ARP 2600 3620 Keyboard Facsimile Pad 28 Blank Patch Sheets VINTAGE SYNTH DEALER', 'patch sheets'],
    ['Korg ARP 2600 FS Patch Book', 'patch book'],
    ['Oberheim OB-Xa Program Patches Booklet 1982', 'booklet'],
    ['Roland Juno-6 polyphonic synthesizer brochure', 'brochure'],
    ['Vintage Sequential Circuits Prophet 5 Spec Sheet', 'spec sheet'],
    ['Roland TR-606 Troubleshooting One Sheet [USED]', 'troubleshooting'],
    ['Green Cap SH-101 MC-202 Roland', 'cap'],
    ['Fuse holder - Sequential Circuits - Prophet-5 - Pro-One', 'fuse'],
    ['Sequential Circuits - Prophet 5/10/600 - AC power socket', 'socket'],
    ['Oberheim - OB-Xa - Phone jack', 'phone jack'],
    ['Oberheim OB-XA 1980s Voice Card - Serviced - 2', 'voice card'],
    ['Korg Polysix Voice Board Complete', 'voice board'],
    ['Keyboard Rubber Contact Strip, 7 positions - Korg PolySix, Moog MemoryMoog, Oberheim OB8', 'contact strip'],
    ['TB-303 - TR-606 Dust covers set for potentiometers and rotary switches', 'covers'],
    ['Fender Rhodes Mark I Stage 88 Key Electric Piano Reproduction Lid', 'lid'],
    ['Neumann U 87 Ai Studio Set • BOX ONLY', 'box only'],
  ] as const) {
    assert.deepEqual(detectNonProductIntent(title), { intent: 'part_or_accessory', token }, title)
  }
})

test('rule 2: `&` no longer hides a cartridge set; `with` still keeps an instrument', () => {
  assert.deepEqual(
    detectNonProductIntent('Yamaha DX7 Voice ROM-1 & ROM-2 Data Cartridge Set'),
    { intent: 'part_or_accessory', token: 'cartridge' },
  )
  for (const title of [
    'Boss AB-2 Foot Switch',
    'Yamaha DX7 Vintage, 2 ROM, BC2, FC, Top Zustand',
    'Yamaha DX7 refurbished Ryuichi Sakamoto ROM loaded w/Hardcase',
    'Fender Custom Shop 1962 Jaguar Journeyman Relic Painted Head Cap Surf Green (683)',
    'Warm Audio WA-47 M7 Capsule ZenPro Mod Edition',
    'Solid State Logic UC1 Hardware Plug-In Control Surface',
    'Arturia CS-80 V Synthesizer Virtual Instrument Software',
    'BOSS DS-2 Turbo Distortion Pedal with Twin Modes and Built-In Remote Jack',
    'Wurlitzer 200A 64-Key Electric Piano with legs and sustain pedal',   // constructed: marker first
    'Korg Mono/Poly Analog Synthesizer serviced !',
  ]) {
    assert.equal(detectNonProductIntent(title), null, title)
  }
  assert.equal(matchedSlug('Boss AB-2 Foot Switch'), 'boss-ab-2')
})

test('rule 2: a `w/` glued to the next word is an inclusion marker', () => {
  assert.equal(earliestInclusionMarker('roland juno-60 w/manual'), 'roland juno-60 '.length)
  assert.equal(detectNonProductIntent('Roland Juno-60 w/manual'), null)            // constructed
  assert.equal(detectNonProductIntent('Sequential Circuits Prophet-5 Rev3.3 w/Midi - ORIGINAL - Pro Serviced w/Restoration'), null)
})

test('rule 2: "Dual Manual" is two keyboards, not a manual', () => {
  // The one title dropping `&` would have cost: its glued "w/ORIGINAL" counts,
  // but `manual` fired first on the keyboard count.
  assert.equal(detectNonProductIntent('SERVICED & RESTORED Dual Manual PROPHET 10 Rev3 w/ORIGINAL OWNERS MANUAL, MIDI, Foot switch pedals, Road case, & Specs sheet - Sequential Circuits SCI'), null)
  assert.equal(detectNonProductIntent('Roland Promars Rare Dual-Manual Analog Synthesizer'), null)   // constructed from a pool title
  // A plain manual is still an accessory, and the exception needs the count word.
  assert.deepEqual(detectNonProductIntent('Sequential Circuits Prophet 10 Owners Manual'), { intent: 'part_or_accessory', token: 'manual' })   // constructed
  assert.deepEqual(detectNonProductIntent('Sequential Circuits Prophet 10 Double Manual'), { intent: 'part_or_accessory', token: 'manual' })   // constructed: unobserved form
})

// ── Rule 3: a quantity has no single-unit price ──────────────────────────────

test('rule 3: several units are deferred, not matched', () => {
  for (const [title, token] of [
    ['Boss ES-5 Effects Switching System (2-pack)', '(2-pack)'],
    ['(31 pack) Roland Alpha Juno 2 Top Panel Push Button Tact Switch', '(31 pack)'],
    ['Boss Pedal 3-pack! DS-1, PS-6, BF-3 2020\'s', '3-pack'],
    ['Lot of 5 1981 Silver Screw Boss pedals SD-1, PH-1R, CE-2, BF-2, CS-1', 'lot of 5'],
    ['3x Moog Mother-32 with 3 tier', '3x'],
    ['Warm Audio WA-87 R2 Pair (2x) - Mint / Like New - Original Boxes', '(2x)'],
  ] as const) {
    assert.deepEqual(detectNonProductIntent(title), { intent: 'multi_unit', token }, title)
  }
  assert.equal(deferral('Boss ES-5 Effects Switching System (3-pack)'), 'non_product_intent:multi_unit')
})

test('rule 3: a quantity of extras, a model name or a cabinet spec is not a quantity', () => {
  for (const title of [
    'Boss AW-3 Dynamic Wah + 2x Gator Patch Cable 3 Pack',
    'Boss DS-1 Distortion Pedal Bundle with 2x Strukture S6P48 Woven Right Angle Patch Cables, 12x Fender Guitar Picks',
    'Boss DS-2 Turbo Distortion Pedal Bundle w/ 2-Pack Strukture S6P48 Woven Right Angle Patch Cable',
    'Yamaha DX7 Synthesizer inkl 4x Cartridge und eingebauten FX',
    'Yamaha TX816 Rack + 1x TF1 Modul, DX7, Vintage',
    'Roland Cube 30X guitarforstærker sort',
    'Fender Twin Reverb 2 x 12 combo',                                     // constructed
  ]) {
    assert.equal(detectNonProductIntent(title), null, title)
  }
  assert.equal(matchedSlug('Boss DS-1 Distortion Pedal Bundle with 2x Strukture S6P48 Woven Right Angle Patch Cables'), 'boss-ds-1')
})

// ── Rule 5: the copy/reference guard reads the spaced model ─────────────────

test('rule 5: "Juno 60 clone" is a copy whichever way the model is written', () => {
  assert.equal(tokenFollowedByReference('roland juno 60 clone', 'juno-60'), true)
  assert.equal(tokenFollowedByReference('roland juno-60 clone', 'juno-60'), true)
  assert.equal(tokenFollowedByReference('roland juno 60 synthesizer', 'juno-60'), false)
  assert.ok(stops('Roland Juno 60 clone', 'copy_or_reference'))
  assert.ok(stops('Roland JU06 Boutique MK1 NEU Juno 60 Clone in OVP', 'copy_or_reference'))
  assert.equal(matchedSlug('Roland Juno 60'), 'roland-juno-60')
  assert.equal(matchedSlug('Roland Juno-60'), 'roland-juno-60')
})
