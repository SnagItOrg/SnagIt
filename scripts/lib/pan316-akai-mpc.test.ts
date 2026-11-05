/**
 * scripts/lib/pan316-akai-mpc.test.ts
 *
 * PAN-316: the Akai MPCs. Twenty-two rows are match targets once the PAN-316 SQL files run: the MPC60, MPC3000,
 * MPC3000LE, MPC2000, MPC2000XL, MPC1000, MPC2500, MPC500, MPC4000 and MPC5000, the MPC Live, Live II and Live III, the
 * One and One G2, the X, X SE and XL, the Key 61, Key 37 and Key 37 G2, and the MPC Sample. Price decides identity
 * (Reverb's sold population, same year, 2026-11-04): the MPC60 II, the MPC2000XL MCD / SE and the MPC One+ are their base
 * row's. Every title is a production or Reverb sold title (2026-11-04) unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan316-akai-mpc.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan316-akai-mpc'

const row = (slug: string, brand_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name === 'akai' ? 'Akai' : brand_name} ${model_name}`, model_name, brand_name,
  status: 'active', support_state: 'supported',
})

/** Every row the PAN-316 files make a match target, with the model names the create file sets or production holds. */
const PRODUCTS: Product[] = [
  row('akai-mpc60', 'akai', 'MPC60'),
  row('akai-mpc3000', 'akai', 'MPC3000'),
  row('akai-mpc3000le', 'akai', 'MPC3000LE'),
  row('akai-mpc2000', 'akai', 'MPC2000'),
  row('akai-mpc2000xl', 'akai', 'MPC2000XL'),
  row('akai-mpc1000', 'akai', 'MPC1000'),
  row('akai-mpc2500', 'akai', 'MPC2500'),
  row('akai-mpc500', 'akai', 'MPC500'),
  row('akai-mpc4000', 'akai', 'MPC4000'),
  row('akai-mpc-5000', 'akai', 'MPC5000'),
  row('akai-mpc-live', 'akai', 'MPC Live'),
  row('akai-mpc-live-ii', 'akai', 'MPC Live II'),
  row('akai-mpc-live-iii', 'akai', 'MPC Live III'),
  row('akai-mpc-one', 'akai', 'MPC One'),
  row('akai-mpc-one-g2', 'akai', 'MPC One G2'),
  row('akai-mpc-x', 'akai', 'MPC X'),
  row('akai-mpc-x-se', 'akai', 'MPC X SE'),
  row('akai-mpc-xl', 'akai', 'MPC XL'),
  row('akai-mpc-key-61', 'akai', 'MPC Key 61'),
  row('akai-mpc-key-37', 'akai', 'MPC Key 37'),
  row('akai-mpc-key-37-g2', 'akai', 'MPC Key 37 G2'),
  row('akai-mpc-sample', 'akai', 'MPC Sample'),
  // The rows production holds that these titles could stray onto.
  row('emu-sp-1200', 'e-mu', 'SP-1200'),
  row('roland-tr-808', 'roland', 'TR-808'),
  row('roland-tr-909', 'roland', 'TR-909'),
]

