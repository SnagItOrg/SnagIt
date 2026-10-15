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

import { homeMarketFirst } from '../../frontend/lib/price-populations'

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
