/**
 * scripts/lib/pan291-oto-ensoniq.test.ts
 *
 * PAN-291: OTO Machines and the Ensoniq samplers and outboard. Seventeen rows become match targets: seven Ensoniq rows
 * that exist as `known` (ASR-10, ASR-X, ASR-X Pro, EPS, EPS-16 Plus, Mirage DSK-8, Mirage DSK-1), the EPS-16 Plus rack,
 * the Mirage DMS-8 / DMS-1 rack, the DP/2, DP/4 and DP/4+ and five OTO Machines rows. Price decides identity (Reverb's
 * sold population, 2026-10-21). Every row requires its own code in a title that names its maker: "EPS Cement", "ESP
 * The Mirage", "Epiphone Biscuit" and the Roland DP-2 damper pedal carry the codes too. About 60 % of the 668
 * production titles that name Ensoniq, Oto, Mirage, ASR or EPS are disks, OS EPROMs, emulators, expanders and parts.
 * Every title is a production title (SELECT, 2026-10-21), a Reverb sold or live title (read-only, 2026-10-21) or a DBA
 * ad live that day, unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan291-oto-ensoniq.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { makerNamed } from '../../frontend/lib/matching/brand-guard'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan291-oto-ensoniq'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-291 files make a match target, with the model names the create / identity files leave or set. */
const PRODUCTS: Product[] = [
  row('oto-machines-biscuit', 'oto machines', 'OTO Machines Biscuit', 'Biscuit'),
  row('oto-machines-bim', 'oto machines', 'OTO Machines BIM', 'BIM'),
  row('oto-machines-bam', 'oto machines', 'OTO Machines BAM', 'BAM'),
  row('oto-machines-boum', 'oto machines', 'OTO Machines BOUM', 'BOUM'),
  row('oto-machines-bebe-cherie', 'oto machines', 'OTO Machines Bébé Chérie', 'Bébé Chérie'),
  row('ensoniq-asr-10', 'ensoniq', 'Ensoniq ASR-10', 'ASR-10'),
  row('ensoniq-asr-x', 'ensoniq', 'Ensoniq ASR-X', 'ASR-X'),
  row('ensoniq-asr-x-pro', 'ensoniq', 'Ensoniq ASR-X Pro', 'ASR-X Pro'),
  row('ensoniq-eps', 'ensoniq', 'Ensoniq EPS', 'EPS'),
  row('ensoniq-eps-16-plus', 'ensoniq', 'Ensoniq EPS-16 Plus', 'EPS-16 Plus'),
  row('ensoniq-eps-16-plus-rack', 'ensoniq', 'Ensoniq EPS-16 Plus Rack', 'EPS-16 Plus Rack'),
  row('ensoniq-mirage-dsk-8', 'ensoniq', 'Ensoniq Mirage DSK-8', 'Mirage DSK-8'),
  row('ensoniq-mirage-dsk-1', 'ensoniq', 'Ensoniq Mirage DSK-1', 'Mirage DSK-1'),
  row('ensoniq-mirage-dms-8', 'ensoniq', 'Ensoniq Mirage DMS-8 / DMS-1 Rack', 'Mirage DMS-8'),
  row('ensoniq-dp-2', 'ensoniq', 'Ensoniq DP/2', 'DP/2'),
  row('ensoniq-dp-4', 'ensoniq', 'Ensoniq DP/4', 'DP/4'),
  row('ensoniq-dp-4-plus', 'ensoniq', 'Ensoniq DP/4+', 'DP/4+'),
  // Brand protection: the rows an Ensoniq or Oto title could stray onto, as production holds them.
  row('roland-tr-909', 'roland', 'Roland TR-909', 'TR-909'),
  row('emu-sp-1200', 'e-mu', 'E-mu SP-1200', 'SP-1200'),
]

/**
 * The MODEL identifiers the PAN-291 identity file writes: the spellings the model tier cannot reach from its one
 * phrase ("DP-4" and "DP4" for "DP/4", "EPS 16+" for "EPS-16 Plus", "ASRX", "DMS-1", "Bebe Cherie"). Every one is
 * safe without a brand word only because each row's boundary requires its maker.
 */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [
  ...M('oto-machines-bebe-cherie', 'Bebe Cherie'),
  ...M('ensoniq-asr-10', 'ASR-10R'),
  ...M('ensoniq-asr-x', 'ASRX'), ...M('ensoniq-asr-x-pro', 'ASRX'),
  ...M('ensoniq-eps-16-plus', 'EPS-16', 'EPS 16', 'EPS16'), ...M('ensoniq-eps-16-plus-rack', 'EPS-16', 'EPS 16', 'EPS16'),
  ...M('ensoniq-mirage-dms-8', 'DMS-1', 'DMS-8', 'Mirage Rack'),
  ...M('ensoniq-dp-2', 'DP-2', 'DP2', 'DP 2'),
  ...M('ensoniq-dp-4', 'DP/4', 'DP-4', 'DP4', 'DP 4'), ...M('ensoniq-dp-4-plus', 'DP/4', 'DP-4', 'DP4', 'DP 4'),
]

