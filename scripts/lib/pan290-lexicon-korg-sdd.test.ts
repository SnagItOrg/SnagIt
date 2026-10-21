/**
 * scripts/lib/pan290-lexicon-korg-sdd.test.ts
 *
 * PAN-290: the Lexicon classics and the Korg SDD delay family. Thirty-one rows become match targets (the Lexicon 224,
 * 480L, PCM 42 and Prime Time 93 that exist as `known` since PAN-230, the Korg SDD-3000 rack and pedal that exist since
 * 2026-08-26, and 25 rows created 2026-10-21 — a verified Reverb page each, except the Super Prime Time, the PCM 92, the
 * SDD-1000 and the DL8000R, which Reverb has no page for). Price decides identity: the 224 / 224X / 224XL and the MX400 /
 * MX400XL are one row each, their codes identifiers (manager, 2026-10-21: below ~25 % apart is one row); the 300 / 300L,
 * PCM96 / Surround, LXP-15 / II and SDD-3000 rack / pedal are two rows each. Lexicon names its units by bare numbers and short codes, so a row refuses every other line's
 * code: a title naming two units (a LARC "for 224XL/480L/300L/M300") names no row. Measured on the 105 production
 * titles that say "lexicon", the production titles that say "sdd", the DBA ads live on 2026-10-21 and the Reverb sold
 * titles behind each row (read-only, 2026-10-21). Every title is a production or Reverb title unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan290-lexicon-korg-sdd.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan290-lexicon-korg-sdd'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-290 files make a match target, with the model names the create / identity files set. */
const PRODUCTS: Product[] = [
  row('lexicon-200', 'lexicon', 'Lexicon 200', '200'),
  row('lexicon-224', 'lexicon', 'Lexicon 224', '224'),
  row('lexicon-480l', 'lexicon', 'Lexicon 480L', '480L'),
  row('lexicon-960l', 'lexicon', 'Lexicon 960L', '960L'),
  row('lexicon-300', 'lexicon', 'Lexicon 300', '300'),
  row('lexicon-300l', 'lexicon', 'Lexicon 300L', '300L'),
  row('lexicon-pcm-41', 'lexicon', 'Lexicon PCM 41', 'PCM 41'),
  row('lexicon-pcm-42', 'lexicon', 'Lexicon PCM 42', 'PCM 42'),
  row('lexicon-pcm-60', 'lexicon', 'Lexicon PCM 60', 'PCM 60'),
  row('lexicon-pcm-70', 'lexicon', 'Lexicon PCM 70', 'PCM 70'),
  row('lexicon-pcm-80', 'lexicon', 'Lexicon PCM 80', 'PCM 80'),
  row('lexicon-pcm-81', 'lexicon', 'Lexicon PCM 81', 'PCM 81'),
  row('lexicon-pcm-90', 'lexicon', 'Lexicon PCM 90', 'PCM 90'),
  row('lexicon-pcm-91', 'lexicon', 'Lexicon PCM 91', 'PCM 91'),
  row('lexicon-pcm-92', 'lexicon', 'Lexicon PCM 92', 'PCM 92'),
  row('lexicon-pcm-96', 'lexicon', 'Lexicon PCM96', 'PCM 96'),
  row('lexicon-pcm-96-surround', 'lexicon', 'Lexicon PCM96 Surround', 'PCM 96'),
  row('lexicon-prime-time', 'lexicon', 'Lexicon Prime Time Model 93', 'Prime Time'),
  row('lexicon-prime-time-ii', 'lexicon', 'Lexicon Prime Time II Model 95', 'Prime Time'),
  row('lexicon-super-prime-time', 'lexicon', 'Lexicon Super Prime Time Model 97', 'Super Prime Time'),
  row('lexicon-lxp-1', 'lexicon', 'Lexicon LXP-1', 'LXP-1'),
  row('lexicon-lxp-5', 'lexicon', 'Lexicon LXP-5', 'LXP-5'),
  row('lexicon-lxp-15', 'lexicon', 'Lexicon LXP-15', 'LXP-15'),
  row('lexicon-lxp-15-ii', 'lexicon', 'Lexicon LXP-15 II', 'LXP-15'),
  row('lexicon-mx200', 'lexicon', 'Lexicon MX200', 'MX200'),
  row('lexicon-mx300', 'lexicon', 'Lexicon MX300', 'MX300'),
  row('lexicon-mx400', 'lexicon', 'Lexicon MX400', 'MX400'),
  row('korg-sdd-1000', 'korg', 'Korg SDD-1000', 'SDD-1000'),
  row('korg-sdd-2000', 'korg', 'Korg SDD-2000', 'SDD-2000'),
  row('korg-sdd-3000-rackmount', 'korg', 'Korg SDD-3000 Rack', 'SDD-3000'),
  row('korg-sdd-3000-pedal', 'korg', 'Korg SDD-3000 Pedal', 'SDD-3000'),
  row('korg-dl8000r', 'korg', 'Korg DL8000R', 'DL8000R'),
  // Brand protection: the rows a Lexicon or SDD title could stray onto, as production holds them.
  row('roland-sdd-320-dimension-d', 'roland', 'Roland SDD-320 Dimension D', 'SDD-320'),
  row('boss-sde-3', 'boss', 'Boss SDE-3', 'SDE-3'),
  row('wurlitzer-200a', 'wurlitzer', 'Wurlitzer 200A', '200A'),
  row('strymon-timeline-mx', 'strymon', 'Strymon TimeLine MX', 'TimeLine MX'),
  row('ua-la-2a', 'universal audio', 'Universal Audio LA-2A', 'LA-2A'),
]

