/**
 * scripts/pan193-jupiter-rematch.ts — PAN-193. DRY RUN unless --apply.
 *
 * Re-matches the active listings whose titles name a Jupiter-4/6/8 and that
 * hold no listing_product_match row at all. Most are legacy rows that no run
 * has evaluated: new-inflow matching only takes the ids a scrape run inserts,
 * and the historical matcher cannot be aimed at a cohort.
 *
 * Dry run: loads the matcher's own index (`loadMatchIndex`), prints every
 * decision `decideMatch` makes, and counts them per product. Writes nothing.
 *
 * --apply: an owner-authorised production write. It writes the rollback file
 * (the start time and the listing ids) BEFORE the first write, then hands the
 * listings to `matchListings`, the one writer, which writes what `decideMatch`
 * decides.
 *
 * --rollback=FILE: deletes the rows created for those listings at or after the
 * recorded start, except any a person has approved since (is_valid=true).
 * It is also a dry run without --apply.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan193-jupiter-rematch.ts
 *   npx tsx scripts/pan193-jupiter-rematch.ts --apply [--out-dir=DIR]
 *   npx tsx scripts/pan193-jupiter-rematch.ts --rollback=DIR/pan193-rollback-<ts>.json [--apply]
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { decideMatch, loadMatchIndex, matchListings } from '../frontend/lib/matching/match-listings'

// The frontend copy of supabase-js, because the client is handed to
// frontend/lib/matching (the pattern scripts/scrape-reverb.ts uses).
const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const APPLY = args.includes('--apply')
const OUT_DIR = flag('out-dir') ?? path.join(os.tmpdir(), 'pan193')
const ROLLBACK = flag('rollback')

/** The ticket's scope: "Jupiter 4/6/8" or "JP-4/6/8" in the title. */
const JUPITER = /(?:jupiter|(?<![\w-])jp)[-\s]?[468](?![\w])/i
const CHUNK = 100

function client(): SupabaseClient {
  for (const p of [path.resolve(__dirname, '../.env.local'), path.resolve(__dirname, '../frontend/.env.local')]) {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data as T[]))
    if (data.length < 1000) return rows
  }
}

const chunks = <T>(xs: T[]): T[][] =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

/** Active Jupiter listings with no match row of any kind. */
async function scope(db: SupabaseClient): Promise<Array<{ id: string; title: string }>> {
  type L = { id: string; title: string | null }
  const listings = (await readAll<L>(() => db.from('listings').select('id, title')
    .eq('is_active', true).or('title.ilike.%jupiter%,title.ilike.%jp%').order('id')))
    .filter((l): l is { id: string; title: string } => !!l.title && JUPITER.test(l.title))
  const held = new Set<string>()
  for (const ids of chunks(listings.map((l) => l.id))) {
    const { data, error } = await db.from('listing_product_match').select('listing_id').in('listing_id', ids)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) held.add(r.listing_id as string)
  }
  return listings.filter((l) => !held.has(l.id))
}

async function rematch(db: SupabaseClient): Promise<void> {
  const [listings, index] = await Promise.all([scope(db), loadMatchIndex(db)])
  const counts: Record<string, number> = {}
  const lines: string[] = []
  for (const l of listings) {
    const d = decideMatch(l.title, index)
    const slug = d.kind === 'matched' || d.kind === 'rejected' ? index.productById.get(d.best.product_id)?.slug : null
    const key = d.kind === 'deferred' ? `deferred:${d.reason}` : slug ? `${d.kind}:${slug}` : d.kind
    counts[key] = (counts[key] ?? 0) + 1
    if (slug) lines.push(`  ${key} | ${l.title}`)
  }
  console.log(`PAN-193 Jupiter re-match — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${listings.length} unmatched listings`)
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`)
  console.log('rows this would write:')
  console.log(lines.sort().join('\n') || '  (none)')
  if (!APPLY) return

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `pan193-rollback-${Date.now()}.json`)
  const fd = fs.openSync(file, 'wx')
  fs.writeSync(fd, JSON.stringify({ started_at: new Date().toISOString(), listing_ids: listings.map((l) => l.id) }))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${file}`)

  for (const ids of chunks(listings.map((l) => l.id))) {
    console.log(await matchListings(db, ids))
  }
}

async function rollback(db: SupabaseClient, file: string): Promise<void> {
  const { started_at, listing_ids } = JSON.parse(fs.readFileSync(file, 'utf8')) as { started_at: string; listing_ids: string[] }
  const rows: Array<{ id: string; is_valid: boolean | null }> = []
  for (const ids of chunks(listing_ids)) {
    const { data, error } = await db.from('listing_product_match').select('id, is_valid')
      .in('listing_id', ids).gte('created_at', started_at).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
  }
  console.log(`PAN-193 rollback — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} rows created since ${started_at}`)
  if (!APPLY) return
  for (const ids of chunks(rows.map((r) => r.id))) {
    const { error } = await db.from('listing_product_match').delete().in('id', ids).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
  }
  console.log('deleted')
}

const db = client()
;(ROLLBACK ? rollback(db, ROLLBACK) : rematch(db)).catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