/** Listing titles that production holds as live score-80 matcher aliases on the Ensoniq rows (synonym, 2026-10-21). */
const SYNONYMS = [
  ['Ensoniq ASR-10 Rack Ears! NEW!', 'ensoniq-asr-10'],
  ['Ensoniq ASR-10 Key (s) "E"', 'ensoniq-asr-10'],
  ['Ensoniq ASR-10 , EPS , ESQ , Mirage , SQ-80 - Push button Tact Switch', 'ensoniq-asr-10'],
  ['Ensoniq EPS One Sheet', 'ensoniq-eps'],
  ['Ensoniq EPS x2 Memory Expander ME-1A for EPS Original Sampler', 'ensoniq-eps'],
  ['Ensoniq EPS 16 Plus Sound Library ( 9 Floppy Disks)', 'ensoniq-eps-16-plus'],
  ['Ensoniq EPS-16 Plus Rack Ears! NEW!', 'ensoniq-eps-16-plus'],
  ['Ensoniq ME-16 Plus 2MB Memory Cartridge for EPS16+', 'ensoniq-eps-16-plus'],
  ['Ensoniq New Data Encoder For- ASR-X & ASR-X Pro', 'ensoniq-asr-x'],
  ['Ensoniq ASR-X , ASR-X Pro - Floppy disk drive 3.5-inch', 'ensoniq-asr-x-pro'],
].map(([alias, canonical_query]) => ({ alias, canonical_query }))

