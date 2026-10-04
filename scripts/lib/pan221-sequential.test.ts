/**
 * scripts/lib/pan221-sequential.test.ts
 *
 * PAN-221: Sequential, three eras, one maker. Owner decision 2 of 2026-10-04 keeps Sequential
 * Circuits, Dave Smith Instruments and Sequential as three brands and makes them one maker to the
 * matcher (SAME_MAKER in brand-guard.ts); decision 1 of 2026-10-02 lets the clean rows be re-curated,
 * which splits the 1978–84 Prophet-5 from the 2020 model as the Prophet-10 already is. The desktop
 * modules, the Pro 3 SE, the Mopho x4 and the Prophet X are the rows the PAN-221 step-2 SQL creates;
 * a desktop row carries the keyboard's model name and the line boundary splits them on the form
 * factor (the Minimoog Model D and the Prophet-10 pattern), so "Prophet 5 Rev 4 Desktop" and
 * "Prophet 10 Module" reach the module without a contiguous "Prophet-5 Desktop" in the title.
 * Every title is a production title from the 1,305 active ones naming the maker (read-only snapshot
 * 2026-10-04); the aliases are the ones the promote SQL adds.
 *
 * Run: npx tsx --test scripts/lib/pan221-sequential.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'
import { makerNamed, makerOf, sameMaker } from '../../frontend/lib/matching/brand-guard'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

const PRODUCTS: Product[] = [
  row('sequential-prophet-5', 'sequential', 'Sequential Prophet-5', 'Prophet-5'),
  row('sequential-prophet-5-desktop', 'sequential', 'Sequential Prophet-5 Desktop', 'Prophet-5'),
  row('sequential-circuits-prophet-5', 'sequential circuits', 'Sequential Circuits Prophet-5', 'Prophet-5'),
  row('sequential-prophet-10', 'sequential', 'Sequential Prophet-10', 'Prophet-10'),
  row('sequential-prophet-10-desktop', 'sequential', 'Sequential Prophet-10 Desktop', 'Prophet-10'),
  row('sequential-circuits-prophet-10', 'sequential circuits', 'Sequential Circuits Prophet 10', 'Prophet-10'),
  row('sequential-prophet-6', 'sequential', 'Sequential Prophet-6', 'Prophet-6'),
  row('sequential-prophet-6-desktop', 'sequential', 'Sequential Prophet-6 Desktop', 'Prophet-6'),
  row('sequential-ob-6', 'sequential', 'Sequential OB-6', 'OB-6'),
  row('sequential-ob-6-desktop', 'sequential', 'Sequential OB-6 Desktop', 'OB-6'),
  row('sequential-take-5', 'sequential', 'Sequential Take 5', 'Take 5'),
  row('sequential-take-5-desktop', 'sequential', 'Sequential Take 5 Desktop', 'Take 5'),
  row('sequential-trigon-6', 'sequential', 'Sequential Trigon-6', 'Trigon-6'),
  row('sequential-trigon-6-desktop', 'sequential', 'Sequential Trigon-6 Desktop', 'Trigon-6'),
  row('sequential-pro-3', 'sequential', 'Sequential Pro 3', 'Pro 3'),
  row('sequential-pro-3-se', 'sequential', 'Sequential Pro 3 SE', 'Pro 3'),
  row('sequential-prophet-rev2', 'sequential', 'Sequential Prophet Rev2', 'Prophet Rev2'),
  row('sequential-prophet-x', 'sequential', 'Sequential Prophet X', 'Prophet X'),
  row('sequential-drumtraks', 'sequential', 'Sequential Circuits DrumTraks', 'DrumTraks'),
  row('sequential-circuits-pro-one', 'sequential circuits', 'Sequential Circuits Pro One', 'Pro-One'),
  row('sequential-circuits-prophet-600', 'sequential circuits', 'Sequential Circuits Prophet 600', 'Prophet-600'),
  row('sequential-circuits-prophet-vs', 'sequential circuits', 'Sequential Circuits Prophet VS', 'Prophet VS'),
  row('sequential-circuits-six-trak', 'sequential circuits', 'Sequential Circuits Six-Trak', 'Six-Trak'),
  row('sequential-circuits-prophet-2000', 'sequential circuits', 'Sequential Circuits Prophet 2000', 'Prophet 2000'),
  row('sequential-circuits-prophet-t8', 'sequential circuits', 'Sequential Circuits Prophet T8', 'Prophet T8'),
  row('dave-smith-instruments-mopho', 'dave smith instruments', 'Dave Smith Instruments Mopho', 'Mopho'),
  row('dave-smith-instruments-mopho-x4', 'dave smith instruments', 'Dave Smith Instruments Mopho x4', 'Mopho x4'),
  row('dave-smith-instruments-evolver', 'dave smith instruments', 'Dave Smith Instruments Evolver', 'Evolver'),
  row('dave-smith-instruments-poly-evolver', 'dave smith instruments', 'Dave Smith Instruments Poly Evolver', 'Poly Evolver'),
  row('dave-smith-instruments-mono-evolver', 'dave smith instruments', 'Dave Smith Instruments Mono Evolver', 'Mono Evolver'),
  row('dave-smith-instruments-prophet-08', 'dave smith instruments', "Dave Smith Instruments Prophet '08", 'Prophet 08'),
  row('dave-smith-instruments-tempest', 'dave smith instruments', 'Dave Smith Instruments Tempest', 'Tempest'),
  row('dave-smith-instruments-tetra', 'dave smith instruments', 'Dave Smith Instruments Tetra', 'Tetra'),
  row('davesmithinstruments-pro2', 'dave smith instruments', 'Dave Smith Instruments Pro 2', 'Pro 2'),
  // The neighbours a Sequential title can also name.
  row('ssl-six', 'ssl', 'SSL SiX', 'SiX'),
  row('oberheim-ob-x8', 'oberheim', 'Oberheim OB-X8', 'OB-X8'),
  row('behringer-pro-1', 'behringer', 'Behringer Pro-1', 'Pro-1'),
]

/** The aliases the PAN-221 promote SQL adds (every one carries the brand, PAN-205). */
const ALIASES = [
  { alias: 'Sequential Prophet Rev 2', canonical_query: 'sequential-prophet-rev2' },
  { alias: 'Dave Smith Instruments Prophet Rev2', canonical_query: 'sequential-prophet-rev2' },
  { alias: "Dave Smith Instruments Prophet '08", canonical_query: 'dave-smith-instruments-prophet-08' },
  { alias: 'Dave Smith Instruments Prophet-08', canonical_query: 'dave-smith-instruments-prophet-08' },
  { alias: "DSI Prophet '08", canonical_query: 'dave-smith-instruments-prophet-08' },
  { alias: 'Dave Smith Instruments Polyevolver', canonical_query: 'dave-smith-instruments-poly-evolver' },
  { alias: 'Sequential Circuits Pro One', canonical_query: 'sequential-circuits-pro-one' },
  { alias: 'Sequential Pro One', canonical_query: 'sequential-circuits-pro-one' },
  { alias: 'Sequential Take-5', canonical_query: 'sequential-take-5' },
  { alias: 'Sequential Take-5 Desktop', canonical_query: 'sequential-take-5-desktop' },
  { alias: 'Dave Smith Instruments Pro-2', canonical_query: 'davesmithinstruments-pro2' },
  { alias: 'Sequential Pro-2', canonical_query: 'davesmithinstruments-pro2' },
]

