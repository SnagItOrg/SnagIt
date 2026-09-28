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

test('scrape-dba sweeps stale rows only where the database applied lifecycle', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'scrape-dba.ts'), 'utf8')
  const sweeps = src.match(/\.update\(\{ is_active: false/g) ?? []
  assert.equal(sweeps.length, 1, 'exactly one stale sweep')
  assert.match(
    src,
    /if \(pr\.lifecycleApplied && run\) \{\s*const cutoff = new Date\(Date\.parse\(run\.startedAt\) - STALE_AFTER_DAYS[^\n]*\n[\s\S]{0,200}\.update\(\{ is_active: false, delisted_at: new Date\(\)\.toISOString\(\) \}, \{ count: 'exact' \}\)\s*\.eq\('source', 'dba\.dk'\)\s*\.eq\('is_active', true\)\s*\.lt\('scraped_at', cutoff\)/,
    'the sweep must sit behind lifecycleApplied, on dba only, by last-seen time before the run started',
  )
  assert.match(src, /const STALE_AFTER_DAYS = 3\n/)
})
