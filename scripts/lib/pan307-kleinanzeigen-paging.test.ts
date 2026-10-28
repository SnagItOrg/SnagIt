/**
 * scripts/lib/pan307-kleinanzeigen-paging.test.ts
 *
 * PAN-307: the Kleinanzeigen scraper pages every search newest first to its end instead of 3 pages × 25, and
 * its stale sweep never retires a row a capped search may simply not have reached.
 *
 * The site's behaviour below was measured on 2026-10-28 (read-only, unauthenticated, 4–6 s apart): the
 * `breadcrumb-summary` lines are copied from the answers, and the fake site reproduces what the probe saw —
 * 50 pages at most, page 1 again past the end, and a valid page that sometimes answers empty.
 *
 * Run: npx tsx --test scripts/lib/pan307-kleinanzeigen-paging.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'

import {
  KLEINANZEIGEN_MAX_PAGES,
  KLEINANZEIGEN_PAGE_SIZE,
  normalizeText,
  pageSearch,
  parseResultSummary,
  sweepShieldPhrase,
  type SearchPage,
} from './kleinanzeigen-paging'

const summaryHtml = (text: string) =>
  `<h1><span id="srp-breadcrumb-summary" class="text-bodyRegular font-strong text-onSurface">${text}</span></h1>`

test('the result summary is read as numbers, German thousands included', () => {
  assert.deepEqual(
    parseResultSummary(summaryHtml('1 - 25 von 1.854 Musikinstrumente für „fender stratocaster“ in Deutschland')),
    { from: 1, to: 25, total: 1854 },
  )
  assert.deepEqual(
    parseResultSummary(summaryHtml('1.226 - 1.250 von 1.855 Musikinstrumente für „fender stratocaster“ in Deutschland')),
    { from: 1226, to: 1250, total: 1855 },
  )
  assert.deepEqual(
    parseResultSummary(summaryHtml('351 - 353 von 353 Musikinstrumente für „fender jazz bass“ in Deutschland')),
    { from: 351, to: 353, total: 353 },
  )
  assert.deepEqual(
    parseResultSummary(summaryHtml('Es wurden keine Musikinstrumente für „fender stratocaster“ in Deutschland gefunden,')),
    { from: 0, to: 0, total: 0 },
  )
  // No summary, or one in a shape nobody measured, is no evidence of where the search ends.
  assert.equal(parseResultSummary('<html><body><article data-adid="1"></article></body></html>'), null)
  assert.equal(parseResultSummary(summaryHtml('Musikinstrumente in Deutschland')), null)
})

// ── A fake Kleinanzeigen ─────────────────────────────────────────────────────────────────────────────────────────

type Fake = { fetchPage: (page: number) => Promise<SearchPage<string>>; requested: number[] }

/**
 * A search of `total` ads, answering as the site did: 50 pages at most, page 1 again for a page past the end
 * or past 50, and the soft empty answer for every (page, attempt) listed in `softEmpty`.
 */
function fakeSite(total: number, softEmpty: Array<[page: number, attempt: number]> = []): Fake {
  const requested: number[] = []
  const attempts = new Map<number, number>()
  const answer = (page: number): SearchPage<string> => {
    if (total === 0) return { listings: [], summary: { from: 0, to: 0, total: 0 } }
    const from = (page - 1) * KLEINANZEIGEN_PAGE_SIZE + 1
    const to = Math.min(page * KLEINANZEIGEN_PAGE_SIZE, total)
    const listings = Array.from({ length: to - from + 1 }, (_, i) => `ad-${from + i}`)
    return { listings, summary: { from, to, total } }
  }
  return {
    requested,
    fetchPage: async (page) => {
      requested.push(page)
      const attempt = (attempts.get(page) ?? 0) + 1
      attempts.set(page, attempt)
      if (softEmpty.some(([p, a]) => p === page && a === attempt)) {
        return { listings: [], summary: { from: 0, to: 0, total: 0 } }
      }
      const lastPage = Math.ceil(total / KLEINANZEIGEN_PAGE_SIZE)
      if (page > KLEINANZEIGEN_MAX_PAGES) return answer(KLEINANZEIGEN_MAX_PAGES)
      if (page > Math.max(lastPage, 1)) return answer(1)
      return answer(page)
    },
  }
}

const noPause = async () => {}
const opts = { maxPages: KLEINANZEIGEN_MAX_PAGES, pause: noPause, retryPause: noPause }

