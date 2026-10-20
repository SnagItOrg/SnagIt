/**
 * scripts/lib/pan266-accessory-classes.test.ts
 *
 * PAN-266 follow-up (G4, 2026-10-19/20): panter stopped on a wiring harness, a UAD plug-in, a ROM
 * cartridge, a leading AC adapter, a bare "<model> stand" and a dust cover the "2600 M" model read as
 * "med". The same guard filters the watchlist mails (PAN-275: "speaker harness", "choke transformer").
 * A unit sold WITH one of these keeps its match through the inclusion-marker rule. Every title is a
 * production title (read-only, 2026-10-20).
 *
 * Run: npx tsx --test scripts/lib/pan266-accessory-classes.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'
import { detectNonProductIntent, earliestInclusionMarker } from '../../frontend/lib/matching/listing-intent'

const product = (slug: string, brand: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand} ${model_name}`, model_name, brand_name: brand.toLowerCase(),
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    product('arp-2600', 'ARP', 'ARP 2600'),
    product('manley-voxbox', 'Manley', 'VOXBOX'),
    product('roland-sp-404-mkii', 'Roland', 'SP-404MKII'),
    product('yamaha-dx7', 'Yamaha', 'DX7'),
    product('boss-es-5', 'Boss', 'ES-5'),
    product('moog-grandmother', 'Moog', 'Grandmother'),
    product('moog-muse', 'Moog', 'Muse'),
    product('gibson-les-paul-junior', 'Gibson', 'Les Paul Junior'),
  ],
  [], [],
  ['arp', 'manley', 'roland', 'yamaha', 'boss', 'moog', 'gibson', 'korg'],
)

const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched'
    ? index.productById.get(d.best.product_id)?.slug
    : d.kind === 'deferred' ? `deferred:${d.reason}${d.intent ? ':' + d.intent : ''}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notMatched = (title: string) => {
  const d = decide(title)
  assert.ok(d === 'none' || d === 'rejected' || String(d).startsWith('deferred:'), `${title} → ${d}`)
}
const firesOn = (title: string, token: string) =>
  assert.deepEqual(detectNonProductIntent(title), { intent: 'part_or_accessory', token }, title)
const silentOn = (title: string) => assert.equal(detectNonProductIntent(title), null, title)

test('the G4 titles panter pre-decided defer, each on its class', () => {
  firesOn('Universal Audio UAD Manley VOXBOX Channel Strip Plug-In', 'plug-in')
  firesOn('Yamaha DX7 ROM VRC-110 Special Selection "BO TOMLYN" Ultra Rare', 'vrc-110')
  firesOn('Power Supply/AC Adapter BOSS: VE-8 Acoustic Singer ES-5 Effects Switching System', 'power supply')
  firesOn('Gibson Les Paul Jr./SG Junior premium wiring harness- 50s style with 0.022uF Bumblebee capacitor', 'harness')
  firesOn('RESTAND Roland SP-404 MKII Stand', 'mkii stand')
  firesOn('GroovePrints Roland SP-404 MK2 Stand + Tablet/Phone Holder – 3D Printed All-In-One Desktop Stand', 'mk2 stand')
  firesOn('Korg Other ARP 2600 M Digital Piano Keyboard Dust Cover by DCFY!® | Customize Color, Fabric & Padding Options - Made in U.S.A.', 'cover')
  notMatched('Universal Audio UAD Manley VOXBOX Channel Strip Plug-In')
  notMatched('Yamaha DX7 ROM VRC-110 Special Selection "BO TOMLYN" Ultra Rare')
  notMatched('Power Supply/AC Adapter BOSS: VE-8 Acoustic Singer ES-5 Effects Switching System')
  notMatched('RESTAND Roland SP-404 MKII Stand')
})

test('parts: a harness, a power or output transformer, a choke, a ROM card', () => {
  firesOn('Fender Deluxe Reverb speaker harness', 'harness')
  firesOn('Roland TR-808 220V/240V Power Transformer 245-219D', 'power transformer')
  firesOn('Vintage Original Fender Blackface Silverface Deluxe Reverb Output Transformer - 022640 - No Tariffs', 'output transformer')
  firesOn('Vintage Original Blackface Silverface Fender Deluxe Reverb Choke Transformer - 022707 - No Tariffs', 'choke')
  firesOn('Yamaha TG55 | ROM Card | Sound Source Unlimited | TG502 | Modern Artist // RARE!!', 'rom card')
  // A transformer that IS the product, or a feature of it, is not a part.
  silentOn('Rupert Neve Designs RNDI Active Transformer Direct Box')
  silentOn('Rupert Neve Designs MBT Master Bus Transformer Stereo Signal Processor 2023 - Present - Black')
  silentOn('Boss VT-1 Voice Transformer')
  // A ROM described is the instrument's: bare `rom` stays refused.
  silentOn('Kurzweil K2000 v2 Orchestral Rom')
  silentOn('Yamaha DX7 - 2 ROMs + Manual')
  // After a marker, the unit: "with … output transformer".
  silentOn('dbx 160XT Compressor / Limiter with Jensen output transformer smack over easy xlr')
})

test('a power supply or AC adapter leads the title only when it is the item', () => {
  firesOn('9V Power Supply Adapter for Boss Guitar Distortion Effects Pedal PSA-120S ME-80', '9v power supply')
  firesOn('AC Adapter Power Supply For Arturia MiniBrute 2 2S Keyboard Synthesizer', 'ac adapter')
  firesOn('Power Supply: Moog Rogue', 'power supply')
  // Sold with one: the synth.
  silentOn('Moog Grandmother 32-Key Semi-Modular Analog Synthesizer w/ Power Supply')
  matches('Moog Grandmother 32-Key Semi-Modular Analog Synthesizer w/ Power Supply', 'moog-grandmother')
})

test('a Decksaver leads the title only when it is the item; a "Decksaver Kit" is a bundle', () => {
  firesOn('Decksaver Moog Grandmother Staubschutzcover', 'decksaver')
  firesOn('Decksaver Novation Launchpad Pro MK3', 'decksaver')
  // Units that list one, with or without a marker (trusted rows).
  silentOn('Akai MPC Live II – Mint – Decksaver + Magma CTRL Case + Original Box')
  silentOn('Roland TR-09 Rhythm Composer / OG box / firmware updated / decksaver')
  // 23,242 DKK on Reverb: the synth sold as a Sweetwater "Decksaver Kit", not a cover.
  silentOn('Moog Muse 8-Voice Polyphonic Analog Synthesizer DECKSAVER KIT')
  matches('Moog Muse 8-Voice Polyphonic Analog Synthesizer DECKSAVER KIT', 'moog-muse')
})

test('a stand after a model code is the item; a bare or Danish stand is not', () => {
  firesOn('Restand Ro Sp44 Ss30 Bk Roland Sp 404 Mkii Stand', 'mkii stand')
  firesOn('Elektron Digitone 1 & 2 stand (100% walnut)', '2 stand')
  silentOn('Roland Juno-106 – fuldt fungerende – meget flot stand – hvide tangenter')
  silentOn('Warm Audio WA-CX12 Tube Condenser Microphone Stand and Cable Bundle')
  silentOn('Fender 1978 Telecaster selges - original stand!')
  // A comma lists a bundle's items, and a stand mount is the mic's.
  silentOn('Sequential Prophet-10 61-key Analog Synthesizer, Ultimate Support AX-48 Stand, AT ATH-M50X, (2) Midi Cables, (2) 1/4 Cables Bundle')
  silentOn('Coles 4038 Studio Ribbon Microphone Inc. 4071 Stand mount')
  // After a marker, the unit (and the pattern reports where the stand is, not where the title starts).
  silentOn('Korg Volca Sample + Restand Volca 2 Stand')   // constructed
  silentOn('Roland TR-8S AIRA Rhythm Performer with Sample Playback 2018 - Present + Stand')
})

test('a plug-in is software only beside UAD or "virtual"; the UC1 is hardware', () => {
  firesOn('Universal Audio UAD Moog Minimoog Plug-in (Activation Card)', 'plug-in')
  firesOn('Waldorf PPG Wave 3.0 Virtual Synthesizer Plug-In', 'plug-in')
  silentOn('Solid State Logic UC1 Hardware Plug-In Control Surface')
  silentOn('SSL (Solid State Logic) UC1 (SSL native plug-in controller) (Official Japanese Product)')
  // UAD-2 hardware is not the `uad` cue.
  silentOn('Universal Audio UAD-2 Satellite Thunderbolt 3 OCTO Core Desktop DSP Accelerator 150+ plugins from Neve, Manley, API etc')
})

test('"2600 M" is a model, not "med"; a year or a metre keeps its own reading', () => {
  assert.equal(earliestInclusionMarker('korg arp 2600 m semi-modular synthesizer module'), -1)
  assert.equal(earliestInclusionMarker('tama model 3556 m fra 1974'), -1)
  // A year before the m: "med", as PAN-261 decided.
  assert.equal(earliestInclusionMarker('fender twin reverb 1966 m cover'), 'fender twin reverb 1966 '.length)
  // A later bare m after the model still counts.
  assert.equal(earliestInclusionMarker('korg arp 2600 m m cover'), 'korg arp 2600 m '.length)
  // A metre is never a marker (unchanged).
  assert.equal(earliestInclusionMarker('4 m kabel'), -1)
  silentOn('Korg ARP 2600 M (w/Korg SQ-1)')
  notMatched('Korg Other ARP 2600 M Digital Piano Keyboard Dust Cover by DCFY!® | Customize Color, Fabric & Padding Options - Made in U.S.A.')
})

test('the ARP 2600 is never Korg\'s FS / M reissue or Behringer\'s clone; the reissue row needs the cue', () => {
  // Production today: the Korg row has no model_name, so a Korg title is refused on the vintage row and writes nothing.
  const korgRow = (model_name: string | null): Product => ({ ...product('arp-korg-arp-2600', 'ARP', 'x'), canonical_name: 'Korg ARP 2600', model_name })
  const today = buildMatchIndex([product('arp-2600', 'ARP', 'ARP 2600'), korgRow(null)], [], [], ['arp', 'korg', 'behringer'])
  const at = (ix: typeof today, title: string) => {
    const d = decideMatch(title, ix)
    return d.kind === 'matched' ? ix.productById.get(d.best.product_id)?.slug : d.kind
  }
  for (const title of [
    'Korg ARP 2600 FS Semi-Modular Synthesizer 2020 - Present - Black',
    'Korg ARP 2600 M Semi-Modular Synthesizer Module 2021 - Present - Black',
    'Arp 2600 FS (2023)',
    'ARP 2600 M_Analog Synthesizer Modul_ semi Modular_USB_NEU sofort!',
    'Behringer ARP 2600 Grey Meanie Semi Modular Synthesizer',
  ]) assert.notEqual(at(today, title), 'arp-2600', title)
  assert.equal(at(today, 'ARP 2600 Tonus 1971-72'), 'arp-2600')
  assert.equal(at(today, 'Vintage "Tonus" ARP 2600 w/ 3604P Keyboard - 110 Volt Unit'), 'arp-2600')
  // Once the KG row carries a model_name, the reissue lands on it and the vintage titles stay home (no tie).
  const fixed = buildMatchIndex([product('arp-2600', 'ARP', 'ARP 2600'), korgRow('ARP 2600')], [], [], ['arp', 'korg', 'behringer'])
  assert.equal(at(fixed, 'Korg ARP 2600 FS Semi-Modular Synthesizer 2020 - Present - Black'), 'arp-korg-arp-2600')
  assert.equal(at(fixed, 'Korg ARP 2600 M (w/Korg SQ-1)'), 'arp-korg-arp-2600')
  assert.equal(at(fixed, 'Arp 2600 FS (2023)'), 'arp-korg-arp-2600')
  assert.equal(at(fixed, 'ARP 2600 Tonus 1971-72'), 'arp-2600')
  assert.equal(at(fixed, 'ARP 2600 with 3620 Keyboard.  Orange/Black'), 'arp-2600')
})
