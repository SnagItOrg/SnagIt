/**
 * scripts/lib/pan154-line-boundary.test.ts
 *
 * PAN-154: a supported product whose name is also a LINE absorbed the line's
 * other members. Owner decisions 2026-09-26: `moog-minimoog` is the vintage
 * original only, `moog-model-d` is the reissue only, and `sequential-prophet-10`
 * is the 1980 Sequential Circuits original only. One test per class; each
 * fails on the matcher before this change.
 *
 * Every title below is a real production listing or sold-history title.
 *
 * Run: npx tsx --test scripts/lib/pan154-line-boundary.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMatchIndex,
  decideMatch,
  lineBoundaryRefusal,
  type Product,
} from '../../frontend/lib/matching/match-listings'

const product = (slug: string, model_name: string, brand_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `${brand_name} ${model_name}`, model_name, brand_name,
  status: 'active', support_state: 'supported',
})

const index = buildMatchIndex([
  product('moog-minimoog', 'Minimoog', 'moog'),
  product('moog-model-d', 'Model D', 'moog'),
  product('sequential-prophet-10', 'Prophet-10', 'sequential'),
  product('sequential-prophet-5', 'Prophet-5', 'sequential'),
], [], [])

const matchedSlug = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

test('a Minimoog Voyager is not the vintage Minimoog', () => {
  for (const title of [
    'Moog Minimoog Voyager XL 61-Key Monophonic Synthesizer 2010 - Black with Wood Cabinet',
    'Moog Minimoog Voyager RME Rack Mount Edition',
    'Moog Minimoog Voyager Old School [Three Wave Music]',
    'Moog Minimoog Voyager (Used)',
    'MiniMoog Voyager Signed by Bob Moog Electric Blue Edition w/ expander and pedal',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }
})

test('a Model D reissue is not the vintage Minimoog, and lands on the reissue', () => {
  assert.equal(matchedSlug('Moog Minimoog Reissue 2022'), null)
  for (const title of [
    'Moog Minimoog Model D Reissue 44-Key Monophonic Synthesizer (2016) 2016 - 2017 - Black / Wood',
    'Moog Minimoog Model D Analog Keyboard Synthesizer (2022 Edition - Mahogany)',
    'Moog MiniMoog Model D Synthesizer (new 2024)',
    'Moog Minimoog Model D Bob Moog Tribute Edition',
    // An inclusion marker before the case keeps the instrument.
    'Moog Minimoog Model D Reissue + ATA case',
  ]) {
    assert.equal(matchedSlug(title), 'moog-model-d', title)
  }
  // A signature edition holds its own KG row, so it is neither page.
  assert.equal(matchedSlug('Moog Geddy Lee Minimoog Model D'), null)
})

test('an accessory is not the instrument; the instrument sold with one still is', () => {
  for (const title of [
    'Moog Minimoog SR Case Brandneu',
    'JFET Transistor E111 for MOOG, Minimoog mit Goldkontakten 3 Stück',
    'Moog Minimoog / Sonic Six / Modular System 12 brochure',
    'Moog Model D SR Case',
    'Moog Music Model D ATA Flightcase (RES-RC-008)',
    'Moog - Mini Moog Model D -  1/4 amp Fuse',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }
  // Sold history is not matched, it is classified with the same rule. This
  // one reached the Minimoog sold band through the migration-034 backfill.
  assert.equal(
    lineBoundaryRefusal('Moog Minimoog Model D original Owners and Service manual, free EU shipping.', 'moog-minimoog'),
    'accessory:service manual',
  )

  assert.equal(matchedSlug('1973 Moog Minimoog Model D w/ Road Case Signed by Herbie Hancock'), 'moog-minimoog')
  assert.equal(matchedSlug('Moog Model D Limited Edition Robert Moog 2026 Free Moog Case'), 'moog-model-d')
})

test('a vintage original is not the Model D reissue, and lands on the Minimoog', () => {
  for (const title of [
    'Moog Minimoog Model D 44-Key Monophonic Synthesizer 1971 - 1982 - Black / Wood',
    'MOOG MINIMOOG MODEL D (Late Model) [12645] (04/17)',
    'Vintage - Moog Minimoog Model D - Monophonic Synthesizer 1972 - SERVICED',
    'Moog Minimoog model D Original  in  Good conditions',
  ]) {
    assert.equal(matchedSlug(title), 'moog-minimoog', title)
  }
  // No "Minimoog" in the title: no longer the reissue, and not the Minimoog.
  assert.equal(matchedSlug('Synthesizer Moog Model D 1973 Walnut Mint'), null)
  // No cue either way: still undecidable, still deferred.
  const d = decideMatch('Moog Minimoog Model D', index)
  assert.equal(d.kind === 'deferred' && d.reason, 'ambiguous_tie')
})

test('Prophet-10 is the Sequential Circuits original; the 2020 model is not', () => {
  for (const title of [
    'Sequential Prophet-10 61-Key 10-Voice Polyphonic Synthesizer 2020 - Present - Black with Wood Sides',
    'Sequential Prophet-10 Desktop Module',
    'Sequential Prophet 10 - rev4',
    // No cue at all. The 2020 model is also sold as "Sequential", so a bare
    // title is not evidence for the 1980 one: fail closed.
    'Sequential Prophet-10',
    'Prophet 10 Sequential',
    // "Circuits" does not survive a 2020 cue.
    'Sequential Circuits Prophet 10 Desktop',
    'Sequential Circuits Prophet 10 Rev 4 Analog Poly Synth',
    // Nor a part for the original.
    'Sequential Circuits Prophet-10 Diagnostics ROM ICs',
  ]) {
    assert.equal(matchedSlug(title), null, title)
  }
  for (const title of [
    'Sequential Circuits - Prophet-10 // restored by VS&C',
    'CHOPPED Original Vintage Sequential Circuits Prophet 10 w/ MIDI',
    'Sequential Prophet 10 Rev3 61-Key Dual Keyboard 10-Voice Polyphonic Synthesizer 1980 - 1984 - Black with Wood Sides',
    'Vintage Sequential Prophet 10 - fully serviced & sold with a warranty',
  ]) {
    assert.equal(matchedSlug(title), 'sequential-prophet-10', title)
  }
})

// ── PAN-154 (2/2): option A for the audit's other products, and the base
// member of the Mustang Bass family. Per product, one real variant title the
// matcher used to send to it, and one real base title it still does.

const LINE_PRODUCTS = [
  product('gibson-j-45', 'J-45', 'gibson'),
  product('gibson-hummingbird', 'Hummingbird', 'gibson'),
  product('gibson-les-paul-studio', 'Les Paul Studio', 'gibson'),
  product('gibson-les-paul-special', 'Les Paul Special', 'gibson'),
  product('gibson-les-paul-custom', 'Les Paul Custom', 'gibson'),
  product('fender-telecaster-thinline', 'Telecaster Thinline', 'fender'),
  product('fender-telecaster-custom', 'Telecaster Custom', 'fender'),
  product('fender-mustang-bass', 'Mustang Bass', 'fender'),
  product('ua-1176ln', '1176LN', 'universal audio'),
  product('korg-ms-20', 'MS-20', 'korg'),
  product('sequential-prophet-5', 'Prophet-5', 'sequential'),
  product('martin-d-28', 'D-28', 'martin'),
]
const lineIndex = buildMatchIndex(LINE_PRODUCTS, [], [])
const lineSlug = (title: string): string | null => {
  const d = decideMatch(title, lineIndex)
  return d.kind === 'matched' ? lineIndex.productById.get(d.best.product_id)!.slug : null
}

test('a named variant is not the base model; the base model still is (option A)', () => {
  for (const [slug, variant, base] of [
    ['gibson-j-45', "Gibson '50s J-45 Original - Vintage Sunburst",
      'Gibson J-45 Standard 2009 - Vintage Sunburst W/ Original Hard Case & LR Baggs Magnetic / Transducer Hybrid Expression System'],
    ['gibson-hummingbird', 'Gibson Hummingbird Studio Rosewood - Satin Rosewood Burst', 'Gibson Hummingbird Standard, Vintage Sunburst'],
    ['gibson-les-paul-studio', 'Gibson Les Paul Studio Session Honeyburst', 'Gibson Les Paul Studio Ebony'],
    ['gibson-les-paul-special', 'Gibson Les Paul Special DC 2015', 'Gibson Les Paul Special - TV Yellow'],
    ['gibson-les-paul-custom', '2010 Gibson Les Paul Custom VOS Wine Red', 'Gibson Les Paul Custom Ebony Custom Shop mit 57 Custombucker'],
    ['fender-telecaster-thinline', 'Fender American Vintage II 1972 Telecaster Thinline - 3 Color Sunburst',
      '1971 Fender Telecaster Thinline American Vintage 70s Guitar'],
    ['fender-telecaster-custom', "Fender Limited Edition '72 Telecaster Custom 2012 - Orange Sparkl",
      '1978 Fender Telecaster Custom – Black – Made in USA 4kg'],
    ['fender-mustang-bass', 'Fender Player II Mustang Bass PJ - Coral Red', '1973 Fender Mustang Bass - Sunburst - Clean Amazing Player - HSC'],
    ['ua-1176ln', 'Urei Universal Audio 1176LN Rev. F Limiting Amplifier', 'Universal Audio 1176LN Limiting Amplifier Reissue 2001 - Present - Black'],
    ['korg-ms-20', 'Korg MS-20 FS Monophonic Analog Synthesizer 2020 - Present - Blue', 'Korg MS-20 with foot controller, wood sides and manuals'],
    ['sequential-prophet-5', 'Sequential Prophet-5 Module', 'Sequential Prophet 5 synthesizer'],
    ['martin-d-28', 'Martin D-28 Modern Deluxe Dreadnought Acoustic Guitar #6278', 'Martin D-28 Standard Series Left-Handed Acoustic Guitar w/Case'],
  ]) {
    assert.equal(lineSlug(variant), null, `${slug}: ${variant}`)
    assert.equal(lineSlug(base), slug, `${slug}: ${base}`)
  }
})

test('a licensed-subsidiary title keeps its auditable rejection under a line boundary', () => {
  // The boundary runs after the collision check, so "Squier" is still a
  // written rejection, never a silent "no candidate".
  assert.equal(decideMatch('Squier Vintage Modified Mustang Bass', lineIndex).kind, 'rejected')
})
