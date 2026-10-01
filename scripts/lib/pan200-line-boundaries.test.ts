/**
 * scripts/lib/pan200-line-boundaries.test.ts
 *
 * PAN-200: the Roland rows the promote SQL moves to `supported`, with the model
 * names it sets, beside the public Roland rows. One test per hazard class, on
 * real production titles (read-only snapshot 2026-10-01). Every test fails on
 * the matcher before this change except the last, which guards against
 * refusing too much.
 *
 * Run: npx tsx --test scripts/lib/pan200-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const product = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Roland ${model_name}`, model_name, brand_name: 'roland',
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex([
  product('roland-juno-6', 'Juno-6'),
  product('roland-juno-60', 'Juno-60'),
  product('roland-juno-106', 'Juno-106'),
  product('roland-ju-06', 'JU-06'),
  product('roland-ju-06a', 'JU-06A'),
  product('roland-jupiter-4', 'Jupiter-4'),
  product('roland-jupiter-8', 'Jupiter-8'),
  product('roland-jp-08', 'JP-08'),
  product('roland-tr-606', 'TR-606'),
  product('roland-tr-06', 'TR-06'),
  product('roland-tr-808', 'TR-808'),
  product('roland-tr-08', 'TR-08'),
  product('roland-tr-909', 'TR-909'),
  product('roland-tr-09', 'TR-09'),
  product('roland-sh-101', 'SH-101'),
  product('roland-re-201', 'RE-201'),
  product('roland-re-501', 'RE-501'),
  product('roland-sre-555', 'SRE-555'),
  product('roland-system-100', 'System 100'),
  product('roland-SP-404', 'SP-404'),
  product('roland-sp-404-mkii', 'SP-404MKII'),
  product('roland-v-synth', 'V-Synth'),
  product('roland-r-8', 'R-8'),
  product('roland-jd-800', 'JD-800'),
  product('roland-jx-8p', 'JX-8P'),
  product('roland-d-50', 'D-50'),
  product('roland-jv-2080', 'JV-2080'),
  product('roland-d-20', 'D-20'),
  product('roland-tr-626', 'TR-626'),
], [], [], ['roland', 'boss', 'behringer', 'viscount'])

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

const expectAll = (slug: string | null, titles: string[]) => {
  for (const t of titles) assert.equal(matchedSlug(t), slug, t)
}

test('a Boutique re-creation is the Boutique model, not the original it names', () => {
  expectAll('roland-ju-06', [
    'Roland Boutique JU-06 JUNO-106 Synthesizer Sound Module 2015-2017',
    'Roland JU-06 Boutique Synthesizer Juno-106 +Fast Neuwertig + OVP+ 1,5J Garantie',
  ])
  expectAll('roland-ju-06a', ['Roland Boutique Series JU-06A Synthesizer Module of JUNO 60 new  //ARMENS//'])
  expectAll('roland-tr-06', ['Mint Roland TR-06 Authentic TR-606 Boutique Series Rhythm MacHine and So Much More.'])
  expectAll('roland-tr-08', ['Roland Boutique Series TR-08 Drum Machine, modern TR-808'])
  // TR-909: "Exclude TR-09 (Boutique)" (constructed from pool titles).
  expectAll('roland-tr-09', ['Roland TR-09 Boutique Rhythm Composer, the TR-909 in miniature'])
  expectAll('roland-jp-08', ['Roland JP-08 Boutique Series Digital Synthesizer Module – Jupiter-8 Recreation'])
})

test('the frozen boundaries: TR-808, TR-909, SH-101, System 100, RE-201, Jupiter-8 refuse their other members', () => {
  expectAll(null, [
    // TR-808: "Exclude TR-08/TR-8/TR-8S and clones" (constructed from pool titles).
    'Roland TR-8S Rhythm Performer TR-808 TR-909 sounds',
    'Behringer RD-8 Roland TR-808 clone',
    // SH-101: "Exclude SH-01/SH-01A (Boutique) and SH-4d".
    'Roland SH-01A Boutique SH-101',
    // System 100: "SPLIT from System-100M"; the row is the Model 101.
    'Roland System 100 M Model 140 Envelope [760438] (09/08)',
    'Roland System 100 Model 104 Sequencer Module – Serviced – Warranty',
    // RE-201: "Distinct from … RE-2/RE-20 pedals".
    'Boss RE-20 Roland RE-201 Space Echo Stereo Tape Delay Twin Guitar Effect Pedal',
  ])
  // RE-501: "SRE-555 is the rack sibling", and the RE-201 named in its feature list is not the offer.
  expectAll('roland-sre-555', ['Roland SRE-555 RE-501 Chorus Echo Flagship 4-Heads RE-201 Tape Delay Spring Reverb CE-1 Chorus'])
})

test('later generations and editions are their own models', () => {
  expectAll(null, [
    'Roland SP-404 MKII',
    'Roland V-Synth XT Rack Mount Digital Synthesizer 2005 - 2009 - Black',
    'Roland V-Synth GT 2.0',
    "80's ROLAND SPV 355 / P / V SYNTH SYNTHESIZER",
    'Roland R-8 MKII Human Rhythm Composer 1990s - Black',
  ])
  expectAll('roland-sp-404-mkii', ['Roland SP-404MKII Creative Sampler and Effector (Open Box, Brand New)'])
})

test('the Roland parts vocabulary: switches, boards, part numbers, merch, broken units, sample packs', () => {
  expectAll(null, [
    'Roland Jupiter-8 Tact Switches Full Set Of 41 Vintage Synthesizer Jp8 Jupiter8 Panel Switch',
    'ORIGINAL Roland Dual Button, Black (22495209) for D-10 & D-20',
    'Roland JV-2080 Jack Board Assy 70896056 Audio & Midi Port Board',
    'Roland S-220 parts - encoder knob',
    'Complete set (20 pcs) - Brand new sliders - Roland Juno 6',
    'Roland TR-909 T-shirt - Small',
    'Roland TR-909 Rhythm Composer Drum Machine BAD SHAPE For Parts / Repair READ 1st',
    'Roland JUNO-106 (an Bastler, mit Soundchip-Problem)',
    'Reverb Roland TR-606 Sample Pack',
    'Thon Case für Roland JUNO-60 u ähnl Synthesizer, Trolly',
    'Roland JD-800 Drum & Percussion Standard Sound Card SL-JD80-01',
    'Roland D-20 / D20 •  4-Bank Set of synth patches • Digital Download • Also works with D-10 / D-5',
    'Roland JD-990 (NEW) LED Graphic Display !',
    'Tape Echo Loops for Roland Space Echo RT-1L RE 201 RE 101 RE 501 RE301 SRE 555',
    'Viscount UFO 61 Intercontinental Vintage 1970s Italian 61 key Electronic Combo Organ Synth (Similar to Roland CR-68 78 Compu-Rhythm)',
  ])
})

test('the instrument still matches: markers, conditions and the words measured on instruments', () => {
  const titles: [string, string][] = [
    ['Roland Juno-106 – 1980s – Full original parts – Fully Serviced – Warranty', 'roland-juno-106'],
    ['[SERVICED] Roland HS-60 Juno 106 61-Key Programmable Polyphonic Synthesizer 1985 - 1989 - Gray', 'roland-juno-106'],
    ['Roland Juno-106 + Flight Case (1984) Mint !', 'roland-juno-106'],
    ['Roland Juno-60 with Tubbutec midi + controller + hardcase, FULLY RESTORED, MINT!', 'roland-juno-60'],
    ['Roland Jupiter-4 Compunicator (Late Rev E) - Mint - Original Case', 'roland-jupiter-4'],
    ['BOSS Roland Space Echo RE-201 Delay/Reverb', 'roland-re-201'],
    ['【Serviced】 Roland RE-201 Space Echo May 1977 Japan w/ Step-Down Transformer', 'roland-re-201'],
    ['Roland RE-201 Space Echo Vintage Tape Echo/Reverb — Professionally Serviced — Original Case + 4 New Tape Loops', 'roland-re-201'],
    ['Roland RE-501 Chorus Echo — Soundgas Refurbished, Re-Capped, Motor, Extra Tape', 'roland-re-501'],
    ['ROLAND TR-606 ANALOGUE DRUM MACHINE EX CONDITION ORIGINAL BOX NEW SWITCHES FULLY TESTED AA+', 'roland-tr-606'],
    ['Roland TR-909 Mint Condition, Serviced, 100-240V upgraded PSU, Firmware V5 Installed & Signed by Jeff Mills', 'roland-tr-909'],
    ['Roland TR-626 Rhythm Composer - Serviced, new power supply', 'roland-tr-626'],
    ['[SALE Ends Sep 24] Roland SH-101 w/ MGS-1 Grip Monophonic Analog Synthesizer Keyboard w/ 100-240V PSU', 'roland-sh-101'],
    ['Roland JD-800 (1995) – Near Mint  – Flight Case Included.', 'roland-jd-800'],
    ['Roland JX-8P 61-Key Polyphonic Synthesizer Keyboard & PG-800 Programmer', 'roland-jx-8p'],
    ['Roland JV-2080 64-Voice Synthesizer Module w/ Pop & Orchestral Expansion Boards Rack Mount Rackmount Synth', 'roland-jv-2080'],
    ['Roland Space Echo RE-201 Mid 1970 - Black Vinyl', 'roland-re-201'],
    ['Roland SP-404 Sampler with 1-Spot Power Adapter', 'roland-SP-404'],
  ]
  for (const [title, slug] of titles) assert.equal(matchedSlug(title), slug, title)
})
