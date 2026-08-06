/**
 * scripts/lib/price-observations.ts
 *
 * Shared helper: record asking-price HISTORY for scraped listings.
 *
 * ── WHY EVENT-BASED, NOT DAILY SNAPSHOTS ────────────────────────────────
 * The naive design (one observation per listing per scrape) is actively
 * misleading for price analysis. A listing that sits on DBA for 90 days
 * would produce 90 rows — but it is ONE unit of supply observed 90 times,
 * not 90 independent data points. Any median computed over that table would
 * be dominated by long-lived, overpriced listings: precisely the ads that
 * did NOT sell would define the "market price".
 *
 * So we write an observation only on a MEANINGFUL EVENT:
 *   - first_seen  — the first time we ever see this listing
 *   - price_change — the seller changed the asking price
 *
 * A listing that sits unchanged for 90 days therefore contributes exactly
 * one row, which is the correct weight. Time-on-market and current status
 * are derived from `listings` (first_seen_at, scraped_at, is_active,
 * delisted_at), not by counting observation rows.
 *
 * ── WHAT THIS DATA IS AND ISN'T ─────────────────────────────────────────
 * These are ASKING prices — what sellers hoped to get, not realised
 * transactions. A listing disappearing is NOT proof of sale (it may have
 * expired, been deleted, or been renewed). Any downstream "sold price"
 * inference must be explicit about that uncertainty. Keep price_type
 * 'asking' distinct from 'sold' (Reverb transactions) and 'retail'
 * (Thomann new) — never average them together.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'

export type PriceType = 'asking' | 'sold' | 'retail'
export type ObservationEvent = 'first_seen' | 'price_change'

export interface ObservationInput {
  source: string
  country: string
  price_type: PriceType
  price_raw: number | null
  currency: string | null
  price_dkk: number | null
  condition?: string | null
  listing_url?: string | null
  listing_title?: string | null
  external_id?: string | null
}

export interface AppendResult {
  firstSeen: number
  priceChanges: number
  unchanged: number
  error: string | null
}

/**
 * Append price observations for listings whose price is new or has changed.
 * Never throws — price history is best-effort and must not abort a scrape.
 */
export async function appendPriceObservations(
  supabase: SupabaseClient,
  observations: ObservationInput[],
): Promise<AppendResult> {
  const candidates = observations.filter(
    o => o.price_dkk != null && o.price_raw != null && o.external_id,
  )
  if (candidates.length === 0) {
    return { firstSeen: 0, priceChanges: 0, unchanged: 0, error: null }
  }

  const source = candidates[0].source
  const ids = candidates.map(o => o.external_id as string)

  // Latest known price per listing. Chunked: a large .in() list blows the
  // URL length limit (same constraint /intel works around).
  const lastPrice = new Map<string, number>()
  const CHUNK = 50
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('market_price_observations')
      .select('external_id, price_dkk, observed_at')
      .eq('source', source)
      .eq('price_type', candidates[0].price_type)
      .in('external_id', ids.slice(i, i + CHUNK))
      .order('observed_at', { ascending: false })

    if (error) return { firstSeen: 0, priceChanges: 0, unchanged: 0, error: error.message }
    // Ordered newest-first, so the first value per id wins.
    for (const row of data ?? []) {
      if (!lastPrice.has(row.external_id)) lastPrice.set(row.external_id, Number(row.price_dkk))
    }
  }

  const now = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  let unchanged = 0
  let firstSeen = 0
  let priceChanges = 0

  for (const o of candidates) {
    const prev = lastPrice.get(o.external_id as string)
    const current = Number(o.price_dkk)

    if (prev === undefined) {
      firstSeen++
    } else if (prev !== current) {
      priceChanges++
    } else {
      unchanged++
      continue // the whole point: no row for an unchanged listing
    }

    rows.push({
      kg_product_id: null,
      source: o.source,
      country: o.country,
      price_type: o.price_type,
      price_raw: o.price_raw,
      currency: o.currency ?? 'DKK',
      price_dkk: o.price_dkk,
      condition: o.condition ?? null,
      listing_url: o.listing_url ?? null,
      listing_title: o.listing_title ?? null,
      external_id: o.external_id,
      observed_at: now,
    })
  }

  if (rows.length === 0) return { firstSeen: 0, priceChanges: 0, unchanged, error: null }

  const { error } = await supabase
    .from('market_price_observations')
    .upsert(rows, { onConflict: 'source,external_id,price_type,observed_at', ignoreDuplicates: true })

  if (error) return { firstSeen: 0, priceChanges: 0, unchanged, error: error.message }
  return { firstSeen, priceChanges, unchanged, error: null }
}

