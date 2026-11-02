/**
 * scripts/lib/pan315-sp-dr.test.ts
 *
 * PAN-315: the Roland SP samplers and the Boss DR drum machines. Seventeen rows are match targets once the PAN-315 SQL
 * files run: the Boss SP-202, SP-303 and SP-505 (known since the KG import), the Roland SP-555, SP-606 and SP-808, and
 * the Boss DR-55, DR-110, DR-220, DR-550, DR-660, DR-5, DR-770, DR-202, DR-670, DR-3 and DR-880. Price decides identity
 * (Reverb's sold population, 2026-11-02): the SP-808EX, the DR-220A / DR-220E and the DR-550 MkII are their base row's.
 * Every title is a production title (SELECT, 2026-11-02) unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan315-sp-dr.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import config from '../rematch-configs/pan315-sp-dr'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-315 files make a match target, with the model names the create / identity files leave or set. */
const PRODUCTS: Product[] = [
  row('boss-sp-202-dr-sample', 'boss', 'BOSS SP-202 Dr. Sample', 'SP-202'),
  row('boss-sp-303-dr-sample', 'boss', 'BOSS SP-303 Dr. Sample', 'SP-303'),
  row('boss-sp-505', 'boss', 'BOSS SP-505', 'SP-505'),
  row('roland-sp-555', 'roland', 'Roland SP-555', 'SP-555'),
  row('roland-sp-606', 'roland', 'Roland SP-606', 'SP-606'),
  row('roland-sp-808', 'roland', 'Roland SP-808', 'SP-808'),
  row('boss-dr-55-dr-rhythm', 'boss', 'BOSS DR-55 Dr. Rhythm', 'DR-55'),
  row('boss-dr-110-dr-rhythm', 'boss', 'BOSS DR-110 Dr. Rhythm', 'DR-110'),
  row('boss-dr-220-dr-rhythm', 'boss', 'BOSS DR-220 Dr. Rhythm', 'DR-220'),
  row('boss-dr-550', 'boss', 'Boss DR-550 Dr. Rhythm', 'DR-550'),
  row('boss-dr-660', 'boss', 'Boss DR-660 Dr. Rhythm', 'DR-660'),
  row('boss-dr-5', 'boss', 'Boss DR-5 Dr. Rhythm Section', 'DR-5'),
  row('boss-dr-770', 'boss', 'Boss DR-770 Dr. Rhythm', 'DR-770'),
  row('boss-dr-202-dr-groove', 'boss', 'BOSS DR-202 Dr. Groove', 'DR-202'),
  row('boss-dr-670', 'boss', 'Boss DR-670 Dr. Rhythm', 'DR-670'),
  row('boss-dr-3', 'boss', 'Boss DR-3 Dr. Rhythm', 'DR-3'),
  row('boss-dr-880', 'boss', 'Boss DR-880 Dr. Rhythm', 'DR-880'),
  // The rows production holds that these titles could stray onto.
  row('roland-sp-404', 'roland', 'Roland SP-404', 'SP-404'),
  row('roland-sp-404sx', 'roland', 'Roland SP-404SX', 'SP-404SX'),
  row('roland-tr-626', 'roland', 'Roland TR-626', 'TR-626'),
  row('emu-sp-1200', 'e-mu', 'E-mu SP-1200', 'SP-1200'),
]

/** The MODEL identifiers the PAN-315 identity file writes: the variants price folds into their base row. */
const M = (slug: string, ...values: string[]) => values.map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value }))
const IDENTS = [...M('boss-dr-220-dr-rhythm', 'DR-220A', 'DR-220E'), ...M('roland-sp-808', 'SP-808EX', 'SP808EX')]

const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['boss', 'roland', 'e-mu', 'akai', 'korg', 'alesis', 'kawai'])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (slug: string, titles: string[]) => { for (const t of titles) assert.equal(decide(t), slug, t) }
const notOn = (titles: string[]) => {
  const ours = [...config.promoted, ...config.supportedToday]
  for (const t of titles) { const d = String(decide(t)); assert.ok(!ours.includes(d), `${t} → ${d}`) }
}

