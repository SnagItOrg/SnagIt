/**
 * scripts/purge-stale-restore.ts
 *
 * PAN-264: put back what scripts/purge-stale.ts deleted, from its export.
 *
 *   listings: the rows go back through two holding tables, because
 *     trg_listings_ingestion_identity (migration 055) stamps ingested_at =
 *     now() on every insert, and a restore must keep the original value.
 *       1. scripts/purge-stale-restore-prepare.sql  (creates the empty holding tables)
 *       2. npx tsx scripts/purge-stale-restore.ts <export-dir> --apply
 *          (loads them and reads them back against the manifest)
 *       3. scripts/purge-stale-restore-apply.sql    (one transaction: user triggers off,
 *          insert, triggers on, postflight, holding tables dropped)
 *   listing_staging: it has no trigger, so the rows are inserted directly
 *     (step 2 alone), and read back against the manifest.
 *
 * Dry run by default: it only checks the export files against their manifests.
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  COVERAGE_SCOPE_COLUMNS, LISTING_COLUMNS, STAGING_COLUMNS, buildManifest, chunk, listingFingerprint, present, selectOf,
  stagingFingerprint, type Manifest, type Row,
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

const read = (dir: string, file: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const same = (a: Manifest, b: Manifest): boolean => JSON.stringify(a) === JSON.stringify(b)

async function selectAll(db: SupabaseClient, table: string, select: string, ids: string[], column = 'id'): Promise<Row[]> {
  const rows: Row[] = []
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from(table).select(select).in(column, part)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as unknown as Row[]))
  }
  return rows
}

async function insertAll(db: SupabaseClient, table: string, rows: Row[]): Promise<void> {
  for (const part of chunk(rows, 500)) {
    const { error } = await db.from(table).insert(part)
    if (error) throw new Error(`${table}: insert failed (${error.message}); the rows inserted before it stay, see the prepare/apply files`)
  }
}

async function main(): Promise<void> {
  const [dir, ...flags] = process.argv.slice(2)
  if (!dir || flags.some((f) => f !== '--apply')) throw new Error('usage: purge-stale-restore.ts <export-dir> [--apply]')
  const apply = flags.includes('--apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const db = createClient(url, key, { auth: { persistSession: false } })

  if (fs.existsSync(path.join(dir, 'listings-manifest.json'))) {
    const m = read(dir, 'listings-manifest.json') as { n: number; coverage_scope_rows: number; manifest: Manifest }
    const rows = read(dir, 'listings.json') as Row[]
    const scopes = read(dir, 'listing_coverage_scopes.json') as Row[]
    if (rows.length !== m.n || scopes.length !== m.coverage_scope_rows || !same(buildManifest(rows, listingFingerprint), m.manifest)) {
      throw new Error('listings export does not match its manifest; refusing')
    }
    console.log(`[restore] listings export: ${rows.length} rows and ${scopes.length} coverage scope rows match the manifest`)
    if (apply) {
      const ids = rows.map((r) => String(r.id))
      const held = await present(db, 'purge_restore_listings', 'id', ids, 200)
      if (held.size > 0) throw new Error(`purge_restore_listings already holds ${held.size} of these rows; refusing`)
      await insertAll(db, 'purge_restore_listings', rows)
      await insertAll(db, 'purge_restore_lcs', scopes)
      const back = await selectAll(db, 'purge_restore_listings', selectOf(LISTING_COLUMNS), ids)
      const backScopes = await selectAll(db, 'purge_restore_lcs', selectOf(COVERAGE_SCOPE_COLUMNS), ids, 'listing_id')
      if (!same(buildManifest(back, listingFingerprint), m.manifest) || backScopes.length !== scopes.length) {
        throw new Error('holding tables do not read back as the manifest; do not run the apply file')
      }
      console.log('[restore] holding tables loaded and verified. Next: scripts/purge-stale-restore-apply.sql')
    }
  }

  if (fs.existsSync(path.join(dir, 'listing_staging-manifest.json'))) {
    const m = read(dir, 'listing_staging-manifest.json') as { n: number; manifest: Manifest }
    const rows = read(dir, 'listing_staging.json') as Row[]
    if (rows.length !== m.n || !same(buildManifest(rows, stagingFingerprint), m.manifest)) {
      throw new Error('listing_staging export does not match its manifest; refusing')
    }
    console.log(`[restore] listing_staging export: ${rows.length} rows match the manifest`)
    if (apply) {
      const ids = rows.map((r) => String(r.id))
      const live = await present(db, 'listing_staging', 'id', ids, 200)
      if (live.size > 0) throw new Error(`listing_staging already holds ${live.size} of these rows; refusing`)
      await insertAll(db, 'listing_staging', rows)
      const back = await selectAll(db, 'listing_staging', selectOf(STAGING_COLUMNS), ids)
      if (!same(buildManifest(back, stagingFingerprint), m.manifest)) throw new Error('restored staging rows do not read back as the manifest')
      console.log(`[restore] listing_staging: ${back.length} rows restored and verified`)
    }
  }
}

main().catch((e) => {
  console.error(`[restore] REFUSED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
