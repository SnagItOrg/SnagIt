/**
 * scripts/lib/schibsted-market-scrape.ts
 *
 * PAN-307: Finn and Blocket on the dba.dk engine's discipline.
 *
 * Before this, scrape-finn and scrape-blocket searched without a category,
 * sorted by relevance, stopped at 3 pages, upserted straight into `listings`
 * and never marked anything inactive. On 2026-10-27, 942 Finn and 1,050
 * Blocket rows were "active" without being seen for 7+ days, some since May,
 * and 240 + 232 of them were matched to product pages.
 *
 * This runner gives both what scrape-dba has:
 *   - Musikkinstrumenter (`sub_category=1.86.92`, the same id on finn.no and
 *     blocket.se, verified live 2026-10-28), newest first, to exhaustion
 *     behind a safety fuse;
 *   - a run record, staging, the health gate and atomic promotion through
 *     promote_scrape_run, with per-query coverage evidence;
 *   - a stale sweep, but only over the queries that reached their end.
 *
 * The product set is unchanged: the scripts still read monitoredSlugs().
 */

import * as crypto from 'crypto'
import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'
import {
  scrapeSchibstedWithCoverage,
  type SchibstedConfig,
  type SchibstedSearchOptions,
  type QueryCoverage,
} from '../../frontend/lib/scrapers/schibsted'
import { evaluateRun, startRun, finishRun, reportRun, type ListingSample, type RunStatus } from './scrape-health'
import { stageListings, promoteRunAtomic, hasEstablishedScopeCoverage, GATE_VERSION, type StagedListing } from './publish'
import { resolveBaseline, baselineNotAttempted, cohortOf, type Baseline } from './baseline'

/** Musikkinstrumenter on finn.no, Musikinstrument on blocket.se: the dba.dk id. */
export const SCHIBSTED_MUSIC_SUB_CATEGORY = '1.86.92'

// Part of the scope hash. Newest first makes a query cut by the fuse lose the
// oldest ads rather than random ones.
export const SEARCH_OPTIONS: SchibstedSearchOptions = { subCategory: SCHIBSTED_MUSIC_SUB_CATEGORY, sort: 'PUBLISHED_DESC' }

export const PARSER_VERSION = 'schibsted-jsonld-1.0.0'
export const PAGINATION_STRATEGY = 'page-increment-until-empty'

// Safety fuse only. Reaching it means coverage is NOT proven. 20 pages is
// 1,060 ads; the largest query, Stratocaster on Finn, was 446 on 2026-10-28.
export const MAX_PAGES_FUSE = 20

/** Same rule and reasoning as scrape-dba (PAN-160). */
export const STALE_AFTER_DAYS = 3

// Between queries; pages inside a query wait 2–4 s in the engine itself.
const DELAY_MIN_MS = 3000
const DELAY_JITTER_MS = 2000

const TERMINAL = new Set(['empty_page', 'no_next_token', 'known_last_page'])

export type MarketQuery = { id: string; slug: string; query: string; kg_product_id: string }

export type CoverageRow = {
  query: string
  kg_product_id: string | null
  query_started: boolean
  query_completed: boolean
  pages_fetched: number
  termination_reason: 'empty_page' | 'max_pages_hit' | 'error'
  raw_count: number
  parsed_count: number
  parse_error_count: number
  unique_staged_count: number
  pagination_tokens: Array<{ q: string; pages: number[]; term: string }>
}

export type MarketSpec = {
  config: SchibstedConfig
  /** `listings.platform`. */
  platform: string
  scraperVersion: string
  runScope: 'complete' | 'targeted'
  dryRun: boolean
}

export function buildSearchQuery(brandName: string, canonicalName: string): string {
  const canonical = canonicalName.trim()
  const brand = brandName.trim()
  if (canonical.toLowerCase().startsWith(brand.toLowerCase())) {
    return canonical
  }
  return `${brand} ${canonical}`.trim()
}

/**
 * Deterministic scope hash. Change the product set, queries, filters, market,
 * pagination strategy or scraper version and a fresh bootstrap is required.
 */