const BRANDS = ['sequential', 'sequential circuits', 'dave smith instruments', 'ssl', 'oberheim', 'behringer', 'arturia', 'creamware', 'moog', 'roland', 'korg']
const index = buildMatchIndex(PRODUCTS, [], ALIASES, BRANDS)

const decided = (title: string) => decideMatch(title, index)
const matchedSlug = (title: string): string | null => {
  const d = decided(title)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}
const reason = (title: string): string => {
  const d = decided(title)
  return d.kind === 'deferred' ? d.reason : d.kind
}

test('PAN-221: one maker, three names — the guard', () => {
  assert.equal(makerOf('Sequential Circuits'), 'sequential')
  assert.equal(makerOf('dave smith instruments'), 'sequential')
  assert.equal(makerOf('oberheim'), 'oberheim')
  assert.ok(sameMaker('sequential', 'dave smith instruments'))
  assert.ok(sameMaker('Sequential Circuits', 'sequential'))
  assert.ok(!sameMaker('sequential', 'oberheim'))
  assert.ok(!sameMaker('epiphone', 'gibson'))
  assert.ok(makerNamed('DSI Dave Smith TEMPEST Drum Synthesizer', 'dave smith instruments'))
  assert.ok(makerNamed('Sequential Prophet 600 PRO SERVICED /WARRANTY =', 'sequential circuits'))
  assert.ok(!makerNamed('Oberheim OB-6 6-voice Polyphonic Analog Synthesizer', 'sequential'))
})

