/**
 * scripts/scrape-dba.ts
 *
 * Fetches DBA.dk listings for knowledge-graph products and upserts them into
 * `listings`, AND appends an asking-price observation per listing into
 * `market_price_observations` so DK asking-price history accumulates over time.
 *
 * WHY DBA MATTERS MOST: it's the Danish home market — the local-market price
 * gaps that drive KUP value live here. Until now there was no DBA cron job at
 * all (dba.dk last scraped 2026-07-04, only 17 of 6,536 rows still active).
 *
 * NOTE ON BOT DETECTION: CLAUDE.md documents DBA wildcard search as parked
 * for bot detection. That applies to WILDCARD scraping (crawling everything).
 * Per-product search — the same pattern Finn/Blocket use — works fine and is
 * what this script does. Verified live 2026-08-06.
 *
 * Features:
 *   - Reads active legendary + classic products from kg_product + kg_brand
 *   - Scrapes search pages via frontend/lib/scrapers/dba.ts (Schibsted engine)
 *   - Jittered rate limiting (3-5s) between products — politer than the flat
 *     3s the Finn/Blocket scripts use, since DBA is the bot-sensitive host
 *   - Upserts on (external_id, source) using listing.url as the stable key
 *   - Appends day-bucketed rows to market_price_observations (idempotent)
 *
 * Usage:
 *   npx tsx scripts/scrape-dba.ts
 *   npx tsx scripts/scrape-dba.ts --limit=5
 *   npx tsx scripts/scrape-dba.ts --product="juno 106"
 *   npx tsx scripts/scrape-dba.ts --tier=legendary
 *   npx tsx scripts/scrape-dba.ts --dry-run        # scrape + report, no writes
 */

import * as path from 'path'
import * as fs from 'fs'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { scrapeDbaWithCoverage } from '../frontend/lib/scrapers/dba'
import * as crypto from 'crypto'
import { evaluateRun, startRun, finishRun, setRunStatus, reportRun, type ListingSample } from './lib/scrape-health'
import { stageListings, promoteRunAtomic, hasEstablishedScopeCoverage, GATE_VERSION, type StagedListing } from './lib/publish'
import { resolveBaseline, baselineNotAttempted, cohortOf, type Baseline } from './lib/baseline'

const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const args = process.argv.slice(2)
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity
const productFilter = args.find(a => a.startsWith('--product='))?.split('=')[1]?.toLowerCase() ?? null
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1]
const TIERS = tierArg ? tierArg.split(',') : ['legendary', 'classic']
const DRY_RUN = args.includes('--dry-run')
// Fault injection for verifying the gate is fail-closed. Nulls price_dkk on
// every scraped row, reproducing the Finn/Blocket bug. Used to prove that a
// detected fault cannot reach listings / price history / lifecycle.
const SIMULATE_BAD_DATA = args.includes('--simulate-bad-data')
// Raises inside the promotion transaction AFTER the listings upsert. Proves
// atomicity: a failure mid-promotion must roll back everything, leaving all
// authoritative tables identical to the pre-run state.
const SIMULATE_PROMOTION_CRASH = args.includes('--simulate-promotion-crash')
// Makes the cohort-identity write fail. Proves the run aborts before
// promotion rather than publishing under an unknown identity — which would
// leave listings with a NULL coverage_scope_hash, outside the coverage
// universe, and the run unusable as a baseline and un-auditable.
const SIMULATE_IDENTITY_WRITE_FAILURE = args.includes('--simulate-identity-write-failure')

// Jittered delay — DBA is the bot-sensitive host, so be politer than the
// flat 3s used for Finn/Blocket. Jitter avoids a machine-regular request
// cadence, which is itself a bot signal.
const DELAY_MIN_MS = 3000
const DELAY_JITTER_MS = 2000

// Bump when scrape/parse behaviour changes, so a run's output can be
// attributed to the code that produced it.
const SCRAPER_VERSION = 'dba-2.0.0'
// Bump when the extraction/normalisation of a page changes. Separate from
// SCRAPER_VERSION because a parser change alters what "one listing" MEANS,
// which breaks volume comparability even when fetching is untouched. Both are
// independent dimensions of the baseline cohort.
const PARSER_VERSION = 'dba-jsonld-1.0.0'
const PAGINATION_STRATEGY = 'page-increment-until-empty'
// Whether this invocation attempts the FULL expected manifest or a subset.
// Recorded from the run's own intent BEFORE scraping: a targeted run must
// never seed a baseline for a complete scope, and that must not depend on
// counts a fault could have changed.
const RUN_SCOPE: 'complete' | 'targeted' =
  productFilter === null && LIMIT === Infinity ? 'complete' : 'targeted'