/** The MODEL identifiers the PAN-316 identity and owner files write: the spellings the model tier cannot reach. */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
/** The seed SKUs production holds on the imported rows (SELECT, 2026-11-04). */
const SKU = (slug: string, value: string) => ({ product_id: `p-${slug}`, type: 'SKU', value })
const IDENTS = [
  SKU('akai-mpc60', 'MPC60'), SKU('akai-mpc3000', 'MPC3000'), SKU('akai-mpc2000', 'MPC2000'), SKU('akai-mpc2000xl', 'MPC2000XL'),
  SKU('akai-mpc-live-ii', 'MPC Live II'), SKU('akai-mpc-one', 'MPC One'), SKU('akai-mpc-x', 'MPC X'),
  ...M('akai-mpc60', 'MPC60II', 'MPC 60II'),
  ...M('akai-mpc-x', 'MPC-X'),
  ...M('akai-mpc-x-se', 'MPC X Special Edition'),
  ...M('akai-mpc-xl', 'MPC-XL'),
  ...M('akai-mpc-live-iii', 'MPC Live 3'),
  ...M('akai-mpc-one-g2', 'MPC One Gen 2'),
  ...M('akai-mpc-key-37-g2', 'MPC Key 37 Gen 2', 'MPC Key 37 Gen2'),
  ...M('akai-mpc3000le', 'MPC3000 LE', 'MPC 3000 LE', 'MPC3000 Limited Edition', 'MPC 3000 Limited Edition'),
  ...M('akai-mpc2000xl', 'MPC 2000 XL', 'MPC-2000 XL', 'MPC2000 XL', 'MPC2000XL-MCD'),
  ...M('akai-mpc-live-ii', 'MPC Live 2'),
  ...M('akai-mpc-one', 'MPC OnePlus'),
]

