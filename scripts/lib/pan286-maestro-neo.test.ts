/**
 * scripts/lib/pan286-maestro-neo.test.ts
 *
 * PAN-286: Maestro vintage pedals and the Neo Instruments Ventilator family. Twenty-five rows become match targets
 * (the Echoplex EP-1, EP-3 and EP-4 that exist as `known` since PAN-230; 18 Maestro rows and 4 Neo Instruments rows
 * created 2026-10-21 with a verified Reverb page each). Every vintage Maestro row carries the code its sellers write,
 * and a row requires its code where the bare line word also names a sibling, the 1962 FZ-1 (no page, no row) or the
 * 2022 relaunch. The Maestro collision: ~110 production titles are Gibson / Epiphone guitars with a Maestro Vibrola,
 * three are Formanta Maestro synths, and the Echoplex trade sells preamp copies and parts under the name. A bare
 * "Ventilator" is the original Neo row; "II" / "2" is the Ventilator II; the Mini Vent and Micro Vent are one row each
 * across their generations. Measured on the 174 production titles that say "maestro" (production SELECT,
 * 2026-10-21), the production Dunlop EP103 titles, the DBA ads live that day and the Reverb sold titles behind each
 * row (read-only, 2026-10-21). Every title is a production or Reverb title unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan286-maestro-neo.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { makerNamed } from '../../frontend/lib/matching/brand-guard'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan286-maestro-neo'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/**
 * Every row the PAN-286 files make a match target, with the model names the create / identity files set: the code
 * the seller writes (the `boss-dm-2` form — the model tier reads model_name as one phrase, and sellers put the code
 * before or after the line word), or the line word where there is no code.
 */
