/**
 * scripts/lib/pan303-kleinanzeigen-audio-hifi.test.ts
 *
 * PAN-303: the Kleinanzeigen scraper also reads Audio & Hifi (c172), for the microphones in its set and nothing else.
 * "Microphone" is the KG subcategory `pro-audio/microphones`, read with each product, so a microphone added to the
 * set later follows without a code change; guitars and synths stay on Musikinstrumente (c74).
 *
 * Every title below is a kleinanzeigen.de ad live on 2026-10-27, found by the scraper's own query for a monitored
 * microphone in c172, or by a probe of the noise c172 holds ("karaoke mikrofon", "usb mikrofon").
 *
 * Run: npx tsx --test scripts/lib/pan303-kleinanzeigen-audio-hifi.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'

import {
  AUDIO_HIFI,
  MICROPHONE_SUBCATEGORY,
  MUSIKINSTRUMENTE,
  buildKleinanzeigenUrl,
  searchCategories,
} from './kleinanzeigen-categories'
import { buildMatchIndex, decideMatch, type Product } from '../../frontend/lib/matching/match-listings'

test('a microphone is searched in Musikinstrumente and Audio & Hifi', () => {
  assert.deepEqual(searchCategories('pro-audio/microphones').map((c) => c.code), ['c74', 'c172'])
  assert.equal(MICROPHONE_SUBCATEGORY, 'pro-audio/microphones')
})

test('every other product stays on Musikinstrumente, and an unreadable subcategory fails closed', () => {
  // The non-microphone leaves the Kleinanzeigen set holds today (production, 2026-10-27).
  for (const leaf of [
    'electric-guitars/solid-body', 'electric-guitars/semi-hollow', 'bass-guitars/4-string',
    'keyboards-and-synths/analog-synths', 'keyboards-and-synths/digital-synths', 'keyboards-and-synths/drum-machines',
    'keyboards-and-synths/electric-pianos', 'effects-and-pedals/reverb', 'pro-audio/recording',
    // Exact match: a neighbouring leaf or a bare kind is not the microphones leaf.
    'pro-audio/microphone-preamps', 'microphones', 'home-audio/closed-back-headphones',
  ]) {
    assert.deepEqual(searchCategories(leaf), [MUSIKINSTRUMENTE], leaf)
  }
  assert.deepEqual(searchCategories(null), [MUSIKINSTRUMENTE])
})

test('the Musikinstrumente URL is unchanged, and Audio & Hifi has its own segment and code', () => {
  assert.equal(buildKleinanzeigenUrl('neumann u 87 ai', 1, MUSIKINSTRUMENTE),
    'https://www.kleinanzeigen.de/s-musikinstrumente/neumann+u+87+ai/k0c74')
  assert.equal(buildKleinanzeigenUrl('neumann u 87 ai', 2, MUSIKINSTRUMENTE),
    'https://www.kleinanzeigen.de/s-musikinstrumente/neumann+u+87+ai/k0c74?pageNum=2')
  assert.equal(buildKleinanzeigenUrl('neumann u 87 ai', 1, AUDIO_HIFI),
    'https://www.kleinanzeigen.de/s-audio-hifi/neumann+u+87+ai/k0c172')
})

test('the scraper reads each product\'s subcategory from the KG and searches the categories it implies', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../scrape-kleinanzeigen.ts'), 'utf8')
  assert.match(src, /subcategory:kg_category!kg_product_subcategory_id_fkey\(slug\)/)
  assert.match(src, /categories: searchCategories\(resolveSubcategorySlug\(product\.subcategory\)\)/)
  assert.match(src, /scrapeKleinanzeigen\(product\.query, product\.categories, 3\)/)
  // No hand list and no second URL builder: the category decision lives in one module.
  assert.doesNotMatch(src, /c172|s-audio-hifi|k0c74/)
})

// ── The matcher on what Audio & Hifi returns ─────────────────────────────────────────────────────────────────────

const row = (slug: string, canonical_name: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name, model_name, brand_name: 'neumann', status: 'active', support_state: 'supported',
})
/** The Kleinanzeigen set's microphones a c172 title could land on, with the model names production holds. */
const PRODUCTS: Product[] = [
  row('neumann-u87', 'Neumann U 87', 'U 87'), row('neumann-u87ai', 'Neumann U 87 Ai', 'U 87 Ai'),
  row('neumann-u47', 'Neumann U 47', 'U 47'), row('neumann-u67', 'Neumann U67', 'U 67'),
  row('neumann-u67-reissue', 'Neumann U 67 Reissue', 'U 67'), row('neumann-km-84', 'Neumann KM 84', 'KM 84'),
  row('neumann-km-184', 'Neumann KM 184', 'KM 184'), row('neumann-tlm-102', 'Neumann TLM 102', 'TLM 102'),
  row('neumann-tlm-103', 'Neumann TLM 103', 'TLM 103'),
]
/** Production's seed identifiers on the U 87 Ai and the U 47. */
const IDENTS = [
  { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U87Ai' }, { product_id: 'p-neumann-u87ai', type: 'SKU', value: 'U 87 Ai' },
  { product_id: 'p-neumann-u47', type: 'SKU', value: 'U47' }, { product_id: 'p-neumann-u47', type: 'MODEL', value: 'U 47' },
]
const index = buildMatchIndex(PRODUCTS, IDENTS, [], ['neumann', 'peluso'])
const slugOf = (title: string): string | null => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? d.best.product_id.slice(2) : null
}

