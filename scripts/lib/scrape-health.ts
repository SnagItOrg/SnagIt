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
 *
 * ── ABSOLUTE VS RELATIVE RULES ──────────────────────────────────────────
 * Absolute rules judge a run on its own output and always apply. Relative
 * rules compare it against a baseline and apply ONLY when a qualifying prior
 * run exists in an identical cohort (see lib/baseline.ts). A first complete
 * run in a new cohort has no baseline, and must not be quarantined for that:
 * `baseline_unavailable` is information, not a violation.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'
import { describeBaseline, type Baseline } from './baseline'

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
// Volume swing versus the cohort baseline that trips a quarantine.
const VOLUME_SWING_PCT = 60

export function evaluateRun(
  listings: ListingSample[],
  counters: RunCounters,
  baseline: Baseline,
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

  // The GLOBAL run measurement: distinct external_ids across the whole run,
  // not per query. Volume rules compare this against a baseline of the same
  // measure — `n` counts a listing once per query that returned it, and
  // mixing the two would compare different quantities.
  const globalUniqueListings = new Set(listings.map(l => l.external_id).filter(Boolean)).size
  const duplicateRate = n > 0 ? (n - globalUniqueListings) / n : 0

  // Relative rules are only meaningful against a qualifying prior run in an
  // identical cohort. Absent one, they stay switched off entirely.
  const baselineVolume = baseline.status === 'available' ? baseline.medianVolume : null

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

  // RELATIVE. Zero results where there was substantial volume before.
  // Pagination may technically end on `empty_page` — a blocked or redesigned
  // source returns a well-formed page with no results — so termination alone
  // cannot catch this. Left unflagged it would mark the ENTIRE source missing
  // and, after three such runs, delist everything.
  if (globalUniqueListings === 0 && baselineVolume != null && baselineVolume >= MIN_EXPECTED_LISTINGS) {
    violations.push({ code: 'zero_results_after_volume', severity: 'soft',
      detail: `0 listings where the cohort baseline is ${baselineVolume} — source may be blocked or its markup changed` })
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

  // RELATIVE. Inactive without a cohort baseline — comparing a complete run
  // against a targeted one produced the 12600% false quarantine this gate was
  // rebuilt to prevent.
  let volumeDelta: number | null = null
  if (baselineVolume != null && baselineVolume > 0) {
    volumeDelta = ((globalUniqueListings - baselineVolume) / baselineVolume) * 100
    if (Math.abs(volumeDelta) > VOLUME_SWING_PCT) {
      violations.push({ code: 'volume_swing', severity: 'soft',
        detail: `global unique listings changed ${volumeDelta.toFixed(0)}% vs the cohort baseline ` +
          `(${baselineVolume} → ${globalUniqueListings}, median over ${baseline.sampleSize} run(s))` })
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
      global_unique_listings: globalUniqueListings,
      // Deprecated alias of the above, kept so existing dashboards keep working.
      unique_external_ids: globalUniqueListings,
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

// The gate verdict is persisted as part of the caller's single pre-promotion
// evidence write (status + violations + cohort identity + baseline + coverage
// together), so a standalone status-only setter no longer exists. The ordering
// it enforced is unchanged: `promote_scrape_run` refuses anything not already
// marked 'passed', so the verdict must be durable before promotion is
// attempted — the database, not the script, is the enforcement point.

/**
 * Open the run record. `started_at` is returned because baseline selection is
 * anchored on it: candidates are restricted to runs that started strictly
 * earlier, so a run inserted concurrently while this one is being evaluated
 * cannot change the verdict, and the selection replays identically later.
 */
export async function startRun(
  supabase: SupabaseClient,
  source: string,
): Promise<{ id: string; startedAt: string } | null> {
  const { data, error } = await supabase
    .from('scrape_run')
    .insert({ source, status: 'running' })
    .select('id, started_at')
    .single()
  if (error) { console.error(`[health] could not open run record: ${error.message}`); return null }
  return { id: data.id, startedAt: data.started_at }
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
export function reportRun(
  status: RunStatus,
  violations: Violation[],
  metrics: Record<string, number | null>,
  baseline: Baseline,
): void {
  const icon = status === 'passed' ? '✅' : status === 'quarantined' ? '⚠️ ' : '❌'
  console.log(`\n${icon} Quality gate: ${status.toUpperCase()}`)
  console.log(`   ${describeBaseline(baseline)}`)
  if (baseline.status === 'available') {
    console.log(`   baseline runs: ${baseline.runIds.join(', ')}`)
  }
  if (violations.length > 0) {
    for (const v of violations) {
      console.log(`   [${v.severity}] ${v.code}: ${v.detail}`)
    }
  }
  console.log(`   global_unique=${metrics.global_unique_listings} dup_rate=${metrics.duplicate_rate} ` +
    `null_price_dkk=${metrics.null_price_dkk} median_dkk=${metrics.price_median_dkk ?? 'n/a'}` +
    (metrics.volume_delta_pct != null ? ` vol_delta=${metrics.volume_delta_pct}%` : ''))
  if (status === 'quarantined') {
    console.log('   → Data stored but EXCLUDED from price aggregation / Kup-score until reviewed.')
  }
  if (status === 'failed') {
    console.log('   → Hard invariant broken. Lifecycle NOT updated; run is untrusted.')
  }
}
