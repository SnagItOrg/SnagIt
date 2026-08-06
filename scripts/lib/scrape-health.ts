/**
 * scripts/lib/scrape-health.ts
 *
 * Minimal output-quality gate for scraper runs. NOT an observability project —
 * a guardrail with three outcomes.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────
 * On 2026-08-05 `scrape-finn` and `scrape-blocket` both exited 0 and looked
 * healthy, while 100% of the listings they saved had NULL price_dkk — the
 * field every arbitrage calculation depends on. The NO and SE markets were
 * silently invisible for weeks. A job can be operationally green and
 * product-worthless at the same time. Validate on OUTPUT, not exit code.
 *
 * ── OUTCOMES ────────────────────────────────────────────────────────────
 *   passed       data publishes normally
 *   quarantined  data is stored but must be EXCLUDED from price aggregation
 *                and Kup-score until reviewed; lifecycle updates are skipped
 *   failed       hard invariant broken; no lifecycle updates, run is not
 *                trusted for anything
 *
 * Hard invariants (→ failed) are things that make the data unusable by
 * definition. Volume and rate swings (→ quarantined) are suspicious but may
 * be legitimate market movement, so they alarm rather than auto-discard.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'

export interface ListingSample {
  external_id?: string | null
  url?: string | null
  title?: string | null
  price?: number | null
  currency?: string | null
  price_dkk?: number | null
}

export interface RunCounters {
  productsAttempted: number
  productsFailed: number
  listingsFetched: number
  listingsSaved: number
  newListings: number
  priceChanges: number
  refoundListings: number
}

export type RunStatus = 'passed' | 'quarantined' | 'failed'

export interface Violation {
  code: string
  severity: 'hard' | 'soft'
  detail: string
}

const VALID_CURRENCIES = new Set(['DKK', 'NOK', 'SEK', 'EUR', 'USD', 'GBP'])

// A run that scrapes almost nothing may be a parser break rather than a
// quiet market. Below this, quarantine and look.
const MIN_EXPECTED_LISTINGS = 5
// Volume swing versus the last passed run that trips a quarantine.
const VOLUME_SWING_PCT = 60

export function evaluateRun(
  listings: ListingSample[],
  counters: RunCounters,
  previousVolume: number | null,
): { status: RunStatus; violations: Violation[]; metrics: Record<string, number | null> } {
  const violations: Violation[] = []
  const n = listings.length

  const nullPrice    = listings.filter(l => l.price == null).length
  const nullCurrency = listings.filter(l => !l.currency).length
  const nullPriceDkk = listings.filter(l => l.price_dkk == null).length
  const nullUrl      = listings.filter(l => !l.url).length
  const nullTitle    = listings.filter(l => !l.title).length
  const emptyIds     = listings.filter(l => !l.external_id).length
  const badCurrency  = listings.filter(l => l.currency && !VALID_CURRENCIES.has(l.currency)).length

  const uniqueIds = new Set(listings.map(l => l.external_id).filter(Boolean)).size
  const duplicateRate = n > 0 ? (n - uniqueIds) / n : 0

  const prices = listings.map(l => l.price_dkk).filter((p): p is number => p != null).sort((a, b) => a - b)
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null

  // ── HARD INVARIANTS → failed ──────────────────────────────────────────
  // These make the run's data unusable, so it must not touch lifecycle.
  if (n > 0 && nullPriceDkk === n) {
    violations.push({ code: 'all_price_dkk_null', severity: 'hard',
      detail: `all ${n} listings have NULL price_dkk — arbitrage math would silently exclude this source` })
  }
  if (emptyIds > 0) {
    violations.push({ code: 'empty_external_id', severity: 'hard',
      detail: `${emptyIds} listing(s) have no external_id — dedup and lifecycle cannot work` })
  }
  if (badCurrency > 0) {
    violations.push({ code: 'invalid_currency', severity: 'hard',
      detail: `${badCurrency} listing(s) have an unrecognised currency` })
  }

  // ── SOFT SIGNALS → quarantined ────────────────────────────────────────

  // Zero results where there was substantial volume before. Pagination may
  // technically end on `empty_page` — a blocked or redesigned source returns
  // a well-formed page with no results — so termination alone cannot catch
  // this. Left unflagged it would mark the ENTIRE source missing and, after
  // three such runs, delist everything.
  if (n === 0 && previousVolume != null && previousVolume >= MIN_EXPECTED_LISTINGS) {
    violations.push({ code: 'zero_results_after_volume', severity: 'soft',
      detail: `0 listings where the recent baseline is ${previousVolume} — source may be blocked or its markup changed` })
  }

  if (n > 0 && nullPriceDkk > 0 && nullPriceDkk < n) {
    violations.push({ code: 'partial_price_dkk_null', severity: 'soft',
      detail: `${nullPriceDkk}/${n} listings missing price_dkk` })
  }
  if (n > 0 && nullTitle / n > 0.1) {
    violations.push({ code: 'high_null_title', severity: 'soft', detail: `${nullTitle}/${n} missing title` })
  }
  if (nullUrl > 0) {
    violations.push({ code: 'null_url', severity: 'soft', detail: `${nullUrl} listing(s) missing url` })
  }
  if (duplicateRate > 0.2) {
    violations.push({ code: 'high_duplicate_rate', severity: 'soft',
      detail: `${(duplicateRate * 100).toFixed(1)}% duplicate external_ids` })
  }
  if (n < MIN_EXPECTED_LISTINGS && counters.productsAttempted > 0) {
    violations.push({ code: 'suspiciously_low_volume', severity: 'soft',
      detail: `only ${n} listings from ${counters.productsAttempted} products — possible parser break` })
  }
  if (counters.productsAttempted > 0 && counters.productsFailed / counters.productsAttempted > 0.25) {
    violations.push({ code: 'high_product_failure_rate', severity: 'soft',
      detail: `${counters.productsFailed}/${counters.productsAttempted} products failed to scrape` })
  }

  let volumeDelta: number | null = null
  if (previousVolume != null && previousVolume > 0) {
    volumeDelta = ((n - previousVolume) / previousVolume) * 100
    if (Math.abs(volumeDelta) > VOLUME_SWING_PCT) {
      violations.push({ code: 'volume_swing', severity: 'soft',
        detail: `volume changed ${volumeDelta.toFixed(0)}% vs last passed run (${previousVolume} → ${n})` })
    }
  }

  const status: RunStatus =
    violations.some(v => v.severity === 'hard') ? 'failed'
    : violations.length > 0 ? 'quarantined'
    : 'passed'

  return {
    status,
    violations,
    metrics: {
      unique_external_ids: uniqueIds,
      duplicate_rate: Number(duplicateRate.toFixed(4)),
      null_price: nullPrice,
      null_currency: nullCurrency,
      null_price_dkk: nullPriceDkk,
      null_url: nullUrl,
      null_title: nullTitle,
      price_min_dkk: prices.length ? prices[0] : null,
      price_median_dkk: median,
      price_max_dkk: prices.length ? prices[prices.length - 1] : null,
      volume_delta_pct: volumeDelta == null ? null : Number(volumeDelta.toFixed(2)),
    },
  }
}

/** Listing volume of the most recent run that actually passed, for comparison. */
export async function lastPassedVolume(supabase: SupabaseClient, source: string): Promise<number | null> {
  const { data } = await supabase
    .from('scrape_run')
    .select('listings_fetched')
    .eq('source', source)
    .eq('status', 'passed')
    .order('started_at', { ascending: false })
    .limit(1)
  return data?.[0]?.listings_fetched ?? null
}

