/**
 * scripts/lib/pan195-line-boundaries.test.ts
 *
 * PAN-195: the Fender series models, promoted to `supported`, must not swallow
 * each other or the rows already supported. Where one model's name sits inside
 * another's, the listing lands on the more specific model; where the title
 * cannot say which era it is, it defers. One test per hazard class measured on
 * the held and unmatched listings of the seven Fender families; each fails on
 * the matcher before this change.
 *
 * Every title below is a real production listing title.
 *
 * Run: npx tsx --test scripts/lib/pan195-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

// model_name exactly as in production.
const MODELS: Record<string, string> = {
  'fender-american-professional-ii-stratocaster': 'American Professional II Stratocaster',
  'fender-american-professional-ii-stratocaster-hss': 'American Professional II Stratocaster HSS',
  'fender-player-ii-stratocaster': 'Player II Stratocaster',
  'fender-player-ii-stratocaster-hss': 'Player II Stratocaster HSS',
  'fender-standard-stratocaster': 'Standard Stratocaster',
  'fender-standard-stratocaster-hss': 'Standard Stratocaster HSS',
  'fender-american-standard-telecaster': 'American Standard Telecaster',
  'fender-standard-telecaster': 'Standard Telecaster',
  'fender-telecaster-thinline': 'Telecaster Thinline',
  'fender-telecaster-custom': 'Telecaster Custom',
  'fender-american-professional-ii-telecaster': 'American Professional II Telecaster',
  'fender-american-professional-ii-telecaster-deluxe': 'American Professional II Telecaster Deluxe',
  'fender-american-professional-ii-telecaster-thinline': 'American Professional II Telecaster Thinline',
  'fender-vintera-ii-60s-telecaster': "Vintera II '60s Telecaster",
  'fender-vintera-ii-60s-telecaster-thinline': "Vintera II '60s Telecaster Thinline",
  'fender-american-vintage-ii-1972-telecaster-thinline': 'American Vintage II 1972 Telecaster Thinline',
  'fender-american-vintage-ii-1977-telecaster-custom': 'American Vintage II 1977 Telecaster Custom',
  'fender-american-professional-ii-jazz-bass': 'American Professional II Jazz Bass',
  'fender-american-professional-ii-jazz-bass-v': 'American Professional II Jazz Bass V',
  'fender-american-professional-ii-jazz-bass-fretless': 'American Professional II Jazz Bass Fretless',
  'fender-american-professional-ii-precision-bass': 'American Professional II Precision Bass',
  'fender-american-professional-ii-precision-bass-v': 'American Professional II Precision Bass V',
  'fender-standard-jazz-bass': 'Standard Jazz Bass',
  'fender-mustang-bass': 'Mustang Bass',
  'fender-american-performer-mustang-bass': 'American Performer Mustang Bass',
  'fender-american-professional-classic-mustang-bass': 'American Professional Classic Mustang Bass',
}

const index = buildMatchIndex(
  Object.entries(MODELS).map(([slug, model_name]): Product => ({
    id: `p-${slug}`, slug, canonical_name: `Fender ${model_name}`, model_name, brand_name: 'fender',
    status: 'active', support_state: 'supported',
  })),
  [], [],
)

const matched = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)!.slug : null
}

const expect = (cases: Array<[string, string | null]>) => {
  for (const [title, slug] of cases) assert.equal(matched(title), slug, title)
}

test('a pickup configuration lands on its own model, not the base it contains', () => {
  expect([
    ['Fender Player II Stratocaster HSS Maple Fingerboard Aquatone Blue (750)', 'fender-player-ii-stratocaster-hss'],
    ['Fender Player II Stratocaster Maple Fingerboard Polar White (463)', 'fender-player-ii-stratocaster'],
    // 22 of these sit on the supported AP II Stratocaster today.
    ['Fender American Professional II Stratocaster HSS - Miami Blue w/Rosewood', 'fender-american-professional-ii-stratocaster-hss'],
    // An HH limited edition has no row: not the AP II Stratocaster either.
    ['Fender American Professional II Stratocaster HH Mahagony LTD.', null],
  ])
})

test('a five-string or fretless bass is not the four-string it contains', () => {
  expect([
    ['Fender American Professional II Jazz Bass V, Maple Fingerboard, Mystic Surf Green (X7) (91778)', 'fender-american-professional-ii-jazz-bass-v'],
    ['Fender American Professional II Jazz Bass Fretless, Rosewood Fingerboard, Dark Night (RC1) (66773)', 'fender-american-professional-ii-jazz-bass-fretless'],
    ['Fender American Professional II Jazz Bass Rosewood Fingerboard Black (038)', 'fender-american-professional-ii-jazz-bass'],
    // "®" splits the V model's name, so it cannot land there; it is still not the four-string.
    ['Fender American Professional II Precision Bass® V, Rosewood Fingerboard, 3-Color Sunburst', null],
    ['Fender American Professional II Precision Bass V - 3-color Sunburst with Rosewood Fingerboard', 'fender-american-professional-ii-precision-bass-v'],
  ])
})

test('a series Thinline, Deluxe or Custom lands on the series model, and the 1968–79 original stays', () => {
  expect([
    ['Fender American Vintage II 1972 Telecaster Thinline - Lake Placid Blue', 'fender-american-vintage-ii-1972-telecaster-thinline'],
    ["Fender Vintera II '60s Telecaster Thinline Black", 'fender-vintera-ii-60s-telecaster-thinline'],
    ['Fender American Professional II Telecaster Deluxe - Dark Night w/Rosewood', 'fender-american-professional-ii-telecaster-deluxe'],
    ['Fender American Professional II Telecaster – USA – Top Zustand', 'fender-american-professional-ii-telecaster'],
    ['1971 Fender Telecaster Thinline American Vintage 70s Guitar', 'fender-telecaster-thinline'],
    ['1978 Fender Telecaster Custom – Black – Made in USA 4kg', 'fender-telecaster-custom'],
  ])
})

test('Standard is the 2025 series only: American and Mexican Standards and bare titles are not it', () => {
  expect([
    // Deferred as a tie with "Standard Telecaster" before this change.
    ['Fender American Standard Telecaster', 'fender-american-standard-telecaster'],
    ['Fender American Standard Stratocaster (1995)', null],
    ['Fender Standard Stratocaster MIM 2013/14 – Sunburst + tillbehör', null],
    ['Fender Standard Jazz Bass with Rosewood Fretboard 1991 - 2008 - Black', null],
    // No laurel board and no year: either era, so it defers.
    ['Fender Standard Jazz Bass - Black', null],
    ['Fender Standard Jazz Bass LRL Olympic White', 'fender-standard-jazz-bass'],
    ['Fender Standard Jazz Bass 2025 in Black', 'fender-standard-jazz-bass'],
    ['FENDER Standard Stratocaster HSS, Laurel Fingerboard, Black Pickguard, Black - Chitarra Elettrica', 'fender-standard-stratocaster-hss'],
  ])
})

test('a series Mustang Bass lands on the series model, and the original stays', () => {
  expect([
    ['Fender American Professional Classic Mustang Bass 3-Color Sunburst', 'fender-american-professional-classic-mustang-bass'],
    ['2019 Fender American Performer Mustang Bass Aubergine', 'fender-american-performer-mustang-bass'],
    ['1973 Fender Mustang Bass - Sunburst - Clean Amazing Player - HSC', 'fender-mustang-bass'],
  ])
})
