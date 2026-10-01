/**
 * scripts/lib/pan205-line-boundaries.test.ts
 *
 * PAN-205: the SSL (Solid State Logic) rows the promote SQL moves to `supported` (the 14 known model
 * rows and the 4 step-2 models), with the model names and spelling aliases the promote SQL sets. One
 * test per hazard class, on production titles (read-only snapshot 2026-10-01) unless marked
 * synthetic. The generation, short-word, parts and quantity tests fail on origin/main's matcher; the
 * plain-title test passes there and guards against this change refusing too much.
 *
 * Run: npx tsx --test scripts/lib/pan205-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, lineBoundaryRefusal, type Product } from '../../frontend/lib/matching/match-listings'

const ssl = (slug: string, model_name: string, canonical_name = `SSL ${model_name}`): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name: 'ssl', status: 'active', support_state: 'supported',
})

// Model names as the promote SQL leaves them (decision 6: "SSL 2" / "SSL 12" / "SSL 18" / "SSL 2 MKII").
const SSL = [
  ssl('ssl-2', 'SSL 2', 'SSL 2'),
  ssl('ssl-2-mkii', 'SSL 2 MKII', 'SSL 2 MKII'),
  ssl('ssl-2-plus', 'SSL 2+', 'SSL 2+'),
  ssl('ssl-2-plus-mkii', 'SSL 2+ MKII', 'SSL 2+ MKII'),
  ssl('ssl-12', 'SSL 12', 'SSL 12'),
  ssl('ssl-18', 'SSL 18', 'SSL 18'),
  ssl('ssl-uf1', 'UF1'),
  ssl('ssl-uf8', 'UF8'),
  ssl('ssl-uc1', 'UC1'),
  ssl('ssl-b-dyn', 'B-Dyn'),
  ssl('ssl-six', 'SiX'),
  ssl('ssl-six-channel', 'SiX Channel'),
  ssl('ssl-big-six', 'Big Six', 'SSL BiG SiX'),
  ssl('ssl-fusion', 'Fusion'),
  ssl('ssl-ultraviolet-eq', 'UltraViolet EQ'),
  ssl('ssl-vhd', 'VHD+'),
  ssl('ssl-vhd-pre', 'VHD Pre'),
  ssl('ssl-xlogic-alpha-vhd-pre', 'XLogic Alpha VHD Pre'),
]
const OTHERS: Product[] = [
  { id: 'p-moog-sonic-six', slug: 'moog-sonic-six', canonical_name: 'Moog Sonic Six', model_name: 'Sonic Six', brand_name: 'moog', status: 'active', support_state: 'supported' },
]
// A sample of the spelling aliases the promote SQL adds (canonical_query = the slug), measured on the snapshot.
const synonyms = [
  { alias: 'SSL2', canonical_query: 'ssl-2' },
  { alias: 'SSL2 MKII', canonical_query: 'ssl-2-mkii' },
  { alias: 'SSL2+', canonical_query: 'ssl-2-plus' },
  { alias: 'SSL 2 Plus', canonical_query: 'ssl-2-plus' },
  { alias: 'SSL2+ MKII', canonical_query: 'ssl-2-plus-mkii' },
  { alias: 'SSL 2 Plus MKII', canonical_query: 'ssl-2-plus-mkii' },
  { alias: 'SSL12', canonical_query: 'ssl-12' },
  { alias: 'SSL18', canonical_query: 'ssl-18' },
  { alias: 'Solid State Logic UF8', canonical_query: 'ssl-uf8' },
  { alias: 'Solid State Logic UC1', canonical_query: 'ssl-uc1' },
  { alias: 'Solid State Logic SiX', canonical_query: 'ssl-six' },
  { alias: 'Solid State Logic SiX CH', canonical_query: 'ssl-six-channel' },
  { alias: 'SSL SiX CH', canonical_query: 'ssl-six-channel' },
  { alias: 'Solid State Logic BiG SiX', canonical_query: 'ssl-big-six' },
  { alias: 'Solid State Logic Fusion', canonical_query: 'ssl-fusion' },
  { alias: 'Solid State Logic VHD+', canonical_query: 'ssl-vhd' },
  { alias: 'Solid State Logic VHD Pre', canonical_query: 'ssl-vhd-pre' },
  { alias: 'Solid State Logic XLogic Alpha VHD Pre', canonical_query: 'ssl-xlogic-alpha-vhd-pre' },
]
const BRANDS = ['ssl', 'moog', 'sequential', 'alesis', 'neve', 'api', 'warm audio']
const index = buildMatchIndex([...SSL, ...OTHERS], [], synonyms, BRANDS)

function slugOf(title: string): string | null {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug ?? null : null
}
function expect(cases: Array<[string, string | null]>): void {
  for (const [title, slug] of cases) assert.equal(slugOf(title), slug, title)
}

test('plain titles reach their row (passes on origin/main for the 70-tier names; guards against refusing too much)', () => {
  expect([
    ['Solid State Logic SSL UF8 DAW Controller 2021 - Present - Black', 'ssl-uf8'],
    ['Solid State Logic SSL UC1 DAW Controller 2021 - Present - Black', 'ssl-uc1'],
    ['Solid State Logic SSL UF1 DAW Controller 2023 - Black', 'ssl-uf1'],
    ['Solid State Logic SSL B-Dyn 500-Series Dynamics Module 2023 - Black', 'ssl-b-dyn'],
    ['Solid State Logic SSL VHD+ Pre 500-Series Microphone Preamp 2021 - Present - Black', 'ssl-vhd'],
    // "1 of 2" is one unit of a split sale.
    ['Solid State Logic SSL B-DYN 500 Dynamics Compressor 1 of 2', 'ssl-b-dyn'],
  ])
})

test('SSL 2 generations: a bare "SSL 2" is the MkI; "+", "Plus" and MKII go to their own rows (decision 2)', () => {
  expect([
    ['Solid State Logic SSL 2 USB Audio Interface 2020 - Present - Black', 'ssl-2'],
    ['Solid State Logic SSL2 USB Audio Interface', 'ssl-2'],
    ['Solid State Logic SSL2 MKII USB Audio Interface 2024 - Present - Black', 'ssl-2-mkii'],
    ['Solid State Logic SSL 2 MKII - 2x2 USB Audio Interface', 'ssl-2-mkii'],
    ['Solid State Logic SSL 2 MKII 2 x 2 USB-C Audio Interface', 'ssl-2-mkii'],
    ['Solid State Logic SSL 2+ USB Audio Interface 2020 - Present - Black', 'ssl-2-plus'],
    ['Solid State Logic SSL2+ USB Audio Interface - 2nd Hand (169924)', 'ssl-2-plus'],
    ['Solid State Logic SSL2+ MkII USB Audio Interface 2024 - Present - Black', 'ssl-2-plus-mkii'],
    ['Solid State Logic SSL 2 Plus MKII USB Audio Interface with Dual Headphones', 'ssl-2-plus-mkii'],
    // "MK11" is a typo for MKII: never the MkI.
    ['Solid State Logic SSL 2 MK11 USB Audio Interface', null],
  ])
  assert.ok(lineBoundaryRefusal('solid state logic ssl 2+ usb audio interface', 'ssl-2'))
  assert.ok(lineBoundaryRefusal('solid state logic ssl 2 plus mkii', 'ssl-2-plus'))
})

test('short numeric names reach their rows only with SSL named: "SSL 12", "SSL12", "SSL18"', () => {
  expect([
    ['Solid State Logic SSL 12 12-Channel USB Audio Interface 2023 - Black', 'ssl-12'],
    ['Solid State Logic SSL12 BRAND NEW 2025', 'ssl-12'],
    ['Solid State Logic SSL18 USB Audio Interface 2025 - Present - Black', 'ssl-18'],
    // Seymour Duncan's Strat pickups are named SSL-1 … SSL-7.
    ['Seymour Duncan Ssl 2 Vntg Flat For Strat Rwrp', null],
    ['Seymour Duncan SSL-2 Vintage Flat Strat pickup', null],
    // An SSL 18 sold with an ALPHA 8 is two products.
    ['Solid State Logic SSL 18 and Alpha 8 Audio Interface Combo 16 Channel', null],
  ])
})

test('SiX is a number word: Moog Sonic Six, Six-Trak and the SiX Channel module never land on the mixer', () => {
  expect([
    ['Solid State Logic SiX 4-Channel Analog Mixer 2019 - Present - Black', 'ssl-six'],
    ['SSL SiX Six-Channel Small Format Desktop Mixer with Two SuperAnalogue Preamps', 'ssl-six'],
    ['Solid State Logic SiX 6-Channel SuperAnalogue Desktop Mini Mixer', 'ssl-six'],
    ['Moog Sonic Six 1972 - 1979 - Blue', 'moog-sonic-six'],
    ['Sequential Circuits Six-Trak 1984 analog synth', null],
    ['Solid State Logic SiX CH 500-Series Channel Strip Module 2021 - Present - Black', 'ssl-six-channel'],
    ['SSL SiX CH 500 Series Channel Strip with Mic Preamp, EQ, Single Knob Compressor', 'ssl-six-channel'],
    ['Solid State Logic BiG SiX 6-Channel Analog Mixer 2022 - Present - Black', 'ssl-big-six'],
  ])
})

test('Fusion is a common word and needs SSL named; a UV EQ or a Fusion/Bus+ combo is not the Fusion', () => {
  expect([
    ['Solid State Logic Fusion Rackmount Audio Processor 2018 - Present - Black', 'ssl-fusion'],
    ['Solid State Logic Fusion Stereo Processor Six Analog Colors and Limitless Sonic Flavors', 'ssl-fusion'],
    ['Jazz, Fusion, Soul, Rock.', null],
    ['Alesis Fusion 8HD', null],
    ['SSL UVEQ UltraViolet Fusion 500 Series Stereo Equalizer (Demo / Open Box)', null],
    ['SSL Fusion/Bus Plus Combo', null],
  ])
})

test('VHD generations: VHD Pre (2015–20), VHD+ (2021–) and the XLogic Alpha VHD Pre rack stay apart', () => {
  expect([
    ['Solid State Logic VHD Pre 500-Series Microphone Preamp 2015 - 2020 - Black', 'ssl-vhd-pre'],
    ['Solid State Logic XLogic Alpha VHD Pre 4-Channel Microphone Preamp 2007 - 2020 - Silver', 'ssl-xlogic-alpha-vhd-pre'],
    // A 2021-on year is the VHD+ without its "+": not the VHD Pre.
    ['Solid State Logic SSL VHD Pre 500-Series Microphone Preamp 2021 - Present - Black', null],
    ['SSL Solid State Logic Alpha XLogic VHD Channel Preamp +OVP WieNeu+ 1,5J Garantie', null],
    ['Solid State Logic VHD Pre - 611EQ - 611DYN 2024', null],
    ['8 Channels of SSL VHD+ Mic Pres, 2 Channels of SSL Comp, rack-ready in a Rupert Neve Designs Lunchbox', null],
  ])
})

test('SSL part numbers are not quantities; real counts and controller sets are refused', () => {
  expect([
    ['Solid State Logic VHD+ Pre Module Uniquely Versatile VHD Based Preamp Technology, 729731X2', 'ssl-vhd'],
    ['Solid State Logic UF8 Advanced DAW Controller, 726490X3', 'ssl-uf8'],
    // synthetic: the SKU written apart from its digits
    ['Solid State Logic SSL UF1 DAW Controller 726570 X2 Factory Sealed', 'ssl-uf1'],
    ['2 x Solid State Logic SSL B-Dyn 500-Series Dynamics Module', null],
    ['Two SSL SiX Ch Modules', null],
    ['FOUR (4) Solid State Logic SiX CH 500-Series Channel Strip Modules (pristine and completely unused)', null],
    ['Solid State Logic UF8/uc1/uf1', null],
    ['Solid State Logic UF8 + UC1 + UF1 Bundle - OPEN BOX', null],
    // "incl 2 SSL Plugins" and "8 SSL Preamps" count plug-ins and preamps, not units.
    ['Solid State Logic SSL UC1 DAW Controller incl 2 SSL Plugins', 'ssl-uc1'],
    ['Solid State Logic SSL18 USB-C Audio Interface – 8 SSL Preamps, Boxed', 'ssl-18'],
  ])
})

test('accessories and things made FOR an SSL product never land on it; the product with extras still does', () => {
  expect([
    ['Decksaver Solid State Logic Big Six Cover', null],
    ['Solid State Logic BiG SiX Rack Mount Kit', null],
    ['Bazel Studio Desk SSL Two UF8\'s, One UF1 Controllers with One Rack Side - Black', null],
    ['BSD DESK FOR SSL UF8 - UF1 Controllers', null],
    ['SSL UC1 - Tablet  Mount Brackets', null],
    ['Solid State Logic SiX Carry Case', null],
    ['STAND for Solid State Logic SSL 12 Audio Interface - 30° - Raised', null],
    ['SSL UF8 Desktop Enclosure', null],
    ['Solid State Logic UC1 Advanced Plug-In Controller with Decksaver DS-PC-SSLUC1 Polycarbonate Cover and UC1 Rack Kit', 'ssl-uc1'],
    // "plug-in" is how SSL names the UC1 hardware: never a part word here.
    ['SSL UC1 Hardware Plug-in Controller for Native Channel Strip 2, Bus Compressor 2', 'ssl-uc1'],
  ])
})

test('every SSL row requires SSL named: a bare model, or "Solid State" alone, is not evidence', () => {
  expect([
    ['UltraViolet EQ - 4 Band Stereo Equalizer', null],
    ['VHD+ Pre Module - Uniquely Versatile VHD Based Preamp Technology', null],
    ['Big Six', null],
  ])
  assert.equal(lineBoundaryRefusal('roland cube lite solid state guitar amp uf8', 'ssl-uf8'), 'no_member_cue')
  assert.equal(lineBoundaryRefusal('sol id state logic uf8', 'ssl-uf8'), null)
  assert.equal(lineBoundaryRefusal('ssl solid stage logic big six analog recording usb mixer', 'ssl-big-six'), null)
})