/**
 * Record the gate verdict on the run BEFORE promotion is attempted.
 * `promote_scrape_run` refuses to publish anything whose status is not
 * already 'passed', so the verdict must be durable first — that ordering is
 * what makes the database the enforcement point rather than this script.
 */
export async function setRunStatus(
  supabase: SupabaseClient,
  runId: string | null,
  status: RunStatus,
  violations: Violation[],
): Promise<void> {
  if (!runId) return
  const { error } = await supabase
    .from('scrape_run')
    .update({ status, violations })
    .eq('id', runId)
  if (error) console.error(`[health] could not set run status: ${error.message}`)
}

export async function startRun(supabase: SupabaseClient, source: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('scrape_run')
    .insert({ source, status: 'running' })
    .select('id')
    .single()
  if (error) { console.error(`[health] could not open run record: ${error.message}`); return null }
  return data.id
}

export async function finishRun(
  supabase: SupabaseClient,
  runId: string | null,
  status: RunStatus,
  counters: RunCounters,
  metrics: Record<string, number | null>,
  violations: Violation[],
  delistedListings: number,
): Promise<void> {
  if (!runId) return
  const { error } = await supabase
    .from('scrape_run')
    .update({
      finished_at: new Date().toISOString(),
      status,
      products_attempted: counters.productsAttempted,
      products_failed: counters.productsFailed,
      listings_fetched: counters.listingsFetched,
      listings_saved: counters.listingsSaved,
      new_listings: counters.newListings,
      price_changes: counters.priceChanges,
      refound_listings: counters.refoundListings,
      delisted_listings: delistedListings,
      ...metrics,
      violations,
    })
    .eq('id', runId)
  if (error) console.error(`[health] could not close run record: ${error.message}`)
}

/** Human-readable gate summary for the run log. */
export function reportRun(status: RunStatus, violations: Violation[], metrics: Record<string, number | null>): void {
  const icon = status === 'passed' ? '✅' : status === 'quarantined' ? '⚠️ ' : '❌'
  console.log(`\n${icon} Quality gate: ${status.toUpperCase()}`)
  if (violations.length > 0) {
    for (const v of violations) {
      console.log(`   [${v.severity}] ${v.code}: ${v.detail}`)
    }
  }
  console.log(`   unique_ids=${metrics.unique_external_ids} dup_rate=${metrics.duplicate_rate} ` +
    `null_price_dkk=${metrics.null_price_dkk} median_dkk=${metrics.price_median_dkk ?? 'n/a'}` +
    (metrics.volume_delta_pct != null ? ` vol_delta=${metrics.volume_delta_pct}%` : ''))
  if (status === 'quarantined') {
    console.log('   → Data stored but EXCLUDED from price aggregation / Kup-score until reviewed.')
  }
  if (status === 'failed') {
    console.log('   → Hard invariant broken. Lifecycle NOT updated; run is untrusted.')
  }
}
