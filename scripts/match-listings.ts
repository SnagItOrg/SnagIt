/**
 * scripts/match-listings.ts
 *
 * The historical backfill: offers listings that hold no listing_product_match
 * row to the matcher. Ordinary new inflow is matched by each scraper through
 * scripts/lib/match-new-inflow.ts using its own batch ids; this command exists
 * for the rows that predate those batches (PAN-262).
 *
 * Usage (from the repository root):
 *   npx tsx scripts/match-listings.ts --historical-backfill --sources=dba.dk --max=N [--ids=a,b] [--from=<scraped_at>] [--show=N|all]
 *   npx tsx scripts/match-listings.ts --historical-backfill --sources=dba.dk --max=N [--from=<scraped_at>] --apply \
 *     --expect-selection=<md5 printed by the dry run> [--out-dir=DIR]
 *   npx tsx scripts/match-listings.ts --rollback=DIR/backfill-rollback-<ts>.json [--apply]
 *
 * Env (loaded from frontend/.env.local or .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { loadMatchIndex, matchListings, type MatchIndex } from '../frontend/lib/matching/match-listings'
import { matcherSourceList } from '../frontend/lib/matching/sources'
import { backfillCohort, selectionDigest, type BackfillRow } from './lib/historical-backfill'
import { outcome, rollback } from './rematch-brand'

// ── Env ───────────────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// The frontend copy of supabase-js, because the client is handed to
// frontend/lib/matching (as scripts/rematch-brand.ts does).
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── HISTORICAL BACKLOG MODE — explicitly opt-in, dry-run by default ──────────
//
// This command is the ONLY code path that can reach the unmatched backlog
// outside a scrape batch. It is therefore fail-closed:
//
//   no flags                       -> refuse, ZERO writes, exit 0
//   --historical-backfill          -> DRY RUN; requires --sources and --max.
//                                     Runs decideMatch in memory against the
//                                     real index and prints the forecast and
//                                     the selection md5. Writes nothing.
//   ... plus --apply               -> an owner-authorised production write, run
//                                     on panter. Refused unless
//                                     --expect-selection= equals the md5 of the
//                                     cohort it selects now, i.e. the cohort
//                                     the dry run forecast. Writes the rollback
//                                     file first, then hands the cohort to
//                                     matchListings, the one writer.
//
// The cohort (scripts/lib/historical-backfill.ts): active listings from
// --sources with NO listing_product_match row, oldest scraped_at first, ties
// broken by id. A listing with any row, so any verdict, is never selected, and
// is re-checked just before its batch is written. --from=<scraped_at> (PAN-266,
// G4) excludes rows scraped before the cursor, so a cohort larger than --max is
// covered round by round; the md5 covers the cursor. PM2 must never invoke this
// command — see ecosystem.config.js.
const argv = process.argv.slice(2)
const flag = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const HISTORICAL = argv.includes('--historical-backfill')
const APPLY      = argv.includes('--apply')
const DRY_RUN = !APPLY
const ROLLBACK   = flag('rollback')
const SOURCES_ARG = flag('sources') ?? null
const MAX_ARG     = flag('max') ?? null
const IDS         = flag('ids') ? new Set(flag('ids')!.split(',').map(s => s.trim()).filter(Boolean)) : undefined
const EXPECT      = flag('expect-selection')
const FROM        = flag('from')
// PAN-266 G4: `--show=all` prints every title of every group, so a 13-row group can be read whole.
const SHOW        = flag('show') === 'all' ? Infinity : Number(flag('show') ?? 3)
const OUT_DIR     = flag('out-dir') ?? path.join(os.tmpdir(), 'backfill')

/** Ceiling for any apply run; a larger --max is refused outright. */
const MAX_HISTORICAL_APPLY = 5_000

/** The rollback runs through rematch-brand's; a backfill file has no held rows to restore. */
const BACKFILL_RUN = { ticket: 'Historical backfill', pan: 'backfill' }