/**
 * The identifiers the PAN-290 identity file writes: the 224's later codes, the glued MX400XL, the form DBA's 480L ad
 * takes, and the pedal's code — the code form keeps "224x", "400xl" and "3000-pdl" whole, so the model name never
 * reaches them.
 */
const IDENTS = [
  ['lexicon-224', '224X'], ['lexicon-224', '224XL'], ['lexicon-mx400', 'MX400XL'], ['lexicon-480l', 'Lexicon 480'], ['korg-sdd-3000-pedal', 'SDD-3000-PDL'],
].map(([slug, value]) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))

const index = buildMatchIndex(PRODUCTS, IDENTS, [])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notOurs = (title: string) => {
  const d = String(decide(title))
  assert.ok(!d.startsWith('lexicon-') && !d.startsWith('korg-'), `${title} → ${d}`)
}

test('every promoted row has a boundary, the config lists 31 rows, and the five families hold 25 rows', () => {
  assert.equal(config.promoted.length, 31)
  assert.equal(new Set(config.promoted).size, 31)
  for (const slug of [...config.promoted, ...config.supportedToday]) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  const fam = (slug: string) => NAVIGATION_FAMILIES.find((f) => f.slug === slug)!
  const children = ['lexicon-pcm', 'prime-time', 'lexicon-lxp', 'lexicon-mx', 'korg-sdd'].flatMap((f) => fam(f).children)
  assert.equal(children.length, 25)
  for (const c of children) assert.ok(config.promoted.includes(c), c)
  // Rows that share a model name share a line, so a refusal within it separates them (step 5b).
  for (const slug of [...config.promoted, ...config.supportedToday].filter((s) => s.startsWith('lexicon-'))) assert.equal(LINE_BOUNDARIES[slug].line, 'lexicon', slug)
  for (const [a, b] of [['lexicon-pcm-96', 'lexicon-pcm-96-surround'], ['lexicon-prime-time', 'lexicon-prime-time-ii'], ['lexicon-lxp-15', 'lexicon-lxp-15-ii'], ['korg-sdd-3000-rackmount', 'korg-sdd-3000-pedal']]) {
    assert.equal(LINE_BOUNDARIES[a].line, LINE_BOUNDARIES[b].line, `${a} / ${b}`)
  }
})

