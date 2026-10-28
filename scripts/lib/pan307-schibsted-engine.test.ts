/**
 * PAN-307: Finn and Blocket on the dba.dk engine. They used to search without
 * a category, by relevance, 3 pages deep, and never mark anything inactive;
 * ~2,000 rows stood "active" for 7+ days.
 *
 * No live request: fetch is replaced where the engine is exercised.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildSchibstedSearchUrl, scrapeSchibstedWithCoverage, FINN_CONFIG, BLOCKET_CONFIG, type QueryCoverage,
} from '../../frontend/lib/scrapers/schibsted'
import {
  SEARCH_OPTIONS, SCHIBSTED_MUSIC_SUB_CATEGORY, MAX_PAGES_FUSE, STALE_AFTER_DAYS,
  buildSearchQuery, computeScopeHash, coverageRowFor, sweepableQueries, sweepAllowed, staleCutoff,
  type CoverageRow,
} from './schibsted-market-scrape'

const ROOT = join(__dirname, '..', '..')

function variant(terminationReason: QueryCoverage['terminationReason'], pages = 2): QueryCoverage {
  return {
    query: 'q', queryStarted: true, queryCompleted: terminationReason !== 'error',
    pagesFetched: pages, terminationReason, rawCount: 53, parsedCount: 53, parseErrorCount: 0,
    paginationTokens: Array.from({ length: pages }, (_, i) => i + 1),
  }
}

test('both markets search Musikkinstrumenter, newest first — the dba.dk id', () => {
  assert.equal(SCHIBSTED_MUSIC_SUB_CATEGORY, '1.86.92')
  assert.deepEqual(SEARCH_OPTIONS, { subCategory: '1.86.92', sort: 'PUBLISHED_DESC' })
  assert.equal(
    buildSchibstedSearchUrl(FINN_CONFIG, 'fender stratocaster', 2, SEARCH_OPTIONS),
    'https://www.finn.no/recommerce/forsale/search?q=fender+stratocaster&sub_category=1.86.92&sort=PUBLISHED_DESC&page=2',
  )
  assert.equal(
    buildSchibstedSearchUrl(BLOCKET_CONFIG, 'fender stratocaster', 1, SEARCH_OPTIONS),
    'https://www.blocket.se/recommerce/forsale/search?q=fender+stratocaster&sub_category=1.86.92&sort=PUBLISHED_DESC',
  )
  // The fuse is a fuse, not the old 3-page cap.
  assert.ok(MAX_PAGES_FUSE >= 20)
  assert.equal(STALE_AFTER_DAYS, 3)
})

test('the query is still brand + canonical name, without a doubled brand', () => {
  assert.equal(buildSearchQuery('Roland', 'Juno-60'), 'Roland Juno-60')
  assert.equal(buildSearchQuery('Fender', 'Fender Stratocaster'), 'Fender Stratocaster')
})

test('a query is terminal only when every spelling variant reached its end', () => {
  const q = { query: 'Roland Juno-60', kg_product_id: 'p1' }
  assert.equal(coverageRowFor(q, [variant('empty_page'), variant('no_next_token')], 10).termination_reason, 'empty_page')
  assert.equal(coverageRowFor(q, [variant('no_next_token'), variant('max_pages_hit')], 10).termination_reason, 'max_pages_hit')
  assert.equal(coverageRowFor(q, [variant('max_pages_hit'), variant('error')], 10).termination_reason, 'error')
  assert.equal(coverageRowFor(q, [], 0).termination_reason, 'max_pages_hit', 'no evidence is not an end')
  const failed = coverageRowFor(q, null, 0)
  assert.equal(failed.termination_reason, 'error')
  assert.equal(failed.query_completed, false)
  const row = coverageRowFor(q, [variant('empty_page', 3), variant('no_next_token', 2)], 7)
  assert.equal(row.pages_fetched, 5)
  assert.equal(row.raw_count, 106)
  assert.equal(row.unique_staged_count, 7)
})

test('the sweep reaches only the queries that ended', () => {
  const rows = [
    coverageRowFor({ query: 'a', kg_product_id: 'p' }, [variant('no_next_token')], 1),
    coverageRowFor({ query: 'b', kg_product_id: 'p' }, [variant('max_pages_hit')], 1),
    coverageRowFor({ query: 'c', kg_product_id: 'p' }, null, 0),
    coverageRowFor({ query: 'd', kg_product_id: 'p' }, [variant('empty_page')], 1),
  ] satisfies CoverageRow[]
  assert.deepEqual(sweepableQueries(rows), ['a', 'd'])
})

test('the sweep waits for an established scope, a complete passed run and a promotion', () => {
  const ok = { dryRun: false, status: 'passed' as const, runScope: 'complete' as const, lifecycleEnabled: true, promoted: true }
  assert.equal(sweepAllowed(ok), true)
  assert.equal(sweepAllowed({ ...ok, lifecycleEnabled: false }), false, 'bootstrap run')
  assert.equal(sweepAllowed({ ...ok, runScope: 'targeted' }), false, '--product / --limit')
  assert.equal(sweepAllowed({ ...ok, status: 'quarantined' }), false)
  assert.equal(sweepAllowed({ ...ok, status: 'failed' }), false)
  assert.equal(sweepAllowed({ ...ok, dryRun: true }), false)
  assert.equal(sweepAllowed({ ...ok, promoted: false }), false)
})

test('the cutoff is three days before the run started', () => {
  assert.equal(staleCutoff('2026-10-28T01:00:00.000Z'), '2026-10-25T01:00:00.000Z')
})

test('each market has its own scope, stable under query order, renewed by a version bump', () => {
  const ids = ['b', 'a'], qs = ['Moog Minimoog', 'Fender Stratocaster']
  const finn = computeScopeHash(FINN_CONFIG, 'finn-2.0.0', ids, qs)
  assert.equal(finn, computeScopeHash(FINN_CONFIG, 'finn-2.0.0', [...ids].reverse(), [...qs].reverse()))
  assert.notEqual(finn, computeScopeHash(BLOCKET_CONFIG, 'finn-2.0.0', ids, qs))
  assert.notEqual(finn, computeScopeHash(FINN_CONFIG, 'finn-2.1.0', ids, qs))
  assert.notEqual(finn, computeScopeHash(FINN_CONFIG, 'finn-2.0.0', ids, ['Moog Minimoog']))
})

test('the engine pages to the end in the category, newest first, and reports it', async () => {
  const page = (ids: number[]) => `<html><script type="application/ld+json">${JSON.stringify({
    '@type': 'CollectionPage',
    mainEntity: { itemListElement: ids.map(id => ({ item: {
      url: `https://www.finn.no/recommerce/forsale/item/${id}`, name: `Ad ${id}`,
      offers: { price: '1000', priceCurrency: 'NOK' },
    } })) },
  })}</script></html>`
  const requested: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    requested.push(url)
    const p = Number(new URL(url).searchParams.get('page') ?? '1')
    // Past the end Schibsted omits the CollectionPage block.
    return new Response(p === 1 ? page([1, 2]) : p === 2 ? page([3]) : '<html></html>', { status: 200 })
  }) as typeof fetch
  try {
    const res = await scrapeSchibstedWithCoverage(FINN_CONFIG, 'klup testquery', MAX_PAGES_FUSE, SEARCH_OPTIONS)
    assert.deepEqual(res.listings.map(l => l.title), ['Ad 1', 'Ad 2', 'Ad 3'])
    assert.equal(res.coverage.length, 1)
    assert.equal(res.coverage[0].terminationReason, 'no_next_token')
    assert.equal(coverageRowFor({ query: 'klup testquery', kg_product_id: 'p' }, res.coverage, 3).termination_reason, 'empty_page')
    for (const u of requested) {
      assert.match(u, /&sub_category=1\.86\.92&sort=PUBLISHED_DESC/)
    }
    // Page 3 twice: the past-the-end answer is re-checked before it counts.
    assert.deepEqual(requested.map(u => new URL(u).searchParams.get('page')), [null, '2', '3', '3'])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('scrape-finn and scrape-blocket publish only through the engine', () => {
  for (const source of ['finn', 'blocket']) {
    const src = readFileSync(join(ROOT, 'scripts', `scrape-${source}.ts`), 'utf8')
    assert.ok(src.includes(`monitoredSlugs('${source}')`), 'same product set')
    assert.ok(src.includes('runSchibstedMarket('))
    assert.ok(!src.includes(".from('listings')"), `scrape-${source} must not write listings directly`)
    assert.match(src, /const SCRAPER_VERSION = '(finn|blocket)-2\.0\.0'/)
  }
})

test('the engine writes listings only through promotion and one per-query sweep', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'lib', 'schibsted-market-scrape.ts'), 'utf8')
  assert.equal((src.match(/\.from\('listings'\)/g) ?? []).length, 1, 'the sweep is the only direct listings write')
  assert.match(
    src,
    /if \(sweepAllowed\(\{[^\n]*\}\) && sweepQueries\.length > 0\) \{\s*const \{ error: staleError, count \} = await supabase\s*\.from\('listings'\)\s*\.update\(\{ is_active: false, delisted_at: new Date\(\)\.toISOString\(\) \}, \{ count: 'exact' \}\)\s*\.eq\('source', config\.source\)\s*\.eq\('is_active', true\)\s*\.not\('coverage_scope_hash', 'is', null\)\s*\.in\('source_query', sweepQueries\)\s*\.lt\('scraped_at', staleCutoff\(run\.startedAt\)\)/,
    'the sweep must sit behind sweepAllowed, on this source, on rows promotion stamped, per terminal query, by last-seen time before the run started',
  )
  assert.ok(src.includes('promoteRunAtomic(supabase, runId, { coverageComplete, lifecycleEnabled })'))
})