function refuse(reason: string): never {
  console.log('[match-listings] REFUSING TO RUN — 0 listings selected, 0 rows written.')
  console.log(`  Reason: ${reason}`)
  console.log('  Normal new-inflow matching happens inside each scraper via')
  console.log('  scripts/lib/match-new-inflow.ts, bounded to that run\'s own listing ids.')
  console.log('  Historical backlog mode (separately authorised) requires:')
  console.log('    npx tsx scripts/match-listings.ts --historical-backfill \\')
  console.log(`      --sources=<a,b> --max=<n<=${MAX_HISTORICAL_APPLY}> [--apply --expect-selection=<md5>]`)
  process.exit(0)
}

const PAGE  = 1000
const CHUNK = 100

const chunks = <T>(xs: T[]): T[][] =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

/** Every listing from the sources, keyset-paged on the primary key (see rematch-active-titles.ts for why). */
async function readSourceListings(db: SupabaseClient, sources: string[]): Promise<BackfillRow[]> {
  const rows: BackfillRow[] = []
  let last: string | null = null
  for (;;) {
    let q = db.from('listings').select('id, title, external_id, scraped_at, is_active')
      .in('source', sources).order('id').limit(PAGE)
    if (last !== null) q = q.gt('id', last)
    const { data, error } = await q
    if (error) throw new Error(`Fetch listings: ${error.message}`)
    const page = (data ?? []) as BackfillRow[]
    rows.push(...page)
    if (page.length < PAGE) return rows
    last = page[page.length - 1].id
  }
}

/** The listings among `ids` that hold a listing_product_match row of any kind. */
async function withMatchRow(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const group of chunks(ids)) {
    const { data, error } = await db.from('listing_product_match').select('listing_id').in('listing_id', group)
    if (error) throw new Error(`Fetch listing_product_match: ${error.message}`)
    for (const r of data ?? []) out.add(r.listing_id as string)
  }
  return out
}

const adNo = (r: BackfillRow) => r.external_id?.split('/').pop() ?? r.id

