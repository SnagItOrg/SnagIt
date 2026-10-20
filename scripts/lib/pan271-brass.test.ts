/**
 * scripts/lib/pan271-brass.test.ts
 *
 * PAN-271: the brass section, trumpets first. Twelve rows become match targets (9 Yamaha YTR, 3 Bach Stradivarius
 * bells, each created 2026-10-19 with a verified Reverb CSP). The boundaries are measured on the trumpet titles live
 * on DBA, Finn, Blocket and Reverb that day: a Yamaha model number is its own identity and a finish suffix is the same
 * row through its identifier; a mouthpiece, a mute, a cleaning rod or a method book is not the horn; a Bach trombone,
 * cornet, C trumpet, Mt. Vernon horn, violin or recording is not a Stradivarius trumpet row; and a trumpet with no
 * model, or no brand, names no row at all — the half of the market the brand page is for. Every title is a production
 * title unless marked synthetic.
 *
 * Run: npx tsx --test scripts/lib/pan271-brass.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, lineBoundaryRefusal, LINE_BOUNDARIES, type Product } from '../../frontend/lib/matching/match-listings'
import config from '../rematch-configs/pan271-brass'

const row = (slug: string, brand_name: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name, status: 'active', support_state: 'supported',
})

/** Every row the PAN-271 create file makes, with the model names it sets. */
const PRODUCTS: Product[] = [
  row('yamaha-ytr-232', 'yamaha', 'Yamaha YTR-232', 'YTR-232'),
  row('yamaha-ytr-1335', 'yamaha', 'Yamaha YTR-1335', 'YTR-1335'),
  row('yamaha-ytr-2320', 'yamaha', 'Yamaha YTR-2320', 'YTR-2320'),
  row('yamaha-ytr-2330', 'yamaha', 'Yamaha YTR-2330', 'YTR-2330'),
  row('yamaha-ytr-2335', 'yamaha', 'Yamaha YTR-2335', 'YTR-2335'),
  row('yamaha-ytr-4335gii', 'yamaha', 'Yamaha YTR-4335GII', 'YTR-4335GII'),
  row('yamaha-ytr-8310z', 'yamaha', 'Yamaha YTR-8310Z', 'YTR-8310Z'),
  row('yamaha-ytr-8335', 'yamaha', 'Yamaha YTR-8335 Xeno', 'YTR-8335'),
  row('yamaha-ytr-8345', 'yamaha', 'Yamaha YTR-8345 Xeno', 'YTR-8345'),
  // The high-end round (owner, 2026-10-20).
  row('yamaha-ytr-9335chs', 'yamaha', 'Yamaha YTR-9335CHS Xeno Artist Chicago', 'YTR-9335CHS'),
  row('yamaha-ytr-9335nys', 'yamaha', 'Yamaha YTR-9335NYS Xeno Artist New York', 'YTR-9335NYS'),
  row('yamaha-ytr-8445', 'yamaha', 'Yamaha YTR-8445 Xeno C', 'YTR-8445'),
  row('yamaha-ytr-9445chs', 'yamaha', 'Yamaha YTR-9445CHS Xeno Artist Chicago C', 'YTR-9445CHS'),
  row('yamaha-ytr-9445nys', 'yamaha', 'Yamaha YTR-9445NYS Xeno Artist New York C', 'YTR-9445NYS'),
  row('yamaha-ytr-8335la', 'yamaha', 'Yamaha YTR-8335LA Custom LA', 'YTR-8335LA'),
  row('yamaha-ytr-8340em', 'yamaha', 'Yamaha YTR-8340EM', 'YTR-8340EM'),
  row('yamaha-ytr-850', 'yamaha', 'Yamaha YTR-850 Custom', 'YTR-850'),
  row('yamaha-ytr-6810', 'yamaha', 'Yamaha YTR-6810 Piccolo', 'YTR-6810'),
  row('bach-stradivarius-37', 'bach', 'Bach Stradivarius 37', 'Stradivarius 37'),
  row('bach-stradivarius-43', 'bach', 'Bach Stradivarius 43', 'Stradivarius 43'),
  row('bach-stradivarius-72', 'bach', 'Bach Stradivarius 72', 'Stradivarius 72'),
  // Brand protection: the supported rows a brass title could stray onto.
  row('yamaha-dx7', 'yamaha', 'Yamaha DX7', 'DX7'),
  row('fender-precision-bass', 'fender', 'Fender Precision Bass', 'Precision Bass'),
]

