/**
 * scripts/purge-stale.ts
 *
 * PAN-264: the nightly retention job. Applies the two rules in
 * scripts/lib/purge-stale.ts:
 *   1. listings inactive for 30 days that nothing references;
 *   2. listing_staging rows 14 days old whose run was promoted.
 *
 * Fail-closed, in this order, for each rule:
 *   - refuse if the table's columns are not the ones this script exports
 *     (an added column would be missing from the export, so the restore
 *     would not be exact);
 *   - select the rows, then drop every listing a reference table names;
 *   - refuse if the count is outside --min/--max (a night should see about
 *     a day's worth of rows);
 *   - write the export (every column, plus the cascaded coverage scopes)
 *     and its manifest to --out, read it back and compare it to the rows,
 *     BEFORE anything is deleted;
 *   - with --apply only, delete in batches of 200 by id, each batch again
 *     filtered by the rule's own columns, and stop at the first batch that
 *     deletes anything other than exactly its ids. The foreign keys from
 *     listing_product_match, price_observation and listing_price_history
 *     are NO ACTION, so a match written after the check makes the delete
 *     fail rather than lose the match.
 *
 * Dry run by default: it selects, checks and writes the export, and
 * deletes nothing.
 *   npx tsx scripts/purge-stale.ts                      # dry run, both rules
 *   npx tsx scripts/purge-stale.ts --rule=listings --listings-cutoff=2026-09-15T00:00:00Z
 *   npx tsx scripts/purge-stale.ts --apply              # what PM2 runs
 * Restore an export: scripts/purge-stale-restore.ts.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  LISTING_ID_REFERENCES, LISTING_URL_REFERENCES, buildManifest, checkBounds, chunk, deleteBatches, externalKey,
  isStaleListing, isStaleStaging, listingFingerprint, parseArgs, present, stagingFingerprint, unreferenced,
  COVERAGE_SCOPE_COLUMNS, LISTING_COLUMNS, STAGING_COLUMNS, selectOf, type Manifest, type Row,
} from './lib/purge-stale'

const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const PAGE = 1000
type Result = { data: Row[] | null; error: { message: string } | null }

async function assertColumns(db: SupabaseClient, table: string, cols: Array<[string, string]>): Promise<void> {
  const { data, error } = await db.from(table).select('*').limit(1)
  if (error) throw new Error(`${table}: ${error.message}`)
  if (!data?.[0]) return
  const live = Object.keys(data[0]).sort().join(',')
  const known = cols.map(([c]) => c).sort().join(',')
  if (live !== known) throw new Error(`${table} columns changed (live: ${live}); refusing, the export would be incomplete`)
}

/** All rows `build` selects, keyset-paginated by id. */
async function pageById(build: (after: string | null) => PromiseLike<Result>): Promise<Row[]> {
  const rows: Row[] = []
  let after: string | null = null
  for (;;) {
    const { data, error } = await build(after)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
    after = String(data[data.length - 1].id)
  }
}

/** Write, fsync and read back; never overwrite an earlier export. */
function writeJson(dir: string, file: string, value: unknown): void {
  const target = path.join(dir, file)
  const fd = fs.openSync(target, 'wx')
  fs.writeSync(fd, JSON.stringify(value, null, file.endsWith('manifest.json') ? 2 : 0))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  if (JSON.stringify(JSON.parse(fs.readFileSync(target, 'utf8'))) !== JSON.stringify(value)) {
    throw new Error(`${target} did not read back identically`)
  }
}

interface RuleResult { rule: string; cutoff: string; n: number; deleted: number; manifest: Manifest; extra?: Record<string, number> }

