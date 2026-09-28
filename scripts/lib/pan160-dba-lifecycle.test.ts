/**
 * PAN-160: every scrape-dba run reported coverage_complete=false, so dba
 * delisting never ran. The cause was the zero-result search page.
 *
 * No live dba request: fetch is replaced by the recorded pages in
 * scripts/fixtures (dba-zero.html is a real "ampex atr-700" search).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fetchSchibstedPage, DBA_CONFIG } from '../../frontend/lib/scrapers/schibsted'

const ROOT = join(__dirname, '..', '..')

test('a recorded zero-result search reads as an empty page for its own query only', async () => {
  const zeroPage = readFileSync(join(ROOT, 'scripts', 'fixtures', 'dba-zero.html'), 'utf8')
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(zeroPage, { status: 200 })) as typeof fetch
  try {
    // The page has no CollectionPage block. Before PAN-160 that was always
    // "unreadable", so the query ended as `error` and coverage was never complete.
    const own = await fetchSchibstedPage(DBA_CONFIG, 'ampex atr-700', 1)
    assert.equal(own.schemaValid, true, 'the search state says 0 results for this query')
    assert.equal(own.rawCount, 0)
    assert.deepEqual(own.listings, [])

    // The same page answering a different query proves nothing about ours.
    const other = await fetchSchibstedPage(DBA_CONFIG, 'roland juno-106', 1)
    assert.equal(other.schemaValid, false, 'a zero answer for another query must stay unreadable')
  } finally {
    globalThis.fetch = realFetch
  }
})