test('Audio & Hifi microphone ads land on their rows', () => {
  for (const [title, slug] of [
    ['Neumann U87 Ai Studio Set', 'neumann-u87ai'],
    ['Neumann U 87 Ai Mikrofon (Studio Set)', 'neumann-u87ai'],
    ['Neumann U87 Baujahr 1970 Made in Western Germany', 'neumann-u87'],
    ['Neumann U67 Set (Reissue, neuwertig)', 'neumann-u67-reissue'],
    ['Neumann KM 184 P48 inkl. Klemme und Etui', 'neumann-km-184'],
    ['Neumann KM-84 Mikrofon', 'neumann-km-84'],
    ['Neumann TLM 102 Studio Set Nickel inkl. EA 4 – OVP + Rechnung', 'neumann-tlm-102'],
    // "wie neu" is "like new": the likeness refusal names the maker, never the bare word.
    ['Neumann Tlm 103 wie Neu mit 2 Jahre Thomann Garantie + Holz Etui', 'neumann-tlm-103'],
    ['Neumann TLM 103 Studio Set mit Spinne – Wie neu – Erstbesitz', 'neumann-tlm-103'],
  ] as const) {
    assert.equal(slugOf(title), slug, title)
  }
})

test('another maker\'s mic "like a Neumann", a replica or a clone is no Neumann row', () => {
  for (const title of [
    // The one measured ad that slipped through before PAN-303: matched to the vintage U 87 at 375 €.
    'B.P.M. CR-73 Studiomikrofon Erstbesitz, wie Neumann U87',
    'DA 87i Mikrofon *Neumann U87i Replika*',
    'Peluso 2247 LE Röhren Großmembranmikrofon - Neumann U47 Klon',
  ]) {
    assert.equal(slugOf(title), null, title)
  }
})

test('pairs, bundles, capsules and wanted ads in Audio & Hifi stay refused', () => {
  for (const title of [
    'Neumann KM184 Stereo Set - Neuwertig!',
    'Neumann KM 184 mt matched Stereo Pair',
    'Neumann KM84 Mikrofone Paar',
    'Neumann TLM 102 Paar (Nickel) – Studio Set mit Spinnen und Koffer',
    'Neumann U 87 Ai Stereo Set',
    'Home Studio Set: Neumann TLM103, UAD Apollo X6, Yamaha HS8 uvm',
    'Neumann M7 Mikrofonkapsel (2x) – U47 / M49 - Rarität',
    'kk84 oder ck1 defekt fur akg c451 / neumann km84 mikrofon SUCHE',
  ]) {
    assert.equal(slugOf(title), null, title)
  }
})

test('consumer, karaoke and USB microphones name no row', () => {
  for (const title of [
    'Lenco DJ Mixer Bluetooth USB Radio Lichter Mikrofon Karaoke',
    'Kabelloses Bluetooth-Karaoke-Mikrofon in Roségold',
    'Tragbare Karaoke-Maschine mit 2 Mikrofonen',
    'Auna MIC-900 USB Kondensatormikrofon',
    'Beyerdynamic Fox USB Studiomikrofon',
    'Logitech G PRO X Wireless LIGHTSPEED Headset mit Mikrofon und USB',
  ]) {
    assert.equal(decideMatch(title, index).kind, 'none', title)
  }
})