test('the 224 line is one row: the 224, 224X and 224XL, spaced or glued, with or without the LARC', () => {
  matches('Lexicon 224 Digital Reverberator', 'lexicon-224')
  matches('Lexicon 224 Digital Reverberator 1978 w/224R Remote. Holiest Among All Verbs. Totally Ready. HEAR IT', 'lexicon-224')
  matches('LEXICON 224 with LARC REMOTE', 'lexicon-224')
  matches('Lexicon 224X Digital Reverberator with LARC Remote - Fully Functional / Classic 12-Bit Magic', 'lexicon-224')
  matches('Lexicon 224X Digital Reverberator with Rare Vintage Blue LARC Remote - Fully Functional / Classic 12-Bit Magic', 'lexicon-224')
  matches('Lexicon 224X mit LARC', 'lexicon-224')
  matches('Vintage Lexicon 224x', 'lexicon-224')
  matches('Lexicon 224xl 1984 - Blue newly restored', 'lexicon-224')
  matches('Lexicon 224XL Digital Reverberator with LARC Remote 1980s - Black / White Remote', 'lexicon-224')
  matches('Lexicon 224 XL with LARC 1980\'s', 'lexicon-224')
  matches('Lexicon 224XL (UPGRADED FROM AN X BEAMISH REBUILT AND UPGRADED) NO LARC', 'lexicon-224')
})

test('the 224 parts trade and the plug-ins name no row', () => {
  for (const t of [
    'Lexicon  224XL new djr NVS card',
    'Lexicon - 224 remote - New panel switch with led black',
    'Lexicon - 224 Remote Control - Black Switch with LED',
    'Lexicon 224 - Version 4.3 Latest OS Firmware Update Upgrade [Without NVS board] Eprom Rom',
    'Lexicon 224 Extender card',
    'Lexicon 224 OS Version 4.4 Latest Firmware 224 only Update Upgrade Eprom Rom Chip',
    'Lexicon 224X OS Version 8.1 Latest Firmware 224 X Update Upgrade Eprom Rom Chip',
    'Lexicon 224XL OS Version 8.21 Latest Firmware 224 XL only Update Upgrade Eprom Rom Chip',
    'Lexicon 224x REMOTE ONLY Blue',
    'Lexicon LARC Remote for 224XL/480L/300L/M300',
    'Lexicon Larc for 224x, 480, 300 1990’s',
    'Lexicon 480L/224XL Replacement LARC Cable',
    // The UAD plug-in and the cards that carry it.
    'UAD Lexicon 224 Digital Reverb\t (Download) <br>',
    'Universal Audio UAD Lexicon 224 Digital Reverb Plug-In',
    'Universal Audio UAD Lexicon 224 Digital Reverb Plug-in (Activation Card)',
    'Universal Audio UAD-2 Quad firewire with 23 plug ins AMS RMX Lexicon 224',
    'Universal Audio Satellite Octo + Plugins (Studer A800, AKG BX20, Lexicon 224, Pultec Collection ...)',
    // Two units in one title, and a copy's reference.
    'Lexicon 480L  and 224XL. with L.A.R.C. 1980\'s - Black n Blue',
    'Lexicon Model 200 Digital Reverberator 224 480L',
    'Lexicon Reflex (Vintage 224XL Sound)',
  ]) notOurs(t)
})

