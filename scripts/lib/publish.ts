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
 *   3. promoteRunAtomic() ONLY on `passed` — delegates to the Postgres
 *                        function promote_scrape_run(), so listings, price
 *                        events and lifecycle all move in ONE transaction
 *
 * quarantined → rows stay in staging, zero downstream effect
 * failed      → rows stay in staging for forensics, zero downstream effect
 *
 * Nothing outside promoteRunAtomic() may write to `listings` on a scrape path.
 *
 * The promotion logic itself lives in SQL (scripts/migrations/047_staging_digest_guard.sql
 * is the current definition). Do not reimplement it here — two copies of the
 * same contract will drift, and only the SQL one runs in a transaction.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'

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

// Baseline selection lives in lib/baseline.ts. The version that used to sit
// here filtered on (source, status='passed') only, so targeted runs defined
// the norm for complete ones — see the cohort contract in that file.

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