test('a small search costs one request and is not read again as page 2 and 3', async () => {
  // roland juno 106: 12 ads. `?pageNum=2` answered page 1, so the old loop read it three times.
  const site = fakeSite(12)
  const res = await pageSearch(site.fetchPage, opts)
  assert.deepEqual(site.requested, [1])
  assert.equal(res.outcome, 'end')
  assert.equal(res.listings.length, 12)
})

test('a full last page is still the end: 25 of 25 asks for nothing more', async () => {
  const site = fakeSite(25)
  const res = await pageSearch(site.fetchPage, opts)
  assert.deepEqual(site.requested, [1])
  assert.equal(res.outcome, 'end')
})

test('a mid-sized search is read to its last page, every ad once', async () => {
  // fender jazz bass: 353 ads, page 15 answered "351 - 353 von 353".
  const site = fakeSite(353)
  const res = await pageSearch(site.fetchPage, opts)
  assert.deepEqual(site.requested, Array.from({ length: 15 }, (_, i) => i + 1))
  assert.equal(res.outcome, 'end')
  assert.equal(new Set(res.listings).size, 353)
})

test('a search above 1,250 ads is capped at page 50, and says so', async () => {
  // fender stratocaster: 1,855 ads; `?pageNum=51` redirected to `seite:50`.
  const site = fakeSite(1855)
  const res = await pageSearch(site.fetchPage, opts)
  assert.equal(site.requested.length, 50)
  assert.equal(res.outcome, 'capped')
  assert.equal(res.listings.length, 1250)
})

test('a soft empty page is read once more, and the search goes on when it answers', async () => {
  // Page 30 of Stratocaster answered "Es wurden keine … gefunden" once, and normally on the second read.
  const site = fakeSite(800, [[30, 1]])
  const res = await pageSearch(site.fetchPage, opts)
  assert.equal(res.outcome, 'end')
  assert.equal(new Set(res.listings).size, 800)
  assert.deepEqual(site.requested.filter((p) => p === 30), [30, 30])
})

test('a page that stays empty fails the search; it is never taken for the end', async () => {
  const site = fakeSite(800, [[30, 1], [30, 2]])
  const res = await pageSearch(site.fetchPage, opts)
  assert.equal(res.outcome, 'failed')
  assert.equal(res.listings.length, 29 * KLEINANZEIGEN_PAGE_SIZE, 'what was read before the failure is kept')
  assert.equal(site.requested.at(-1), 30, 'and nothing after it is asked for')
})

test('a page that answers as another page fails the search', async () => {
  // A redirect to page 1 mid-search (a shrinking search, a changed URL scheme) must not pass as page n.
  const site = fakeSite(100)
  const redirected: Fake['fetchPage'] = (page) => site.fetchPage(page === 3 ? 1 : page)
  assert.equal((await pageSearch(redirected, opts)).outcome, 'failed')
})

test('a page with a summary but no readable card fails the search (a markup change)', async () => {
  const unreadable = async (page: number): Promise<SearchPage<string>> =>
    ({ listings: [], summary: { from: (page - 1) * 25 + 1, to: page * 25, total: 300 } })
  assert.equal((await pageSearch(unreadable, opts)).outcome, 'failed')
  const noSummary = async (): Promise<SearchPage<string>> => ({ listings: ['ad-1'], summary: null })
  assert.equal((await pageSearch(noSummary, opts)).outcome, 'failed')
})

test('an empty search is confirmed once, then is an empty search', async () => {
  const site = fakeSite(0)
  const res = await pageSearch(site.fetchPage, opts)
  assert.deepEqual(site.requested, [1, 1])
  assert.equal(res.outcome, 'end')
  assert.equal(res.listings.length, 0)
  // A first empty answer that the second read contradicts is a normal search.
  const flaky = fakeSite(12, [[1, 1]])
  assert.equal((await pageSearch(flaky.fetchPage, opts)).listings.length, 12)
})

test('every page after the first waits for the pause, every retry for the retry pause', async () => {
  const calls: string[] = []
  const site = fakeSite(80, [[2, 1]])
  await pageSearch(
    async (page) => { calls.push(`get ${page}`); return site.fetchPage(page) },
    { maxPages: 50, pause: async () => { calls.push('pause') }, retryPause: async () => { calls.push('retry') } },
  )
  assert.deepEqual(calls, ['get 1', 'pause', 'get 2', 'retry', 'get 2', 'pause', 'get 3', 'pause', 'get 4'])
})