test('the 480L, 960L, 300 and 300L', () => {
  matches('Lexicon 480L Digital Effects System with LARC Remote 1980s - Black / White Remote', 'lexicon-480l')
  matches('Lexicon 480L V 4.1 - LARC - Classic Card', 'lexicon-480l')
  matches('Lexicon 480L with LARC Remote', 'lexicon-480l')
  matches('Lexicon 480L Digital Reverb Effects System', 'lexicon-480l')
  // DBA, 2026-10-21 (31,000 kr): "480" without the L, through the identifier; "m." after a three-digit number is not "med".
  matches('Lexicon 480 m. Larc, Classic Card', 'lexicon-480l')
  matches('Lexicon 480 Digital Effects System with 2 LARC remote Controls Black with White Remote', 'lexicon-480l')
  for (const t of [
    '☆ Lexicon 480L Reverb final v4.1 Firmware upgrade kit - big enhancements and unlocks Classic Cart!☆',
    '☆ Lexicon 480L Reverb HSP card repair custom IC\'s  X2 ☆',
    'Lexicon  480L Digital Effects System  Cartridge',
    'Lexicon 480 L - 480L Replacement Battery',
    'Lexicon 480L Classic Cartridge',
    'Lexicon 480L Diagnostic Cartridge',
    'Lexicon 480l nonvolatile memory card 64k',
    'Lexicon 480L Original Owner’s Manual',
    'LEXICON 480L SERVICE MANUAL W SCHEMATICS',
    'Lexicon LEXICON CLASSIC CARD FOR LEXICON 480 L 1980 - BLACK',
    'Lot Of 3 Lexicon 480L V1.23 EPROM IC\'s. U40, U41, U42. LP',
    'Lexicon - MPX R1 , 480L , PCM81  - Internal Memory Backup Replacement Battery',
  ]) notOurs(t)
  matches('Lexicon 960L Digital Effects System 24-bit 96kHz', 'lexicon-960l')
  matches('Lexicon 960L with LARC2', 'lexicon-960l')
  // Recall cost, accepted: "8x" reads as a count (PAIR_OR_LOT), here the I/O channels of one unit.
  notOurs('Lexicon 960L Digital fx System w LARC2 8x ANALOG & DIGITAL INTERFACE')
  matches('Lexicon 300 Digital Effects System', 'lexicon-300')
  matches('1990s Lexicon M300 Digital Effects System', 'lexicon-300')
  matches('Lexicon M300 Digital Reverb Effects Upgraded to V3.5', 'lexicon-300')
  matches('Lexicon M 300 Digital Effects System', 'lexicon-300')
  matches('Lexicon 300L Digital Effects System with LARC Remote 1980s - Black / White Remote', 'lexicon-300l')
  matches('Lexicon 300L with LARC', 'lexicon-300l')
  matches('v3.5L  Lexicon  300L reverb effects processor rack m300 studio guitar vocals keyboards', 'lexicon-300l')
  notOurs('Lexicon M300 LARC Remote')
  notOurs('LARC Remote  Lexicon m300 Doug Jane LARC  1990 White')
  notOurs('Lexicon PCM 70 / M300 NOS Encoder')
  // The MX300 is the MX line's, never the 300.
  matches('Lexicon MX300 Stereo Reverb Effects Processor', 'lexicon-mx300')
  matches('Lexicon MX300 reverb / effektprocessor til rack', 'lexicon-mx300')
})