test('every row has a boundary, the config lists 12 + 5 rows, and the three families hold all 17', () => {
  assert.equal(config.promoted.length, 12)
  assert.equal(new Set([...config.promoted, ...config.supportedToday]).size, 17)
  const fam = (slug: string) => NAVIGATION_FAMILIES.find((f) => f.slug === slug)!
  const children = ['boss-dr', 'boss-sp', 'roland-sp'].flatMap((f) => fam(f).children)
  assert.deepEqual([...children].sort(), [...config.promoted, ...config.supportedToday].sort())
  for (const slug of children) {
    assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
    assert.ok(PRODUCTS.some((p) => p.slug === slug), `${slug} is not in the fixture`)
  }
  // The SP-404 family is the owner's and stays as it was.
  assert.deepEqual(fam('roland-sp-404-sampler').children, ['roland-sp-404', 'roland-sp-404sx', 'roland-sp-404a', 'roland-sp-404-mkii'])
})

test('the SP line: each code reaches its row, the SP-808EX is the SP-808, and the SP-404 keeps its own rows', () => {
  matches('boss-sp-202-dr-sample', [
    'Boss SP-202 Dr. Sample 1998 - 2001 - Black', 'Boss (Roland) SP-202 Dr Sample Sampler', 'Boss SP-202',
    'BOSS SP-202 Dr. Sample Sampler Looper Drum Machine Roland sp202 !', 'Boss SP-202 Sampler w/ 2MB memory card',
    'Boss SP-202 Dr. Sample 1998 - 2001 - Black **Memory Card Included**', 'Boss SP-202 Dr. Sample lo-fi sampler with instruction manual',
  ])
  matches('boss-sp-303-dr-sample', ['Boss SP-303 Dr. Sample 2001 - 2005 - Silver', 'Boss Dr Sample SP-303 2001', 'Boss SP-303 Dr. Sample w/ Smart media Card'])
  matches('boss-sp-505', ['Boss SP-505 Groove Sampling Workstation 2000s - Silver', 'Boss SP-505 With Smart Media Card'])
  matches('roland-sp-808', [
    'Roland SP-808 Groove Sampler 2000s - Black', 'Roland SP 808 Groove Sampler',
    'Roland SP-808EX e-MIX Studio Phrase Sampling Workstation 2000s - Red', 'Roland e-Mix Studio SP808EX',
  ])
  // Synthetic: no production title names the SP-555 or SP-606 unit yet (Reverb sold titles, 2026-11-02).
  matches('roland-sp-555', ['Roland SP-555 Sampler'])
  matches('roland-sp-606', ['Roland SP-606 Sampling Workstation'])
  matches('roland-sp-404sx', ['ROLAND SP-404 SX Dr. Sample Sampler SP-404SX BOSS w/ SD, 100-240V SPU'])
})

test('the DR line: each code reaches its row, never its neighbour (DR-5 / DR-55 / DR-550), and the variants are one row', () => {
  matches('boss-dr-55-dr-rhythm', ['Boss DR-55 Dr. Rhythm 1980 - 1983 - Black', 'BOSS Dr-55 Dr. Rhythm Vintage Analog Drum Machine Roland'])
  matches('boss-dr-110-dr-rhythm', [
    'Boss DR-110 Dr. Rhythm 1980s - Silver', 'Boss Dr 110 Dr. Rhythm Graphic Drum M ACH Ine   1980\'s', 'Boss Dr.Rhythm Graphic DR-110 Used',
    'PRO SERVICED - Boss DR-110 Dr. Rhythm w/ Original Case', 'Boss DR-110 - Drum Machine - Case Included - Manual Included - Tested',
  ])
  matches('boss-dr-220-dr-rhythm', [
    'Boss DR-220 Dr. Rhythm', 'Boss  Dr. Rhythm DR-220 A', 'Boss DR-220A Dr. Rhythm 1986 - 1990 - Black',
    'Boss DR-220E Dr. Rhythm 1986 - 1990 - Silver', 'Boss DR-220A - Vintage Dr. Rhythm Drum Machine - Original Case included - Tested',
  ])
  matches('boss-dr-550', ['Boss DR-550 MKII trommemaskine sort'])
  matches('boss-dr-880', ['BOSS Dr. Rhythm DR-880', 'BOSS DR-880 trommemaskine'])
  matches('boss-dr-3', ['Boss DR-3 Dr. Rhythm trommemaskine'])
  matches('boss-dr-202-dr-groove', ['Boss DR-202 Groove box', 'Boss DR-202 Dr. Groove - Black w/ Power Supply'])
  // Synthetic, the neighbours: a code is never a shorter or longer one.
  matches('boss-dr-5', ['Boss DR-5 Dr. Rhythm Section'])
  matches('boss-dr-550', ['Boss DR-550 Dr. Rhythm'])
  matches('boss-dr-660', ['Boss DR-660 Dr. Rhythm'])
  matches('boss-dr-670', ['Boss DR-670 Dr. Rhythm'])
  matches('boss-dr-770', ['Boss DR-770 Dr. Rhythm'])
})

