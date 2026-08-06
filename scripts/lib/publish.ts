/**
 * scripts/lib/publish.ts
 *
 * Fail-closed publication for scraper runs.
 *
 * ── THE INVARIANT THIS ENFORCES ─────────────────────────────────────────
 * A detected fault must be INCAPABLE of changing authoritative state — not
 * merely logged after the fact. The earlier design evaluated the quality
 * gate *after* upserting to `listings`, so it recorded damage instead of
 * preventing it.
 *
 * Flow:
 *   1. stageListings()   scrape output → listing_staging, keyed by run_id
 *   2. evaluateRun()     health computed from staged rows (scrape-health.ts)
 *   3. promoteRun()      ONLY on `passed` — staging → listings + events
 *                        + lifecycle, all under one run_id
 *
 * quarantined → rows stay in staging, zero downstream effect
 * failed      → rows stay in staging for forensics, zero downstream effect
 *
 * Nothing outside promoteRun() may write to `listings` on a scrape path.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'
import { appendPriceObservations, reconcileListingLifecycle } from './price-observations'

export const GATE_VERSION = '1.0.0'

export interface StagedListing {
  external_id: string | null
  title: string | null
  price: number | null
  currency: string | null
  price_dkk: number | null
  url: string | null
  image_url: string | null
  location: string | null
  source: string
  country: string | null
  normalized_text: string | null
  platform: string | null
}

/** Insert scrape output into staging. Nothing authoritative is touched. */
export async function stageListings(
  supabase: SupabaseClient,
  runId: string,
  listings: StagedListing[],
): Promise<{ staged: number; error: string | null }> {
  if (listings.length === 0) return { staged: 0, error: null }

  let staged = 0
  const CHUNK = 500
  for (let i = 0; i < listings.length; i += CHUNK) {
    const rows = listings.slice(i, i + CHUNK).map(l => ({ ...l, run_id: runId }))
    const { error } = await supabase.from('listing_staging').insert(rows)
    if (error) return { staged, error: error.message }
    staged += rows.length
  }
  return { staged, error: null }
}

/**
 * Robust baseline: median listing volume over recent PASSED runs.
 *
 * Comparing against only the most recent run lets one bad run become the new
 * normal, which would let the NEXT bad run pass. A median over several
 * approved runs resists that drift.
 */
export async function robustBaseline(
  supabase: SupabaseClient,
  source: string,
  window = 14,
): Promise<{ medianVolume: number | null; sampleSize: number; runs: number[] }> {
  const { data } = await supabase
    .from('scrape_run')
    .select('listings_fetched')
    .eq('source', source)
    .eq('status', 'passed')
    .order('started_at', { ascending: false })
    .limit(window)

  const volumes = (data ?? []).map(r => r.listings_fetched as number).filter(v => v > 0)
  if (volumes.length === 0) return { medianVolume: null, sampleSize: 0, runs: [] }

  const sorted = [...volumes].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return { medianVolume: median, sampleSize: sorted.length, runs: volumes }
}

/**
 * Promote a passed run's staged rows into the authoritative tables.
 *
 * Delegates to the `promote_scrape_run` Postgres function so the whole
 * promotion is ONE TRANSACTION. Doing this as several round-trips from here
 * would allow a crash between the listings upsert and the lifecycle update
 * to leave a half-promoted run. Any failure inside the function rolls back
 * everything; re-promoting the same run_id is a no-op.
 *
 * `coverageComplete` gates lifecycle specifically: a run may legitimately
 * pass the data-quality gate while covering only part of the catalogue, and
 * such a run must never conclude that unseen listings are gone.
 *
 * `lifecycleEnabled` is the bootstrap guard — false until the source has at
 * least one complete, passed, promoted run establishing its universe.
 */
export async function promoteRunAtomic(
  supabase: SupabaseClient,
  runId: string,
  opts: { coverageComplete: boolean; lifecycleEnabled: boolean; failAfterListings?: boolean },
): Promise<{
  skipped: boolean
  reason?: string
  published: number
  newListings: number
  priceChanges: number
  unchanged: number
  delisted: number
  missed: number
  lifecycleApplied: boolean
  error: string | null
}> {
  const empty = {
    skipped: true, published: 0, newListings: 0, priceChanges: 0,
    unchanged: 0, delisted: 0, missed: 0, lifecycleApplied: false,
    error: null as string | null,
  }

  const { data, error } = await supabase.rpc('promote_scrape_run', {
    p_run_id: runId,
    p_coverage_complete: opts.coverageComplete,
    p_delist_threshold: 3,
    p_lifecycle_enabled: opts.lifecycleEnabled,
    p_fail_after_listings: opts.failAfterListings ?? false,
  })

  if (error) return { ...empty, error: error.message }
  const r = data as Record<string, unknown>
  return {
    skipped: Boolean(r.skipped),
    reason: r.reason as string | undefined,
    published: Number(r.published ?? 0),
    newListings: Number(r.first_seen ?? 0),
    priceChanges: Number(r.price_changes ?? 0),
    unchanged: Number(r.unchanged ?? 0),
    delisted: Number(r.delisted ?? 0),
    missed: Number(r.missed ?? 0),
    lifecycleApplied: Boolean(r.lifecycle_applied),
    error: null,
  }
}