test('the PCM line: one row per number, the PCM96 Surround by its word, parts and plug-ins never', () => {
  matches('Lexicon PCM 41 Digital Delay Processor', 'lexicon-pcm-41')
  matches('Lexicon PCM 42 Digital Delay Processor 1980s - Blue', 'lexicon-pcm-42')
  matches('Lexicon PCM 42 Digital Delay', 'lexicon-pcm-42')
  matches('Lexicon PCM-60 Digital Reverberator', 'lexicon-pcm-60')
  matches('Lexicon PCM 70 Digital Effects Processor', 'lexicon-pcm-70')
  matches('Lexicon PCM80 Digital Effects Processor', 'lexicon-pcm-80')
  matches('Lexicon PCM 81 Digital Effects Processor', 'lexicon-pcm-81')
  matches('Lexicon PCM 90 Digital Reverb Processor', 'lexicon-pcm-90')
  matches('Lexicon PCM 91 Digital Reverberator', 'lexicon-pcm-91')
  matches('Lexicon PCM 92 Stereo Reverb Effect Processor 2022 - Silver', 'lexicon-pcm-92')
  matches('Lexicon PCM96 Stereo Reverb / Effects Processor', 'lexicon-pcm-96')
  matches('Lexicon PCM96 Surround', 'lexicon-pcm-96-surround')
  matches('Lexicon PCM 96 Surround D Digital AES/EBU I/O, XLR', 'lexicon-pcm-96-surround')
  matches('Lexicon PCM96 Surround Parallel Stereo & Surround Reverb/Effects Processor (Analog and Digital I/O) EXCELLENT+ CONDITION!', 'lexicon-pcm-96-surround')
  for (const t of [
    '12mm Gray Knob Cap with Line for Lexicon PCM41, PCM42, PCM-41, PCM-42 PCM 41 42',
    'PixelGear Black D-Shaft Knob with Red Cap for Lexicon PCM41, PCM42 PCM 41 42',
    'Lexicon - PCM 41/42/70 - 1/4 inch phone jack',
    'Lexicon PCM96 Surround , PCM96 and PCM92 (Lot for salvage / parts)',
    'Lexicon PCM Native Reverb Plug-In Bundle (Download)',
    'Lexicon PLPCMRB PCM Native Reverb Plug In Bundle',
    'Lexicon Pro PCM Native Effects Bundle Software 691991500442 MAC/PC',
    'Lexicon LXP Native Reverb Plug-In Bundle (Download)',
    'Lexicon Lxp Native Reverb',
    // A PCM 60 that names the 224 it sounds like: two units, no row.
    'Lexicon PCM 60 Reverb With 224 Sound',
    // Sony's PCM recorders and Roland's PCM cards are not Lexicon (DBA, 2026-10-21).
    'Sony PCM-D10 digital stereo recorder',
    'Roland SN‑U110‑08 – PCM expansionskort',
  ]) notOurs(t)
})

test('the Prime Time line: the Model 93, the II and the Super Prime Time apart', () => {
  matches('Lexicon Prime Time Digital Delay Model 93', 'lexicon-prime-time')
  matches('Lexicon  Prime time model 93 digital delay', 'lexicon-prime-time')
  matches('Lexicon Prime Time II Model 95 Digital Delay Processor', 'lexicon-prime-time-ii')
  matches('1980s Lexicon Prime Time II Model 95 Digital Delay Processor', 'lexicon-prime-time-ii')
  matches('Lexicon Prime Time II Model 95', 'lexicon-prime-time-ii')
  // Recall cost, accepted: the model name is one phrase, and this seller split it.
  notOurs('Lexicon Prime II Time Model 95 Digital Delay')
  matches('Lexicon Super Prime Time Model 97 Programmable Digital Delay Processor 1980s - Black', 'lexicon-super-prime-time')
  for (const t of [
    'Lexicon Model 93 Prime Time Power Transformer',
    'Lexicon Prime Time Digital Delay Model 93 Front Panel',
    'Lexicon Prime Time Digital Delay Model 93 Memory Expansion PCB',
  ]) notOurs(t)
})

