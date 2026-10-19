/**
 * scripts/lib/pan266-parts-plugins.test.ts
 *
 * PAN-266 G4: the Reverb dry run of 2026-10-19 matched a power cable to the ARP 2600, a stand to the
 * SP-404 MKII, amplifier boards to the Wurlitzer 200A and a UAD plug-in to the Manley VOXBOX. Parts,
 * accessories and software that NAME a product are not that product; a unit sold WITH one keeps its
 * match through the inclusion-marker rule. Every title is a production title (read-only, 2026-10-19)
 * unless marked.
 *
 * Run: npx tsx --test scripts/lib/pan266-parts-plugins.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'
import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'
import { tokenIsObjectOfFor } from '../../frontend/lib/matching/brand-guard'

const product = (slug: string, brand: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand} ${model_name}`, model_name, brand_name: brand.toLowerCase(),
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex(
  [
    product('arp-2600', 'ARP', 'ARP 2600'),
    product('manley-voxbox', 'Manley', 'VOXBOX'),
    product('roland-sp-404-mkii', 'Roland', 'SP-404MKII'),
    product('roland-xp-30', 'Roland', 'XP-30'),
    product('wurlitzer-200a', 'Wurlitzer', '200A'),
    product('korg-polysix', 'Korg', 'Polysix'),
    product('korg-volca-bass', 'Korg', 'Volca Bass'),
    product('moog-mavis', 'Moog', 'Mavis'),
    product('ua-la-2a', 'Universal Audio', 'LA-2A'),
    product('sequential-prophet-x', 'Sequential', 'Prophet X'),
  ],
  [], [],
  ['arp', 'manley', 'roland', 'wurlitzer', 'korg', 'moog', 'universal audio', 'sequential'],
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

test('the four G4.1 titles decide none or deferred, each on the class it belongs to', () => {
  firesOn('ARP 2600 POWER CABLE 1970s cord new nos modular synthesizer VINTAGE SYNTH DEALER', 'power cable')
  firesOn('UAD Manley VOXBOX Channel Strip\t (Download) <br>', '(download)')
  firesOn('3DWaves Stands For The Roland SP-404 MKII Sampler', 'stands for')
  firesOn('Wurlitzer 200A amplifier boards', 'boards')
  notMatched('ARP 2600 POWER CABLE 1970s cord new nos modular synthesizer VINTAGE SYNTH DEALER')
  notMatched('UAD Manley VOXBOX Channel Strip\t (Download) <br>')
  notMatched('3DWaves Stands For The Roland SP-404 MKII Sampler')
  notMatched('Wurlitzer 200A amplifier boards')
})

test('parts: a cord, a board, a PCB sold alone', () => {
  firesOn('Korg PolySix main board KLM-367A', 'board')
  firesOn('Sequential Prophet 5 Rev3 61-Key 5-Voice Polyphonic Synthesizer - No voice/cpu boards', 'boards')
  notMatched('Korg PolySix main board KLM-367A')
  // A fingerboard wood is the guitar's, not a circuit board.
  silentOn('Fender American Professional II Jazzmaster Rosewood Board 3-Tone Sunburst US23011584')
  silentOn('Fender  Jaco Pastorius Jazz Bass, Fretless, Pau Ferro board, 3-Color Sunburst')
  silentOn('8.5lb Gibson Historic Custom Shop Les Paul R6 \'56 Reissue Brazilian Board Goldtop 2003')
  // The marker rule: a unit sold with a board or a cord keeps its match.
  matches('Roland XP-30 61-Key 64-Voice Expandable Synthesizer w/ Roland SR-JV80-15 Special FX Collection Expansion Board', 'roland-xp-30')
  silentOn('Roland D-550 Vintage Synth Sound Module (Read Description) (Comes With Cord and Halg CD Memory Card Loaded With Patches)(NEW INTERNAL BATTERY)')
})

test('accessories: a stand sold for a product, with or without the article', () => {
  firesOn('Red Color 45 Degree Angle Stands For Korg Volca Bass FM Keys Nubass Loop Synthesizer - Made in USA', 'stands for')
  firesOn('Moog Cheeks Chestnut Solid Wood Rack Stand for Semi-Modular Synths - fits DFAM, Mother-32, Subharmonicon', 'stand for')
  notMatched('Red Color 45 Degree Angle Stands For Korg Volca Bass FM Keys Nubass Loop Synthesizer - Made in USA')
  // The bare noun is refused: a bundle names its stands after the product, and a trusted PAN-221 row keeps it.
  silentOn('Sequential Prophet X 61-key Synthesizer - Moog EP-3 Universal Pedal, Sustain Pedal, Neewer Collapsible Stands, Presonus HD7')
  matches('Sequential Prophet X 61-key Synthesizer - Moog EP-3 Universal Pedal, Sustain Pedal, Neewer Collapsible Stands, Presonus HD7', 'sequential-prophet-x')
  silentOn('Neumann KM 184 Stereo Set Small-diaphragm Cardioid Microphones with Cables and Stands - Matte Black')
})

test('"for the <model>" is the same reading as "for <model>"', () => {
  assert.equal(tokenIsObjectOfFor('3dwaves stands for the roland sp-404 mkii sampler', 'sp-404 mkii', 'roland'), true)
  assert.equal(tokenIsObjectOfFor('3dwaves stands for the roland sp-404 mkii sampler', 'sp-404 mkii', null), false)   // the brand sits between
  assert.equal(tokenIsObjectOfFor('rupert neve designs portico 511 preamp for the 500 series - studio preamp', '511', 'neve'), false)
  assert.equal(tokenIsObjectOfFor('barely played & untouched for the past 25 years', 'les paul custom', 'gibson'), false)
})

test('software: a plug-in, a licence or a virtual instrument that names a hardware product', () => {
  firesOn('Arturia CS-80 V Virtual Synthesizer Plug-In (Download)', '(download)')
  firesOn('GForce Oberheim OB-X Virtual Instrument', 'virtual instrument')
  firesOn('Arturia CS-80 V License', 'license')
  // Sold with software, after a marker: the hardware.
  silentOn('SOLID STATE LOGIC SSL 2 MKII Desktop 2-in/2-out USB-C Audio Interface with Software')
  silentOn('Waldorf Blofeld Desktop Synthesizer +SL License + OVP + Neuwertig+ 1,5J Garantie')
  silentOn('Dave Smith Instruments Evolver Desktop Monophonic Synthesizer + software')
  // `plug-in` stays refused (PAN-196): the UC1 is hardware.
  silentOn('Solid State Logic UC1 Hardware Plug-In Control Surface')
})

test('a kit that is the product, and the borderline the PR does not decide', () => {
  matches('Moog Mavis Semi-Modular Analog Synthesizer Kit', 'moog-mavis')                       // trusted production match
  matches('Moog Mavis Build-It-Yourself Analog Synthesizer Kit w/ 24-Point Patch Bay', 'moog-mavis')
  // 20,260 DKK on Reverb is a hardware price; the reviewer decides, this PR leaves it matched.
  matches('Universal Audio LA-2A- UA Classics', 'ua-la-2a')
})