export function computeScopeHash(
  config: SchibstedConfig, scraperVersion: string, queryIds: string[], queries: string[],
): string {
  const payload = JSON.stringify({
    source: config.source,
    country: config.country,
    query_ids: [...queryIds].sort(),
    queries: [...queries].sort(),
    search: SEARCH_OPTIONS,
    pagination: PAGINATION_STRATEGY,
    scraper_version: scraperVersion,
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * One coverage row per expected query, aggregated over its spelling variants.
 * A query is only terminal if EVERY variant terminated for a known-exhausted
 * reason — the rule scrape-dba applies.
 */
export function coverageRowFor(
  q: Pick<MarketQuery, 'query' | 'kg_product_id'>,
  variants: QueryCoverage[] | null,
  uniqueStaged: number,
): CoverageRow {
  if (variants === null) {
    return {
      query: q.query, kg_product_id: q.kg_product_id,
      query_started: true, query_completed: false, pages_fetched: 0,
      termination_reason: 'error', raw_count: 0, parsed_count: 0,
      parse_error_count: 0, unique_staged_count: 0, pagination_tokens: [],
    }
  }
  const allTerminal = variants.length > 0 && variants.every(v => TERMINAL.has(v.terminationReason))
  return {
    query: q.query,
    kg_product_id: q.kg_product_id,
    query_started: true,
    query_completed: variants.every(v => v.queryCompleted),
    pages_fetched: variants.reduce((a, v) => a + v.pagesFetched, 0),
    termination_reason: allTerminal
      ? 'empty_page'
      : (variants.some(v => v.terminationReason === 'error') ? 'error' : 'max_pages_hit'),
    raw_count: variants.reduce((a, v) => a + v.rawCount, 0),
    parsed_count: variants.reduce((a, v) => a + v.parsedCount, 0),
    parse_error_count: variants.reduce((a, v) => a + v.parseErrorCount, 0),
    unique_staged_count: uniqueStaged,
    pagination_tokens: variants.map(v => ({ q: v.query, pages: v.paginationTokens, term: v.terminationReason })),
  }
}

/** The queries whose absence of an ad proves something: they reached their end. */
export function sweepableQueries(rows: CoverageRow[]): string[] {
  return rows.filter(r => r.termination_reason === 'empty_page').map(r => r.query)
}

/**
 * Whether the stale sweep may run at all. Behind the same bootstrap guard as
 * the miss counter: a passed, complete run of a scope that an earlier
 * complete run already established, and a promotion that actually happened.
 * Which rows it may touch is then narrowed per query by sweepableQueries().
 */
export function sweepAllowed(s: {
  dryRun: boolean; status: RunStatus; runScope: 'complete' | 'targeted'; lifecycleEnabled: boolean; promoted: boolean
}): boolean {
  return !s.dryRun && s.status === 'passed' && s.runScope === 'complete' && s.lifecycleEnabled && s.promoted
}

/** Taken from the run's start, so no row this run saw can be swept. */
export function staleCutoff(runStartedAt: string, days = STALE_AFTER_DAYS): string {
  return new Date(Date.parse(runStartedAt) - days * 24 * 60 * 60 * 1000).toISOString()
}

function normalizeText(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * Scrape, stage, gate, promote and sweep one market. Returns the promoted run
 * id, or null when nothing was published; the caller hands that run's inserts
 * to the matcher.
 */
export async function runSchibstedMarket(
  supabase: SupabaseClient,
  spec: MarketSpec,
  queries: MarketQuery[],
): Promise<{ promotedRunId: string | null; exitCode: number }> {
  const { config, scraperVersion, runScope, dryRun } = spec
  const tag = `[scrape-${config.source}]`

  let scraped = 0
  let totalListings = 0
  let failed = 0
  const allSamples: ListingSample[] = []
  const stagedRows: Array<StagedListing & { source_query: string }> = []
  const coverageRows: CoverageRow[] = []
  const scopeHash = computeScopeHash(config, scraperVersion, queries.map(q => q.id), queries.map(q => q.query))

  // Open the run record FIRST — staging rows are keyed to it, and its
  // started_at anchors baseline selection and the sweep cutoff.
  const run = dryRun ? null : await startRun(supabase, config.source)
  if (!dryRun && !run) {
    console.error('Could not open a run record; refusing to scrape without a fail-closed gate.')
    return { promotedRunId: null, exitCode: 1 }
  }
  const runId = run?.id ?? null

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS)

    const q = queries[i]
    let res: Awaited<ReturnType<typeof scrapeSchibstedWithCoverage>>
    try {
      res = await scrapeSchibstedWithCoverage(config, q.query, MAX_PAGES_FUSE, SEARCH_OPTIONS)
    } catch (err) {
      failed += 1
      coverageRows.push(coverageRowFor(q, null, 0))
      console.error(`${tag} ${q.slug}: scrape failed (${err instanceof Error ? err.message : err})`)
      continue
    }
    const row = coverageRowFor(q, res.coverage, res.listings.length)
    coverageRows.push(row)

    // NOTHING authoritative is written in this loop.
    for (const l of res.listings) {
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
        country: l.country ?? config.country,
        normalized_text: l.title ? normalizeText(l.title) : null,
        platform: spec.platform,
        source_query: q.query,
      })
    }

    scraped += 1
    totalListings += res.listings.length
    console.log(`${tag} ${q.slug}: ${res.listings.length} listings, ${row.pages_fetched} pages, ${row.termination_reason}`)
  }

  const counters = {
    productsAttempted: queries.length,
    productsFailed: failed,
    listingsFetched: allSamples.length,
    listingsSaved: 0,
    newListings: 0,
    priceChanges: 0,
    refoundListings: 0,
  }

  // ── 1. STAGE + cohort identity + coverage evidence ────────────────────
  let stagedCount = 0
  if (!dryRun && runId) {
    const st = await stageListings(supabase, runId, stagedRows)
    if (st.error) {
      console.error(`Staging failed: ${st.error}`)
      await finishRun(supabase, runId, 'failed', counters, {}, [{ code: 'staging_failed', severity: 'hard', detail: st.error }], 0)
      return { promotedRunId: null, exitCode: 1 }
    }
    stagedCount = st.staged

    // Must exist BEFORE promotion: promote_scrape_run reads the scope hash
    // to stamp scope membership. Fail closed (see scrape-dba).
    const { error: identityErr } = await supabase.from('scrape_run').update({
      coverage_version: 'v2',
      coverage_scope_hash: scopeHash,
      scraper_version: scraperVersion,
      parser_version: PARSER_VERSION,
      pagination_strategy: PAGINATION_STRATEGY,
      run_scope: runScope,
      expected_products: queries.length,
    }).eq('id', runId)
    if (identityErr) {
      console.error(`Run identity write failed: ${identityErr.message}`)
      await finishRun(supabase, runId, 'failed', counters, {},
        [{ code: 'run_identity_write_failed', severity: 'hard', detail: identityErr.message }], 0)
      console.error(`   NOT PUBLISHED — ${stagedCount} rows held in staging under run_id ${runId}.`)
      return { promotedRunId: null, exitCode: 1 }
    }

    if (coverageRows.length > 0) {
      const { error: covErr } = await supabase
        .from('scrape_query_coverage')
        .insert(coverageRows.map(c => ({ ...c, run_id: runId })))
      if (covErr) console.error(`Coverage write failed: ${covErr.message}`)
    }
  }

  // ── 2. EVALUATE ───────────────────────────────────────────────────────
  const cohort = cohortOf({
    source: config.source,
    coverage_scope_hash: scopeHash,
    coverage_version: 'v2',
    scraper_version: scraperVersion,
    parser_version: PARSER_VERSION,
    pagination_strategy: PAGINATION_STRATEGY,
  })
  let baseline: Baseline
  if (dryRun || !run) {
    baseline = baselineNotAttempted('dry_run')
  } else if (cohort === null) {
    baseline = baselineNotAttempted('cohort_identity_incomplete')
  } else {
    baseline = await resolveBaseline(supabase, cohort, { id: run.id, startedAt: run.startedAt })
  }
  const { status, violations, metrics } = evaluateRun(allSamples, counters, baseline)

  console.log(`\n${tag} ${scraped}/${queries.length} queries, ${totalListings} listings scraped, ${stagedCount} staged.`)
  reportRun(status, violations, metrics, baseline)

  const allTerminal = coverageRows.every(c => c.termination_reason === 'empty_page')
  const coverageComplete =
    !dryRun && status === 'passed' && runScope === 'complete' &&
    failed === 0 && scraped === queries.length &&
    coverageRows.length === queries.length && allTerminal
  if (!allTerminal) {
    const truncated = coverageRows.filter(c => c.termination_reason !== 'empty_page')
    console.log(`   Coverage: ${truncated.length}/${coverageRows.length} queries did NOT reach their end (${truncated.map(c => c.query).join(', ')}) — miss counter blocked, sweep skips them.`)
  }

  // ── 3. PERSIST THE GATE'S EVIDENCE — before promotion is attempted ────
  if (!dryRun && runId) {
    const { error: evidenceErr } = await supabase.from('scrape_run').update({
      status,
      violations,
      coverage_version: 'v2',
      coverage_scope_hash: scopeHash,
      scraper_version: scraperVersion,
      parser_version: PARSER_VERSION,
      pagination_strategy: PAGINATION_STRATEGY,
      run_scope: runScope,
      gate_version: GATE_VERSION,
      expected_products: queries.length,
      covered_products: scraped,
      coverage_complete: coverageComplete,
      raw_count: allSamples.length,
      staged_count: stagedCount,
      parse_error_count: coverageRows.reduce((a, c) => a + c.parse_error_count, 0),
      ...metrics,
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
    }).eq('id', runId)
    if (evidenceErr) {
      console.error(`Run evidence write failed: ${evidenceErr.message}`)
      await finishRun(supabase, runId, 'failed', counters, metrics,
        [...violations, { code: 'run_evidence_write_failed', severity: 'hard', detail: evidenceErr.message }], 0)
      console.error(`   NOT PUBLISHED — ${stagedCount} rows held in staging under run_id ${runId}.`)
      return { promotedRunId: null, exitCode: 1 }
    }
  }

  // ── 4. PROMOTE (only on pass), then sweep ─────────────────────────────
  let delisted = 0
  let promotedRunId: string | null = null

  if (!dryRun && runId && run && status === 'passed') {
    // Bootstrap guard: until one complete, passed, promoted run has
    // established this exact scope, publish but count no misses.
    const lifecycleEnabled = await hasEstablishedScopeCoverage(supabase, config.source, scopeHash, scraperVersion)

    const pr = await promoteRunAtomic(supabase, runId, { coverageComplete, lifecycleEnabled })
    if (pr.error) {
      console.error(`   Promotion failed (rolled back): ${pr.error}`)
      await finishRun(supabase, runId, 'failed', counters, metrics,
        [...violations, { code: 'promotion_failed', severity: 'hard', detail: pr.error }], 0)
      return { promotedRunId: null, exitCode: 1 }
    }
    if (pr.skipped) {
      console.log(`   Promotion skipped: ${pr.reason}`)
    } else {
      promotedRunId = runId
      delisted = pr.delisted
      counters.listingsSaved = pr.published
      counters.newListings = pr.newListings
      counters.priceChanges = pr.priceChanges
      counters.refoundListings = pr.unchanged
      console.log(`   Published: ${pr.published} listings (atomic)`)
      if (pr.lifecycleApplied) {
        console.log(`   Lifecycle: ${pr.missed} missed, ${pr.delisted} delisted (after 3 misses)`)
      } else if (!lifecycleEnabled) {
        console.log('   Lifecycle: SKIPPED (bootstrap — establishing coverage universe; misses start next complete run)')
      } else {
        console.log('   Lifecycle: miss counter SKIPPED (coverage incomplete)')
      }
    }

    // Stale sweep, per query. Only rows this engine published itself
    // (coverage_scope_hash set, PAN-260) and whose query reached its end in
    // THIS run: a query cut by the fuse or an error proves nothing about the
    // ads it did not reach. A row the run saw has scraped_at = now, past the
    // cutoff. Re-seen rows come back on their own: promotion sets
    // is_active=true and delisted_at=NULL.
    const sweepQueries = sweepableQueries(coverageRows)
    if (sweepAllowed({ dryRun, status, runScope, lifecycleEnabled, promoted: promotedRunId !== null }) && sweepQueries.length > 0) {
      const { error: staleError, count } = await supabase
        .from('listings')
        .update({ is_active: false, delisted_at: new Date().toISOString() }, { count: 'exact' })
        .eq('source', config.source)
        .eq('is_active', true)
        .not('coverage_scope_hash', 'is', null)
        .in('source_query', sweepQueries)
        .lt('scraped_at', staleCutoff(run.startedAt))
      if (staleError) {
        console.error(`   Stale sweep failed: ${staleError.message}`)
      } else {
        delisted += count ?? 0
        console.log(`   Stale sweep: ${count ?? 0} not seen for ${STALE_AFTER_DAYS} days marked inactive (${sweepQueries.length}/${coverageRows.length} queries at their end).`)
      }
    } else if (promotedRunId) {
      console.log('   Stale sweep: SKIPPED (bootstrap, targeted run or no query at its end).')
    }
  } else if (!dryRun) {
    console.log(`   NOT PUBLISHED — ${stagedCount} rows held in staging under run_id ${runId}.`)
    console.log('   Authoritative tables (listings, price history, lifecycle) are unchanged.')
  }

  // ── 5. RECORD THE OUTCOME ─────────────────────────────────────────────
  if (!dryRun && runId) {
    await finishRun(supabase, runId, status, counters, metrics, violations, delisted)
  }
  return { promotedRunId, exitCode: status === 'failed' ? 1 : 0 }
}