/**
 * Consecutive complete, successful runs a listing must be missing from
 * before it is delisted. A single failed or partial search must NEVER mass-
 * delist a source — that would fabricate a wave of fake "sold" signals.
 */
export const DELIST_AFTER_MISSES = 3

/**
 * Maintain listing lifecycle for one source after a scrape.
 *
 * CALL THIS ONLY AFTER A COMPLETE, SUCCESSFUL RUN. If the quality gate
 * returned `failed` or `quarantined`, or the run was partial (--limit,
 * --product, or a high product-failure rate), skip it entirely — a
 * miss must mean "genuinely absent from a full sweep", not "we didn't look".
 *
 * - Re-found listings: refresh last_seen_at, reset consecutive_misses to 0,
 *   and REACTIVATE if previously delisted (sellers renew and relist).
 * - Missing listings: increment consecutive_misses. Only at
 *   DELIST_AFTER_MISSES do they become inactive.
 *
 * delisted_at is NOT a sale date. The listing may have expired, been
 * deleted, or been renewed under a new id. Never infer a transaction.
 */
export async function reconcileListingLifecycle(
  supabase: SupabaseClient,
  source: string,
  seenExternalIds: string[],
  opts: { runWasComplete: boolean; runId: string },
): Promise<{ delisted: number; reactivated: number; missing: number; skipped: boolean; error: string | null }> {
  const base = { delisted: 0, reactivated: 0, missing: 0, skipped: true, error: null as string | null }
  if (!opts.runWasComplete) return base
  if (seenExternalIds.length === 0) return base // never delist off an empty result set

  const now = new Date().toISOString()
  const seen = new Set(seenExternalIds)

  const rows: {
    id: string; external_id: string | null; is_active: boolean | null
    consecutive_misses: number | null; last_miss_run_id: string | null
  }[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, external_id, is_active, consecutive_misses, last_miss_run_id')
      .eq('source', source)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) return { ...base, skipped: false, error: error.message }
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  const refound = rows.filter(r => r.external_id && seen.has(r.external_id))
  const missing = rows.filter(r => r.external_id && !seen.has(r.external_id) && r.is_active !== false)

  let reactivated = 0
  for (let i = 0; i < refound.length; i += 50) {
    const chunk = refound.slice(i, i + 50)
    const wasInactive = chunk.filter(r => r.is_active === false).length
    const { error } = await supabase
      .from('listings')
      .update({
        last_seen_at: now, consecutive_misses: 0,
        is_active: true, delisted_at: null, last_miss_run_id: null,
      })
      .in('id', chunk.map(r => r.id))
    if (error) return { delisted: 0, reactivated, missing: missing.length, skipped: false, error: error.message }
    reactivated += wasInactive
  }

  // Increment misses — but AT MOST ONCE PER RUN. Re-running reconciliation
  // for the same run_id (a retry, a resumed job) must not compound misses
  // into a false delisting, so this is idempotent by construction.
  let delisted = 0
  let counted = 0
  for (const r of missing) {
    if (r.last_miss_run_id === opts.runId) continue // already counted this run
    counted++
    const misses = (r.consecutive_misses ?? 0) + 1
    const shouldDelist = misses >= DELIST_AFTER_MISSES
    const { error } = await supabase
      .from('listings')
      .update(
        shouldDelist
          ? { consecutive_misses: misses, last_miss_run_id: opts.runId, is_active: false, delisted_at: now }
          : { consecutive_misses: misses, last_miss_run_id: opts.runId },
      )
      .eq('id', r.id)
    if (error) return { delisted, reactivated, missing: counted, skipped: false, error: error.message }
    if (shouldDelist) delisted++
  }

  return { delisted, reactivated, missing: counted, skipped: false, error: null }
}