const PRODUCTS: Product[] = [
  row('maestro-echoplex-ep-1', 'maestro', 'Maestro Echoplex EP-1', 'EP-1'),
  row('maestro-echoplex-ep-2', 'maestro', 'Maestro Echoplex EP-2 Tape Delay', 'EP-2'),
  row('maestro-echoplex-ep-3', 'maestro', 'Maestro Echoplex EP-3', 'EP-3'),
  row('maestro-echoplex-ep-4', 'maestro', 'Maestro Echoplex EP-4', 'EP-4'),
  row('maestro-fuzz-tone-fz-1a', 'maestro', 'Maestro Fuzz-Tone FZ-1A', 'FZ-1A'),
  row('maestro-fuzz-tone-fz-1b', 'maestro', 'Maestro Fuzz-Tone FZ-1B', 'FZ-1B'),
  row('maestro-fuzz-tone-fz-1s', 'maestro', 'Maestro Fuzz-Tone FZ-1S Super-Fuzz', 'FZ-1S'),
  row('maestro-fuzz-mfz-1', 'maestro', 'Maestro Fuzz MFZ-1', 'MFZ-1'),
  row('maestro-fuzz-phazzer', 'maestro', 'Maestro Fuzz Phazzer', 'Fuzz Phazzer'),
  row('maestro-bass-brassmaster', 'maestro', 'Maestro Bass Brassmaster Fuzz BB-1', 'Bass Brassmaster'),
  row('maestro-phase-shifter-ps-1', 'maestro', 'Maestro Phase Shifter PS-1', 'PS-1'),
  row('maestro-phase-shifter-ps-1a', 'maestro', 'Maestro Phase Shifter PS-1A', 'PS-1A'),
  row('maestro-phase-shifter-ps-1b', 'maestro', 'Maestro Phase Shifter PS-1B', 'PS-1B'),
  row('maestro-phaser-mp-1', 'maestro', 'Maestro Phaser MP-1', 'MP-1'),
  row('maestro-mini-phase-mps-2', 'maestro', 'Maestro Mini-Phase MPS-2', 'MPS-2'),
  row('maestro-ring-modulator-rm-1', 'maestro', 'Maestro Ring Modulator RM-1', 'RM-1'),
  row('maestro-filter-sample-hold-fsh-1', 'maestro', 'Maestro Filter Sample/Hold FSH-1', 'FSH-1'),
  row('maestro-parametric-filter-mpf-1', 'maestro', 'Maestro Parametric Filter MPF-1', 'MPF-1'),
  row('maestro-octave-box', 'maestro', 'Maestro Octave Box', 'Octave Box'),
  row('maestro-boomerang-bg-2', 'maestro', 'Maestro Boomerang BG-2', 'Boomerang'),
  row('maestro-full-range-booster-frb-1', 'maestro', 'Maestro Full Range Booster FRB-1', 'FRB-1'),
  row('neo-instruments-ventilator', 'neo instruments', 'Neo Instruments Ventilator (original)', 'Ventilator'),
  row('neo-instruments-ventilator-ii', 'neo instruments', 'Neo Instruments Ventilator II', 'Ventilator II'),
  row('neo-instruments-mini-vent', 'neo instruments', 'Neo Instruments Mini Vent II', 'Mini Vent'),
  row('neo-instruments-micro-vent', 'neo instruments', 'Neo Instruments Micro Vent', 'Micro Vent'),
  // Brand protection: the rows a Maestro or Echoplex title could stray onto, as production holds them.
  row('dunlop-ep103-echoplex-delay', 'dunlop', 'Dunlop EP103 Echoplex Delay', 'EP103 Echoplex Delay'),
  row('gibson-sg-standard', 'gibson', 'Gibson SG Standard', 'SG Standard'),
  row('boss-fz-5', 'boss', 'Boss FZ-5', 'FZ-5'),
  row('moog-mf-102-ring-modulator', 'moog', 'Moog MF-102 Ring Modulator', 'MF-102 Ring Modulator'),
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
const notMaestro = (title: string) => {
  const d = String(decide(title))
  assert.ok(!d.startsWith('maestro-') && !d.startsWith('neo-'), `${title} → ${d}`)
}

test('every promoted row has a boundary, the config lists 25 rows and the three families hold 11 of them', () => {
  assert.equal(config.promoted.length, 25)
  assert.equal(new Set(config.promoted).size, 25)
  for (const slug of config.promoted) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  const fam = (slug: string) => NAVIGATION_FAMILIES.find((f) => f.slug === slug)!
  assert.deepEqual(fam('fuzz-tone').children, ['maestro-fuzz-tone-fz-1a', 'maestro-fuzz-tone-fz-1b', 'maestro-fuzz-tone-fz-1s'])
  assert.deepEqual(fam('echoplex').children, ['maestro-echoplex-ep-1', 'maestro-echoplex-ep-2', 'maestro-echoplex-ep-3', 'maestro-echoplex-ep-4'])
  assert.deepEqual(fam('ventilator').children, ['neo-instruments-ventilator', 'neo-instruments-ventilator-ii', 'neo-instruments-mini-vent', 'neo-instruments-micro-vent'])
  for (const f of ['fuzz-tone', 'echoplex', 'ventilator']) for (const c of fam(f).children) assert.ok(config.promoted.includes(c), c)
  // The Echoplex and Ventilator rows share a line each, so a refusal within it separates members (step 5b).
  for (const slug of config.promoted.filter((s) => s.includes('echoplex'))) assert.equal(LINE_BOUNDARIES[slug].line, 'echoplex', slug)
  for (const slug of config.promoted.filter((s) => s.startsWith('neo-'))) assert.equal(LINE_BOUNDARIES[slug].line, 'ventilator', slug)
})

test('"Neo" names Neo Instruments for the confidence floor; "Maestro" is a brand only when a pedal model follows', () => {
  assert.ok(makerNamed('neo ventilator ii rotary speaker simulator', 'neo instruments'))
  assert.ok(makerNamed('neo micro vent 16 rotary cabinet simulator pedal', 'neo instruments'))
  assert.equal(makerNamed('holy grail neo fra electro harmonix', 'electro-harmonix') && makerNamed('holy grail neo', 'neo instruments'), true)
  assert.equal(makerNamed('rega neo psu mk2', 'strymon'), false)
})

test('the Echoplex line: each row requires its number, "EP4" is "EP-4", and the parts, copies and the Dunlop stay out', () => {
  matches('Maestro Echoplex EP-1 1959 - 1963 - Brown', 'maestro-echoplex-ep-1')
  matches('Fully working Maestro Echoplex EP-1 1959 - 1963  tube Tape Delay echo with Original footswitch', 'maestro-echoplex-ep-1')
  matches('Maestro Echoplex EP-2 1963 - 1969 - Green', 'maestro-echoplex-ep-2')
  matches('60\'s Maestro Echoplex EP-2', 'maestro-echoplex-ep-2')
  matches('Maestro Echoplex EP-3 Solid State 1970 - 1991 - Grey', 'maestro-echoplex-ep-3')
  matches('(VINTAGE!) Maestro 1973 EP-3 Echoplex "Black Top"', 'maestro-echoplex-ep-3')
  matches('Clean Refurbished Maestro Echoplex EP-3 Solid State tape delay with lid and pedal!', 'maestro-echoplex-ep-3')
  matches('Maestro Echoplex EP-3 Solid State w/Footswitch (USED)', 'maestro-echoplex-ep-3')
  matches('Pre-Owned 1974 Maestro Echoplex EP-3', 'maestro-echoplex-ep-3')
  matches('Maestro EP-3 Solid State', 'maestro-echoplex-ep-3')
  matches('Maestro Echoplex EP-4 1970s - Grey', 'maestro-echoplex-ep-4')
  matches("1970's Maestro EP-4 Echoplex", 'maestro-echoplex-ep-4')
  matches('Maestro Echoplex EP4 Vintage Solid State Tape Delay!', 'maestro-echoplex-ep-4')
  matches('Maestro EchoPlex EP-4 Tape Echo Machine 1970s Black With Foot Switch NO ISSUES!', 'maestro-echoplex-ep-4')
  matches('Maestro Market Electronics Inc. EP-4 ep4 EchoPlex echo plex Echo Chamber Delay Module', 'maestro-echoplex-ep-4')
  matches('Maestro EP-4 Echo Plex', 'maestro-echoplex-ep-4')
  // Two members, a transitional unit: no row.
  notMatched('RARE - Transitional Solid State Maestro EP-2 / EP-3 Echoplex - Less than 400 made')
  notMatched('Maestro Echoplex EP-2 transition to EP-3 Tape Delay')
  // The preamp copies that quote the Echoplex, the parts, and a bare "Echoplex".
  notMatched('Catalinbread Epoch Boost Preamp/Buffer * Made in USA * Reproduction of the famous Maestro Echoplex EP-3 Tape Echo Preamp Circuit * Up to 20 dB adjustable clean boost *')
  notMatched('DCW Pedals Exoplex Vintage Preamp - Maestro EP-3 Echoplex Style Preamp')
  notMatched('Echoplex Preamp guitarpedal')  // DBA
  notMatched('Maestro Echoplex EP-3 EP-4 Reproduction Replacement Thumb Screws Set of 4')
  notMatched('Reproduction Maestro Echoplex EP-3 / EP-4 Replacement Thumb Screws Set of 4')
  notMatched('Maestro Echoplex EP-3 Vintage Lid Decal Replica Prints For Restoration Rare!')
  notMatched("Maestro Echoplex EP-3 volume knob... 1971 vintage original, same as chickenhead knobs used on late 50's Fender Tweed amps.")
  notMatched('Tuki Padded Cover for Maestro Echoplex EP-3 Tape Delay (maes001p)')
  notMatched('PEDAL ONLY for Maestro Echoplex EP-3 Solid State tape delay')
  notMatched('Pair of Original Maestro Echoplex Tape Delay knobs')
  notMatched('Maestro Echoplex Bumper Sticker 9" x 3" High Quality Laser FREE SHIPPING!')
  // Dunlop's Echoplex Delay is Dunlop's row (production holds its identifiers; here only its model name), never an EP row.
  matches('Dunlop EP103 Echoplex Delay Pedal', 'dunlop-ep103-echoplex-delay')
  notMaestro('DUNLOP ECHOPLEX DELAY EP103')
  notMaestro('Dunlop EP103 Echoplex Digital Delay Guitar Effects Pedal')
})

test('the Fuzz-Tone line: the letter after FZ-1 is the row, the bare 1962 FZ-1 and the 2022 FZ-M name no row, the copies stay out', () => {
  matches('Maestro Fuzz-Tone FZ-1A 1965 - 1967 - Black', 'maestro-fuzz-tone-fz-1a')
  matches('Used Maestro Fuzz-Tone FZ-1A 1966-1967', 'maestro-fuzz-tone-fz-1a')
  matches('Gibson Maestro Fuzz-Tone FZ-1A 1960s', 'maestro-fuzz-tone-fz-1a')
  // Recall costs: a code split by a space or hyphenated the other way is not the code form ("FZ-1 A", "FZ1-A").
  notMatched('1966 Maestro by Gibson Fuzz-Tone FZ-1 A w/ manual')
  notMatched('Gibson 1966 Maestro Fuzz Tone FZ1-A 1966')
  matches('Maestro Fuzz-Tone FZ-1B 1968 - 1970 - Black', 'maestro-fuzz-tone-fz-1b')  // synthetic, Reverb's page years
  matches('Maestro FZ-1B Fuzz-Tone', 'maestro-fuzz-tone-fz-1b')
  matches('Maestro Fuzz-Tone FZ-1S Super Fuzz', 'maestro-fuzz-tone-fz-1s')
  matches('Maestro FZ-1S Fuzz-Tone Super Fuzz "Early 70s"', 'maestro-fuzz-tone-fz-1s')
  // The 1962 original has no Reverb page and no row; a converted FZ-1A that names the FZ-1 spec is still an FZ-1A.
  notMatched('Maestro Fuzz-Tone FZ-1 1962 Black')
  notMatched('1962 Maestro Fuzz-Tone FZ-1 ~ Very Early ~ Serial Number 201 ~ Serviced and Good for 50 More Years!')
  notMatched('Vintage Rare Collectable Maestro Fuzz Tone FZ-1 NOT FZ-1A Real Deal Original')
  notMatched('Maestro Fuzz-Tone FZ-M')  // the 2022 relaunch, synthetic from Reverb's page title
  notMatched('Maestro Fuzz guitar effektpedal')  // DBA, 2026-10-21: which fuzz?
  notMatched('Gibson Maestro Fuzz-Tone FZ-1 - Shell Only')
  notMatched('MAESTRO Fuzz-Tone FZ-1 CLONE | Germanium Fuzz Pedal 2021')
  notMatched('Canterbury Audio Apollo Fuzz-Tone (Maestro fz-1 REPLICA) 2026 - Brown')
  notMatched('KVFX KVFZ-1 Skuzz-Tone (Maestro FZ-1 Fuzz-Tone) Handmade')
  notMatched('Smitty Fuzz Tone - clone of Maestro FZ-1S Super FUZZ-TONE')
  notMatched('Super Electric Suzztone - Maestro Fuzz-Tone FZ-1S Super-Fuzz (Free Shipping)')
  // The Boss FZ-5 that names the Maestro sound is Boss's row.
  matches('Boss Fuzz FZ-5 Guitar Effects Pedal Classic Vintage Fuzz Selective With Mode Selector! Fuzz Face, Maestro Fuzz, or Octavia Fuzz!', 'boss-fz-5')
})

test('the other Maestro fuzzes: the MFZ-1 is its code, the Fuzz Phazzer and the Bass Brassmaster their words; copies and a modern year stay out', () => {
  matches('Maestro MFZ-1 Fuzz 1976', 'maestro-fuzz-mfz-1')
  matches("Maestro MFZ-1 Fuzz 1970's Vintage MOOG", 'maestro-fuzz-mfz-1')
  matches('Vintage Maestro Fuzz MFZ-1 Guitar Pedal', 'maestro-fuzz-mfz-1')
  matches('Maestro Fuzz MFZ-1 1970s - Silver', 'maestro-fuzz-mfz-1')
  notMatched('Chicago Stompworks Maestro Fuzz MFZ-1 clone Black Fudge w/ free shipping')
  notMatched('Vintage Maestro Fuzztain mfzt Fuzz Sustainer pedal')
  matches('Maestro Fuzz Phazzer 1971 - 1974 - Green', 'maestro-fuzz-phazzer')
  matches('Maestro Fuzz Phazzer FP-1', 'maestro-fuzz-phazzer')
  notMatched("3 Maestro pedals : Fuzz Phazzer + Wha Wha + Volume (70's)")
  matches('Maestro Bass Brassmaster Fuzz BB-1 1971 - 1974 - Black / Orange / Silver', 'maestro-bass-brassmaster')
  matches('Maestro Bass Brassmaster - Vintage Bass Octave Fuzz', 'maestro-bass-brassmaster')
  matches('Maestro BB-1 Bass Brassmaster Fuzz', 'maestro-bass-brassmaster')
  notMatched('GGG Brassmaster CLONE of Maestro Bass Brassmaster Fuzz')
  notMatched('The Latent Audio Lemon Maestro Bass Brassmaster Octave Fuzz 2019')
  notMaestro('Behringer Bass Brassmaster Fuzz Maestro 2025')
})

test('the phase shifters: PS-1 / PS-1A / PS-1B by their letter, the MP-1 and MPS-2 by their code; the Stage Phaser, the Orbit and a bare "Maestro Phaser" name no row', () => {
  matches('Maestro Phase Shifter PS-1 1971 - Black', 'maestro-phase-shifter-ps-1')
  matches('Maestro PS-1 Phase Shifter (Made by Oberheim) - Early 70\'s - Message Me for a Shipping Estimate', 'maestro-phase-shifter-ps-1')
  matches('Maestro PS-1 Phaser', 'maestro-phase-shifter-ps-1')
  matches('Vintage Maestro Phase Shifter PS-1 1971 - Black (Rare PS-1 not the PS-1A)', 'maestro-phase-shifter-ps-1')  // the negated sibling
  notMatched('Maestro PS-1 Phase Shifter Footswitch PSFS-1')
  notMatched('Stromer Mutroniks PSFS-2 Maestro PS-1 footswitch')
  matches('Maestro PS-1A Phase Shifter 1976', 'maestro-phase-shifter-ps-1a')
  matches('Maestro Phase Shifter PS-1A 1970s - Black with PSFS-2 Phase Shifter Footswitch', 'maestro-phase-shifter-ps-1a')
  matches('Maestro PS-1A + PSFS2 Phase Shifter 1970\'s RARE!!', 'maestro-phase-shifter-ps-1a')
  notMatched('Maestro PS-1A Replica PCB')
  notMatched('Maestro PS-1A Phase Shifter Enclosure and Switches *Parts*')
  matches('1975 Maestro PS-1B Phase Shifter', 'maestro-phase-shifter-ps-1b')
  matches('Maestro Phase Shifter PS-1B 1970s - Black', 'maestro-phase-shifter-ps-1b')
  matches('Maestro Phaser MP-1 1976 - 1978 - Black', 'maestro-phaser-mp-1')
  matches('Maestro MP-1 Phaser Vintage Phase Moog', 'maestro-phaser-mp-1')
  matches('Maestro Phaser - Model MP Phaser MP-1', 'maestro-phaser-mp-1')
  matches('Maestro MPS-2 Mini-Phase 1976', 'maestro-mini-phase-mps-2')
  matches('Maestro Mini-Phase MPS-2', 'maestro-mini-phase-mps-2')
  notMatched('Maestro Stage Phaser')  // DBA, 2026-10-21: no Reverb page, no row
  notMatched('Maestro Stage Phaser MSP 1970s - Silver/Black')
  notMatched('Maestro Phaser')  // DBA, 2026-10-21
  notMatched('Maestro Orbit Phaser')  // the 2022 relaunch, synthetic from Reverb's page title
  notMatched('Moose Electronics Maestro Stage Phaser clone')
})

test('ring modulator, filters, octave box, Boomerang and booster: a word or a code each; the MP-2 pedal, a 2026 copy and the Titan Boost stay out', () => {
  matches('Maestro Ring Modulator RM-1 1971 - 1975 - Metal', 'maestro-ring-modulator-rm-1')
  matches('Maestro Ring Modulator RM-1 Vintage Effects Pedal Pitch Modulation Oberheim RARE', 'maestro-ring-modulator-rm-1')
  notMatched('Vintage Maestro MP-2 Pitch & Modulation Control - Expression Foot Pedal for RM-1 Ring Modulator')
  notMaestro('Moog MF-102 Ring Modulator')  // synthetic: Moog's own row
  matches("Maestro FSH-1 Filter Sample Hold 1970's", 'maestro-filter-sample-hold-fsh-1')
  matches('Maestro FSH-1 Filter Sample/Hold', 'maestro-filter-sample-hold-fsh-1')
  matches("Maestro MPF-1 Parametric Filter Late 1970's Silver/Black", 'maestro-parametric-filter-mpf-1')
  matches('Maestro Mpf-1 parametric filter', 'maestro-parametric-filter-mpf-1')
  notMatched('Loophole Pedals Maestro Parametric Filter MPF1 2026 - Black')
  matches('vintage Maestro OB-1 Octave Box pedal, Rare! near mint condition with original box & paperwork', 'maestro-octave-box')
  matches('Maestro Octave Box OB2', 'maestro-octave-box')
  matches('Maestro Octave Box 1970s - Blue / Black', 'maestro-octave-box')
  matches('Maestro Boomerang BG-2 1972 - 1976 - Black', 'maestro-boomerang-bg-2')
  matches('Vintage 1974 Maestro BG-2 Boomerang Wah-Volume Pedal, New Gagan Pot', 'maestro-boomerang-bg-2')
  matches('Maestro Boomerang Wah/Volume', 'maestro-boomerang-bg-2')
  matches("Gibson Maestro Boomerang 69'-70'", 'maestro-boomerang-bg-2')
  matches('Maestro Full Range Booster FRB-1 1972 - 1975 - Black', 'maestro-full-range-booster-frb-1')
  matches('Maestro Frb-1 Full Range Booster', 'maestro-full-range-booster-frb-1')
  notMatched('Guitar Pedal Maestro titan boost')  // DBA, 2026-10-21: the 2022 relaunch
  notMatched('Ubrugt Maestro Comet Chorus fra Gibson.')  // DBA, 2026-10-21
})

test('the Maestro collision: a Gibson or Epiphone with a Maestro Vibrola, a Formanta Maestro and the woodwind system name no pedal', () => {
  const guitars = [
    '1969 Gibson SG Standard "Large Guard" with Maestro Vibrola',
    'Gibson SG Standard \'61 Maestro Vibrola Vintage Cherry',
    'Gibson SG Standard \'61 Faded with Maestro Vibrola 2022 - Present - Vintage Cherry',
    'Gibson SG Standard 61 Faded Maestro Tremolo - Vintage Cherry',
    'Gibson SG 61 Maestro Faded',
    'Epiphone "Inspired by Gibson Custom" \'63 Les Paul SG Custom with Maestro Vibrola 2024 - Present - Classic White',
    'Epiphone 1964 SG Standard Reissue Maestro Vibrola',
    'Gibson Custom Shop 1963 Firebird V w/ Maestro Vibrola VOS Vintage Sunburst',
    'Gibson Custom Shop \'67 Mahogany Flying V Reissue with Maestro Vibrola 2021 - Present - Sparkling Burgundy',
    'Gibson Custom LE 1963 Firebird VII Reissue Double Gold Maestro Gloss NH',
    'TPP Eric Clapton Cream "Fool" Gibson USA SG Standard Tribute w Maestro',
    'Gibson ES-335 60s (Dark Walnut) + 2 Maestro Pedals & Case',
    '2013 Epiphone Custom Shop Les Paul Custom SG • Maestro • TV Pelham Blue',
    'All Original 1967 Gibson ES-335 TD Maestro – Sunburst',  // Kleinanzeigen
    '1968 Gibson SG Standard',  // DBA
    'Epiphone SG guitar med dobbelt humbucker og vibrato',  // DBA
    'Formanta Maestro',
    'Maestro (Formanta) Soviet synthesizer: New Mods, Midi',
    'serviced Formanta Maestro+MIDI',
    'Andet, Gibson Maestro Sound System for Woodwinds W3',  // DBA
    'Alhambra 100 MRH Maestro Series akustisk guitar',  // DBA
    'Guitarforstærker Maestro PG 105M med bærehåndtag',  // DBA
    'Sælger min Maestro el-bas',  // DBA
    'Knapharmonika, Hagstrøm Maestro',  // DBA
  ]
  for (const title of guitars) notMaestro(title)
})

test('the Ventilator family: a bare Ventilator is the original, "II" / "2" the second, the Mini Vent and Micro Vent one row each; the Remote is a footswitch', () => {
  matches('Neo Instruments Ventilator', 'neo-instruments-ventilator')
  matches('Neo Instruments Ventilator V1', 'neo-instruments-ventilator')
  matches('Neo Instruments Ventilator (Original)', 'neo-instruments-ventilator')
  matches('Neo Instruments / Neo Ventilator w/ Brake Footswitch. Excellent Condition!', 'neo-instruments-ventilator')
  matches('Neo Instruments Ventilator — Leslie Simulator, awesome spacy stereo effect', 'neo-instruments-ventilator')
  matches('Neo Instruments Ventilator 2010s - Grey Plus matching Neo Remote Switch', 'neo-instruments-ventilator')
  matches('Neo Instruments Ventilator II Rotary Speaker Simulator Pedal (Leslie Tones)', 'neo-instruments-ventilator-ii')
  matches('Neo Instruments Ventilator II , Second-Hand', 'neo-instruments-ventilator-ii')
  // Recall cost: "Ventilator 2" is not the model's form and no brand-free identifier is safe for a word that is Danish
  // for a fan; the original refuses the "2", so the title names no row rather than the wrong one.
  notMatched('Neo Instruments Ventilator  2 Rotary Simulation Pedal + Remote Foot Switch')
  notMatched('Ventilator II with Ventilator Remote & Remote II')  // no brand word: below the floor, a recall cost
  notMatched('Neo Instruments Ventilator II Leslie Simulator and Remote Footswitch')  // "and" is no inclusion marker: a recall cost
  matches('Neo Instruments Ventilator II Rotary Speaker Simulator Pedal with Remote II Pedal', 'neo-instruments-ventilator-ii')
  notMatched('Neo Instruments Ventilator Remote II Footswitch for Ventilator II')
  notMatched('Neo Instruments Ventilator Remote II')
  notMatched('Neo Ventilator Remote 2 Control Pedal')
  notMatched('Neo Instruments Venrem Ventilator Remote Ii')
  matches('Neo Instruments Mini Vent Rotary Cabinet Simulator', 'neo-instruments-mini-vent')
  matches('Neo Instruments Mini Vent II', 'neo-instruments-mini-vent')
  matches('NEO MINI VENT II mini vent II 2024 - black', 'neo-instruments-mini-vent')
  matches('NEO Instruments mini Vent II Leslie 122 Rotary Effect Pedal', 'neo-instruments-mini-vent')
  matches('Neo Instruments Mini Vent II 2 Ventilator New Guitar/Organ Leslie Simulator w/ power supply', 'neo-instruments-mini-vent')
  matches('Neo Instruments Mini Vent for Organ Rotary Sim with Mini-Remote Option, choice of Halfmoon or FS-6', 'neo-instruments-mini-vent')
  matches('Micro Vent Neo Instruments', 'neo-instruments-micro-vent')  // DBA, 2026-10-21
  matches('NEO Instruments micro Vent 16', 'neo-instruments-micro-vent')
  matches('Neo Micro Vent 16 Rotary Cabinet Simulator Pedal', 'neo-instruments-micro-vent')
  matches('NEO Instruments Micro Vent 122 Rotary Speaker Effect Pedal', 'neo-instruments-micro-vent')
  matches('Neo Instruments Micro Vent 122 Rotary Cabinet 122 Simulator Pedal with Box', 'neo-instruments-micro-vent')
  notMatched('Neo Instruments Drive In overdrive guitarpedal')  // DBA, 2026-10-21: no row
  notMatched('Holy Grail Neo  fra Electro Harmonix Rumklang med spring, hall og plate.')  // DBA
  notMatched('Rega Neo PSU MK2 24V motorstyring med DSP')  // DBA
  notMatched('Showtec Gobobeam lyseffekt sort')  // DBA, the "ventilator" query's noise
})