/** The identifiers the PAN-271 identity file writes: each spelling hyphenated and glued, as the file generates them. */
const VARIANTS: Record<string, string[]> = {
  'yamaha-ytr-1335': ['YTR-1335S'],
  'yamaha-ytr-2320': ['YTR-2320E', 'YTR-2320S'],
  'yamaha-ytr-2330': ['YTR-2330S'],
  'yamaha-ytr-2335': ['YTR-2335S'],
  'yamaha-ytr-4335gii': ['YTR-4335G', 'YTR-4335GS', 'YTR-4335GSII'],
  'yamaha-ytr-8310z': ['YTR-8310ZII', 'YTR-8310ZS'],
  'yamaha-ytr-8335': ['YTR-8335II', 'YTR-8335IIS', 'YTR-8335S', 'YTR-8335G', 'YTR-8335GS', 'YTR-8335RS', 'YTR-8335RGS', 'YTR-8335R'],
  'yamaha-ytr-8345': ['YTR-8345II', 'YTR-8345S', 'YTR-8345G', 'YTR-8345GS', 'YTR-8345RS'],
  'yamaha-ytr-9335chs': ['YTR-9335CHSII', 'YTR-9335CHSIII'],
  'yamaha-ytr-9335nys': ['YTR-9335NYSII', 'YTR-9335NYSIII'],
  'yamaha-ytr-8445': ['YTR-8445II', 'YTR-8445S', 'YTR-8445G', 'YTR-8445GS'],
  'yamaha-ytr-9445chs': ['YTR-9445CHSII'],
  'yamaha-ytr-9445nys': ['YTR-9445NYSII'],
  'yamaha-ytr-8335la': ['YTR-8335LAII', 'YTR-8335LAS', 'YTR-8335LAIIS'],
  'yamaha-ytr-850': ['YTR-850G', 'YTR-850GS', 'YTR-850S'],
  'yamaha-ytr-6810': ['YTR-6810S'],
  'bach-stradivarius-37': ['180S37', '18037', '180ML37', 'LR180S37', 'LR18037', 'LT180S37', '190S37', '19037', 'Strad 37', 'Stradivarius Model 37', 'Stradivarius Modell 37', 'Bach 37'],
  'bach-stradivarius-43': ['180S43', '18043', '180ML43', 'LR180S43', 'LR18043', '170S43', '170S43GYR', '190S43', 'LR190S43B', 'Strad 43', 'Stradivarius Model 43', 'Stradivarius Modell 43', 'Bach 43'],
  'bach-stradivarius-72': ['180S72', '18072', '180ML72', 'LR180S72', 'LR18072', 'Strad 72', 'Stradivarius Model 72', 'Stradivarius Modell 72', 'Bach 72'],
}
/** Round 2 (2026-10-20) writes a third, SPACED spelling too: Finn's "ytr 6810s" reads neither form round 1 wrote. */
const SPACED_TOO = new Set(['yamaha-ytr-9335chs', 'yamaha-ytr-9335nys', 'yamaha-ytr-8445', 'yamaha-ytr-9445chs', 'yamaha-ytr-9445nys', 'yamaha-ytr-8335la', 'yamaha-ytr-850', 'yamaha-ytr-6810'])
const IDENTS = Object.entries(VARIANTS).flatMap(([slug, values]) =>
  values.flatMap((value) => (value.includes('-')
    ? [value, value.replace(/-/g, ''), ...(SPACED_TOO.has(slug) ? [value.replace(/-/g, ' ')] : [])]
    : [value]))
    .map((value) => ({ product_id: `p-${slug}`, type: 'MODEL', value })),
)