test('a part, a case, a card, a manual or a clone names no row; two models in one title stay a tie', () => {
  notOn([
    'Boss Dr 110 Original Case', 'Boss DR-110 Box - Original Case - Tested', 'Boss DR-110 parts - potentiometer 1 (tempo)',
    'Boss DR-110 Service Notes [Three Wave Music]', 'Boss Dr. Rhythm DR-55 - 4-AA battery holder - New', 'START/STOP Switch Dr. Rhythm DR-55 BOSS',
    'BOSS clone DR-55 Doctor Rhythm - Blue', 'Boss DR-202 Dr. Groove Rubber Button Set - Black and Red',
    'Boss SP-202 parts - 4Meg 5 Volt Smartmedia card', 'Minolta RM-2S 5V 2MB SmartMedia Card (RARE!, Fully Tested) (Boss SP-202, MC-505, JX-305)',
    'BOSS SP 303 / 404 / 404sx Replacement Potentiometers Kit SP303/404/404sx Roland', '10 x TACT SWITCH ROLAND BOSS SP-505 SP-606 SP-808 FRONT PANEL',
    'Boss SP-505 Groove Sampling Workstation Discontinued (Boxed) - NON-FUNCTIONING / FOR PARTS', 'Roland SP-808EX Back Panel',
    'Roland SP-808 — Owners Manual User Guide Instructions — 196 Pages — USA Made', 'BOSS DR-770 Dr. Rhythm manual',
    'Boss BRC-120 Ac Adapter 14 Volt 800 mA For DR-880,SP-505,VF-1,GR-33/20,JS-5,GT-3/6/6B/8, AF-70, & More',
    'Power Supply/AC Adapter for Roland Products: SP-555 Pattern Sequencer, MC-09 Phrase Lab, JV-1010 64 Voice Synthesizer Module',
    'Ripcord USB to 9V Boss DR-110 Drum machine-compatible power cable by myVolts',
    'Boss SP-202 Dr. Sample & DR-202 Dr. Groove COMBO - MODDED', 'Boss SP-303 & SP-202 COMBO w/ 3D printed stands',
    'Roland TR-626 + TR-505 + Boss DR-770 Vintage Rhythm Composer Drum Machine Bundle TR626 TR505 DR770',
    'Korg Trinity DR-5 Keyboard Workstation (Consignment)',
  ])
  // A part the title says is included is the unit's.
  assert.equal(LINE_BOUNDARIES['boss-dr-202-dr-groove'].accessories!.some((n) => typeof n !== 'string' && n.test('Dr. Groove (Power Cable Included)')), false)
  assert.equal(LINE_BOUNDARIES['boss-dr-202-dr-groove'].accessories!.some((n) => typeof n !== 'string' && n.test('Dr. Groove power cable')), true)
})

test('a Boss row is never reached by a title that names Roland alone (a deferral writes no row)', () => {
  assert.equal(decide('Roland SP-505'), 'deferred:brand_mismatch')
})