test('PAN-221: an era name is never a brand mismatch for the same maker', () => {
  assert.equal(matchedSlug('Dave Smith Instruments OB-6 49-Key 6-voice Polyphonic Synthesizer 2017 - Present - Black'), 'sequential-ob-6')
  assert.equal(matchedSlug('Dave Smith Instruments OB-6 Desktop 6-Voice Polyphonic Synthesizer 2017 - Present - Black'), 'sequential-ob-6-desktop')
  assert.equal(matchedSlug('Dave Smith Instruments Sequential Prophet X Hybrid Synthesizer Keyboard'), 'sequential-prophet-x')
  assert.equal(matchedSlug('Sequential Prophet 600 61-Key 6-Voice Polyphonic Synthesizer 1982 - 1985 - Black with Wood Sides'), 'sequential-circuits-prophet-600')
  assert.equal(matchedSlug('Mopho x4 synth DSI (Dave Smith Instruments aka Sequential)'), 'dave-smith-instruments-mopho-x4')
  assert.equal(matchedSlug('DSI Dave Smith TEMPEST Drum Synthesizer + Fast neuwertig + 1,5 Jahre Garantie'), 'dave-smith-instruments-tempest')
  assert.equal(matchedSlug('Dave Smith Tempest drum machine'), 'dave-smith-instruments-tempest')
  assert.equal(matchedSlug('Dave Smith Prophet REV2'), 'sequential-prophet-rev2')
  // "Sequential Circuits Six Trak" is not an SSL SiX tie once the maker is one brand's worth of evidence.
  assert.equal(matchedSlug('Vintage Sequential Circuits Six-Trak Model 610 49-Key 6-Voice Polyphonic Synth Synthesizer Keyboard'), 'sequential-circuits-six-trak')
  assert.equal(matchedSlug('Sequential Circuits Six-Trak 1984 analog synth'), 'sequential-circuits-six-trak')
})

test('PAN-221: a different maker is still a different maker', () => {
  // Oberheim is Tom Oberheim's own brand: an "Oberheim OB-6" without the maker's name stays a mismatch (listed, not matched).
  assert.equal(reason('Oberheim OB-6 6-voice Polyphonic Analog Synthesizer'), 'brand_mismatch')
  // The OB-X8 names both makers up front: a collaboration, unchanged.
  assert.equal(matchedSlug('Sequential Oberheim OB-X8 Eight-voice Analog Poly Synth'), 'oberheim-ob-x8')
  assert.equal(matchedSlug('Arturia Prophet-5 V (Download)'), null)
  assert.equal(matchedSlug('Creamware PRO 12 ASB DSP Desktop Synth (Prophet 5 Clone) Free Shipping US & Canada'), null)
  assert.equal(matchedSlug('Oak Veneered Dual Stand for Behringer Model D, Pro One, K2 and Neutron'), null)
})

