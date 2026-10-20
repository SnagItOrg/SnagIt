/**
 * scripts/lib/pan266-wall-home-market.test.ts
 *
 * PAN-266: the product wall's page never drops a Danish ad for a foreign one. Measured on
 * 2026-10-15: the Juno-106 wall rendered 50 Reverb/Kleinanzeigen/Finn rows and 0 of its 5 live,
 * matched DBA ads, because the page is the 50 newest `scraped_at` and Reverb is scraped after DBA
 * every night. The DS-1 (0 of 7) and the Les Paul Studio (0 of 9) were the same.
 *
 * Run: npx tsx --test scripts/lib/pan266-wall-home-market.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { homeMarketFirst, isHomeMarket } from '../../frontend/lib/price-populations'
import { translations } from '../../frontend/lib/i18n'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

type Row = { id: string; source: string | null; country: string | null }
const reverb = (i: number): Row => ({ id: `r${i}`, source: 'reverb', country: null })
const dba = (i: number): Row => ({ id: `d${i}`, source: 'dba.dk', country: 'DK' })

test('the Danish listings lead, in their own order; the rest keep theirs', () => {
  // A night's wall: 60 Reverb rows scraped at 02:00, 5 DBA rows scraped at 00:30, newest first.
  const newestFirst = [...Array.from({ length: 60 }, (_, i) => reverb(i)), ...Array.from({ length: 5 }, (_, i) => dba(i))]
  const page = homeMarketFirst(newestFirst).slice(0, 50)
  assert.deepEqual(page.slice(0, 5).map((l) => l.id), ['d0', 'd1', 'd2', 'd3', 'd4'])
  assert.deepEqual(page.slice(5).map((l) => l.id), Array.from({ length: 45 }, (_, i) => `r${i}`))
})

test('"Danish" is decided by classifyListing: by country, or by source when the country is missing', () => {
  const rows: Row[] = [
    reverb(0),
    { id: 'legacy', source: 'dba.dk', country: null },
    { id: 'finn', source: 'finn', country: 'NO' },
    { id: 'dk-country', source: 'kleinanzeigen', country: 'DK' },
  ]
  assert.deepEqual(homeMarketFirst(rows).map((l) => l.id), ['legacy', 'dk-country', 'r0', 'finn'])
  assert.deepEqual(homeMarketFirst([]), [])
})

test('the route builds the page from homeMarketFirst, before the display limit', () => {
  const route = readFileSync(join(FRONTEND, 'app', 'api', 'product', '[slug]', 'route.ts'), 'utf8')
  assert.match(route, /const listings = homeMarketFirst\(allListings\)\.slice\(0, DISPLAY_LISTING_LIMIT\)/)
})

// PAN-274: the seam the page draws is the seam the ordering already has.

test('isHomeMarket is the predicate homeMarketFirst orders by', () => {
  const rows: Row[] = [reverb(0), dba(0), { id: 'finn', source: 'finn', country: 'NO' }, { id: 'legacy', source: 'dba.dk', country: null }]
  const ordered = homeMarketFirst(rows)
  const home = rows.filter(isHomeMarket).map((l) => l.id)
  assert.deepEqual(ordered.slice(0, home.length).map((l) => l.id), home)
  assert.ok(ordered.slice(home.length).every((l) => !isHomeMarket(l)))
  assert.equal(isHomeMarket({ source: 'reverb', country: 'DK' }), false, 'Reverb is never the home market, whatever its country')
})

test('the page splits the wall with isHomeMarket and draws the seam only between two non-empty groups', () => {
  const page = readFileSync(join(FRONTEND, 'app', '(shell)', 'product', '[slug]', 'page.tsx'), 'utf8')
  assert.match(page, /\(isHomeMarket\(listing\) \? home : away\)\.push\(listing\)/)
  assert.match(page, /seam: home\.length > 0 && away\.length > 0/)
  assert.match(page, /\{group\.seam \? \(\s*<ListSection/)
  // The note names Reverb only when every listing in the group is Reverb.
  assert.match(page, /every\(\(l\) => l\.source === REVERB_SOURCE\)\s*\? t\.wallSeamReverb\s*: t\.wallSeamOwnMarket/)
  // The sort runs inside each group: a Reverb "under" never outranks a Danish "typisk".
  assert.match(page, /orderByVerdictRank\(group,/)
  assert.doesNotMatch(page, /orderByVerdictRank\(listings,/)
})

test('the seam names its basis in words, in both locales, and the badge copy is untouched', () => {
  for (const locale of ['da', 'en'] as const) {
    const t = translations[locale] as Record<string, string>
    assert.doesNotMatch(t.wallSeamLabel, /\{count\}/, 'PAN-279: no count in a group header')
    assert.ok(/Reverb/.test(t.wallSeamReverb) && !/Reverb/.test(t.wallSeamOwnMarket))
    assert.equal(t.verdictBasisReverbFallback, locale === 'da' ? 'målt mod Reverb' : 'measured against Reverb')
  }
  // ListSection (PAN-279): Astryx's CommandPaletteGroup heading — a named group,
  // a left-aligned 12px secondary heading, no rules, no count; the note and the
  // muted region optional. No copy of its own.
  const section = readFileSync(join(FRONTEND, 'components', 'ListSection.tsx'), 'utf8')
  assert.match(section, /role="group" aria-labelledby=\{headingId\}/)
  assert.match(section, /<p id=\{headingId\} className="text-xs font-medium text-ink-secondary">/)
  assert.doesNotMatch(section, /role="separator"|border-t|text-center|\{count\}/)
  assert.match(section, /\{note && <p/)
  assert.match(section, /muted \? <div className="list-section-muted">\{children\}<\/div> : children/)
  assert.doesNotMatch(section, /from '@\/lib\/i18n'/)
})