/** The forecast: every decision is decideMatch's, against the index matchListings loads. Nothing is written. */
function forecast(cohort: BackfillRow[], index: MatchIndex, show: number): Record<string, number> {
  const totals: Record<string, number> = {}
  const byProduct = new Map<string, BackfillRow[]>()
  for (const l of cohort) {
    const o = outcome(l.title!, index)
    const kind = o.key.startsWith('deferred:') ? o.key : o.key.split(':')[0]
    totals[kind] = (totals[kind] ?? 0) + 1
    if (o.slug) byProduct.set(o.key, [...(byProduct.get(o.key) ?? []), l])
    if (IDS) console.log(`  ${adNo(l)} | ${l.id} | ${o.key} | ${l.title}`)
  }
  console.log('totals by outcome:')
  for (const [k, n] of Object.entries(totals).sort()) console.log(`  ${k}: ${n}`)
  console.log(`per product (${byProduct.size}), outcome:slug → count, then up to ${show} sample titles:`)
  for (const [k, ls] of Array.from(byProduct.entries()).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${k} → ${ls.length}`)
    for (const l of ls.slice(0, show)) console.log(`      ${adNo(l)} | ${l.title}`)
  }
  return totals
}

async function backfill(db: SupabaseClient, sources: string[], max: number, from?: string): Promise<void> {
  const [rows, index] = await Promise.all([readSourceListings(db, sources), loadMatchIndex(db)])
  const active = rows.filter(r => r.is_active)
  const matched = await withMatchRow(db, active.map(r => r.id))
  const cohort = backfillCohort(rows, matched, max, IDS, from)
  const digest = selectionDigest(cohort, from)
  const pool = backfillCohort(rows, matched, Number.MAX_SAFE_INTEGER).length
  const atOrAfter = from ? backfillCohort(rows, matched, Number.MAX_SAFE_INTEGER, undefined, from).length : pool

  console.log(`${rows.length} listings from ${sources.join(',')}: ${active.length} active, ${matched.size} of them hold a match row`)
  console.log(`${rows.length - active.length} inactive listings are not selected`)
  console.log(`cohort: ${pool} active listings with no match row, ordered scraped_at, id` +
    (from ? `; ${atOrAfter} at or after --from=${from}` : '') + `; selected ${cohort.length}` +
    (IDS ? ` of ${IDS.size} named by --ids` : ` (--max=${max})`))
  if (IDS) for (const id of Array.from(IDS)) if (!cohort.some(r => r.id === id)) {
    const r = rows.find(x => x.id === id)
    console.log(`  NOT SELECTED ${id}: ${!r ? 'not a listing from these sources' : !r.is_active ? 'inactive' : matched.has(id) ? 'holds a match row' : 'no title'}`)
  }
  if (cohort.length > 0) console.log(`first ${cohort[0].scraped_at} ${cohort[0].id}, last ${cohort[cohort.length - 1].scraped_at} ${cohort[cohort.length - 1].id}`)
  console.log(`selection md5=${digest}`)
  const totals = forecast(cohort, index, SHOW)
  if (DRY_RUN) return

  if (EXPECT !== digest) refuse(`--expect-selection=${EXPECT ?? '(missing)'} does not equal the selection md5 ${digest}; re-run the dry run`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `backfill-rollback-${Date.now()}.json`)
  const fd = fs.openSync(file, 'wx')
  fs.writeSync(fd, JSON.stringify({
    started_at: new Date().toISOString(),
    selection_md5: digest,
    from: from ?? null,
    forecast: totals,
    listing_ids: cohort.map(r => r.id),
    held_rows: [],
  }))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${file}`)

  const written = { matched: 0, rejected: 0, deferred: 0, total: 0, raced: 0 }
  for (const group of chunks(cohort.map(r => r.id))) {
    // A row may have appeared since the selection (a scrape's own matcher, a person): leave those.
    const now = await withMatchRow(db, group)
    const ids = group.filter(id => !now.has(id))
    written.raced += group.length - ids.length
    const r = await matchListings(db, ids)
    written.matched += r.matched; written.rejected += r.rejected; written.deferred += r.deferred; written.total += r.total
  }
  console.log(`✅  written: ${JSON.stringify(written)} (forecast matched ${totals.matched ?? 0}, rejected ${totals.rejected ?? 0})`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (ROLLBACK) return rollback(supabase, BACKFILL_RUN, ROLLBACK, APPLY)

  if (!HISTORICAL) {
    refuse('this command no longer has an unbounded default mode; --historical-backfill is required')
  }
  if (!SOURCES_ARG) refuse('--historical-backfill requires an explicit --sources= set')
  if (!MAX_ARG)     refuse('--historical-backfill requires an explicit --max=')

  const sources = SOURCES_ARG.split(',').map(s => s.trim()).filter(Boolean)
  const invalidSources = sources.filter(s => !matcherSourceList().includes(s))
  if (sources.length === 0)       refuse('--sources= resolved to an empty set')
  if (invalidSources.length > 0)  refuse(`unsupported source(s): ${invalidSources.join(', ')}`)

  const max = Number(MAX_ARG)
  if (!Number.isInteger(max) || max <= 0) refuse(`--max must be a positive integer, got ${MAX_ARG}`)
  if (max > MAX_HISTORICAL_APPLY) refuse(`--max=${max} exceeds the ${MAX_HISTORICAL_APPLY} ceiling`)
  if (APPLY && !EXPECT) refuse('--apply requires --expect-selection=<the md5 the dry run printed>')
  if (FROM !== undefined && Number.isNaN(Date.parse(FROM))) refuse(`--from must be a scraped_at timestamp as the dry run prints it, got ${FROM}`)

  console.log(
    `[match-listings] HISTORICAL BACKLOG MODE — sources=${sources.join(',')} ` +
    `max=${max}${FROM ? ` from=${FROM}` : ''} ${DRY_RUN ? '(DRY RUN — no rows will be written)' : '(APPLY — rows WILL be written)'}`,
  )
  await backfill(supabase, sources, max, FROM)
}

main().then(() => process.exit(0), err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