const index = buildMatchIndex(PRODUCTS, IDENTS, [])
const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notMatched = (title: string) => {
  const d = decide(title)
  assert.ok(d === 'none' || d === 'rejected' || String(d).startsWith('deferred:'), `${title} → ${d}`)
}

test('every promoted row has a boundary, and the identity files write 80 + 51 identifiers', () => {
  for (const slug of config.promoted) assert.ok(LINE_BOUNDARIES[slug], `${slug} has no LINE_BOUNDARIES entry`)
  assert.equal(IDENTS.length, 131)
})

test('a Yamaha model number is its own identity, in every spelling the market writes', () => {
  matches('Yamaha YTR232 Trompet', 'yamaha-ytr-232')
  matches('Yamaha - YTR 232 - - Trompet - Japan - 1970 (Ingen mindstepris)', 'yamaha-ytr-232')
  matches('Yamaha - YTR1335 - - Trompet - Japan', 'yamaha-ytr-1335')
  matches('PÅ LAGER! Yamaha YTR-2330 Student Trompet', 'yamaha-ytr-2330')
  matches('Yamaha YTR2320E trompet i messing', 'yamaha-ytr-2320')
  // Reverb writes the hyphen as U+2011; folded before anything reads it (PAN-266).
  matches('Yamaha YTR‑2335 Standard Student Bb Trumpet', 'yamaha-ytr-2335')
  matches('Yamaha YTR-4335GII Intermediate Trumpet', 'yamaha-ytr-4335gii')
  matches('Yamaha YTR-4335GS Bb Intermediate Trumpet', 'yamaha-ytr-4335gii')
  matches('Yamaha YTR4335GSII', 'yamaha-ytr-4335gii')
  // A finish suffix glues to the number, so the model tier cannot read it; the identifier does (synthetic finish).
  matches('Yamaha YTR-2330S trompet forsølvet', 'yamaha-ytr-2330')
  // A seller's typo stays unmatched (DBA 2026-10-18, 3.450 kr): recall cost accepted, no row is wrong.
  notMatched('yamaha ytr4335gll trompet')
  // Two models in one title tie and defer (synthetic).
  notMatched('Yamaha YTR-2330 og YTR-2335 sælges samlet')
})

test('the Xeno and Custom rows take every finish and leadpipe spelling, and nothing beyond them', () => {
  matches('Yamaha YTR-8335RGS Xeno Bb Trumpet w/ Reversed Lead Pipe', 'yamaha-ytr-8335')
  matches('Yamaha YTR-8335S Xeno Series Bb Trumpet', 'yamaha-ytr-8335')
  matches('Yamaha YTR-8335II Xeno Trumpet', 'yamaha-ytr-8335')
  matches('Yamaha YTR-8345II Xeno Trumpet', 'yamaha-ytr-8345')
  matches('Yamaha YTR-8310Z Bobby Shew Custom Z Trumpet', 'yamaha-ytr-8310z')
  matches('Yamaha YTR-8310ZII Custom Z Trumpet', 'yamaha-ytr-8310z')
  // The line name alone, a row Klup does not hold (6335) and a bare "Chicago C" are not a row.
  notMatched('XENO trompet')
  notMatched('Yamaha trompet YTR6335S sølvfarget')
  notMatched('Yamaha Chicago C trompet')
})

