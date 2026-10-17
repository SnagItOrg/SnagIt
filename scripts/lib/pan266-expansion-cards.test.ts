/**
 * scripts/lib/pan266-expansion-cards.test.ts
 *
 * PAN-266: a Roland wave-expansion card (SN-U110-xx, SR-JV80-xx, SRX-xx) is a part, never the module it
 * expands. The DBA backfill of 2026-10-16 matched "Roland SN‑U110‑08 – PCM expansionskort" (DBA 12816052)
 * to roland-u-110 — the manager rejected the row — because its hyphens were U+2011 and "U110" stood free.
 * Every title is a production title (read-only, 2026-10-17) unless marked.
 *
 * Run: npx tsx --test scripts/lib/pan266-expansion-cards.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMatchIndex, decideMatch, foldHyphens, lineBoundaryRefusal, modelCodeForm, type Product } from '../../frontend/lib/matching/match-listings'
import { namesProduct } from './recall-canary'

const product = (slug: string, model_name: string): Product => ({
  id: `p-${slug}`, slug, canonical_name: `Roland ${model_name}`, model_name, brand_name: 'roland',
  status: 'active', support_state: 'supported',
})

// The hosts the cards expand, with the production model names.
const index = buildMatchIndex([
  product('roland-u-110', 'U-110'),
  product('roland-u-20', 'U-20'),
  product('roland-d-70', 'D-70'),
  product('roland-jv-1080', 'JV-1080'),
  product('roland-jv-2080', 'JV-2080'),
  product('roland-xp-30', 'XP-30'),
  product('roland-xp-50', 'XP-50'),
  product('roland-xv-3080', 'XV-3080'),
  product('roland-xv-5080', 'XV-5080'),
  product('roland-jd-990', 'JD-990'),
  product('roland-fantom-x6', 'Fantom-X6'),
], [], [], ['roland'])

const decide = (title: string) => {
  const d = decideMatch(title, index)
  return d.kind === 'matched' ? index.productById.get(d.best.product_id)?.slug : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
}
const matches = (title: string, slug: string) => assert.equal(decide(title), slug, title)
const notMatched = (title: string) => {
  const d = decide(title)
  assert.ok(d === 'none' || d === 'rejected' || String(d).startsWith('deferred:'), `${title} → ${d}`)
}

test('a non-breaking hyphen is a hyphen: the card code stays glued and names no host', () => {
  assert.equal(modelCodeForm('Roland SN‑U110‑08'), modelCodeForm('Roland SN-U110-08'))
  assert.equal(modelCodeForm('Roland SN‑U110‑08'), 'roland sn u 110-08')
  // An en dash is a separator, not a hyphen.
  assert.equal(foldHyphens('SN‑U110‑08 – PCM'), 'SN-U110-08 – PCM')
  // The recall canary reads the same code form, so the card never names the U-110 in its denominator.
  assert.equal(namesProduct('Roland SN‑U110‑08 – PCM expansionskort', 'U-110'), false)
  assert.equal(namesProduct('Roland U-110 sound module', 'U-110'), true)
})

test('a PCM / wave-expansion card is not the module it expands', () => {
  // The DBA ad, as written (U+2011), and the boundary's reason once the title is read.
  notMatched('Roland SN‑U110‑08 – PCM expansionskort')
  assert.equal(lineBoundaryRefusal('roland sn-u110-08 – pcm expansionskort', 'roland-u-110'), 'accessory:expansionskort')
  assert.equal(lineBoundaryRefusal('roland u-110 sn-u110-07', 'roland-u-110'), 'accessory:sn-u110-07')
  notMatched('Expansion, Roland SN-U110-06')
  notMatched('Roland U-110 - SN-U110-07 "Electric Guitar" Expansion Card 1990s - Black / Blue')
  notMatched('Roland U-110 Sound Library PCM Data ROM Cards SN-U110-02 SN-U110-10 Latin&FX Roc')
  notMatched('Roland SN-U110-11 Sound Effects PCM Data Card for U-110, U-220 MIJ')
  notMatched('Roland SR-JV80-02 Orchestral ekspansionsboard til synth')
  notMatched('Roland SR-JV80-04 Vintage Synth Expansion Board')
  notMatched('Roland Expansion Board SRX-01 Dynamic Drum Kits Card for XV-3080 XV-5080 Fantom etc')
  notMatched('ROLAND Expansion Board SRX-99 Special Wave Expansion, für Fantom-S, Fantom-S88, Fantom-X6, Fantom-X7, Fantom-X8 und Fantom-XR')
  notMatched('ROLAND SRX-07 Ultimate Keys Expansion X6/XR/XV/2020/3080/XV5080 / + 1 J GEWÄHR!')
})

test('a module sold with a card keeps its inclusion marker, and the bare module still matches', () => {
  matches('ROLAND JV-1080 w/SR-JV80-06 [ZG72989] (10/06)', 'roland-jv-1080')  // a trusted production match
  matches('Roland Super JD-990 Sound Module + Roland SR-JV80-04 Vintage Synth Expansion Board', 'roland-jd-990')
  matches('Roland XV-3080 128-Voice Rackmount Synthesizer Module  incl. SR-JV80-12 Hip Hop Expansion', 'roland-xv-3080')
  matches('Roland XP-30 61-Key 64-Voice Expandable Synthesizer w/ Roland SR-JV80-15 Special FX Collection Expansion Board', 'roland-xp-30')
  matches('Roland U-110 sound module', 'roland-u-110')  // synthetic
})
