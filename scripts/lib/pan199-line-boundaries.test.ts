/**
 * scripts/lib/pan199-line-boundaries.test.ts
 *
 * PAN-199: the Moog rows the promote SQL moves to `supported`, with the model
 * names it sets. One test per hazard class, on real production titles (read-only
 * snapshot 2026-09-30). Every test fails on the matcher before this change
 * except the last, which guards against refusing too much.
 *
 * Run: npx tsx --test scripts/lib/pan199-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

const product = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Moog ${model_name}`, model_name, brand_name: 'moog',
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex([
  product('moog-minimoog', 'Minimoog'),
  product('moog-model-d', 'Model D'),
  product('moog-minimoog-model-d-2022', 'Model D'),
  product('moog-minimoog-voyager', 'Minimoog Voyager'),
  product('moog-minimoog-voyager-xl', 'Voyager XL'),
  product('moog-minimoog-voyager-rme', 'Voyager RME'),
  product('moog-minimoog-voyager-old-school', 'Voyager Old School'),
  product('moog-mf-104', 'MF-104'),
  product('moog-mf-104m', 'MF-104M'),
  product('moog-mf-104z', 'MF-104Z'),
  product('moog-memorymoog', 'Memorymoog'),
  product('moog-memory-plus', 'Memorymoog Plus'),
  product('moog-moog-subsequent-37', 'Subsequent 37'),
  product('moog-moog-messenger', 'Messenger'),
  product('moog-sirin', 'Sirin'),
  product('moog-etherwave-theremin', 'Etherwave Theremin'),
  product('moog-satellite', 'Satellite'),
  product('moog-source', 'Source'),
  product('moog-matriarch', 'Matriarch'),
  product('moog-mother-32', 'Mother-32'),
  product('moog-prodigy', 'Prodigy'),
], [], [])

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

const expectAll = (slug: string | null, titles: string[]) => {
  for (const t of titles) assert.equal(matchedSlug(t), slug, t)
}

test('the Model D splits by year: 2016 reissue, 2022– re-run, vintage original', () => {
  expectAll('moog-minimoog-model-d-2022', [
    'Moog Minimoog Model D Reissue 44-Key Monophonic Synthesizer (2022) 2022 - Present - Black / Wood',
    'Moog Minimoog Model D 2023 Reissue 44-Key Monophonic Synthesizer / Wood Brand New //ARMENS//',
    'Moog MiniMoog Model D Synthesizer (new 2024)',
    'Moog Model D 2026 - Oak Bob Moog Special Edition',
  ])
  expectAll('moog-model-d', [
    'Moog Minimoog Model D Reissue 44-Key Monophonic Synthesizer (2016) 2016 - 2017 - Black / Wood',
    '(Rare) 2018 LIMITED Moog Minimoog Model D WALNUT Reissue 44-Key Monophonic Synthesizer (2018) - Walnut / Wood',
    // No year: nothing separates the runs, so it keeps its old home.
    'Moog Minimoog Model D Reissue 44-Key Monophonic Synthesizer',
  ])
  expectAll('moog-minimoog', [
    'Moog Minimoog Model D 44-Key Monophonic Synthesizer 1971 - 1982 - Black / Wood',
    'Moog Minimoog Model D (1974)',
  ])
})

test('a Voyager is not the vintage Minimoog, and XL, RME and Old School are their own models', () => {
  expectAll('moog-minimoog-voyager', [
    'Moog Minimoog Voyager (Used)',
    'Moog Minimoog Voyager Performer Edition 44-Key Monophonic Synthesizer 2002 - 2015 - Traditional Wood Cabinet',
    'Moog Minimoog Voyager Select Series 44-Key Monophonic Synthesizer 2006 - 2013 - Cherry Cabinet',
  ])
  expectAll('moog-minimoog-voyager-xl', ['Moog Minimoog Voyager XL 61-Key Monophonic Synthesizer 2010 - Black with Wood Cabinet'])
  expectAll('moog-minimoog-voyager-rme', [
    'Moog Minimoog Voyager RME Rack Mount Edition Monophonic Synthesizer 2005 - 2015 - Black',
    'MOOG Voyager RME Analoger Synthesizer Rack + Holz + Wie Neu + OVP + Garantie',
  ])
  expectAll('moog-minimoog-voyager-old-school', [
    'Moog Minimoog Voyager Old School 44-Key Monophonic Synthesizer 2008 - 2009 - Ash Cabinet',
  ])
  // Written as one word it does not read "Voyager Old School", but it is still not the base.
  expectAll(null, ['Moog Moog MiniMoog Voyager OldSchool 2008'])
})

test('the MF-104 is not the MF-104M or MF-104Z, however the seller spells them', () => {
  expectAll('moog-mf-104m', ['NEW, Moog Moogerfooger MF-104M Analog Delay/MF104 M/ MF 104M 104  pedal //ARMENS//'])
  expectAll('moog-mf-104z', ['Moog Moogerfooger MF-104z Analog Delay  mf104 mf 104 mf104z'])
  expectAll('moog-mf-104', ['Moog MF-104 “Big Briar” Moogerfooger Analog Delay 2000 - 2001 - Black'])
})

test('a longer model inside a line: Memorymoog Plus, Subsequent 37 CV, Etherwave Plus, the Sirin', () => {
  expectAll('moog-memory-plus', ['Moog Memorymoog Plus - Fully Serviced'])
  expectAll('moog-memorymoog', ['Moog Memorymoog 1982 - 1985 - Wood'])
  // The CV model has no KG row: refused, never absorbed.
  expectAll(null, ['Moog Subsequent 37 CV Paraphonic Analog Synth 2010s - Gray'])
  expectAll(null, ['Moog Etherwave Plus Theremin 2009 - Present - Natural'])
  expectAll('moog-etherwave-theremin', ['MOOG Etherwave Theremin Synthesizer Ash Wood - Model 2022 like Etherwave PLUS // NEU + OVP + GARANTIE'])
  expectAll('moog-sirin', ['Moog Sirin Analog Messenger of Joy 2019 - Present - Silver'])
})

test('parts and accessories of the Moog rows are not the instrument', () => {
  expectAll(null, [
    'Moog Satellite Main PCB for Parts or Repair',
    'Moog Satellite Wiring Harness',
    'Moog Satellite complete wood case',
    'Moog Source Membrane',
    'Moog Source Panel Overlay Set',
    'Moog SR Series Matriarch Synthesizer Case 2020s - Black',
    'Moog Mother-32 Three-Tier Rack Kit 2010s - Black',
    'Universal Audio UAD Moog Minimoog Plug-in (Activation Card)',
    'Prodigy Plus (Moog clone)',
    'Moog - Prodigy - Power Transformer',
    'Complete Set - Keyboard Rubber Contacts  - Moog Memorymoog',
    'Moog MemoryMoog Plus OS Version 4.1 Latest Firmware Memory Rom Eprom',
  ])
})

test('an instrument sold with an accessory is still the instrument', () => {
  expectAll('moog-source', ['Moog Source Monophonic Analog Synthesizer (Serviced w/ New Membrane Panel)'])
  expectAll('moog-matriarch', ['Moog Matriarch (with Moog SR Case & more)'])
  expectAll('moog-mother-32', ['Moog Mother-32 Tabletop / Eurorack Semi-Modular Synthesizer 2015 - Present - Black'])
  expectAll('moog-satellite', ['Moog Satellite 1973 - 1979 - Black'])
})