test('the LXP and MX lines: siblings apart, the LXP-15 II by its mark, the MX400XL the MX400\'s row, the power supplies never', () => {
  matches('Lexicon LXP-1 rack effektprocessor til guitar/lyd', 'lexicon-lxp-1')
  matches('Lexicon LXP-1 Multi-Effects Processing Module', 'lexicon-lxp-1')
  matches('Lexicon LXP-5 Effects Processing Module', 'lexicon-lxp-5')
  matches('Lexicon LXP-15 Multi-Effects Processor', 'lexicon-lxp-15')
  matches('Lexicon LXP-15 Version II Multi-Effects Processor 1990s - Black', 'lexicon-lxp-15-ii')
  matches('Lexicon Lexicon LXP-15 II Digital Effects Processor - Rack Mount 1990\'s - Gray', 'lexicon-lxp-15-ii')
  matches('Lexicon MX200 Dual Reverb Effects Processor 2010s - Black', 'lexicon-mx200')
  matches('Lexicon MX200 (MX-200) Multi-Effects Processor FX Chorus Delay Reverb U288860', 'lexicon-mx200')
  matches('Lexicon MX200 Dual Reverb Effects Processor - Everything Included', 'lexicon-mx200')
  matches('Lexicon MX300 stereo reverb effektprocessor rack', 'lexicon-mx300')
  matches('Lexicon MX400 Dual Stereo / Surround Reverb Effects Processor', 'lexicon-mx400')
  // The MX400XL is the MX400's row (manager, 2026-10-21): glued through the identifier, spaced through the model name.
  matches('Lexicon MX400XL Dual Stereo / Surround Reverb Effects Processor 2010s - Blue', 'lexicon-mx400')
  matches('Lexicon MX400XL Multi Effects Rack 2017', 'lexicon-mx400')
  matches('Lexicon MX400 XL Dual Engine Reverb', 'lexicon-mx400')
  notOurs('Lexicon MX300 and MX400XL rack')
  for (const t of [
    '9VAC 1300mA AC Adapter Charger Replacement for Lexicon MX200 MPX100 JamMan MPX110 Dual Reverb,Digitech RP100 RP150 RP200 RP300 RP350 RP3 RP250 RP200A RP250 RP255 RP350 RP300A RP355 Effects Processor',
    '9Vac Adapter For Lexicon Mx200 Mpx100,Behringer Tube Ultragain Mic200 Mic100,Psu11-Ul U090075A Psu-Mini-Ul-01,Behringer Pro Nox101 Dj Mixer Behringer Miniamp Amp800,Digitech Vocal300 Vocalist Live4,5',
    'Power Supply Replacement for Lexicon Mx200 Adapter Uk 9V',
    'Lexicon MX200 Factory Original Power Supply AC/AC Wall Adapter | 9VAC 1.3A + 3VAC',
    // The MPX units have no row, and the 200 is not the MX200 or the MPX 200 (DBA, 2026-10-21).
    'Lexicon MPX 100 Dual Channel Processor',
    'Lexicon MPX 200 24-Bit Dual Channel Processor 2000s - Black',
    'Lexicon MS 200 Lexicon MS 200',
    'dbx, bbe, lexicon, boss, tascam 160x, 266xl, MPX100, MPX500, RV70, 482i, 112rmk2, 2231',
    // DBA, 2026-10-21: a Lexicon interface and a rack of 201s.
    'Lydkort, Lexicon IO 42',
    'Multiple 10 bits vintage digital Lexicon 201 Delaysc in racks',
  ]) notOurs(t)
  // A spaced "MX 200" is the MX200, never the Lexicon 200 (synthetic, the form sellers write for the MX300 on DBA).
  matches('Lexicon MX 200 dual reverb', 'lexicon-mx200')
  // The 200 itself still names its row.
  matches('Lexicon Model 200 Digital Reverberator 1980s - Black', 'lexicon-200')
  matches('Lexicon 200 reverb needs service', 'lexicon-200')
})

test('a bundle with another maker\'s unit names no Lexicon row (DBA, 2026-10-21)', () => {
  notOurs('Kemper Profiler rack guitar preamp / effektprocessor + Lexicon PCM 90 effekt')
  notOurs('Studio Rolling Rack — XV-5080, E-MU, Lexicon, Line 6, Furman, Roland M-160')
})