async function listingsRule(db: SupabaseClient, cutoff: string, dir: string, apply: boolean,
  min: number, max: number): Promise<RuleResult> {
  await assertColumns(db, 'listings', LISTING_COLUMNS)
  await assertColumns(db, 'listing_coverage_scopes', COVERAGE_SCOPE_COLUMNS)

  const inactive = await pageById((after) => {
    let q = db.from('listings').select(selectOf(LISTING_COLUMNS)).eq('is_active', false).lt('scraped_at', cutoff)
      .is('watchlist_id', null)
    if (after) q = q.gt('id', after)
    return q.order('id').limit(PAGE) as unknown as PromiseLike<Result>
  })
  const stale = inactive.filter((r) => isStaleListing(r, cutoff))

  // Cheapest and most excluding first (the matched listings, about 18,600 in October 2026, stay old forever), so
  // the url and observation checks only see what is still a candidate. Each set ends up holding every reference
  // among the rows it was asked about, and a row it was not asked about is already excluded.
  const refIds = new Set<string>()
  const none = { ids: refIds, urls: new Set<string>(), externalKeys: new Set<string>(), saved: new Set<string>() }
  for (const table of LISTING_ID_REFERENCES) {
    const open = unreferenced(stale, none).map((r) => String(r.id))
    for (const id of await present(db, table, 'listing_id', open, 200)) refIds.add(id)
  }
  let pool = unreferenced(stale, none)
  const text = (rows: Row[], col: string) => rows.map((r) => r[col]).filter((v): v is string => typeof v === 'string')
  const saved = await present(db, 'saved_listings', 'listing_id',
    [...text(pool, 'id'), ...text(pool, 'url'), ...text(pool, 'external_id')], 50)
  pool = unreferenced(pool, { ...none, saved })
  const refUrls = new Set<string>()
  for (const { table, column } of LISTING_URL_REFERENCES) {
    for (const u of await present(db, table, column, text(unreferenced(pool, { ...none, urls: refUrls }), 'url'), 50)) refUrls.add(u)
  }
  pool = unreferenced(pool, { ...none, urls: refUrls })
  const refExternal = new Set<string>()
  for (const source of [...new Set(pool.map((r) => String(r.source)))]) {
    const ext = text(pool.filter((r) => String(r.source) === source), 'external_id')
    for (const e of await present(db, 'market_price_observations', 'external_id', ext, 200, ['source', source])) {
      refExternal.add(externalKey(source, e))
    }
  }
  const doomed = unreferenced(stale, { ids: refIds, urls: refUrls, externalKeys: refExternal, saved })

  const refusal = checkBounds('listings', doomed.length, min, max)
  if (refusal) throw new Error(refusal)

  const doomedIds = doomed.map((r) => String(r.id))
  const scopes: Row[] = []
  for (const part of chunk(doomedIds, 200)) {
    const { data, error } = await db.from('listing_coverage_scopes').select(selectOf(COVERAGE_SCOPE_COLUMNS)).in('listing_id', part)
    if (error) throw new Error(`listing_coverage_scopes: ${error.message}`)
    scopes.push(...((data ?? []) as unknown as Row[]))
  }

  const manifest = buildManifest(doomed, listingFingerprint)
  writeJson(dir, 'listings.json', doomed)
  writeJson(dir, 'listing_coverage_scopes.json', scopes)
  writeJson(dir, 'listings-manifest.json', { cutoff, n: doomed.length, coverage_scope_rows: scopes.length, apply, manifest })
  console.log(`[purge-stale] listings: ${inactive.length} inactive before ${cutoff}, ${stale.length} stale, ` +
    `${stale.length - doomed.length} kept for a reference, ${doomed.length} to delete (${scopes.length} coverage scope rows go with them)`)

  let deleted = 0
  if (apply) {
    deleted = await deleteBatches('listings', doomedIds, (batch) =>
      db.from('listings').delete().in('id', batch).eq('is_active', false).lt('scraped_at', cutoff)
        .is('watchlist_id', null).select('id') as unknown as PromiseLike<Result>)
  }
  return { rule: 'listings', cutoff, n: doomed.length, deleted, manifest,
    extra: { inactive: inactive.length, stale: stale.length, coverage_scope_rows: scopes.length } }
}

async function stagingRule(db: SupabaseClient, cutoff: string, dir: string, apply: boolean,
  min: number, max: number): Promise<RuleResult> {
  await assertColumns(db, 'listing_staging', STAGING_COLUMNS)
  const { data: runs, error } = await db.from('scrape_run').select('id, promoted_at').not('promoted_at', 'is', null)
  if (error) throw new Error(`scrape_run: ${error.message}`)
  const promoted = new Map((runs ?? []).map((r) => [String(r.id), String(r.promoted_at)]))

  const old = await pageById((after) => {
    let q = db.from('listing_staging').select(selectOf(STAGING_COLUMNS)).lt('created_at', cutoff)
    if (after) q = q.gt('id', after)
    return q.order('id').limit(PAGE) as unknown as PromiseLike<Result>
  })
  const doomed = old.filter((r) => isStaleStaging(r, promoted.get(String(r.run_id)), cutoff))

  const refusal = checkBounds('listing_staging', doomed.length, min, max)
  if (refusal) throw new Error(refusal)

  const manifest = buildManifest(doomed, stagingFingerprint)
  writeJson(dir, 'listing_staging.json', doomed)
  writeJson(dir, 'listing_staging-manifest.json', { cutoff, n: doomed.length, apply, manifest })
  console.log(`[purge-stale] listing_staging: ${old.length} staged before ${cutoff}, ${old.length - doomed.length} ` +
    `kept (run not promoted, or staged after its promotion), ${doomed.length} to delete`)

  let deleted = 0
  if (apply) {
    deleted = await deleteBatches('listing_staging', doomed.map((r) => String(r.id)), (batch) =>
      db.from('listing_staging').delete().in('id', batch).lt('created_at', cutoff)
        .select('id') as unknown as PromiseLike<Result>)
  }
  return { rule: 'listing_staging', cutoff, n: doomed.length, deleted, manifest, extra: { staged_before_cutoff: old.length } }
}

async function main(): Promise<void> {
  const now = new Date()
  const opts = parseArgs(process.argv.slice(2), now)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const dir = opts.outDir ?? path.join(os.homedir(), 'klup-purge-exports', now.toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const db = createClient(url, key, { auth: { persistSession: false } })
  console.log(`[purge-stale] ${opts.apply ? 'APPLY' : 'DRY RUN (nothing is deleted; --apply deletes)'}; export to ${dir}`)

  const results: RuleResult[] = []
  for (const rule of opts.rules) {
    results.push(rule === 'listings'
      ? await listingsRule(db, opts.listingsCutoff, dir, opts.apply, opts.minListings, opts.maxListings)
      : await stagingRule(db, opts.stagingCutoff, dir, opts.apply, opts.minStaging, opts.maxStaging))
  }
  writeJson(dir, 'summary.json', { written_at: now.toISOString(), apply: opts.apply, results })
  for (const r of results) {
    console.log(`[purge-stale] ${r.rule}: ${opts.apply ? `deleted ${r.deleted} of ${r.n}` : `would delete ${r.n}`}`)
  }
}

main().catch((e) => {
  console.error(`[purge-stale] REFUSED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
