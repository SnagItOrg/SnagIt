/**
 * frontend/lib/matching/ingestion-batch.ts
 *
 * SERVER-ONLY. First-ingestion identity: minting, DATABASE-CONFIRMED selection,
 * and the single bounded writer→matcher handoff.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS LIVES HERE
 *
 * It began in `scripts/lib/match-new-inflow.ts`, serving the five PM2
 * scrapers. `/api/cron/scrape` is the sixth listing writer and the only one
 * that runs on Vercel, and Next cannot import from `scripts/`. It sits beside
 * `match-listings.ts` for exactly the reason that file does: both sides of the
 * repo already consume `frontend/lib/matching/*` (scripts by relative path,
 * the app by `@/`), so one definition binds every writer. `match-new-inflow.ts`
 * re-exports this module unchanged, so the scrapers are untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE
 *
 * An upsert's returned ids are NOT proof of first insertion. `ON CONFLICT DO
 * UPDATE` returns REFRESHED historical rows too — ~35,025 across five
 * representative batches, ~32,544 of them Reverb. Eligibility is therefore the
 * STORED, trigger-protected `listings.ingestion_batch_id` (migration 055),
 * re-queried from the database and verified again in memory, never the write
 * call's output and never a timestamp.
 *
 * FAIL-CLOSED. Absent, malformed, mismatched, incomplete, oversized or failed
 * boundary evidence performs ZERO writes. There is deliberately no fallback
 * that selects rows by time, recency or "unmatched" status — the absence of
 * such a fallback is the safety property.
 *
 * NEVER THROWS. A matcher failure must not falsify a writer's success, so
 * every error is caught, logged and reported.
 */

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { matchListings } from './match-listings'
import { isMatcherSource } from './sources'

/** Canonical textual form of a v4 UUID, which is what Postgres `uuid` renders. */
const BATCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Canonicalise for comparison. Postgres compares `uuid` values by value, not by
 * text, so a stored id may render in any case; lower-casing prevents a false
 * REJECTION. It can never cause a false acceptance — two distinct UUIDs cannot
 * collide under case folding.
 */
function canonicalBatchId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return BATCH_ID_RE.test(v) ? v : null
}

/** A batch id is usable only if it is a real UUID. Anything else is malformed. */
export function isIngestionBatchId(value: unknown): value is string {
  return canonicalBatchId(value) !== null
}

/**
 * One cryptographically strong batch id per execution, generated BEFORE the
 * execution writes any listing. Stamped onto every INSERT payload and made
 * immutable by migration 055's trigger.
 */
export function newIngestionBatchId(): string {
  return randomUUID()
}

/**
 * Ask the database which listings actually carry this batch id.
 *
 * `.eq()` is the server-side boundary; the in-memory re-check on the returned
 * `ingestion_batch_id` is defence in depth, so a filter that silently failed to
 * apply cannot widen the batch. Any failure returns null -> zero matcher writes.
 */
export async function fetchBatchListingIds(
  supabase: SupabaseClient,
  source: string,
  batchId: string,
): Promise<string[] | null> {
  const wanted = canonicalBatchId(batchId)
  if (!wanted) {
    console.error('[ingestion-batch] malformed batch id — 0 rows written')
    return null
  }
  const ids: string[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, ingestion_batch_id')
      .eq('source', source)
      .eq('ingestion_batch_id', wanted)
      .order('id')
      .range(offset, offset + 999)
    if (error) {
      console.error(`[ingestion-batch] ${source}: batch identity lookup failed (${error.message}) — 0 rows written`)
      return null
    }
    if (!data?.length) break
    for (const r of data as Array<{ id: string; ingestion_batch_id: string | null }>) {
      // Exact stored identity only. A row that came back without the expected
      // value is evidence the boundary did not hold, so the whole lookup fails.
      if (canonicalBatchId(r.ingestion_batch_id) !== wanted) {
        console.error(`[ingestion-batch] ${source}: returned row does not carry this batch identity — 0 rows written`)
        return null
      }
      if (typeof r.id === 'string' && r.id.length > 0) ids.push(r.id)
    }
    if (data.length < 1000) break
    offset += 1000
  }
  return ids
}

/** PostgREST URL-length ceiling for an `.in()` list; same limit the report uses. */
const ID_CHUNK = 50

/**
 * Sanity ceiling on one batch. This guards against a BOUNDARY BUG — a caller
 * accidentally passing something close to the whole table — not against
 * legitimate throughput.
 *
 * Measured from production (read-only): a single DBA promoted run publishes
 * ~712 listings, Finn ~611, Blocket ~527, Kleinanzeigen ~631, and a Reverb run
 * writes ~32,500 because it sweeps the whole active catalogue. The ceiling sits
 * above the largest real run and well below the ~87,000-row `listings` table,
 * so a runaway boundary is still refused outright rather than silently matched.
 */
export const MAX_BATCH_IDS = 50_000

export interface BatchMatchResult {
  source: string
  /** Distinct ids actually offered to the matcher. */
  considered: number
  matched: number
  rejected: number
  deferred: number
  /** Set when nothing was attempted; always paired with zero writes. */
  skipped?: string
}

function zero(source: string, skipped: string): BatchMatchResult {
  return { source, considered: 0, matched: 0, rejected: 0, deferred: 0, skipped }
}

