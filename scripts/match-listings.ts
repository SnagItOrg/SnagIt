/**
 * scripts/match-listings.ts
 *
 * Finds listings without an entry in listing_product_match and runs the
 * matching pipeline against the knowledge graph.
 *
 * Processes up to MAX_PER_RUN listings then exits cleanly. Let PM2 schedule
 * the next run via cron_restart — do NOT rely on autorestart-on-crash.
 *
 * Usage:
 *   npm run match-listings
 *
 * Env (loaded from frontend/.env.local or .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { matchListings } from '../frontend/lib/matching/match-listings'
import { matcherSourceList } from '../frontend/lib/matching/sources'

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

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── HISTORICAL BACKLOG MODE — explicitly opt-in, dry-run by default ──────────
//
// This command is the ONLY code path that can select listings by recency
// rather than by scrape batch, i.e. the only one that can reach the
// pre-activation unmatched backlog. It is therefore fail-closed:
//
//   no flags                       -> refuse, ZERO writes, exit 0
//   --historical-backfill          -> DRY RUN; requires --sources and --max
//   ... plus --apply               -> would write; still requires --sources
//                                     and --max, and is NOT authorised in this
//                                     revision (never run here)
//
// Ordinary new inflow is matched by each scraper through
// scripts/lib/match-new-inflow.ts using its own batch ids. PM2 must never
// invoke this command — see ecosystem.config.js.
const argv = process.argv.slice(2)
const HISTORICAL = argv.includes('--historical-backfill')
const APPLY      = argv.includes('--apply')
const SOURCES_ARG = argv.find(a => a.startsWith('--sources='))?.split('=')[1] ?? null
const MAX_ARG     = argv.find(a => a.startsWith('--max='))?.split('=')[1] ?? null

/** Ceiling for any future apply run; a larger --max is refused outright. */
const MAX_HISTORICAL_APPLY = 5_000

function refuse(reason: string): never {
  console.log('[match-listings] REFUSING TO RUN — 0 listings selected, 0 rows written.')
  console.log(`  Reason: ${reason}`)
  console.log('  Normal new-inflow matching happens inside each scraper via')
  console.log('  scripts/lib/match-new-inflow.ts, bounded to that run\'s own listing ids.')
  console.log('  Historical backlog mode (separately authorised) requires:')
  console.log('    npx tsx scripts/match-listings.ts --historical-backfill \\')
  console.log(`      --sources=<a,b> --max=<n<=${MAX_HISTORICAL_APPLY}> [--apply]`)
  process.exit(0)
}

if (!HISTORICAL) {
  refuse('this command no longer has an unbounded default mode; --historical-backfill is required')
}
if (!SOURCES_ARG) refuse('--historical-backfill requires an explicit --sources= set')
if (!MAX_ARG)     refuse('--historical-backfill requires an explicit --max=')

const HISTORICAL_SOURCES = SOURCES_ARG.split(',').map(s => s.trim()).filter(Boolean)
const invalidSources = HISTORICAL_SOURCES.filter(s => !matcherSourceList().includes(s))
if (HISTORICAL_SOURCES.length === 0) refuse('--sources= resolved to an empty set')
if (invalidSources.length > 0)       refuse(`unsupported source(s): ${invalidSources.join(', ')}`)

const MAX_PER_RUN = Number(MAX_ARG)
if (!Number.isInteger(MAX_PER_RUN) || MAX_PER_RUN <= 0) refuse(`--max must be a positive integer, got ${MAX_ARG}`)
if (MAX_PER_RUN > MAX_HISTORICAL_APPLY) refuse(`--max=${MAX_PER_RUN} exceeds the ${MAX_HISTORICAL_APPLY} ceiling`)

const DRY_RUN = !APPLY
console.log(
  `[match-listings] HISTORICAL BACKLOG MODE — sources=${HISTORICAL_SOURCES.join(',')} ` +
  `max=${MAX_PER_RUN} ${DRY_RUN ? '(DRY RUN — no rows will be written)' : '(APPLY — rows WILL be written)'}`,
)

