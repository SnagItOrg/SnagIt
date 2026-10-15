/**
 * scripts/lib/purge-stale.ts
 *
 * PAN-264 (owner decision 2026-10-15, items 1a and 3a): the retention rules,
 * as pure functions. scripts/purge-stale.ts runs them nightly through a
 * PurgeStore; the one-time run uses the same code for its export, and its SQL
 * batch files recompute the same predicate and refuse unless they agree.
 *
 * Rule 1, listings. A listing is deleted when every one of these holds:
 *   - is_active = false;
 *   - inactive for 30 days, measured from the last evidence it was live or
 *     delisted: scraped_at, last_seen_at and delisted_at are all before the
 *     cutoff, and scraped_at is set. scraped_at is the column every scraper
 *     refreshes when it sees a listing, and no stale sweep touches it.
 *     delisted_at is written only by the dba.dk, blocket and finn sweeps;
 *     the reverb and kleinanzeigen sweeps write is_active alone;
 *   - watchlist_id is null (a watchlist's own hit);
 *   - nothing references it: no listing_product_match row of any kind (so
 *     no is_valid match and no admin_decision), none in the 053 match
 *     archive, no price_observation or listing_price_history row, no
 *     watchlist notification (migration 066, once applied), no saved
 *     listing (saved_listings.listing_id is text without a foreign key, so
 *     it is matched against the id, the external_id and the url), no
 *     market_price_observations row for its (source, external_id) or its
 *     url, and its url is not in reverb_price_history,
 *     auctionet_price_history or price_snapshots.
 * listing_coverage_scopes rows go with the listing (ON DELETE CASCADE).
 * They are exported with it, so the restore puts them back.
 *
 * Rule 2, listing_staging. A staged row is deleted when its run was
 * promoted (scrape_run.promoted_at is set), it was staged at or before that
 * promotion, and it is 14 days old. promote_scrape_run() (migration 055)
 * is the only reader of staging, together with compute_staging_digest(),
 * which only promote calls. It sets promoted_at in the same transaction, at
 * the end, and returns `already_promoted` for a run it has promoted before,
 * so it never reads that run's rows again. Rows of quarantined, failed or
 * unpromoted runs are kept for forensics (migration 042).
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const LISTING_RETENTION_DAYS = 30
export const STAGING_RETENTION_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** A row as exported: column name to the value PostgREST returned. */
export type Row = Record<string, unknown>

/**
 * Tables whose `listing_id` points at a listing. Any row in any of them
 * keeps the listing. kg_arch_lpm_053 is the archive of match rows that
 * migration 053 repointed; it counts as a match row.
 */
export const LISTING_ID_REFERENCES = [
  'listing_product_match',
  'kg_arch_lpm_053',
  'price_observation',
  'listing_price_history',
  'watchlist_notification',
] as const

/** Not in production until migration 066 is applied; a missing table holds no reference. */
export const OPTIONAL_TABLES = new Set<string>(['watchlist_notification'])

/** Tables that name a listing by its url, without a foreign key. */
export const LISTING_URL_REFERENCES = [
  { table: 'market_price_observations', column: 'listing_url' },
  { table: 'reverb_price_history', column: 'listing_url' },
  { table: 'auctionet_price_history', column: 'listing_url' },
  { table: 'price_snapshots', column: 'listing_url' },
] as const

/**
 * Every column, in table order, as production has them (PAN-264 read R3,
 * 2026-10-15). numeric columns are exported as text so no digit is lost to
 * a JavaScript number; the restore casts them back.
 */
type Columns = Array<[string, 'text-cast' | 'native']>
const native = (...cols: string[]): Columns => cols.map((c) => [c, 'native'])
export const LISTING_COLUMNS: Columns = [
  ...native('id', 'title', 'price', 'currency', 'url', 'image_url', 'location', 'scraped_at', 'source', 'watchlist_id',
    'notified_at', 'normalized_text', 'external_id', 'platform', 'condition', 'brand_id', 'is_active', 'country'),
  ['price_dkk', 'text-cast'],
  ...native('first_seen_at', 'delisted_at', 'last_seen_at', 'consecutive_misses', 'last_miss_run_id',
    'coverage_scope_hash', 'source_query', 'ingestion_batch_id', 'ingested_at'),
]
export const COVERAGE_SCOPE_COLUMNS: Columns = native('listing_id', 'scope_hash', 'source', 'source_query',
  'first_seen_run_id', 'last_seen_run_id', 'first_seen_at', 'last_seen_at')
export const STAGING_COLUMNS: Columns = [
  ...native('id', 'run_id', 'external_id', 'title', 'price', 'currency'),
  ['price_dkk', 'text-cast'],
  ...native('url', 'image_url', 'location', 'source', 'country', 'normalized_text', 'platform', 'created_at', 'source_query'),
]

export const selectOf = (cols: Array<[string, string]>): string =>
  cols.map(([c, how]) => (how === 'text-cast' ? `${c}:${c}::text` : c)).join(',')