/**
 * Match exactly the listings this batch inserted.
 *
 * @param source  `listings.source` value; must be an eligible matcher source.
 * @param ids     Listing ids CONFIRMED by `fetchBatchListingIds`.
 */
export async function matchScrapedBatch(
  supabase: SupabaseClient,
  source: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<BatchMatchResult> {
  // Unknown or unsupported source -> no work. Keeps the allowlist authoritative.
  if (!isMatcherSource(source)) return zero(source, 'source_not_matchable')

  // Deduplicate: the same listing can appear under several query variants in
  // one run, and a duplicate id must not be offered (or written) twice.
  const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))

  if (unique.length === 0) return zero(source, 'no_batch_ids')
  if (unique.length > MAX_BATCH_IDS) return zero(source, `batch_too_large_${unique.length}`)

  const out: BatchMatchResult = { source, considered: unique.length, matched: 0, rejected: 0, deferred: 0 }

  try {
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const r = await matchListings(supabase, unique.slice(i, i + ID_CHUNK))
      out.matched  += r.matched
      out.rejected += r.rejected
      out.deferred += r.deferred
    }
  } catch (err) {
    // Deliberately swallowed: the write already succeeded and its result must
    // stand. Report, do not rethrow.
    return {
      ...out,
      skipped: `matcher_error:${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return out
}

/** Counts only — never listing titles, urls or secrets. */
export function reportBatchMatch(r: BatchMatchResult): void {
  if (r.skipped) {
    console.log(`[ingestion-batch] ${r.source}: no matching performed (${r.skipped}) — 0 rows written`)
    return
  }
  console.log(
    `[ingestion-batch] ${r.source}: considered ${r.considered} batch listing(s) → ` +
    `${r.matched} matched, ${r.rejected} rejected, ${r.deferred} deferred (no row)`,
  )
}

// ── Multi-source execution handoff ──────────────────────────────────────────

export interface RunHandoffResult {
  /** The execution's batch id was a real UUID. */
  batch_id_valid: boolean
  /**
   * Every matchable source produced a usable, verified id set AND the total was
   * within the ceiling. False means ZERO matcher writes were performed for the
   * whole execution.
   */
  complete: boolean
  results: BatchMatchResult[]
}

/**
 * ONE execution, possibly several sources.
 *
 * The PM2 scrapers each write exactly one source, so they call
 * `fetchBatchListingIds` + `matchScrapedBatch` directly. `/api/cron/scrape`
 * loops over every active watchlist in a single invocation and can write
 * `dba.dk`, `reverb` and `thomann` rows in that one execution, so it needs the
 * same contract applied across the source set.
 *
 * FAIL-CLOSED AT EXECUTION SCOPE, not per source: if ANY source's identity
 * lookup fails, or the combined batch exceeds the ceiling, NOTHING is matched
 * for this execution. Partial trust in an execution whose boundary evidence is
 * known to be incomplete is exactly the property the contract exists to deny.
 *
 * Ids are deduplicated GLOBALLY before any matcher call: a listing row has one
 * source, so per-source sets should already be disjoint, and if they ever are
 * not, the first source to claim an id keeps it and the duplicate is dropped.
 */
export async function matchRunInflow(
  supabase: SupabaseClient,
  batchId: string,
  sources: Iterable<string | null | undefined>,
): Promise<RunHandoffResult> {
  if (!isIngestionBatchId(batchId)) {
    return {
      batch_id_valid: false,
      complete: false,
      results: [zero('(execution)', 'malformed_batch_id')],
    }
  }

  const distinct = Array.from(
    new Set(
      Array.from(sources)
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim()),
    ),
  ).sort()

  if (distinct.length === 0) {
    return { batch_id_valid: true, complete: true, results: [] }
  }

  const matchable = distinct.filter((s) => isMatcherSource(s))
  const results: BatchMatchResult[] = distinct
    .filter((s) => !isMatcherSource(s))
    .map((s) => zero(s, 'source_not_matchable'))

  // ── Phase 1: gather DB-confirmed identity for EVERY matchable source ──────
  // Nothing is matched until all lookups have succeeded.
  const claimed = new Set<string>()
  const perSource = new Map<string, string[]>()
  let failed: string | null = null

  for (const source of matchable) {
    const ids = await fetchBatchListingIds(supabase, source, batchId)
    if (ids === null) { failed = failed ?? source; continue }
    const own: string[] = []
    for (const id of ids) {
      if (claimed.has(id)) continue   // global dedupe across watchlists/sources
      claimed.add(id)
      own.push(id)
    }
    perSource.set(source, own)
  }

  if (failed !== null) {
    for (const source of matchable) {
      results.push(zero(source, source === failed
        ? 'batch_identity_lookup_failed'
        : 'execution_identity_incomplete'))
    }
    return { batch_id_valid: true, complete: false, results }
  }

  if (claimed.size > MAX_BATCH_IDS) {
    for (const source of matchable) {
      results.push(zero(source, `execution_batch_too_large_${claimed.size}`))
    }
    return { batch_id_valid: true, complete: false, results }
  }

  // ── Phase 2: hand off ────────────────────────────────────────────────────
  for (const source of matchable) {
    results.push(await matchScrapedBatch(supabase, source, perSource.get(source) ?? []))
  }

  return { batch_id_valid: true, complete: true, results }
}