const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['akai', 'e-mu', 'roland', 'korg', 'yamaha', 'kurzweil', 'ensoniq', 'native instruments'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  for (const t of titles) { const d = String(decide(t)); assert.ok(!config.promoted.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary, the config lists 22 rows, and the family holds all 22', () => {
  assert.equal(config.promoted.length, 22)
  assert.equal(new Set(config.promoted).size, 22)
  assert.deepEqual(config.supportedToday, [])
  const family = NAVIGATION_FAMILIES.find((f) => f.slug === 'akai-mpc')!
  assert.deepEqual([...family.children].sort(), [...config.promoted].sort())
  for (const slug of family.children) {
    assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
})

test('the vintage MPCs: each reaches its row, the MPC60 II and 2000XL MCD are their base row\'s, 2000 / 2000XL and 3000 / 3000LE never cross', () => {
  matches('akai-mpc60', [
    'Akai MPC60 Integrated MIDI Sequencer and Drum Sampler 1988 - 1991 - Grey', 'Akai MPC60II Integrated MIDI Sequencer and Drum Sampler 1991 - 1994 - Grey',
    'Akai MPC 60II', 'Akai MPC 60 II 1994 MIDI Sequencer & Sampler OS3.10 + OS2.12 - Grey',
    'Akai MPC60 / MPC 60 Mark 1 – Maxed RAM, Upgraded Widescreen, Vimana 3.15b5 OS, USB Drive, New Pads',
  ])
  matches('akai-mpc3000', ['Akai MPC3000 MIDI Production Center 1993 - 2001 - Grey', 'Akai MPC3000 MIDI Production Center (Bruce Forat Upgraded)Janet Jackson and SD card!'])
  matches('akai-mpc3000le', [
    'Akai MPC3000LE MIDI Production Center 32MB SD card', 'AKAI MPC3000 LE MIDI  1999 - 2001 - Black Edition No. 1286',
    'Akai MPC3000 Limited Edition  #0123 Roger Linn 16 Bit Drum Sampler/MIDI Sequencer - Black',
  ])
  matches('akai-mpc2000', ['Akai MPC2000 MIDI Production Center 1997 - 2001 - Grey', 'Akai MPC2000 32MB RAM / 8 Outs / New Screen', 'MPC2000  8 OUTS+MAX RAM'])
  matches('akai-mpc2000xl', [
    'Akai MPC2000XL MIDI Production Center', 'Akai MPC 2000 XL', 'Akai MPC-2000 XL Blue MIDI Production Center 2006 - 2007 - Blue',
    'Akai MPC2000XL-MCD', 'AKAI MPC2000XL MCD-EB16 EFFECTS- 8 OUTS - 32MB RAM', 'Fully Serviced Akai MPC2000XL w/CF Drive 1GB Card & 32MB RAM',
    'AKAI MPC2000XL, CUSTOM BLACK TRIM, BLUE LCD, 100MB INTERNAL ZIP DRIVE or CF READER, 32MB RAM, OS 1.20',
  ])
  matches('akai-mpc1000', ['Akai MPC1000 - Black w/ 1GB CF Card', 'Akai MPC 1000 Black – JJOS2XL – 128MB RAM – Fully Working'])
  matches('akai-mpc2500', ['Akai MPC2500 Music Production Center 2005 - 2013 - Black', 'Akai MPC 2500 Special Edition + JJOS XL 3.82 + 120 GB HDD'])
  matches('akai-mpc500', ['Akai MPC500 Music Production Center'])
  matches('akai-mpc4000', ['Akai MPC4000 Music Production Center'])
  matches('akai-mpc-5000', ['AKAI MPC5000 (192MB Memory Upgrade, HDD 80GB)'])
})

test('the current MPCs: a generation never reaches its successor (Live / II / III, One / G2, X / SE, Key 37 / G2)', () => {
  matches('akai-mpc-live', ['Akai MPC Live Standalone Sampler / Sequencer'])
  matches('akai-mpc-live-ii', [
    'Akai MPC Live II Standalone Sampler / Sequencer Gold Edition 2022 - Present - Gold', 'MPC Live 2 with original box - Make Offer',
    'Akai Professional MPC Live II Retro Edition — Excellent Condition, SSD Installed, Power Supply Included',
    'AKAI MPC LIVE II "GOLD" + 2TB SSD DRIVE FULLY LOADED W/ EXPANSION PACKS, VST\'S & DRUMKITS FOR SALE!',
  ])
  matches('akai-mpc-live-iii', [
    'Akai Professional MPC Live III Standalone Music Production Center', 'Akai Professional MPC Live III Standalone Music Production Center - Retro Edition (MPCLive3Rd1)',
    'Akai Professional MPC Live III Standalone Music Production Center MPC Live 3 - Open Box Mint',
  ])
  matches('akai-mpc-one', [
    'Akai MPC One Standalone MIDI Sequencer 2020 - Present - Black', 'Akai MPC One + Standalone MIDI Sequencer 2023 - Present - Red',
    'Akai MPC One Plus Standalone Sampler and Sequencer', 'Akai MPC OnePlus Music Production Center',
  ])
  matches('akai-mpc-one-g2', ['Akai MPC One G2 Standalone MIDI Sequencer 2026 - Present - Blue', 'Akai MPC One Gen 2 with 1TB SD Card'])
  matches('akai-mpc-x', ['Akai MPC X Standalone Sampler / Sequencer 2017 - Present - Black', 'AKAI MPC-X Standalone Music Production Center', 'Akai MPC X w/ 1 TB Hard Drive'])
  matches('akai-mpc-x-se', [
    'Akai MPC X SE', 'Akai MPC X Special Edition Standalone Sampler / Sequencer 2023 - Present - Grey', 'Akai MPC X SE 2023 (New In Original Box)',
  ])
  matches('akai-mpc-xl', ['Akai MPC XL Standalone Music Production Center', 'Akai MPC-XL open box'])
  matches('akai-mpc-key-61', ['AKAI MPC Key 61 Standalone Music Production Synthesizer'])
  matches('akai-mpc-key-37', ['Akai MPC Key 37 Standalone Workstation Synthesizer 2024 - Present - Red', 'Akai MPC Key 37 - Never Played - Screen Film Still On + Extras!'])
  matches('akai-mpc-key-37-g2', ['Akai MPC Key 37 G2 Standalone Workstation Synthesizer 2026 - Present - Cream', 'Akai Professional MPC Key 37 Gen2 Standalone MPC Keyboard Synthesiser'])
  // "Generation 2" is the G2, so the Key 37 refuses it; no identifier reaches the G2 row from it, so it names none.
  assert.equal(decide('Akai Professional MPC Key 37 Generation 2 [Three Wave Music]'), 'none')
  matches('akai-mpc-sample', ['Akai MPC Sample 2025 - present - Gray'])
})

test('parts, OS chips, sample libraries, covers, cases, stands and software name no MPC row', () => {
  notOn([
    'Akai Mpc 3000 Floppy Drive (original)', 'Akai Pad MPC3000', 'Akai - MPC60 - Battery', 'Akai MPC 3000 Original Screen - Works!',
    'Akai MPC3000 Complete Original Display', 'Akai MPC 3000 - Grau - Side / Front Panels', 'Akai MPC2000XL Production Center Parts',
    'Akai MPC 3000 OS 3.50 Vailixi EPROM Upgrade KIT', 'Akai MPC 3000 firmware OS upgrade: version 3.50 Vailixi USA stock MPC 3000',
    'Vimana OS 3.15 for the Akai MPC 60 / MPC60 ii (Free 2 Day Shipping)', 'Akai MPC-60 OS Version 2.12 Operating System Eprom Firmware MPC60',
    'Akai IB-208P MPC 2000XL - S3000XL etc. Audio Output Expander Board 8PARA L6036A501A', 'AKAI MPC2000XL 8output board IB-M208P',
    'Akai MPC 2000 and 2000xl Format Floppy 15 Disk Sample Library TR 909 SP1200 RD9 MC 202 LoFi Toys TS204 EPS',
    'Ultimate MPC2000 SD Boot Disk + ZuluSCSI Card Reader', 'Tin Metal Sign for Studio Akai MPC60 Check it out!',
    'New Akai MPC60II Clear Nameplate LCD Panel MPC 60 MkII MPC60 - MINT+ NEW!', 'Akai MPC 1000 - Black Face Plate',
    'MPC-1000 full Set tactile switch Akai', 'Akai MPC-1000 Pushbuttons Tact Switches Full Set Of 35 Micro Switch Mpc1000',
    '8MB RAM SIMM 72-Pin FPM 70ns Low Density 16-Chip Micron per Akai MPC 2000 S2000 S3000XL Kurzweil K2000 Roland - Testata 100%',
    'AKAI MPC 3000 LCD Screen Blue', 'Akai MPC2000XL Pad Sheet Metal Plate', 'Akai MPC 1000 - Original Pads Grey',
    'Decksaver DS-PC-MPCLIVE2 Akai MPC Live II Cover', 'Decksaver Akai MPC One / MPC One+ Cover', 'Akai  MPC One/One+ Pads and Sensor',
    'L&B Audio Works Akai MPC One Gen 2 Deluxe Stand - Walnut, Sapele or Rosewood - 20 or 40 Degree Tilt - Handmade',
    'AKAI MPC2000XL User Owner\'s Instruction Manual', 'Power Supply Unit Psu for Akai MPC2000XL', 'Acrylic Dust Cover for MPC 2000XL',
    'Akai Mpc 2500 Shirt', 'AKAI - TSHIRT MPC XL - T-shirt noir taille xl', 'Akai MPC 2000 (not XL) Power Input with Wires',
    'Akai MPC 1000 window - Blue', 'Akai MPC 60 Key Synth Ax60 1980s - Black Improved',
    // Synthetic: the free software and an expansion sold alone.
    'Akai MPC Beats Software License', 'Akai MPC Expansion Pack Vintage Drums',
  ])
  // The ASQ-10 is Akai's sequencer, not an MPC: "… ASQ10 Midi Sequencer with Vimana 3.15B5 … MPC60" (synthetic tail).
  notOn(['Upgraded Akai Professional Roger Linn ASQ10 Midi Sequencer with Vimana 3.15B5 | ASQ-10 like the MPC60'])
})

test('a title naming two MPCs stays a tie; one naming a generation and its successor resolves to the successor', () => {
  // Synthetic first: two units in one ad.
  for (const t of ['Akai MPC1000 and Akai MPC2500', 'Akai MPC2500 - Custom MPC3000LE Tribute']) {
    assert.equal(decide(t), 'deferred:ambiguous_tie', t)
  }
  // Synthetic: the refusal inside one line separates the members (step 5b).
  matches('akai-mpc-live-ii', ['Akai MPC Live upgraded to MPC Live II trade'])
})
