/**
 * scripts/lib/pan249-studio.test.ts
 *
 * PAN-249: the studio-gear pass. Thirteen rows become match targets (ten created with a verified Reverb CSP on
 * 2026-10-07, three that existed as `known`); the boundaries are measured on every active title naming the model
 * (read-only snapshot 2026-10-07): the classic LA-610 must not take the MkII's 57 titles, the Solina must not take
 * its parts trade, the Clariphonic must not take the 500-series module or the MS, the Fairchild 670 must not take
 * the Stam Audio clones, and the bare-number Lexicon 200 must not take an MPX 200. Every title is a production title
 * except the Reverb page titles that stand in for the units no live title names yet.
 *
 * Run: npx tsx --test scripts/lib/pan249-studio.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'
import studioConfig from '../rematch-configs/pan249-studio'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

const PRODUCTS: Product[] = [
  row('ua-la-4', 'universal audio', 'Universal Audio LA-4', 'LA-4'),
  row('ua-la-610', 'universal audio', 'Universal Audio LA-610', 'LA-610'),
  row('ua-la-2a', 'universal audio', 'Universal Audio LA-2A', 'LA-2A'),
  row('lexicon-200', 'lexicon', 'Lexicon 200', '200'),
  row('roland-dep-5', 'roland', 'Roland DEP-5', 'DEP-5'),
  row('ssl-xlogic-multichannel-compressor', 'ssl', 'SSL XLogic Multichannel Compressor', 'XLogic Multichannel Compressor'),
  row('ssl-xlogic-alpha-vhd-pre', 'ssl', 'SSL XLogic Alpha VHD Pre', 'XLogic Alpha VHD Pre'),
  row('altec-436', 'altec', 'Altec 436', '436'),
  row('focusrite-red-3', 'focusrite', 'Focusrite Red 3', 'Red 3'),
  row('anthony-demaria-labs-adl-1500', 'anthony demaria labs', 'Anthony DeMaria Labs ADL 1500', 'ADL 1500'),
  row('amek-9098-eq', 'amek', 'Amek 9098 EQ', '9098 EQ'),
  row('joemeek-sc2', 'joemeek', 'Joemeek SC2', 'SC2'),
  row('arp-solina-string-ensemble', 'arp', 'ARP Solina String Ensemble', 'Solina String Ensemble'),
  row('fairchild-670', 'fairchild', 'Fairchild 670', '670'),
  row('kush-clariphonic', 'kush audio', 'Kush Audio Clariphonic', 'Clariphonic'),
]
const BRANDS = new Set(['universal audio', 'lexicon', 'roland', 'ssl', 'altec', 'focusrite', 'anthony demaria labs', 'amek', 'joemeek', 'arp', 'fairchild', 'kush audio', 'behringer', 'stam audio', 'retro instruments'])
const index = buildMatchIndex(PRODUCTS, [], [], BRANDS)

const decide = (title: string) => {
  const d = decideMatch(title, index)
  if (d.kind === 'matched') return `matched:${index.productById.get(d.best.product_id)?.slug}`
  if (d.kind === 'deferred') return `deferred:${d.reason}`
  return d.kind
}
const matched = (title: string, slug: string) => assert.equal(decide(title), `matched:${slug}`, title)
const notMatched = (title: string, slug: string) => assert.notEqual(decide(title), `matched:${slug}`, title)

test('PAN-249: the classic LA-610 never takes a MkII title', () => {
  matched('Universal Audio LA-610 Tube Channel Strip', 'ua-la-610')
  for (const t of [
    'Universal Audio LA-610 MkII Tube Channel Strip 2008 - Present - Black',
    'Universal Audio LA-610 Mk II Classic Tube Recording Channel Regular',
    'Universal Audio LA-610 Mk2 Classic Tube Recording Channel',
    'Universal Audio LA610 MKII Classic Tube Recording Channel',
    'Universal Audio LA 610 MKII Mic Pre Compressor Channel Strip',
    'Universal Audio Classic LA-610 Mk II 2025 - Black',
    'Universal Audio LA-610 MKII - Mackie Big Knob - XLR to 1/4 Cable (2)',
  ]) notMatched(t, 'ua-la-610')
})

test('PAN-249: the Solina keeps its units and refuses its parts trade, the manuals and the Behringer', () => {
  matched('ARP Solina String Ensemble Polyphonic Analog Synthesizer 1974 - 1979', 'arp-solina-string-ensemble')
  matched('ARP / Solina String ensemble 1975-1980 - black', 'arp-solina-string-ensemble')
  // An inclusion marker keeps the accessory noun from refusing the instrument.
  matched('ARP Solina String Ensemble 1970s Wood - OG Volume Pedal Included', 'arp-solina-string-ensemble')
  for (const t of [
    'Arp / Solina String Ensemble slidercap',
    'Solina String Ensemble - ARP - Button Caps',
    'Solina String Ensemble - ARP - On/Off Switch',
    'Arp / Solina  String Ensemble powerswitch',
    'Solina String Ensemble - ARP - tuning knob',
    'Solina String Ensemble - ARP - replacement keys',
    'ARP/EMINENT Solina Power Transformer',
    'ARP / Solina String Ensemble Service Manual',
    'ARP - Odyssey Mk 2 , Soloist , Quartet , Solina , Pro-DGX - Phone jack',
  ]) notMatched(t, 'arp-solina-string-ensemble')
  // Behringer is a catalogue brand: its unit is never the ARP's (deferred as brand_mismatch where a Behringer row exists).
  assert.ok(!decide('Behringer Solina String Ensemble 49-Voice Synthesizer 2023 - Present - Black').startsWith('matched:'))
})

test('PAN-249: the Clariphonic Dual-Channel refuses the 500-series module and the MS', () => {
  matched('Kush Audio Clariphonic Parallel Equalizer EQ Rack Module with Box', 'kush-clariphonic')
  matched('Kush Audio UBK Clariphonic', 'kush-clariphonic')
  for (const t of [
    'Kush Audio Clariphonic 500 Series Parallel Equalizer Module 2010s - Black',
    'Kush Clariphonic 500',
    'Kush Audio Clariphonic MS Dual-Channel Parallel Equalizer 2010s - Brown / Black',
  ]) notMatched(t, 'kush-clariphonic')
})

test('PAN-249: the Fairchild 670 refuses the clones and the tubes sold for it', () => {
  matched('Fairchild 670 Compressor / Limiter *Holy Grail*Serviced*Guaranteed*', 'fairchild-670')
  for (const t of [
    'Stam Audio SA-670 MkI StamChild Vari-MU tube Compressor limiter - Fairchild 670 mastering mk 1 I',
    'Stamchild 670 Mk2 Fairchild style vari mu compressor',
    'Extremely rare NOS GE General Electric 6386 BLACK PLATE disc getter made for RCA matched pair !  for FAIRCHILD 660 670, Gates, Collins, STA level  etc',
  ]) notMatched(t, 'fairchild-670')
})

test('PAN-249: the bare-number Lexicon 200 refuses the MPX 200 and the MX200', () => {
  matched('Lexicon Model 200 Digital Reverberator', 'lexicon-200')
  notMatched('Lexicon MPX 200 24-Bit Dual Channel Processor', 'lexicon-200')
  notMatched('Lexicon MX200 Dual Reverb Effects Processor', 'lexicon-200')
})

test('PAN-249: the rows with no live demand still resolve their own Reverb titles', () => {
  // "Urei" is not a catalogue brand, so a Urei-branded title carries no brand evidence for the Universal Audio row
  // and defers; an alias row ("Urei LA-4") is the fix once a live title demands it (none today).
  assert.equal(decide('Urei LA-4 Compressor Limiter'), 'deferred:low_confidence')
  matched('Universal Audio LA-4 Compressor Limiter', 'ua-la-4')
  matched('Roland DEP-5 Digital Effects Processor', 'roland-dep-5')
  matched('Focusrite Red 3 Dual Compressor / Limiter', 'focusrite-red-3')
  matched('Anthony DeMaria Labs ADL 1500 Stereo Tube Compressor / Limiter', 'anthony-demaria-labs-adl-1500')
  matched('AMEK System 9098 EQ Mic Preamp with Equalizer', 'amek-9098-eq')
  matched('Joemeek SC2.2 Photo Optical Stereo Compressor', 'joemeek-sc2')
  matched('SSL XLogic Multichannel Compressor (2004 - 2011)', 'ssl-xlogic-multichannel-compressor')
  // The Alpha VHD Pre shares "XLogic" and stays its own row.
  matched('Solid State Logic SSL XLogic Alpha VHD Pre 4-Ch Mic Pre - Excellent!', 'ssl-xlogic-alpha-vhd-pre')
  // A clone that references the 436 is not the unit.
  notMatched('Retro Instruments Revolver Dual-channel Tube Compressor based Altec 436', 'altec-436')
})

test('PAN-249: the re-match config names the thirteen promoted rows and its lines find their titles', () => {
  assert.equal(studioConfig.promoted.length, 13)
  assert.ok(!studioConfig.promoted.includes('dbx-160'), 'dbx-160 stays known until the owner splits it')
  for (const slug of studioConfig.promoted) assert.ok(PRODUCTS.some((p) => p.slug === slug), slug)
  const hits: Record<string, string> = {
    'la-4': 'Urei LA-4 Compressor Limiter', 'la-610': 'Universal Audio LA610 MKII Classic Tube Recording Channel',
    'lexicon-200': 'Lexicon Model 200 Digital Reverberator', 'dep-5': 'Roland DEP 5 Digital Effects Processor',
    'xlogic-multichannel': 'SSL XLogic Multichannel Compressor', 'altec-436': 'AMPTEK AT-24C Vari-Mu Compressor (EMI Chandler RS124 / ALTEC 436C)',
    'red-3': 'Focusrite Red 3 Dual Compressor / Limiter', 'adl-1500': 'Anthony DeMaria Labs ADL 1500 Stereo Tube Compressor / Limiter',
    '9098': 'Neve 9098 Console Manual Neve 9098 analog era - white binder', 'sc2': 'Joemeek SC2.2 Photo Optical Stereo Compressor',
    'solina': 'Behringer Solina String Ensemble', '670': 'Stamchild 670 Mk2 Fairchild style vari mu compressor', 'clariphonic': 'Kush Clariphonic 500',
  }
  for (const l of studioConfig.lines) assert.ok(l.names.test(hits[l.line]), l.line)
  assert.ok(!studioConfig.lines.find((l) => l.line === 'la-4')!.names.test('ORIGINAL Sanyo LA4140 Headphone Amplifier IC for Roland TB-303, TR-606'))
})