export function cutoffFor(days: number, now: Date): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

/**
 * Epoch microseconds of a timestamptz as PostgREST returns it, ISO 8601
 * ("2026-08-01T12:34:56.123456+00:00") or Postgres text
 * ("2026-08-01 12:34:56.123456+00"). Microseconds, because Postgres keeps
 * them and the rules compare at that precision: a row staged a microsecond
 * after its run's promotion was never read by it. A JavaScript number holds
 * every microsecond of this era exactly (below 2^53). Throws on anything
 * else, so an unreadable timestamp stops the run instead of deciding a row.
 */
export function timestampMicros(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(String(value))
  if (!m) throw new Error(`unreadable timestamp: ${String(value)}`)
  const [, y, mo, d, h, mi, s, frac = '', zone] = m
  let offsetMin = 0
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1
    const digits = zone.slice(1).replace(':', '')
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0'))
  }
  return (Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMin * 60_000) * 1000 + Number(frac.padEnd(6, '0'))
}

/** Rule 1 on the listing's own columns. References are checked separately. */
export function isStaleListing(row: Row, cutoffIso: string): boolean {
  const cutoff = timestampMicros(cutoffIso) as number
  const scraped = timestampMicros(row.scraped_at)
  if (row.is_active !== false || row.watchlist_id !== null || scraped === null) return false
  return [scraped, timestampMicros(row.last_seen_at), timestampMicros(row.delisted_at)]
    .every((t) => t === null || t < cutoff)
}

/** Rule 2 on the staged row and its run's promotion time. */
export function isStaleStaging(row: Row, promotedAt: string | undefined, cutoffIso: string): boolean {
  if (promotedAt === undefined) return false
  const created = timestampMicros(row.created_at)
  if (created === null) return false
  return created < (timestampMicros(cutoffIso) as number) && created <= (timestampMicros(promotedAt) as number)
}

/**
 * The listings that no reference table names. `ids` are listing ids,
 * `urls` listing urls, `externalKeys` (source, external_id) pairs, and
 * `saved` the saved_listings.listing_id values, which may be any of the three.
 */
export function unreferenced(
  candidates: Row[],
  referenced: { ids: Set<string>; urls: Set<string>; externalKeys: Set<string>; saved: Set<string> },
): Row[] {
  const named = (v: unknown, set: Set<string>) => v !== null && v !== undefined && set.has(String(v))
  return candidates.filter((r) =>
    !named(r.id, referenced.ids) &&
    !named(r.url, referenced.urls) &&
    !(r.external_id !== null && referenced.externalKeys.has(externalKey(r.source, r.external_id))) &&
    !named(r.id, referenced.saved) && !named(r.external_id, referenced.saved) && !named(r.url, referenced.saved))
}

export function externalKey(source: unknown, externalId: unknown): string {
  return `${String(source)}\u0000${String(externalId)}`
}

/**
 * The batch partition of a row: the first hex digit of its uuid, so 16
 * batches of about equal size. The SQL batch files use left(id::text, 1).
 */
export function partitionOf(id: string): string {
  return id[0].toLowerCase()
}

const us = (v: unknown): string => {
  const t = timestampMicros(v)
  return t === null ? '' : String(t)
}
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/**
 * One line per row over the columns the predicate reads. The SQL side builds
 * the same line, so equal md5s prove the export and the database agree on
 * which rows go and on their state.
 */
export function listingFingerprint(r: Row): string {
  return [r.id, us(r.scraped_at), us(r.last_seen_at), us(r.delisted_at), txt(r.source), txt(r.external_id)].join('|')
}

export function stagingFingerprint(r: Row): string {
  return [r.id, r.run_id, us(r.created_at), txt(r.external_id)].join('|')
}

export interface PartitionManifest { n: number; ids_md5: string; fp_md5: string }
export type Manifest = Record<string, PartitionManifest>

const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex')

/**
 * Per partition: the row count, md5 of the ids joined by ',' and md5 of the
 * fingerprints joined by '\n', both in id order. Postgres orders uuids by
 * their bytes, which is the order of their lower-case text.
 */
export function buildManifest(rows: Row[], fingerprint: (r: Row) => string): Manifest {
  const byPart = new Map<string, Row[]>()
  for (const r of [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))) {
    const p = partitionOf(String(r.id))
    if (!byPart.has(p)) byPart.set(p, [])
    byPart.get(p)?.push(r)
  }
  const out: Manifest = {}
  for (const p of [...byPart.keys()].sort()) {
    const part = byPart.get(p) as Row[]
    out[p] = {
      n: part.length,
      ids_md5: md5(part.map((r) => String(r.id)).join(',')),
      fp_md5: md5(part.map(fingerprint).join('\n')),
    }
  }
  return out
}