test('PAN-221: the Prophet-5 is split by name like the Prophet-10', () => {
  assert.equal(matchedSlug('Sequential Prophet-5'), 'sequential-prophet-5')
  assert.equal(matchedSlug('Sequential Prophet-5 Rev 4'), 'sequential-prophet-5')
  assert.equal(matchedSlug('Sequential New Prophet-5 Rev 4 - 5-Voice Analog Synthesizer [Three Wave Music]'), 'sequential-prophet-5')
  assert.equal(matchedSlug('Sequential Prophet-5 61-Key 5-Voice Polyphonic Synthesizer'), 'sequential-prophet-5')
  assert.equal(matchedSlug('Sequential Circuits Prophet 5 Rev 3.3 with Wine Country MIDI - Local Pickup Only !'), 'sequential-circuits-prophet-5')
  assert.equal(matchedSlug('Sequential Prophet 5 Rev3 61-Key 5-Voice Polyphonic Synthesizer 1980 - 1984 + Flight case'), 'sequential-circuits-prophet-5')
  assert.equal(matchedSlug('Sequential Circuits -  Prophet 5 Rev2  // Restored by VSC'), 'sequential-circuits-prophet-5')
  assert.equal(matchedSlug('Sequential Circuits Prophet 5'), 'sequential-circuits-prophet-5')
  assert.equal(matchedSlug('Sequential Prophet-5 Desktop Module'), 'sequential-prophet-5-desktop')
  assert.equal(matchedSlug('SEQUENTIAL PROPHET 5 DESKTOP : BRAND NEW :  [DETROIT MODULAR]'), 'sequential-prophet-5-desktop')
  assert.equal(matchedSlug('Sequential Prophet-5 Module'), 'sequential-prophet-5-desktop')
  assert.equal(matchedSlug('Sequential Prophet 5 Rev 4 Desktop'), 'sequential-prophet-5-desktop')
  // No brand, no 2020 cue: not decided automatically.
  assert.equal(matchedSlug('Prophet 5 Rev 3 Owned by Placebo'), null)
  // The parts trade.
  assert.equal(matchedSlug('Sequential Circuits Prophet 5 Wooden Enclosure American Walnut'), null)
  assert.equal(matchedSlug('Sequential Circuits - Prophet 5 , Prophet 10 - voltage selector slide switch'), null)
  assert.equal(matchedSlug('Potentiometer - Sequential Circuits Prophet-5 rev1 & rev2 / Pro-One / B100K'), null)
})

test('PAN-221: the Prophet-10 keeps its split and gains the desktop module', () => {
  assert.equal(matchedSlug('Sequential Prophet-10 61-key Analog Synthesizer'), 'sequential-prophet-10')
  assert.equal(matchedSlug('Sequential Prophet 10 Rev 3'), 'sequential-circuits-prophet-10')
  assert.equal(matchedSlug('Vintage Sequential Prophet 10 - fully serviced & sold with a warranty'), 'sequential-circuits-prophet-10')
  assert.equal(matchedSlug('Sequential Prophet-10 Desktop Module'), 'sequential-prophet-10-desktop')
  assert.equal(matchedSlug('Sequential Prophet-10 Desktop 10-Voice Polyphonic Synthesizer 2021 - Present - Black with Wood Sides'), 'sequential-prophet-10-desktop')
  assert.equal(matchedSlug('Sequential Prophet 10 Module Analog Synthesizer'), 'sequential-prophet-10-desktop')
})

test('PAN-221: the 2018– keyboards and their desktop modules', () => {
  assert.equal(matchedSlug('SEQUENTIAL PROPHET 6 KEYBOARD : BRAND NEW :  [DETROIT MODULAR]'), 'sequential-prophet-6')
  assert.equal(matchedSlug('Sequential Prophet-6 Desktop 6-Voice Polyphonic Synthesizer 2018 - 2020 - Black with Wood Sides'), 'sequential-prophet-6-desktop')
  assert.equal(matchedSlug('Prophet 6 Desktop Sequential'), 'sequential-prophet-6-desktop')
  assert.equal(matchedSlug('Dave Smith Instruments Sequential Prophet-6 Desktop Polyphonic Analog Synthesizer'), 'sequential-prophet-6-desktop')
  assert.equal(matchedSlug('Sequential OB-6 Desktop - Dave Smith Polyphonic Analog Synthesizer Module'), 'sequential-ob-6-desktop')
  assert.equal(matchedSlug('SEQUENTIAL - TOM OBERHEIM OB-6 KEYBOARD : BRAND NEW :  [DETROIT MODULAR]'), 'sequential-ob-6')
  assert.equal(matchedSlug('SEQUENTIAL - TOM OBERHEIM OB-6 DESKTOP : BRAND NEW :  [DETROIT MODULAR]'), 'sequential-ob-6-desktop')
  assert.equal(matchedSlug('Sequential Take 5 Synthesizer - Refurbished'), 'sequential-take-5')
  assert.equal(matchedSlug('Sequential Take 5 Desktop Module'), 'sequential-take-5-desktop')
  assert.equal(matchedSlug('Sequential Take-5 Desktop Module 5-Voice Polyphonic Synthesizer'), 'sequential-take-5-desktop')
  assert.equal(matchedSlug('Sequential Trigon-6 Polyphonic Analogue Synthesizer'), 'sequential-trigon-6')
  assert.equal(matchedSlug('Sequential Trigon 6 Desktop'), 'sequential-trigon-6-desktop')
  assert.equal(matchedSlug('Sequential Pro 3 Multi-Filter Mono Synth'), 'sequential-pro-3')
  assert.equal(matchedSlug('Sequential Pro 3 SE 37-Key 3-Voice Monophonic / Paraphonic Synthesizer 2020 - Present - Black with Wood Sides'), 'sequential-pro-3-se')
  assert.equal(matchedSlug('Sequential Pro 3 SE Special Edition Synthesiser Keyboard'), 'sequential-pro-3-se')
  assert.equal(matchedSlug('Sequential Prophet Rev2 16-voice Keyboard - Refurbished'), 'sequential-prophet-rev2')
  assert.equal(matchedSlug('Sequential Prophet Rev 2 Keys (16-Voice)'), 'sequential-prophet-rev2')
  assert.equal(matchedSlug('Sequential Prophet X EX-DEMO'), 'sequential-prophet-x')
  assert.equal(matchedSlug('Sequential Prophet X 61-key Synthesizer - Moog EP-3 Universal Pedal, Sustain Pedal, Neewer Collapsible Stands, Presonus HD7'), 'sequential-prophet-x')
  // Stands, covers, presets and cases for them.
  assert.equal(matchedSlug('Rockville Keyboard Stand For Dave Smith Instruments Prophet Rev2-08'), null)
  assert.equal(matchedSlug('DUST COVER for Sequential Take-5 Desktop / Oberheim Teo-5 Desktop'), null)
  assert.equal(matchedSlug("SoundsDivine 'Brass' - Sequential Prophet 5/10 Rev.4 Presets"), null)
})