test('the high-end rows (owner, 2026-10-20): Xeno Artist, Xeno C, Custom LA, 850, 6810 — each its own row', () => {
  matches('Yamaha YTR-9335CHSIII Xeno Artist Custom "Chicago" Bb Trumpet', 'yamaha-ytr-9335chs')
  matches('Yamaha YTR-9335NYSII Xeno New York Artist Model Trumpet', 'yamaha-ytr-9335nys')
  matches('Yamaha YTR-9335CHS Xeno Artist Chicago trompet', 'yamaha-ytr-9335chs')
  matches('Yamaha YTR-8445II Xeno C Trumpet', 'yamaha-ytr-8445')
  matches('Yamaha YTR-9445CHS Xeno Chicago Series C Trumpet', 'yamaha-ytr-9445chs')
  matches('Yamaha YTR-9445NYSII Xeno New York Artist Model C Trumpet', 'yamaha-ytr-9445nys')
  matches('Yamaha YTR-8335LAIIS Custom Bb Trumpet', 'yamaha-ytr-8335la')
  matches('Yamaha YTR-8340EM Lightweight Bb Trumpet', 'yamaha-ytr-8340em')
  matches('Yamaha YTR-850GS Custom Bb Trumpet', 'yamaha-ytr-850')
  matches('Strøken/ubrukt Yamaha piccolo trompet ytr 6810s sølv med koffert selges!', 'yamaha-ytr-6810')
  // The LA and the Artist rows never fall back onto the 8335: the suffix glues to the number.
  matches('Yamaha YTR-8335LA Custom LA Trumpet', 'yamaha-ytr-8335la')
  matches('Yamaha YTR-8335II Xeno Trumpet', 'yamaha-ytr-8335')
})

test('a trumpet with no model, or no brand, names no row — the brand page carries it', () => {
  for (const title of [
    'Trompet med etui', 'Yamaha trompet messing', 'Yamaha sølv trompet', 'Yamaha trompet', 'Trompet',
    '🎺 Vintage trompet – flot klassisk look', 'Besson trompet forsølvet', 'Søren P. Sørensen trompet', 'Instrumentsamling',
    'Yamaha trompet messing med etui', 'Trompet i krom',
  ]) notMatched(title)
})

test('a mouthpiece, a mute, a cleaning rod, a method book or a bag is not the trumpet', () => {
  notMatched('Yamaha John Hagstrom trumpet mouthpiece - silver')
  notMatched('Lot of 4 Yamaha YAC 1666P Valve Casing Cleaning Rod For Trumpet New Old Stock')
  notMatched('Bach 7C Mundstykke trompet')
  notMatched('Bach Artisan 7C Trumpet Mouthpiece (A4517C7) Trompet Mundstykke')
  notMatched('Trompet, vincent bach 5c')
  notMatched('Yamaha Silent Brass ST7-9 system för trumpet/kornett')
  notMatched('Fusion premium bag til trompet')
  notMatched('Arban Conservatory Method bog for Trumpet og andre brass band instrumenter')
  // Synthetic: the model number on an accessory, before and after "til".
  notMatched('Yamaha YTR-2330 mundstykke')
  notMatched('Mundstykke til Yamaha YTR-2330')
  // A bundle keeps its extras: the nouns come after the inclusion marker.
  matches('Bach stradivarius 37 Large Bore. Inkl. Trim kit', 'bach-stradivarius-37')
  matches('Yamaha YTR-2330 trompet med mundstykke og etui', 'yamaha-ytr-2330')
})

test('the Bach Stradivarius bells, as Nordic sellers write them', () => {
  matches('Bach Stradivarius 37 Bb Trompet', 'bach-stradivarius-37')
  matches('Vincent Bach Stradivarius 180S37 ML Silverpläterad Trumpet', 'bach-stradivarius-37')
  matches('Trumpet Bach Stradivarius Model 37 ML', 'bach-stradivarius-37')
  matches('Bach Stradivarius 37 ML trumpet, silver', 'bach-stradivarius-37')
  matches('Bach Stradivarius modell 37 trompet', 'bach-stradivarius-37')
  matches('Bach LR180S37 Stradivarius Professional Model Bb Trumpet', 'bach-stradivarius-37')
  matches('Bach 18037 Stradivarius Professional Model Bb Trumpet', 'bach-stradivarius-37')
  matches('Bach 180S43 Stradivarius Professional Model Bb Trumpet', 'bach-stradivarius-43')
  matches('Bach 170S43GYR Stradivarius Professional Bb Trumpet', 'bach-stradivarius-43')
  matches('Vincent Bach Stradivarius Model 72 Bb trompet (MLV) – sølv, topp stand + utstyr', 'bach-stradivarius-72')
  matches('Bach Stradivarius 72 (ML) – Profesjonell trompet – original koffert + 2 munnstk.', 'bach-stradivarius-72')
  // No bell, no row; and the bell without the brand stays below the confidence floor (synthetic).
  notMatched('Bach Stradivarius Bb trompet')
  assert.equal(decide('Stradivarius 37 ML trompet'), 'deferred:low_confidence')
})