const index = buildMatchIndex(PRODUCTS, IDENTS, SYNONYMS, ['ensoniq', 'oto machines', 'epiphone', 'esp', 'roland', 'e-mu', 'akai', 'yamaha', 'kawai', 'doepfer'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notOurs = (title: string) => {
  const d = String(decide(title))
  assert.ok(!config.promoted.includes(d), `${title} → ${d}`)
}

test('every promoted row has a boundary, the config lists 17 rows, and the four families hold 12 of them', () => {
  assert.equal(config.promoted.length, 17)
  assert.equal(new Set(config.promoted).size, 17)
  for (const slug of config.promoted) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  for (const slug of config.promoted) assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  const fam = (slug: string) => NAVIGATION_FAMILIES.find((f) => f.slug === slug)!
  assert.deepEqual(fam('ensoniq-asr-sampler').children, ['ensoniq-asr-10', 'ensoniq-asr-x', 'ensoniq-asr-x-pro'])
  assert.deepEqual(fam('ensoniq-eps-sampler').children, ['ensoniq-eps', 'ensoniq-eps-16-plus', 'ensoniq-eps-16-plus-rack'])
  assert.deepEqual(fam('ensoniq-mirage-sampler').children, ['ensoniq-mirage-dsk-8', 'ensoniq-mirage-dsk-1', 'ensoniq-mirage-dms-8'])
  assert.deepEqual(fam('ensoniq-dp-effects').children, ['ensoniq-dp-4', 'ensoniq-dp-4-plus', 'ensoniq-dp-2'])
  for (const f of ['ensoniq-asr-sampler', 'ensoniq-eps-sampler', 'ensoniq-mirage-sampler', 'ensoniq-dp-effects']) {
    for (const c of fam(f).children) assert.ok(config.promoted.includes(c), c)
  }
})

test('"Oto" names OTO Machines and "Ensonic" names Ensoniq for the confidence floor; neither word alone is the maker of another', () => {
  assert.ok(makerNamed('oto bam reverb', 'oto machines'))
  assert.ok(makerNamed('ensonic kt-76', 'ensoniq'))
  assert.equal(makerNamed('otomatic bam', 'oto machines'), false) // synthetic
})

test('OTO Machines: each row is its word beside "Oto"; a two-unit bundle, a Biscuit resonator and a bare BAM name no row', () => {
  matches('OTO BAM Reverb', 'oto-machines-bam') // DBA, 3,800 kr
  matches('OTO Machines BAM Space Generator 2014 - Present - Black / Yellow', 'oto-machines-bam')
  matches('OTO Machines BAM Space Generator w/ DECKSAVER - FREE SHIPPING', 'oto-machines-bam')
  matches('OTO Machines BIM 12-Bit Delay | Includes Decksaver Cover', 'oto-machines-bim')
  matches('Oto machines Bim', 'oto-machines-bim')
  matches('OTO Machines BOUM Warming Unit (Analog Compressor + Distortion + Gate + Filter)', 'oto-machines-boum')
  matches('Oto Oto Boum', 'oto-machines-boum')
  matches('OTO Machines BISCUIT 8-Bit Effects and Analog Filter 2009 - 2016 - Black', 'oto-machines-biscuit')
  // The v2 "der OTO" firmware is the same unit ($950 against $1,000).
  matches('OTO Machines Biscuit 2 / Der Oto + Face Plate + N. Am. Power + Documentation #0998', 'oto-machines-biscuit')
  matches('OTO Machines BISCUIT 8-Bit Effects and Analog Filter (with box, manuals, power supply and Der Oto overlay)', 'oto-machines-biscuit')
  matches('OTO Machines Bébé Chérie Analog Mixer 2023 - pink', 'oto-machines-bebe-cherie')
  matches('OTO Machines Bebe Cherie Desktop Analogue 6 Channel Mixer', 'oto-machines-bebe-cherie')
  matches('Oto Machines BÉBÉ CHÉRIE', 'oto-machines-bebe-cherie')
  notOurs('OTO Machines BIM & BAM Bundle!')
  notOurs('OTO Machines BAM & BIM (both included in sale)')
  notOurs('OTO Machines Replacement Power Supply (BIM /BAM /BOUM ) - UK')
  notOurs('Epiphone Biscuit-8E elektrisk resonatorguitar sort') // DBA
  notOurs('BAM Reverb pedal') // synthetic: no maker
  notOurs('Decksaver OTO BIM cover') // synthetic
})

test('the ASR line: the ASR-10 keyboard and rack are one row, the ASR-X and its Pro two; expanders, boards and the ASR-88 stay out', () => {
  matches('Ensoniq ASR-10 Advanced Sampling Recorder 1992 - Black', 'ensoniq-asr-10')
  matches('Ensoniq ASR-10 Rackmount Advanced Sampling Recorder 1992 - Black', 'ensoniq-asr-10')
  matches('Ensoniq ASR10 Advanced Sampling Keyboard', 'ensoniq-asr-10')
  matches('Ensoniq ASR 10 KEYBOARD SAMPLER 16 meg/61 key/ASR10,ASR-10 w/ SCSI //ARMENS//', 'ensoniq-asr-10')
  matches('Ensoniq ASR-10 with SCSI and Gotek USB emulator', 'ensoniq-asr-10')
  matches('Ensoniq ASR-10 Vintage Sampler Keyboard - Purple Display Version - 16MB', 'ensoniq-asr-10')
  matches('Ensoniq ASR-10R', 'ensoniq-asr-10')
  matches('Ensoniq ASR-X Advanced Sampler / Resampler 1997 - 1999 - Black', 'ensoniq-asr-x')
  matches('Ensoniq ASR-X Pro Resampling Production Studio 1998 - Red', 'ensoniq-asr-x-pro')
  matches('Ensoniq ASRX Pro sampler', 'ensoniq-asr-x-pro')
  matches('Ensoniq ASR-X Pro 66MB RAM / 8 Outs / EXP-3', 'ensoniq-asr-x-pro')
  notOurs('Ensoniq ASR-10 Rack Ears! NEW!')
  notOurs('Ensoniq ASR-10 Key (s) "E"')
  notOurs('Ensoniq ASR-10 Operating System 3.53 with Instruments')
  notOurs('Ensoniq ASR-10 V1.50B Firmware EPROM! NEW!')
  notOurs('Ensoniq ASR-10 Essential Sound Disk Library ( 8 Disks)')
  notOurs('Ensoniq ASR-10 Rackmount  floppy')
  notOurs('Ensoniq ASR-10 Displayboard keyboard')
  notOurs('Ensoniq OEX-6sr (ASR-10) Output Expander')
  notOurs('Acrylic Dust Cover for Ensoniq ASR-10')
  notOurs('USB Floppy Drive Emulator WITH KNOB for Ensoniq ASR-10 plus 100\'s of disks & OLED Display')
  notOurs('Ensoniq ASR-X Pro mainboard and 64mb ram')
  notOurs('Ensoniq ASR-X ASR-X Pro 8 Output Expansion Board X-8')
  notOurs('Ensoniq ASR-X Pro Power Supply with Aluminum Caps')
  notOurs('Ensoniq ASR-X Pro beta OS upgrade floppy 3.20 / 4.0 beta')
  notOurs('Ensoniq ASR-X Turbo Sampler Fully loaded')
  notOurs('Ensoniq ASR-88 Advanced Sampling Recorder (like ASR-10)')
  notOurs('ASR-10 / EPS16+ / ASR-X - 27 Diskets / Floppy Disks Soundbank, Instruments, Drums,FX, OS Boot - Original, Official')
  notOurs('Ensoniq ASR-10 , EPS , ESQ , Mirage , SQ-80 - Push button Tact Switch')
  notOurs('Ensoniq New Data Encoder For- ASR-X & ASR-X Pro')
})

test('the EPS line: the classic, the EPS-16 Plus keyboard and its rack are three rows; "Plus" is never "sold with"', () => {
  matches('Ensoniq EPS Performance Sampler 1988 - Black', 'ensoniq-eps')
  matches('Ensoniq EPS W/ Gotek USB and OEX8 Upgrades Plus 4x Memory Expansion!', 'ensoniq-eps')
  matches('Ensoniq EPS 16 Plus Digital Sampling Workstation 1990 - Black', 'ensoniq-eps-16-plus')
  matches('Ensoniq EPS16+', 'ensoniq-eps-16-plus')
  matches('Ensoniq EPS 16+ digital sampling workstation', 'ensoniq-eps-16-plus') // DBA
  matches('Ensoniq EPS 16 +, with Protec type soft case, 47 disks, expanded memory, sustain pedal & manual', 'ensoniq-eps-16-plus')
  matches('Vintage Ensoniq EPS-16 Analog/Digital Sampling Keyboard w/ Floppy Disks (1990s)', 'ensoniq-eps-16-plus')
  matches('FULLY SERVICED Ensoniq EPS-16 Plus Sampler with PREMIUM GoTek FlashFloppy Emulator + HUGE Sample Library!', 'ensoniq-eps-16-plus')
  matches('Ensoniq EPS 16 Plus with ME-16 Plus', 'ensoniq-eps-16-plus')
  matches('Ensoniq EPS 16 Plus Rackmount Digital Sampling Workstation 1990 - Black', 'ensoniq-eps-16-plus-rack')
  matches('Ensoniq EPS 16+ Rack | Max Ram | USB Reader | Excellent Condition', 'ensoniq-eps-16-plus-rack')
  matches('Ensoniq EPS 16 Plus Turbo Rackmount Digital Sampling Workstation 1990 - Black', 'ensoniq-eps-16-plus-rack')
  notOurs('Ensoniq  EPS 16 Plus Sound Library ( 9 Floppy Disks)')
  notOurs('Ensoniq  EPS 16 Plus Operating System 1.30 with Instruments')
  notOurs('ENSONIQ EPS 16 Plus 1990 Original Software Boot disk v.1.10')
  notOurs('Ensoniq EPS-16 Plus Rack Ears! NEW!')
  notOurs('Ensoniq EPS 16 Plus FB-2 Flash Bank Original OEM Instantly Load The Operating System!')
  notOurs('Ensoniq ME-16 Plus 2MB Memory Cartridge for EPS16+')
  notOurs('Ensoniq EPS16+ ME 16Plus Card')
  notOurs('2-pack Faders - EPS 16 Plus Rack')
  notOurs('Ensoniq EPS 16 Plus Rackmount NOS Display Board')
  notOurs('Ensoniq EPS 16 Plus Digital Sampling Workstation - Not Working')
  notOurs('Ensoniq EPS16+ KEYBOARD/RACK 1990')
  notOurs('Ensoniq EPS x2 Memory Expander ME-1A for EPS Original Sampler')
  notOurs('rare Ensoniq EPS 2x Memory Ram Expander, #ME-1A Ensoniq Performance Sampler 1988')
  notOurs('Ensoniq EPS 4X-Memory Expander')
  notOurs('Ensoniq EPS One Sheet')
  notOurs('Ensoniq EPS-M EPSm Rackmount Digital Sampler 1988')
  notOurs('Akai MPC 3000 2000 XL Program Format Floppy 12 Disk Disks Ensoniq EPS Drums Sample Library MPC Instant Load')
  notOurs('Syntaur "Sample Magic: Mastering the Ensoniq EPS/ASR Samplers" book by Sam Mims')
  notOurs('EPS Cement lättbetong 50 liter vit') // Blocket
})

test('the Mirage: DSK-8 and DSK-1 by their code, the DMS racks one row; a bare Mirage, an ESP Mirage and the disks stay out', () => {
  matches('Ensoniq Mirage DSK-8 Digital Sampling Keyboard 1984 - Grey', 'ensoniq-mirage-dsk-8')
  matches('1980s Ensoniq Mirage DSK-8 Sampling Keyboard . Working with Disks!', 'ensoniq-mirage-dsk-8')
  matches('Ensoniq Mirage DSK-8 Sampling Keyboard 1984 - Gotek floppy', 'ensoniq-mirage-dsk-8')
  matches('Ensoniq Mirage DSK-1 Digital Sampling Keyboard (red stripe) 1986 - Black', 'ensoniq-mirage-dsk-1')
  matches('**READ DESC** Ensoniq Mirage DSK-1 w/ Gotek USB Drive & Carry Case', 'ensoniq-mirage-dsk-1')
  matches('Ensoniq Mirage DMS-8 Digital Multi-Sampler 1985', 'ensoniq-mirage-dms-8')
  matches('Ensoniq Mirage DMS-1 Digital Multi-Sampler with extra sound disks 1986 - Black', 'ensoniq-mirage-dms-8')
  matches('Ensoniq MIRAGE Rack W/ Gotek USB', 'ensoniq-mirage-dms-8')
  notOurs('Ensoniq Mirage 1986 - Gray')
  notOurs('ESP The Mirage Custom Shop Stratocaster HSS Purple Ash MIJ Japan Guitar') // DBA
  notOurs('ESP Custom Shop M-III Mirage Green Ash Super Stratocaster Guitar MIJ Japan') // DBA
  notOurs('Ensoniq Mirage OS Operating System Boot Disk v3.2 - US Seller, New, 720k MF-2DD.')
  notOurs('Ensoniq Mirage USB Floppy Emulator with pre-installed disk images on USB drive')
  notOurs('Ensoniq Mirage Disk Bundle')
  notOurs('Ensoniq Mirage DSK-1 cover')
  notOurs('Pushbuttons Tact Switches for Ensoniq Mirage DSK-1 or DSK-8 Grey full set of 24')
  notOurs('Ensoniq Mirage DSK-8 - 1/4 inch phone jack stereo - For Black DSK8')
  notOurs('Ensoniq Mirage DMS-1 rack (non functioning)')
})

test('the DP line: the DP/4 refuses the DP/4+, every spelling reaches its row, and a Roland DP-2 or a converter is not one', () => {
  matches('Ensoniq DP/4 Parallel Effects Processor 1993 - Black', 'ensoniq-dp-4')
  matches('Ensoniq DP/4 Parallel Effects Processor - Latest OS + Manuals', 'ensoniq-dp-4')
  matches('Ensoniq DP/4 Parallel Effects Processor v1.15 Firmware Latest!', 'ensoniq-dp-4')
  matches('Ensoniq DP/4+ Parallel Effects Processor (Serviced / Warranty)', 'ensoniq-dp-4-plus')
  matches('Ensoniq DP/4+ (plus) Parallel Effects Processor with manual and spare battery', 'ensoniq-dp-4-plus')
  matches('Legendary Ensoniq DP4+ Parallel Effects Processor - Daft Punk Secret Weapon - Near Mint', 'ensoniq-dp-4-plus')
  matches('Ensoniq DP/2 Parallel Effects Processor 1995 - Black', 'ensoniq-dp-2')
  matches('Ensoniq DP2 Parallel Effects Processor, DP-2 multi effects unit', 'ensoniq-dp-2')
  matches('Ensoniq  Dp 2  Black', 'ensoniq-dp-2')
  notOurs('Sony CX20018 A-D Converter for Eventide H3000, Ensoniq DP/4 NOS, US supply in CA')
  notOurs('Ensoniq DP/4+ Effects Processor - Panasonic REPLACEMENT BATTERY ONLY! - 3 Solder Prongs')
  notOurs('Ensoniq DP/2 Parallel Effects Processor - DP-2 Multi-FX - DP2 Unit - i.e. DP-4 DP-4 ASR-X')
  notOurs('Ensoniq DP/4+ / Not working properly')
  notOurs('Roland DP-2 sustain pedal') // synthetic: Roland's damper pedal
  notOurs('Kawai RV-4 (DP-4 killer ;) )') // DBA
})