const BATCH            = 50       // listings fetched per batch
const QUERY_TIMEOUT_MS = 30_000   // per-query timeout; on timeout skip batch instead of crashing
const BATCH_SLEEP_MS   = 500      // pause between batches

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms)
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let offset       = 0
  let processed    = 0
  let totalMatched = 0
  let totalRejected = 0
  let totalDeferred = 0
  let totalFound   = 0
  let timeouts     = 0

  console.log(`🔍  Historical scan: up to ${MAX_PER_RUN} listings in batches of ${BATCH}…\n`)

  while (processed < MAX_PER_RUN) {
    let batch: Array<{ id: string; title: string }> | null = null

    try {
      const res = await withTimeout(
        supabase
          .from('listings')
          .select('id, title')
          .not('title', 'is', null)
          // Was ['reverb','finn','blocket','dba'] — 'dba' never matched a row
          // because DBA listings are stored as 'dba.dk', and 'kleinanzeigen'
          // was missing entirely. See frontend/lib/matching/sources.ts.
          .in('source', HISTORICAL_SOURCES)
          .order('scraped_at', { ascending: false })
          .range(offset, offset + BATCH - 1),
        QUERY_TIMEOUT_MS,
        `listings range ${offset}`,
      )
      if (res.error) throw new Error(`Fetch listings: ${res.error.message}`)
      batch = (res.data ?? []) as Array<{ id: string; title: string }>
    } catch (err) {
      timeouts++
      console.warn(`⚠️  skip offset ${offset} — ${(err as Error).message}`)
      offset += BATCH
      await sleep(BATCH_SLEEP_MS)
      continue
    }

    if (!batch || batch.length === 0) break

    const batchIds = batch.map(r => r.id)

    try {
      const res = await withTimeout(
        supabase
          .from('listing_product_match')
          .select('listing_id')
          .in('listing_id', batchIds),
        QUERY_TIMEOUT_MS,
        `listing_product_match offset ${offset}`,
      )
      if (res.error) throw new Error(`Fetch listing_product_match: ${res.error.message}`)

      const matchedSet   = new Set(((res.data ?? []) as Array<{ listing_id: string }>).map(r => r.listing_id))
      const unmatchedIds = batchIds.filter(id => !matchedSet.has(id))

      if (unmatchedIds.length > 0) {
        totalFound += unmatchedIds.length
        if (DRY_RUN) {
          process.stdout.write(`  offset ${offset}: ${unmatchedIds.length} would be considered (dry run — no write)\n`)
          processed += batch.length
          if (batch.length < BATCH) break
          offset += BATCH
          await sleep(BATCH_SLEEP_MS)
          continue
        }
        const { matched, rejected, deferred } = await withTimeout(
          matchListings(supabase, unmatchedIds),
          QUERY_TIMEOUT_MS,
          `matchListings offset ${offset}`,
        )
        totalMatched += matched
        totalRejected += rejected
        totalDeferred += deferred
        process.stdout.write(
          `  offset ${offset}: ${matched}/${unmatchedIds.length} matched` +
          (rejected ? `, ${rejected} brand-collision rejected` : '') +
          (deferred ? `, ${deferred} deferred (no row)` : '') + '\n',
        )
      }
    } catch (err) {
      timeouts++
      console.warn(`⚠️  skip offset ${offset} — ${(err as Error).message}`)
    }

    processed += batch.length
    if (batch.length < BATCH) break
    offset += BATCH
    await sleep(BATCH_SLEEP_MS)
  }

  console.log(
    `\n✅  Done — scanned ${processed}, matched ${totalMatched}/${totalFound} unmatched` +
    (totalRejected ? `, ${totalRejected} brand-collision rejected` : '') +
    (totalDeferred ? `, ${totalDeferred} deferred as unsafe (no row written)` : '') +
    (timeouts ? `, ${timeouts} skipped batch(es)` : ''),
  )
  process.exit(0)
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
