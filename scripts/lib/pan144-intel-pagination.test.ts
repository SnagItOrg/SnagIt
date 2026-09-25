/**
 * PAN-144 — /intel reads its matched listings to exhaustion.
 *
 * PostgREST caps a response at 1,000 rows. The /intel read had no range(), and
 * on 2026-09-25 its set was 2,495 rows: the page received 1,000 and computed
 * every median and delta from them. Roland Juno-106 showed no DK median at all
 * (6 listings existed) and Fender Stratocaster read SE 19,499 against a
 * complete 13,647.
 *
 * The loader needs a live Supabase client, so this guards the query shape the
 * same way pan134-reverb-null-country.test.ts guards scrape-reverb.ts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('/intel pages its listing_product_match read on a unique order', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'frontend', 'app', 'intel', 'page.tsx'), 'utf8')
  const reads = src.split(".from('listing_product_match')")
  assert.equal(reads.length, 2, 'expected exactly one listing_product_match read in intel/page.tsx')

  const query = reads[1].slice(0, reads[1].indexOf('\n\n'))
  assert.ok(query.includes('.range(from, to)'), 'the read must be paged with range()')
  assert.ok(query.includes(".order('id'"), 'paging needs the unique id order to be deterministic')
  assert.ok(src.includes('fetchAllPages('), 'the read must go through lib/exhaustive-fetch')
})