test('the SDD line: the SDD-3000 rack takes a bare SDD-3000, the pedal its word or code; SDD-1000 and SDD-2000 apart', () => {
  // DBA, 2026-10-21.
  matches('Korg SDD-3000 digital delay rackeffekt', 'korg-sdd-3000-rackmount')
  matches('SDD 3000 Korg Delay,', 'korg-sdd-3000-rackmount')
  matches('Korg SDD-3000 programmable digital delay effektpedal', 'korg-sdd-3000-pedal')
  matches('Korg SDD-3000 Programmable Digital Delay Effektpedal', 'korg-sdd-3000-pedal')
  matches('Korg SDD 1000', 'korg-sdd-1000')
  // Reverb, production and sold.
  matches('Korg SDD-3000 Rack Mount Digital Delay  1980\'s Black', 'korg-sdd-3000-rackmount')
  matches('Vintage 1983 Korg SDD-3000 Rack  Digital Delay Echo Chorus Flanger Doubling  TOP', 'korg-sdd-3000-rackmount')
  matches('KORG SDD-3000 Digital Delay  (Rack), The Edge, Daniel Lanois', 'korg-sdd-3000-rackmount')
  matches('Korg SDD 3000 Digital Delay Pedal', 'korg-sdd-3000-pedal')
  matches('Korg SDD-3000-PDL Programmable Digital Delay Pedal 2010s - Black', 'korg-sdd-3000-pedal')
  matches('Korg SDD-3000-PDL MIDI vintage Digital Delay Pedal', 'korg-sdd-3000-pedal')
  matches('Used Korg SDD-3000-PDL Programmable Digital Delay Pedal TSU26422', 'korg-sdd-3000-pedal')
  matches('Korg SDD-3000 Programmable Digital Delay Pedal (SDD3000)', 'korg-sdd-3000-pedal')
  matches('Korg SDD-1000 Digital Delay Line', 'korg-sdd-1000')
  matches('Korg digital delay sdd-1000', 'korg-sdd-1000')
  matches('Korg SDD-2000', 'korg-sdd-2000')
  matches('Korg SDD-2000 2000s - Black', 'korg-sdd-2000')
  matches('KORG DL8000R Digital Multi Tap Delay Rack Effect', 'korg-dl8000r')
  matches('Korg DL8000r Stereo Multi-tap Digital Delay', 'korg-dl8000r')
  for (const t of [
    // Parts, papers and power.
    'Korg - SDD-2000 , N364 - Battery',
    '5x tactile switch for Korg SDD-3000, SDD-2000, Roland Fantom MC307',
    'Korg - C303, C505 , DRV2000 , M1 , M1R , M3R  , SDD1000 - Power Switch',
    'Korg - Polysix , Korg Poly61 , Poly-61M , SDD3000 - Battery',
    'KORG Legacy Manuals/Brochures (M1Rex/SDD-2000/VC-10) Mac/PC DVD',
    'Korg SDD-1000 / 3000 / 3300 Digital Delay Service Manuals 1980S',
    'Korg SDD-3000 Service Manual',
    'Power Supply Replacement for KORG SDD-3000 GUITAR EFFECTS PEDAL ADAPTER 9V',
    // Copies and cousins.
    'DTS Audio Technology and Research SDD 3KP (Korg SDD-3000 Preamp)',
    'DTS SDD-3KP Pre-Amplifier (based on the Korg SDD-3000)',
    'DTS Audio Research & Technology SDD-3KP preamp pedal til guitar',
    'Korg SDD-1200 Vintage Digital Delay Rack (Sdd-3000\'s Hot Cousin)',
  ]) notOurs(t)
})

test('"SDD" is not "SD", not Roland\'s SDE and not Roland\'s SDD-320', () => {
  for (const t of [
    'KORG SD-400 Signal Delay Analog BBD MN3005 Vintage Made in Japan',
    'Korg SD-200 Signal Delay 1980s Silver Lo-Fi Sound',
    'Korg Electribe ESX-SD 2000s - Red',
    'Roland SDE-3000 Digital Delay 1980s - Black',
    'Roland SDE-3000A Digital Delay 1983 - 1994 - Black TGHM',
    'Roland SDE-3000 Digital Delay sdd3000',
    'Boss SDE-3000D Dual Digital Delay Pedal',
    'Roland - SDE-1000/3000 , D110 , HP-126 , HP-800 , MKS-30 - New Power Switch',
  ]) notOurs(t)
  matches('Roland SDD-320 Dimension D - Great condition', 'roland-sdd-320-dimension-d')
})