test('another Bach horn, a collector era, a violin or the composer is not a Stradivarius trumpet row', () => {
  for (const title of [
    'Bach Stradivarius model 36 basun messing',
    'Bach Stradivarius ventil og trækbasun, sousafon Bb og tuba Bb',
    'Kornett "Bach Stradivarius - Model 37"',
    'Bach Stradivarius  Model 184 Kornett',
    'Stradivarius Bach kornett model 184',
    'Bach Mercedes Trompet',
    'Bach C180/229 trompet med corporation klokke til salgs.',
    'Trompet Bach Mt. Vernon ML (Art nr 1403)',
    'Bach Stradivarius Commercial 1b  LT190L1b',
    'Kiso  Suzuki Violin 1/2 Copy of Stradivarius no.180 1975',
    'Violin, Antonius Stradivarius Cremonensis Faciebat 1713',
    'J.S. Bach - Brandenburgkonsert 1-3',
    "Dave Mustaine's Megadeth NAMM Dean Stradivarius VMNT Flying King V Guitar",
    'Fender Precision Bass body, BaCH neck customised by OX BIRD- White, Walbucker pickup, Wal2',
  ]) notMatched(title)
  // Synthetic: a 37 from the Mt. Vernon years is a collector piece, not the row's market.
  notMatched('Bach Stradivarius 37 Mt Vernon 1962')
})

test('lineBoundaryRefusal says what the title is', () => {
  assert.equal(lineBoundaryRefusal('Bach Stradivarius 37 Bb Trompet', 'bach-stradivarius-37'), null)
  assert.equal(lineBoundaryRefusal('Bach Stradivarius model 36 basun messing', 'bach-stradivarius-37'), 'other_member:basun')
  assert.equal(lineBoundaryRefusal('Bach Stradivarius 37 Mt Vernon 1962', 'bach-stradivarius-37'), 'other_member:mt vernon')
  assert.equal(lineBoundaryRefusal('Yamaha YTR-2330 mundstykke', 'yamaha-ytr-2330'), 'accessory:mundstykke')
  assert.equal(lineBoundaryRefusal('Yamaha YTR-2330 trompet med mundstykke og etui', 'yamaha-ytr-2330'), null)
  // "topp stand" is a condition, never a stand sold alone — a stand is not on the brass list at all.
  assert.equal(lineBoundaryRefusal('Vincent Bach Stradivarius Model 72 Bb trompet (MLV) – sølv, topp stand + utstyr', 'bach-stradivarius-72'), null)
})

test("the config's lines pre-select every title the boundaries decide", () => {
  const names = (title: string) => config.lines.filter((l) => l.names.test(title)).map((l) => l.line)
  assert.deepEqual(names('Yamaha YTR232 Trompet'), ['ytr'])
  assert.deepEqual(names('Yamaha - YTR 232 - - Trompet'), ['ytr'])
  assert.deepEqual(names('Bach Stradivarius 37 Bb Trompet'), ['stradivarius'])
  assert.deepEqual(names('Vincent Bach Stradivarius 180S37 ML'), ['stradivarius', 'bach-180'])
  assert.deepEqual(names('Bach 170S43GYR Professional Bb Trumpet'), ['bach-180'])
  assert.deepEqual(names('Bach 19037 Professional Bb Trumpet'), ['bach-180'])
  assert.deepEqual(names('Trompet med etui'), [])
})
