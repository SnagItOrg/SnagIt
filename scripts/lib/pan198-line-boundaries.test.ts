/**
 * scripts/lib/pan198-line-boundaries.test.ts
 *
 * PAN-198: the Gibson series models, promoted to `supported`, must not swallow
 * each other or the rows already supported. Where one model's name sits inside
 * another's, the listing lands on the more specific model; where the title
 * names a model that has no row (a Custom Shop reissue, an earlier generation,
 * a part), it lands nowhere. One test per hazard class measured on the forecast
 * of 6,995 production listings; each fails on the matcher before this change,
 * except the base-model test, which guards the other direction: a boundary that
 * refused too much would fail it.
 *
 * Every title below is a real production listing title.
 *
 * Run: npx tsx --test scripts/lib/pan198-line-boundaries.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

// model_name exactly as in production.
const MODELS: Record<string, string> = {
  'gibson-les-paul-standard-50s': "Les Paul Standard '50s",
  'gibson-les-paul-standard-50s-double-trouble': "Les Paul Standard '50s Double Trouble",
  'gibson-les-paul-standard-50s-p-90': "Les Paul Standard '50s P-90",
  'gibson-les-paul-standard-60s': "Les Paul Standard '60s",
  'gibson-les-paul-standard-60s-faded': "Les Paul Standard '60s Faded",
  'gibson-les-paul-studio': 'Les Paul Studio',
  'gibson-les-paul-studio-session': 'Les Paul Studio Session',
  'gibson-les-paul-studio-deluxe-ii': 'Les Paul Studio Deluxe II',
  'gibson-les-paul-special': 'Les Paul Special',
  'gibson-les-paul-special-tribute': 'Les Paul Special Tribute',
  'gibson-les-paul-junior': 'Les Paul Junior',
  'gibson-les-paul-junior-double-cut': 'Les Paul Junior Double Cut',
  'gibson-les-paul-deluxe': 'Les Paul Deluxe',
  'gibson-les-paul-tribute': 'Les Paul Tribute',
  'gibson-les-paul-traditional': 'Les Paul Traditional',
  'gibson-les-paul-traditional-pro-ii': 'Les Paul Traditional Pro II',
  'gibson-the-paul': 'The Paul',
  'gibson-les-paul-the-paul-ii': 'Les Paul The Paul II',
  'gibson-sg-standard': 'SG Standard',
  'gibson-sg-standard-61': "SG Standard '61",
  'gibson-sg-standard-61-faded': "SG Standard '61 Faded",
  'gibson-sg-special': 'SG Special',
  'gibson-sg-special-faded': 'SG Special Faded',
  'gibson-sg-supreme': 'SG Supreme',
  'gibson-es-330': 'ES-330',
  'gibson-es-335-block': 'ES-335 Block',
  'gibson-es-345': 'ES-345',
  'gibson-marcus-king-es-345': 'Marcus King ES-345',
  'gibson-explorer': 'Explorer',
  'gibson-explorer-custom': 'Explorer Custom',
  'gibson-explorer-e2': 'Explorer E2',
  'gibson-70s-explorer': "'70s Explorer",
  'gibson-custom-shop-1958-korina-explorer-reissue': '1958 Korina Explorer Reissue',
  'gibson-flying-v': 'Flying V',
  'gibson-flying-v-custom': 'Flying V Custom',
  'gibson-dave-mustaine-flying-v-exp': 'Dave Mustaine Flying V EXP',
  'gibson-firebird': 'Firebird',
  'gibson-firebird-platypus': 'Firebird Platypus',
  'gibson-firebird-studio': 'Firebird Studio',
  'gibson-thunderbird': 'Thunderbird',
  'gibson-non-reverse-thunderbird': 'Non-Reverse Thunderbird',
  'gibson-thunderbird-bicentennial': 'Thunderbird Bicentennial',
  'gibson-advanced-jumbo': 'Advanced Jumbo',
  'gibson-custom-shop-1936-advanced-jumbo': '1936 Advanced Jumbo',
  'gibson-j-185': 'J-185',
  'gibson-j-185-original': 'J-185 Original',
  'gibson-lg-2': 'LG-2',
  'gibson-lg-2-all-mahogany-faded': 'LG-2 All Mahogany Faded',
  'gibson-dove': 'Dove',
  'gibson-dove-original': 'Dove Original',
  'gibson-sj-200-original': 'SJ-200 Original',
  'gibson-sj-200-standard': 'SJ-200 Standard',
  'gibson-sj-200-standard-rosewood': 'SJ-200 Standard Rosewood',
  'gibson-hummingbird': 'Hummingbird',
}

const index = buildMatchIndex(
  Object.entries(MODELS).map(([slug, model_name]): Product => ({
    id: `p-${slug}`, slug, canonical_name: `Gibson ${model_name}`, model_name, brand_name: 'gibson',
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

test('a series model lands on itself, not on the base model it contains', () => {
  expect([
    ["Gibson Les Paul Standard '50s Double Trouble Guitar Vintage Bourbon Burst", 'gibson-les-paul-standard-50s-double-trouble'],
    ["Gibson Les Paul Standard '50s P-90 Gold Top", 'gibson-les-paul-standard-50s-p-90'],
    ["Gibson Les Paul Standard '60s Faded - VBB (#364)", 'gibson-les-paul-standard-60s-faded'],
    ["Gibson Les Paul Standard '50s - HS (#100)", 'gibson-les-paul-standard-50s'],
    ['Gibson Les Paul Studio Session Honeyburst', 'gibson-les-paul-studio-session'],
    ['Gibson Les Paul Studio Deluxe II 2013 - Wine Red', 'gibson-les-paul-studio-deluxe-ii'],
    ['Gibson Les Paul Special Tribute P90 Ebony 2018', 'gibson-les-paul-special-tribute'],
    ['Gibson Les Paul Junior Double Cut TV Yellow 205160162', 'gibson-les-paul-junior-double-cut'],
    ["Gibson Les Paul Traditional Pro II '60s 2012 - 2014 - Merlot", 'gibson-les-paul-traditional-pro-ii'],
    ["Gibson SG Standard '61 Faded Vintage Cherry w/Case", 'gibson-sg-standard-61-faded'],
    ['2008 Gibson SG Special Faded worn brown', 'gibson-sg-special-faded'],
    ['Gibson Explorer Custom 2024 Ebony Gloss', 'gibson-explorer-custom'],
    ['Gibson Explorer E2 1980 - Natural', 'gibson-explorer-e2'],
    ['Gibson Flying V Custom 2025, Ebony', 'gibson-flying-v-custom'],
    ['Gibson Dave Mustaine Flying V EXP Metallic Silver 2022 mint!', 'gibson-dave-mustaine-flying-v-exp'],
    ['Gibson Firebird Platypus Tobacco Sunburst', 'gibson-firebird-platypus'],
    ['Gibson Firebird Studio T 2017 - Pelham Blue', 'gibson-firebird-studio'],
    ['Gibson Thunderbird Bicentennial 1976 - Natural - VG Condition - OHSC', 'gibson-thunderbird-bicentennial'],
    ['Gibson Marcus King ES-345 Sixties Cherry', 'gibson-marcus-king-es-345'],
    ['Gibson J-185 Original - Vintage Sunburst', 'gibson-j-185-original'],
    ['Gibson LG-2 All Mahogany Faded - Natural', 'gibson-lg-2-all-mahogany-faded'],
    ['Gibson SJ-200 Standard Rosewood - Rosewood Burst', 'gibson-sj-200-standard-rosewood'],
    ['Gibson Dove Original - Antique Natural', 'gibson-dove-original'],
    ['Gibson Custom Shop 1936 Advanced Jumbo Vintage Sunburst', 'gibson-custom-shop-1936-advanced-jumbo'],
  ])
})

test('a base model keeps its own titles, originals included (option A: the year is a facet)', () => {
  expect([
    ['Gibson Explorer 2019 - Present - Antique Natural', 'gibson-explorer'],
    ['1976 Gibson Explorer Limited Edition - Natural', 'gibson-explorer'],
    ['1967 Gibson Flying V "Sunburst"', 'gibson-flying-v'],
    ['Gibson Firebird V 2017 - Vintage Sunburst', 'gibson-firebird'],
    ['1959 Gibson Les Paul Junior cherry', 'gibson-les-paul-junior'],
    ['1975 Gibson Les Paul Deluxe Gold Top', 'gibson-les-paul-deluxe'],
    ['Gibson ES-345 Stereo Vintage 1968 Semi-Hollow Sunburst Electric Guitar Pre-Owned', 'gibson-es-345'],
    ['1946 Gibson LG-2 Sunburst #NSN', 'gibson-lg-2'],
    ['Gibson Dove 1969 Cherry Original', 'gibson-dove'],
    ['1979 Gibson USA Les Paul "The Paul" - in Natural Walnut', 'gibson-the-paul'],
  ])
})

test('the 2021 Thunderbird Bass ships with a non-reverse HEADSTOCK; the Non-Reverse Thunderbird is a body', () => {
  expect([
    ['Gibson Thunderbird Bass Guitar - Inverness Green with Non-reverse Headstock', 'gibson-thunderbird'],
    ['Gibson Non-Reverse Thunderbird Bass – Inverness Green – Mint – Original Hardshell Case', 'gibson-non-reverse-thunderbird'],
    ['Gibson Thunderbird Non Reverse 2021 - Pelham Blue Inc Hard Case', null],
  ])
})

test('a Custom Shop reissue, a decade model or a limited run without its own row is not the base', () => {
  expect([
    ['Gibson Custom Shop ´58 Les Paul Junior DC TV Yellow', null],
    ['Gibson Les Paul junior Custom Shop (57/2021) Vurderes Solgt.', null],
    ["GIBSON USA Custom Shop '63 ES-335 Block Reissue \"Faded Cherry\" (2014) (Reserved)", null],
    ['Gibson Custom Shop 1963 Firebird V - Vintage Sunburst', null],
    ['Stunning 2001 Gibson Custom Shop 1959 Korina Flying V Reissue Natural with White Pickguard', null],
    ['Gibson Explorer 70s - Antique Natural', null],
    ['Gibson 70s Flying V Antique Natural (007)', null],
    ['Gibson Les Paul Deluxe 70s Cherry Sunburst (073)', null],
    ['Gibson SG Special \'70s Tribute 2012 - 2013 - Satin Vintage Sunburst', null],
    ['Gibson SG Standard 61 - Vintage Cherry', null],
    ['Gibson Custom Shop SG Special \'63 Reissue', null],
    ['Gibson Custom Shop 2017 J-35 VINTAGE', null],
    ['2015 Gibson Custom Shop Limited Edition J-185 Red Spruce - Sunset Burst', null],
    ['Gibson Custom Shop SJ-200 Original Special 2026, Antique Natural', null],
    ['Gibson Acoustic Dealer Select Hummingbird Standard Sinker Mahogany Acoustic-electric Guitar - Thin Edge Sunburst', null],
  ])
})

test('an earlier generation sold under the same name is not the current model', () => {
  expect([
    ['2005 Gibson SG Supreme Midnight Burst w/ OHSC', null],
    ['Gibson SG Supreme P-90 1999 - Fire Burst', null],
    ['Gibson SG Supreme 2024 - Fireburst', 'gibson-sg-supreme'],
    ['Gibson Les Paul "The Paul" With Hardshell Case 1990s - Trans Red -', null],
    ['Gibson The Paul II 1996 - Black', null],
    ['Gibson Original Dove 2008 - Natural', null],
    ['1969 Gibson Dove original', null],
  ])
})

test('a part that lists the model among the ones it fits is not the guitar', () => {
  expect([
    ['1965+ Kluson Gibson ES-330 (T-217)', null],
    ['Gibson 1977-81 Tulip 3+3 tuner (L-bass side) for LP Std, LP Deluxe, ES-335, ES-175, Flying V, L6S Deluxe, Mara', null],
    ['Gibson Vintage 1974 Les Paul Tailpiece w/Studs ES SG L6-S The Paul 1975 1976 1977 1978', null],
    ['3 Ply W/B/W Pickguard for 2004-2008 Gibson Firebird Studio + Foil Decal', null],
    ['Gibson Thunderbird Modern Hardshell Case - Brown', null],
  ])
})
