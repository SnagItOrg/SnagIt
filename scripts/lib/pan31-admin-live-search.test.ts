/**
 * PAN-31 — the restored admin-only multi-platform live search.
 *
 * WHAT WAS LOST. `frontend/app/api/scrape/route.ts` was deleted in 1ae0b7f
 * ("Stage 3 WP-4: replace the live-scrape SERP with a catalogue resolver").
 * It was the public SERP's orchestration layer, and it declared:
 *
 *   const ALL_SOURCES = ['dba', 'finn', 'blocket', 'kleinanzeigen', 'reverb', 'thomann']
 *
 * plus a URL mode that resolved a pasted DBA / Thomann / Reverb link, and a
 * `.catch(() => [])` on every source job. The admin successor
 * `/api/admin/product/[slug]/scrape-platform` carried over five of the six
 * sources, neither the URL mode nor the failure isolation.
 *
 * WHAT MUST NOT COME BACK. The deleted route upserted into `listings` and
 * `thomann_product` on every unauthenticated request. Restoring the search
 * must not restore the write.
 *
 * WHY THESE ARE SOURCE ASSERTIONS. A Next.js route module may export only its
 * HTTP verbs, so the orchestration inside POST has no importable seam, and
 * importing the module itself needs the Next runtime and live Supabase
 * credentials. Both contracts under test are structural — "the gate runs
 * first", "this file contains no write" — and the repo already pins route
 * contracts this way (`wp1-public-contract.test.ts`, `wp4-search.test.ts`).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROUTE_ACCESS } from '../../frontend/lib/route-access'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

const read = (...parts: string[]) => readFileSync(join(FRONTEND, ...parts), 'utf8')

/** Source with comments stripped, so prose about a write is not read as one. */
const readCode = (...parts: string[]) =>
  read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const SEARCH_ROUTE = ['app', 'api', 'admin', 'product', '[slug]', 'scrape-platform', 'route.ts']
const SAVE_ROUTE = ['app', 'api', 'admin', 'product', '[slug]', 'save-listing', 'route.ts']
const CURATION_UI = ['app', 'admin', 'product', '[slug]', 'ProductCurationClient.tsx']

/** The six sources of the deleted route's ALL_SOURCES. Craigslist never existed. */
const FORMER_SOURCES = ['dba', 'finn', 'blocket', 'kleinanzeigen', 'reverb', 'thomann']

test('live search restores the former source set, stays gated and read-only, and isolates a failing source', () => {
  const src = readCode(...SEARCH_ROUTE)
  const ui = readCode(...CURATION_UI)

  // ── the gate, before any external work ──────────────────────────────────
  assert.equal(
    ROUTE_ACCESS.find((r) => r.route === '/api/admin/product/[slug]/scrape-platform')?.access,
    'admin_api',
    'live search must be classified admin_api, never public',
  )
  // The gate is the first statement of the handler: nothing is parsed, fetched
  // or scraped before it. Adapter definitions live above POST and are inert.
  const body = src.slice(src.indexOf('export async function POST'))
  const gate = body.indexOf('requireAdminInRoute()')
  assert.ok(gate > 0, 'POST must call requireAdminInRoute()')
  for (const work of ['req.json()', 'detectListingUrl(', 'fetchListingFromUrl(', 'SCRAPERS[platform]']) {
    const at = body.indexOf(work)
    assert.notEqual(at, -1, `POST must reach ${work}`)
    assert.ok(at > gate, `${work} must not run before the admin gate`)
  }

  // ── the source set, derived from the deleted route ──────────────────────
  const declared = src.match(/const VALID_PLATFORMS: Platform\[\] = \[([^\]]+)\]/)
  assert.ok(declared, 'VALID_PLATFORMS must be declared')
  const platforms = declared[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  assert.deepEqual(platforms.sort(), [...FORMER_SOURCES].sort(), 'every former source must be searchable')
  for (const p of FORMER_SOURCES) {
    assert.match(src, new RegExp(`\\n\\s+${p}: \\(query: string\\)`), `${p} needs an adapter in SCRAPERS`)
  }
  // "Alle" sent four of six before PAN-31, silently dropping Reverb and Thomann.
  assert.ok(
    ui.includes('ALL_SEARCH_PLATFORMS'),
    "the 'Alle' toggle must fan out over the declared option list, not a hardcoded subset",
  )
  assert.equal(
    /platform === 'all'\s*\?\s*\[/.test(ui), false,
    "the 'Alle' toggle must not carry its own literal source list",
  )

  // ── URL mode: a pasted DBA / Thomann / Reverb link resolves to one listing ──
  assert.ok(src.includes('detectListingUrl('), 'URL mode must be restored')
  assert.ok(
    src.indexOf('detectListingUrl(') < src.indexOf('SCRAPERS[platform]'),
    'a recognised listing URL must short-circuit before the query scrapers run',
  )

  // ── one failing source must not erase another source's results ──────────
  assert.ok(
    /catch \(err\) \{[\s\S]*?listings: \[\] as RawScrapedListing\[\], failed: true/.test(src),
    'each source must be caught individually and reported as failed, not thrown',
  )
  assert.ok(src.includes('failedSources'), 'the failed source must be named to the operator')
  assert.equal(
    /error: (err instanceof Error \? err\.message : String\(err\)) \}, \{ status: 5/.test(src), false,
    'no raw upstream message may be returned to the client',
  )
  assert.ok(ui.includes('failedSources'), 'the UI must surface a partial failure without discarding results')

  // ── search is preview only: no write, no match, no learned alias ─────────
  for (const write of ['.upsert(', '.insert(', '.update(', '.delete(', 'listing_product_match', 'synonym']) {
    assert.equal(src.includes(write), false, `live search must not reference ${write}`)
  }
  // The deleted route's public CDN cache must not come back on an admin response.
  assert.equal(src.includes('s-maxage'), false, 'an admin search response must not be publicly cached')
})

test('attachment is the only write path and reuses the existing provenance and duplicate handling', () => {
  const src = readCode(...SAVE_ROUTE)
  const ui = readCode(...CURATION_UI)

  // Attachment is admin-gated too, and is reused rather than reimplemented:
  // PAN-31 must not have touched it.
  assert.equal(
    ROUTE_ACCESS.find((r) => r.route === '/api/admin/product/[slug]/save-listing')?.access,
    'admin_api',
  )
  assert.ok(src.indexOf('requireAdminInRoute()') < src.indexOf('getSupabaseAdmin()'))

  // Provenance: the existing convention, not a parallel matching model.
  assert.ok(src.includes("onConflict: 'external_id,source'"), 'listing identity is (external_id, source)')
  assert.ok(src.includes("method: 'FUZZY'"), 'manual curation is recorded as FUZZY, per /api/admin/match/approve')
  assert.ok(src.includes('is_valid: true'), 'an explicitly attached listing is a confirmed match')
  assert.ok(src.includes('sanitizeListingPrice'), 'price integrity is applied on the write path')

  // Duplicates are state, not an error: re-attaching an already-matched listing
  // must not surface a Postgres unique-violation message.
  assert.ok(
    /onConflict: 'listing_id,product_id', ignoreDuplicates: true/.test(src),
    'a repeat attach must be idempotent',
  )

  // The write happens only on an explicit operator action. Searching must not
  // reach the save path, and the search results list must not auto-save.
  const searchHandler = ui.slice(ui.indexOf('async function handleSearch'), ui.indexOf('async function handleSave'))
  assert.equal(searchHandler.includes('save-listing'), false, 'searching must not attach anything')
  assert.ok(ui.includes('savedUrls'), 'the UI must confirm the resulting state per listing')
})