/**
 * Has this exact SCOPE been established by a complete, passed, promoted v2 run?
 *
 * Scope-specific by necessity: the per-source variant accepted any v2 run, so
 * a single targeted product run established "coverage" for the whole source
 * (observed live). Changing the product universe, pagination, filters, or
 * scraper version requires a fresh bootstrap.
 */
export async function hasEstablishedScopeCoverage(
  supabase: SupabaseClient,
  source: string,
  scopeHash: string,
  scraperVersion: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('scope_has_established_coverage', {
    p_source: source, p_scope_hash: scopeHash, p_scraper_version: scraperVersion,
  })
  if (error) return false
  return Boolean(data)
}

/** @deprecated superseded by promoteRunAtomic — kept only for reference. */
async function promoteRunLegacy(
  supabase: SupabaseClient,
  runId: string,
  source: string,
  opts: { coverageComplete: boolean },
): Promise<{
  published: number
  newListings: number
  priceChanges: number
  unchanged: number
  delisted: number
  reactivated: number
  lifecycleSkipped: boolean
  error: string | null
}> {
  const base = {
    published: 0, newListings: 0, priceChanges: 0, unchanged: 0,
    delisted: 0, reactivated: 0, lifecycleSkipped: true, error: null as string | null,
  }

  // Read back this run's staged rows.
  const staged: any[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('listing_staging')
      .select('*')
      .eq('run_id', runId)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) return { ...base, error: error.message }
    if (!data || data.length === 0) break
    staged.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  if (staged.length === 0) return base

  const now = new Date().toISOString()

  // 1. Publish listings.
  let published = 0
  const CHUNK = 500
  for (let i = 0; i < staged.length; i += CHUNK) {
    const rows = staged.slice(i, i + CHUNK).map(s => ({
      title: s.title,
      price: s.price,
      currency: s.currency,
      price_dkk: s.price_dkk,
      url: s.url,
      image_url: s.image_url,
      location: s.location,
      source: s.source,
      country: s.country,
      normalized_text: s.normalized_text,
      platform: s.platform,
      external_id: s.external_id,
      scraped_at: now,
      last_seen_at: now,
      first_seen_at: now,   // preserved on conflict below for existing rows
      is_active: true,
      watchlist_id: null,
    }))
    const { error } = await supabase
      .from('listings')
      .upsert(rows, { onConflict: 'external_id,source', ignoreDuplicates: false })
    if (error) return { ...base, published, error: error.message }
    published += rows.length
  }

  // upsert overwrites first_seen_at on existing rows; restore the earliest
  // value so time-on-market is not reset every night.
  await supabase.rpc('restore_first_seen_at', { p_source: source }).then(
    () => undefined,
    () => undefined, // helper is optional; see note in migration 043
  )

  // 2. Price-history events (first_seen / price_change only).
  const obs = await appendPriceObservations(
    supabase,
    staged.map(s => ({
      source: s.source,
      country: s.country ?? 'DK',
      price_type: 'asking' as const,
      price_raw: s.price,
      currency: s.currency,
      price_dkk: s.price_dkk,
      listing_url: s.url,
      listing_title: s.title,
      external_id: s.external_id,
    })),
  )
  if (obs.error) return { ...base, published, error: obs.error }

  // 3. Lifecycle — only on documented complete coverage.
  let delisted = 0, reactivated = 0, lifecycleSkipped = true
  if (opts.coverageComplete) {
    const seen = staged.map(s => s.external_id).filter(Boolean) as string[]
    const lc = await reconcileListingLifecycle(supabase, source, seen, {
      runWasComplete: true,
      runId,
    })
    if (lc.error) return { ...base, published, error: lc.error }
    delisted = lc.delisted
    reactivated = lc.reactivated
    lifecycleSkipped = lc.skipped
  }

  await supabase
    .from('scrape_run')
    .update({ published_count: published, promoted_at: now })
    .eq('id', runId)

  return {
    published,
    newListings: obs.firstSeen,
    priceChanges: obs.priceChanges,
    unchanged: obs.unchanged,
    delisted,
    reactivated,
    lifecycleSkipped,
    error: null,
  }
}