test('an HTTP error still propagates, so the caller counts a failed request', async () => {
  await assert.rejects(
    pageSearch(async () => { throw new Error('kleinanzeigen fetch failed: 403 Forbidden') }, opts),
    /403/,
  )
})

// ── The sweep shield ─────────────────────────────────────────────────────────────────────────────────────────────

test('the shield phrase is the model without the brand, in the stored alphabet', () => {
  assert.equal(sweepShieldPhrase('Fender', 'Fender Stratocaster'), 'stratocaster')
  assert.equal(sweepShieldPhrase('Fender', 'Stratocaster'), 'stratocaster')
  assert.equal(sweepShieldPhrase('Gibson', 'Gibson Les Paul'), 'les paul')
  // A canonical name that is only the brand falls back to the whole name rather than shielding nothing — or everything.
  assert.equal(sweepShieldPhrase('Wurlitzer', 'Wurlitzer'), 'wurlitzer')
  // What the sweep's ILIKE compares against: the scraper's own normalized_text.
  assert.ok(normalizeText('FENDER Stratocaster 1969, OHSC').includes(sweepShieldPhrase('Fender', 'Fender Stratocaster')))
  assert.ok(normalizeText('Gibson Les-Paul Standard').includes(sweepShieldPhrase('Gibson', 'Gibson Les Paul')))
  assert.match(sweepShieldPhrase('Roland', 'Roland Juno-106'), /^[a-z0-9 ]+$/, 'nothing PostgREST would need quoted')
})

// ── The wiring, from source: importing the scraper would start a scrape ─────────────────────────────────────────

const src = fs.readFileSync(path.resolve(__dirname, '../scrape-kleinanzeigen.ts'), 'utf8')

test('the scraper pages through the shared helper, to the site cap, at least 2 s apart with jitter', () => {
  assert.match(src, /scrapeKleinanzeigen\(product\.query, product\.categories, KLEINANZEIGEN_MAX_PAGES\)/)
  assert.match(src, /return pageSearch\(page => fetchKleinanzeigenPage\(normalizedQ, page, category\)/)
  const delay = Number(src.match(/const PAGE_DELAY_MS = (\d+)\n/)?.[1])
  assert.ok(delay >= 2000, `PAGE_DELAY_MS is ${delay}; scripts/CLAUDE.md asks ≥2s between requests`)
  assert.match(src, /pause: \(\) => jittered\(PAGE_DELAY_MS, PAGE_JITTER_MS\)/)
  assert.ok(Number(src.match(/const PAGE_JITTER_MS = (\d+)\n/)?.[1]) > 0)
  // The empty-page break is gone: an empty page is a failure to retry, never the end.
  assert.doesNotMatch(src, /if \(pageResults\.length === 0\) break/)
})

test('a failed search blocks the sweep, and a capped one shields its model', () => {
  assert.match(src, /if \(result\.outcome === 'failed'\) requestFailed = true/)
  assert.match(src, /if \(capped\) sweepShield\.add\(sweepShieldPhrase\(product\.brand_name, product\.canonical_name\)\)/)
  assert.match(
    src,
    /\.lt\('scraped_at', cutoff\)\n[\s\S]{0,120}for \(const phrase of sweepShield\) sweep = sweep\.not\('normalized_text', 'ilike', `%\$\{phrase\}%`\)\n\s*const \{ error: staleError, count \} = await sweep\n/,
    'every shielded phrase must narrow the one sweep statement before it runs',
  )
  // The stored text the shield is compared with comes from the same function.
  assert.match(src, /normalized_text: normalizeText\(listing\.title\)/)
  assert.doesNotMatch(src, /function normalizeText/)
})

test('a row the old sweep retired while still live comes back on the first run that sees it — no SQL needed', () => {
  // 2026-10-28: 4,673 kleinanzeigen rows inactive, 3,682 of them last seen within 30 days. Every row the scraper
  // writes carries is_active: true, and the upsert updates on conflict instead of skipping the existing row.
  assert.match(src, /external_id: listing\.url,\s*is_active: true,/)
  assert.match(src, /onConflict: 'external_id,source',\s*ignoreDuplicates: false,/)
})