test('PAN-221: the DrumTraks takes units, never EPROM sets, side panels or sample packs', () => {
  assert.equal(matchedSlug('Sequential DrumTraks 12-Voice Drum Machine 1984 - Black'), 'sequential-drumtraks')
  assert.equal(matchedSlug('Sequential Circuits DrumTraks Model 400 Vintage Drum Machine'), 'sequential-drumtraks')
  assert.equal(matchedSlug('Sequential DrumTraks with 30 EPROM sounds & HH Decay control'), 'sequential-drumtraks')
  assert.equal(matchedSlug('Custom Wooden Side Panels Sequential Circuits Drumtraks American Walnut Wood'), null)
  assert.equal(matchedSlug('Sequential Circuits Drumtraks OS version 0.5 EPROM Firmware Upgrade KIT / New ROM Final Update Chip'), null)
  assert.equal(matchedSlug('Reverb Sequential Circuits DrumTraks Sample Pack'), null)
  // The TOM stays `known` (one complete unit in the pool): "Tom" is Tom Oberheim on every OB-6 box.
  // "Dave Smith & Tom Oberheim" names Oberheim as a catalogue brand and the maker only by a short form: listed, not matched.
  assert.equal(reason('Dave Smith &Tom Oberheim OB-6 6 Voice Analog Synth Desktop Module  box //ARMENS//'), 'brand_mismatch')
})

test('PAN-221: the vintage Sequential Circuits rows take units, never the parts trade', () => {
  assert.equal(matchedSlug('Sequential Circuits Pro-One vintage analog synth'), 'sequential-circuits-pro-one')
  assert.equal(matchedSlug('SEQUENTIAL CIRCUITS PRO ONE VINTAGE 80`S'), 'sequential-circuits-pro-one')
  assert.equal(matchedSlug('Sequential Circuits Pro-One (Fatar keybed) // restored by VS&C'), 'sequential-circuits-pro-one')
  assert.equal(matchedSlug('Sequential Circuits Pro-One knob set - Full set of 28 - New'), null)
  assert.equal(matchedSlug('Sequential Circuits - Pro-One - Power Transformer'), null)
  assert.equal(matchedSlug('Sequential Circuits - Prophet-600'), 'sequential-circuits-prophet-600')
  assert.equal(matchedSlug('Sequential Prophet 600 with Gli Gli mod, upgraded Fatar keyboard, and travel case'), 'sequential-circuits-prophet-600')
  assert.equal(matchedSlug('Sequential Circuits Prophet 600 Firmware OS update : SIX-08 - 0.8 Eprom Rom'), null)
  assert.equal(matchedSlug('Sequential Circuits Prophet VS Vector Synthesizer *Restored VINTAGE SYNTH DEALER'), 'sequential-circuits-prophet-vs')
  assert.equal(matchedSlug('Sequential Circuits - Prophet VS , Studio 440 - ORANGE Switch with led'), null)
  assert.equal(matchedSlug('Sequential Circuits Prophet T8'), 'sequential-circuits-prophet-t8')
  assert.equal(matchedSlug('Sequential Prophet 2000 61-Key 8-Voice Polyphonic Synthesizer'), 'sequential-circuits-prophet-2000')
  assert.equal(matchedSlug('Panasonic 3 Volt Battery for Sequential Circuits Prophet 5  10 VS Six-Trak DrumTraks Tom'), null)
})