// Safety fuse only. Reaching it means coverage is NOT proven — never a
// success signal. Set high enough that real queries exhaust naturally.
const MAX_PAGES_FUSE = 40

/**
 * Deterministic scope hash. Approval for lifecycle belongs to this exact
 * universe: change the product set, queries, filters, market, pagination
 * strategy, or scraper version and a fresh bootstrap is required.
 */
function computeScopeHash(productIds: string[], queries: string[]): string {
  const payload = JSON.stringify({
    source: 'dba.dk',
    country: 'DK',
    tiers: [...TIERS].sort(),
    product_ids: [...productIds].sort(),
    queries: [...queries].sort(),
    pagination: PAGINATION_STRATEGY,
    scraper_version: SCRAPER_VERSION,
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function jitteredDelay(): Promise<void> {
  return sleep(DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS)
}

type ProductRow = {
  id: string
  canonical_name: string
  kg_brand: { name: string } | { name: string }[] | null
}

function resolveBrandName(brand: ProductRow['kg_brand']): string | null {
  if (!brand) return null
  if (Array.isArray(brand)) return brand[0]?.name ?? null
  return brand.name ?? null
}

function buildSearchQuery(brandName: string, canonicalName: string): string {
  const canonical = canonicalName.trim()
  const brand = brandName.trim()
  if (canonical.toLowerCase().startsWith(brand.toLowerCase())) return canonical
  return `${brand} ${canonical}`.trim()
}

function normalizeText(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function loadProducts(): Promise<Array<{ id: string; canonical_name: string; brand_name: string; query: string }>> {
  const { data, error } = await supabase
    .from('kg_product')
    .select('id, canonical_name, kg_brand!inner(name)')
    .in('tier', TIERS)
    .eq('status', 'active')
    .order('canonical_name')

  if (error) {
    console.error(`❌ Failed to load kg_product: ${error.message}`)
    process.exit(1)
  }

  let products = ((data ?? []) as ProductRow[])
    .map((product) => {
      const brandName = resolveBrandName(product.kg_brand)
      if (!brandName || !product.canonical_name) return null
      return {
        id: product.id,
        canonical_name: product.canonical_name,
        brand_name: brandName,
        query: buildSearchQuery(brandName, product.canonical_name),
      }
    })
    .filter((p): p is { id: string; canonical_name: string; brand_name: string; query: string } => p !== null)

  if (productFilter) {
    products = products.filter(p => p.canonical_name.toLowerCase().includes(productFilter))
  }
  if (LIMIT !== Infinity) {
    products = products.slice(0, LIMIT)
  }
  return products
}

type ScrapedListings = Awaited<ReturnType<typeof scrapeDbaWithCoverage>>['listings']

function buildRows(listings: ScrapedListings) {
  return listings.map((listing) => ({
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    url: listing.url,
    image_url: listing.image_url,
    location: listing.location,
    source: listing.source,
    country: listing.country,
    price_dkk: listing.price_dkk ?? null,
    scraped_at: new Date().toISOString(),
    watchlist_id: null,
    normalized_text: normalizeText(listing.title),
    external_id: listing.url,
    is_active: true,
    platform: 'dba',
  }))
}

async function main() {
  console.log('⚙️  DBA.dk → Listings + Price History Scraper')
  if (productFilter) console.log(`   Product filter: ${productFilter}`)
  if (DRY_RUN) console.log('   [dry-run] No writes will be made.')
  console.log(`   Tiers: ${TIERS.join(', ')}`)
  console.log(`   Limit: ${LIMIT === Infinity ? '∞' : LIMIT} products`)
  console.log(`   Rate limit: ${DELAY_MIN_MS / 1000}–${(DELAY_MIN_MS + DELAY_JITTER_MS) / 1000}s jittered between products`)
  console.log()

  const products = await loadProducts()
  if (products.length === 0) {
    console.log('No matching products found. Exiting.')
    return
  }

  console.log(`Loaded ${products.length} products from knowledge graph.\n`)

  let scrapedProducts = 0
  let totalListings = 0
  let failedProducts = 0
  const allSamples: ListingSample[] = []
  const stagedRows: StagedListing[] = []
  const coverageRows: Record<string, unknown>[] = []
  const scopeHash = computeScopeHash(products.map(p => p.id), products.map(p => p.query))

  // Open the run record FIRST — staging rows are keyed to it, and its
  // started_at anchors baseline selection.
  const run = DRY_RUN ? null : await startRun(supabase, 'dba.dk')
  if (!DRY_RUN && !run) {
    console.error('Could not open a run record; refusing to scrape without a fail-closed gate.')
    process.exitCode = 1
    return
  }
  const runId = run?.id ?? null

  for (let i = 0; i < products.length; i++) {
    if (i > 0) await jitteredDelay()

    const product = products[i]
    let listings: ScrapedListings
    try {
      const res = await scrapeDbaWithCoverage(product.query, MAX_PAGES_FUSE)
      listings = res.listings
      // One coverage row per expected product, aggregated over its query
      // variants. A product is only terminal if EVERY variant terminated
      // for a known-exhausted reason.
      const variants = res.coverage
      const terminal = new Set(['empty_page', 'no_next_token', 'known_last_page'])
      const allTerminal = variants.length > 0 && variants.every(v => terminal.has(v.terminationReason))
      const allCompleted = variants.every(v => v.queryCompleted)
      coverageRows.push({
        query: product.query,
        kg_product_id: product.id,
        query_started: true,
        query_completed: allCompleted,
        pages_fetched: variants.reduce((a, v) => a + v.pagesFetched, 0),
        termination_reason: allTerminal
          ? 'empty_page'
          : (variants.find(v => v.terminationReason === 'error') ? 'error' : 'max_pages_hit'),
        raw_count: variants.reduce((a, v) => a + v.rawCount, 0),
        parsed_count: variants.reduce((a, v) => a + v.parsedCount, 0),
        parse_error_count: variants.reduce((a, v) => a + v.parseErrorCount, 0),
        unique_staged_count: res.listings.length,
        pagination_tokens: variants.map(v => ({ q: v.query, pages: v.paginationTokens, term: v.terminationReason })),
      })
    } catch (err) {
      failedProducts += 1
      coverageRows.push({
        query: product.query, kg_product_id: product.id,
        query_started: true, query_completed: false, pages_fetched: 0,
        termination_reason: 'error', raw_count: 0, parsed_count: 0,
        parse_error_count: 0, unique_staged_count: 0, pagination_tokens: [],
      })
      console.error(`[scrape-dba] ${product.canonical_name}: scrape failed (${err instanceof Error ? err.message : err})`)
      continue
    }

    // NOTHING authoritative is written in this loop. Output only accumulates
    // for staging; publication happens after the gate says `passed`.
    if (SIMULATE_BAD_DATA) {
      for (const l of listings) (l as { price_dkk: number | null }).price_dkk = null
    }
    for (const l of listings) {
      allSamples.push({
        external_id: l.url, url: l.url, title: l.title,
        price: l.price, currency: l.currency, price_dkk: l.price_dkk ?? null,
      })
      stagedRows.push({
        external_id: l.url ?? null,
        title: l.title ?? null,
        price: l.price ?? null,
        currency: l.currency ?? null,
        price_dkk: l.price_dkk ?? null,
        url: l.url ?? null,
        image_url: l.image_url ?? null,
        location: l.location ?? null,
        source: l.source,
        country: l.country ?? 'DK',
        normalized_text: l.title ? normalizeText(l.title) : null,
        platform: 'dba',
        source_query: product.query,
      } as StagedListing & { source_query: string })
    }

    scrapedProducts += 1
    totalListings += listings.length
    console.log(`[scrape-dba] ${product.canonical_name}: ${listings.length} listings`)
  }

  // ── 1. STAGE ──────────────────────────────────────────────────────────
  let stagedCount = 0
  if (!DRY_RUN && runId) {
    const st = await stageListings(supabase, runId, stagedRows)
    if (st.error) {
      console.error(`Staging failed: ${st.error}`)
      await finishRun(supabase, runId, 'failed', {
        productsAttempted: products.length, productsFailed: failedProducts,
        listingsFetched: allSamples.length, listingsSaved: 0,
        newListings: 0, priceChanges: 0, refoundListings: 0,
      }, {}, [{ code: 'staging_failed', severity: 'hard', detail: st.error }], 0)
      process.exitCode = 1
      return
    }
    stagedCount = st.staged

    // Scope hash and coverage version must exist on the run BEFORE promotion:
    // promote_scrape_run reads coverage_scope_hash to stamp scope membership
    // and to restrict misses. Writing them afterwards left v_scope NULL
    // inside the transaction, silently skipping scope membership entirely.
    //
    // The full cohort identity is stamped here too, so this run is already
    // addressable as baseline material for the NEXT run the moment it exists,
    // and so its identity cannot be back-dated after seeing its own results.
    const { error: identityErr } = await supabase.from('scrape_run').update({
      coverage_version: 'v2',
      coverage_scope_hash: scopeHash,
      scraper_version: SCRAPER_VERSION,
      parser_version: PARSER_VERSION,
      pagination_strategy: PAGINATION_STRATEGY,
      // An invalid value the CHECK constraint rejects, so the failure is a
      // real database error on the real code path — not a mocked branch.
      run_scope: SIMULATE_IDENTITY_WRITE_FAILURE ? 'not-a-valid-scope' : RUN_SCOPE,
      expected_products: products.length,
    }).eq('id', runId)

    // FAIL CLOSED. This write was previously unchecked, and a silent failure
    // here is not cosmetic: promotion would proceed with a NULL scope hash,
    // skipping scope membership entirely, and the run would carry no cohort
    // identity — making it both unusable as a baseline and impossible to
    // audit. Refuse to continue rather than publish under an unknown identity.
    if (identityErr) {
      console.error(`Run identity write failed: ${identityErr.message}`)
      await finishRun(supabase, runId, 'failed', {
        productsAttempted: products.length, productsFailed: failedProducts,
        listingsFetched: allSamples.length, listingsSaved: 0,
        newListings: 0, priceChanges: 0, refoundListings: 0,
      }, {}, [{ code: 'run_identity_write_failed', severity: 'hard', detail: identityErr.message }], 0)
      console.error(`   NOT PUBLISHED — ${stagedCount} rows held in staging under run_id ${runId}.`)
      process.exitCode = 1
      return
    }

    // Coverage evidence: one row per EXPECTED product. Written before the
    // gate so run_has_lifecycle_coverage() can evaluate it inside the
    // promotion transaction.
    if (coverageRows.length > 0) {
      const { error: covErr } = await supabase
        .from('scrape_query_coverage')
        .insert(coverageRows.map(c => ({ ...c, run_id: runId })))
      if (covErr) console.error(`Coverage write failed: ${covErr.message}`)
    }
  }

  // ── 2. EVALUATE (before anything authoritative is touched) ────────────
  const counters = {
    productsAttempted: products.length,
    productsFailed: failedProducts,
    listingsFetched: allSamples.length,
    listingsSaved: 0,
    newListings: 0,
    priceChanges: 0,
    refoundListings: 0,
  }
  // Baseline: only runs that measured the SAME THING may be compared. The
  // cohort is (source, scope hash, coverage version, scraper version, parser
  // version, pagination strategy), and a qualifying run must additionally be
  // complete, promoted and coverage-approved. No qualifying run → the
  // relative volume rules simply do not apply to this run.
  const cohort = cohortOf({
    source: 'dba.dk',
    coverage_scope_hash: scopeHash,
    coverage_version: 'v2',
    scraper_version: SCRAPER_VERSION,
    parser_version: PARSER_VERSION,
    pagination_strategy: PAGINATION_STRATEGY,
  })
  let baseline: Baseline
  if (DRY_RUN || !run) {
    baseline = baselineNotAttempted('dry_run')
  } else if (cohort === null) {
    baseline = baselineNotAttempted('cohort_identity_incomplete')
  } else {
    baseline = await resolveBaseline(supabase, cohort, { id: run.id, startedAt: run.startedAt })
  }

  const { status, violations, metrics } = evaluateRun(allSamples, counters, baseline)

  console.log(`\n[scrape-dba] ${scrapedProducts}/${products.length} products, ${totalListings} listings scraped, ${stagedCount} staged.`)
  reportRun(status, violations, metrics, baseline)

  // Coverage manifest: every expected product actually scraped. "No
  // exceptions thrown" is not proof — a changed pagination can silently
  // drop pages while still returning HTTP 200.
  // Expected and recorded query counts must be identical — a missing
  // coverage row means we cannot account for that part of the universe.
  const coverageRowsComplete = coverageRows.length === products.length
  const allTerminal = coverageRows.every(c => c.termination_reason === 'empty_page')

  const coverageComplete =
    !DRY_RUN && status === 'passed' &&
    RUN_SCOPE === 'complete' &&
    failedProducts === 0 && scrapedProducts === products.length &&
    coverageRowsComplete && allTerminal

  if (!DRY_RUN && !allTerminal) {
    const truncated = coverageRows.filter(c => c.termination_reason !== 'empty_page').length
    console.log(`   Coverage: ${truncated}/${coverageRows.length} queries did NOT reach documented exhaustion — lifecycle blocked.`)
  }

  // ── 3. PROMOTE (only on pass) ─────────────────────────────────────────
  let published = 0, newListings = 0, priceChanges = 0, unchangedSeen = 0
  let delisted = 0

  // Persist the verdict BEFORE promotion: promote_scrape_run only publishes
  // runs already marked 'passed', so the database — not this script — is the
  // enforcement point.
  if (!DRY_RUN && runId) await setRunStatus(supabase, runId, status, violations)

  if (!DRY_RUN && runId && status === 'passed') {
    // Bootstrap guard: until this source has one complete, passed, promoted
    // run establishing its universe, publish but do NOT count misses.
    // Otherwise pre-existing rows that were never inside a documented
    // coverage universe start accruing misses immediately, and three
    // identical coverage faults could still fabricate a mass delisting.
    // Scope-specific: approval belongs to (source, scope_hash, scraper_version),
    // so a changed product universe or scraper version requires a new bootstrap.
    const lifecycleEnabled = await hasEstablishedScopeCoverage(
      supabase, 'dba.dk', scopeHash, SCRAPER_VERSION,
    )

    const pr = await promoteRunAtomic(supabase, runId, {
      coverageComplete,
      lifecycleEnabled,
      failAfterListings: SIMULATE_PROMOTION_CRASH,
    })

    if (pr.error) {
      console.error(`   Promotion failed (rolled back): ${pr.error}`)
      await finishRun(supabase, runId, 'failed', counters, metrics,
        [...violations, { code: 'promotion_failed', severity: 'hard', detail: pr.error }], 0)
      process.exitCode = 1
      return
    }
    if (pr.skipped) {
      console.log(`   Promotion skipped: ${pr.reason}`)
    } else {
      published = pr.published
      newListings = pr.newListings
      priceChanges = pr.priceChanges
      unchangedSeen = pr.unchanged
      delisted = pr.delisted

      console.log(`   Published: ${published} listings (atomic)`) 
      console.log(`   Price history: ${newListings} new, ${priceChanges} price changes, ${unchangedSeen} unchanged (no row written)`)
      if (pr.lifecycleApplied) {
        console.log(`   Lifecycle: ${pr.missed} missed, ${delisted} delisted (after 3 misses)`)
      } else if (!coverageComplete) {
        console.log('   Lifecycle: SKIPPED (coverage incomplete — no delisting inferred)')
      } else {
        console.log('   Lifecycle: SKIPPED (bootstrap — establishing coverage universe; misses start next complete run)')
      }
    }
  } else if (!DRY_RUN) {
    console.log(`   NOT PUBLISHED — ${stagedCount} rows held in staging under run_id ${runId}.`)
    console.log('   Authoritative tables (listings, price history, lifecycle) are unchanged.')
  }

  counters.listingsSaved = published
  counters.newListings = newListings
  counters.priceChanges = priceChanges
  counters.refoundListings = unchangedSeen

  if (!DRY_RUN && runId) {
    await finishRun(supabase, runId, status, counters, metrics, violations, delisted)
    const { error: auditErr } = await supabase.from('scrape_run').update({
      expected_products: products.length,
      covered_products: scrapedProducts,
      coverage_complete: coverageComplete,
      gate_version: GATE_VERSION,
      scraper_version: SCRAPER_VERSION,
      parser_version: PARSER_VERSION,
      pagination_strategy: PAGINATION_STRATEGY,
      run_scope: RUN_SCOPE,
      raw_count: allSamples.length,
      staged_count: stagedCount,
      // Full evidence, not just the number: which cohort was required, which
      // runs were selected, and why every other considered run was rejected.
      // Enough to re-audit the verdict without re-running selection.
      baseline_status: baseline.status,
      baseline: {
        status: baseline.status,
        reason: baseline.reason,
        measure: baseline.measure,
        median_volume: baseline.medianVolume,
        sample_size: baseline.sampleSize,
        run_ids: baseline.runIds,
        volumes: baseline.volumes,
        cohort: baseline.cohort,
        window: baseline.window,
        version: baseline.version,
        rejected: baseline.rejected,
      },
      coverage_version: 'v2',
      coverage_scope_hash: scopeHash,
      parse_error_count: coverageRows.reduce((a, c) => a + Number(c.parse_error_count ?? 0), 0),
    }).eq('id', runId)

    // Publication already happened, so this cannot be failed closed — but a
    // lost audit record means the next run cannot use this one as a baseline
    // and this verdict cannot be re-audited. Never swallow it.
    if (auditErr) console.error(`[scrape-dba] run audit record write failed: ${auditErr.message}`)
  }

  // Signal downstream automation: quarantined/failed runs should not be
  // treated as a healthy nightly refresh.
  if (status === 'failed') process.exitCode = 1
}

main().catch((error) => {
  console.error('❌ scrape-dba failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