/** Fail closed on a count outside the bounds the operator expects. */
export function checkBounds(label: string, n: number, min: number, max: number): string | null {
  if (n < min) return `${label}: ${n} rows is below the minimum ${min}; refusing`
  if (n > max) return `${label}: ${n} rows exceeds the maximum ${max}; refusing`
  return null
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface CliOptions {
  apply: boolean
  rules: Array<'listings' | 'staging'>
  listingsCutoff: string
  stagingCutoff: string
  maxListings: number
  maxStaging: number
  minListings: number
  minStaging: number
  outDir: string | null
}

/**
 * Dry run unless --apply. The defaults bound one night: the first nightly
 * run after the one-time purge should see a day's worth of rows, so a count
 * above the maximum means something upstream went wrong (a sweep that
 * deactivated a whole source 30 days ago, say) and the run deletes nothing.
 */
export function parseArgs(argv: string[], now: Date): CliOptions {
  const value = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit === undefined ? undefined : hit.slice(name.length + 3)
  }
  const int = (name: string, fallback: number): number => {
    const v = value(name)
    if (v === undefined) return fallback
    if (!/^\d+$/.test(v)) throw new Error(`--${name} must be a whole number, got ${v}`)
    return Number(v)
  }
  const iso = (name: string, fallback: string): string => {
    const v = value(name)
    if (v === undefined) return fallback
    return new Date(Math.floor((timestampMicros(v) as number) / 1000)).toISOString()
  }
  const known = new Set(['apply', 'dry-run', 'rule', 'listings-cutoff', 'staging-cutoff', 'max-listings',
    'max-staging', 'min-listings', 'min-staging', 'out'])
  for (const a of argv) {
    const name = a.replace(/^--/, '').split('=')[0]
    if (!a.startsWith('--') || !known.has(name)) throw new Error(`unknown argument ${a}`)
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('--apply and --dry-run together')
  const rule = value('rule') ?? 'all'
  if (!['all', 'listings', 'staging'].includes(rule)) throw new Error(`--rule must be all, listings or staging`)
  return {
    apply: argv.includes('--apply'),
    rules: rule === 'all' ? ['listings', 'staging'] : [rule as 'listings' | 'staging'],
    listingsCutoff: iso('listings-cutoff', cutoffFor(LISTING_RETENTION_DAYS, now)),
    stagingCutoff: iso('staging-cutoff', cutoffFor(STAGING_RETENTION_DAYS, now)),
    maxListings: int('max-listings', 3000),
    maxStaging: int('max-staging', 10000),
    minListings: int('min-listings', 0),
    minStaging: int('min-staging', 0),
    outDir: value('out') ?? null,
  }
}

// ── PostgREST helpers (the CLI's only I/O besides the export files) ─────────

type Result = { data: Row[] | null; error: { message: string } | null }
const PAGE = 1000
export const DELETE_BATCH = 200

/**
 * The values of `column` among `values` that `table` holds. Each chunk is
 * read page by page, so a listing named by more rows than one page holds is
 * still found. Any error throws: an unchecked reference must not read as
 * "no reference".
 */
export async function present(db: SupabaseClient, table: string, column: string, values: string[],
  size: number, eq?: [string, string]): Promise<Set<string>> {
  const found = new Set<string>()
  for (const part of chunk([...new Set(values)], size)) {
    for (let from = 0; ; from += PAGE) {
      let q = db.from(table).select(column).in(column, part)
      if (eq) q = q.eq(eq[0], eq[1])
      const { data, error } = (await q.order(column).range(from, from + PAGE - 1)) as unknown as Result & { error: { code?: string } | null }
      // PGRST205: PostgREST knows no such table. Only a table listed as optional may be missing.
      if (error?.code === 'PGRST205' && OPTIONAL_TABLES.has(table)) return found
      if (error) throw new Error(`${table}.${column}: ${error.message}`)
      for (const r of data ?? []) found.add(String(r[column]))
      if (!data || data.length < PAGE) break
    }
  }
  return found
}

/**
 * Delete `ids` in batches through `del`, which must re-apply the rule's own
 * filters and return the deleted ids. Stops at the first batch that deletes
 * anything but exactly its ids: a row that changed since the check stays,
 * and the run says so instead of carrying on.
 */
export async function deleteBatches(label: string, ids: string[], del: (batch: string[]) => PromiseLike<Result>,
  pauseMs = 250): Promise<number> {
  let deleted = 0
  for (const batch of chunk([...ids].sort(), DELETE_BATCH)) {
    const { data, error } = await del(batch)
    if (error) throw new Error(`${label}: delete stopped after ${deleted} rows: ${error.message}`)
    const got = new Set((data ?? []).map((r) => String(r.id)))
    const extra = [...got].filter((id) => !batch.includes(id))
    if (extra.length > 0) throw new Error(`${label}: a batch deleted ids outside it (${extra.join(',')}); stopped`)
    deleted += got.size
    if (got.size !== batch.length) {
      throw new Error(`${label}: a batch deleted ${got.size} of ${batch.length} (a row changed since the check); stopped after ${deleted}`)
    }
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs))
  }
  return deleted
}