test('PAN-221: Dave Smith Instruments — the Mopho box, the x4, the three Evolvers, the Prophet \'08', () => {
  assert.equal(matchedSlug('Dave Smith Instruments Mopho Desktop Monophonic Synthesizer 2008 - 2016 - Yellow'), 'dave-smith-instruments-mopho')
  assert.equal(matchedSlug('DSI Mopho Dave Smith Instruments Synthesizer + Top-Zustand + 1.5J Garantie'), 'dave-smith-instruments-mopho')
  assert.equal(matchedSlug('Dave Smith Instruments Mopho x4 44-Key 4-Voice Polyphonic Synthesizer 2013 - 2018 - Black with Wood Sides'), 'dave-smith-instruments-mopho-x4')
  assert.equal(matchedSlug('Dave Smith Instruments Mopho X4'), 'dave-smith-instruments-mopho-x4')
  // The Mopho Keyboard and the Mopho SE have no row yet: refused, never the desktop.
  assert.equal(matchedSlug('Dave Smith Instruments Mopho 32-Key Monophonic Synthesizer 2011 - 2016 - Yellow with Wood Sides'), null)
  assert.equal(matchedSlug('Dave Smith Instruments Mopho SE 42-Key Monophonic Synthesizer 2014 - 2016 - Black with Wood Sides'), null)
  assert.equal(matchedSlug('DAVE SMITH INSTRUMENTS Mopho Keyboard [03803] (08/31)'), null)
  assert.equal(matchedSlug('Fatar Replacement Weighted A Key for Pro-2, Prophet-08, Prophet-12, Mopho Keyboard, Mopho SE, Mopho X4, E-Mu XK-6/MK-6/PK-6'), null)
  assert.equal(matchedSlug('Dave Smith Instruments Evolver Desktop Monophonic Synthesizer 2002 - 2016 - Blue'), 'dave-smith-instruments-evolver')
  assert.equal(matchedSlug('Dave Smith Instruments Poly Evolver 61-Key 4-Voice Polyphonic Synthesizer 2005 - 2011 - Blue with Wood Sides'), 'dave-smith-instruments-poly-evolver')
  assert.equal(matchedSlug('Dave Smith Instruments Polyevolver'), 'dave-smith-instruments-poly-evolver')
  assert.equal(matchedSlug('DAVE SMITH INSTRUMENTS Mono Evolver Keyboard PE [1063] (07/28)'), 'dave-smith-instruments-mono-evolver')
  assert.equal(matchedSlug('Stereoping CE-1 Evolver Midi Controller for Dave Smith Instruments DSI Evolver Synth Synthesizer CE1'), null)
  assert.equal(matchedSlug('Dave Smith Instruments 12-note Key Contact Strip for Mono Evolver, Poly Evolver'), null)
  assert.equal(matchedSlug("Dave Smith Instruments Prophet '08 PE 61-Key 8-Voice Polyphonic Synthesizer"), 'dave-smith-instruments-prophet-08')
  assert.equal(matchedSlug('Prophet 08 Synthesizer'), null)
  assert.equal(matchedSlug('Dave Smith Instruments Tempest 6-Voice Drum Machine 2011 - 2018 - Black with Wood Sides + Decksaver'), 'dave-smith-instruments-tempest')
  assert.equal(matchedSlug('Dave Smith Tetra Real  Rack Wood Stand Side Panel Wooden Oak'), null)
  assert.equal(matchedSlug('Dave Smith Instruments Pro 2 44-Key Monophonic / Paraphonic Synthesizer 2014 - 2018 - Black with Wood Sides'), 'davesmithinstruments-pro2')
  assert.equal(matchedSlug('DSI Dave Smith Sequential Pro-2 Synthesizer + OVP + Top Zustand + 1,5J Garantie'), 'davesmithinstruments-pro2')
})
