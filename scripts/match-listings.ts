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

// ── Safety knobs ──────────────────────────────────────────────────────────────
const BACKFILL = process.argv.includes('--backfill')
let MAX_PER_RUN = 500             // hard cap: scan at most this many listings per invocation
if (BACKFILL) {
  MAX_PER_RUN = 60_000
  console.log('[match] Backfill mode — processing up to 60000 listings')
}
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
  let totalFound   = 0
  let timeouts     = 0

  console.log(`🔍  Scanning up to ${MAX_PER_RUN} listings in batches of ${BATCH}…\n`)

  while (processed < MAX_PER_RUN) {
    let batch: Array<{ id: string; title: string }> | null = null

    try {
      const res = await withTimeout(
        supabase
          .from('listings')
          .select('id, title')
          .not('title', 'is', null)
          .in('source', ['reverb', 'finn', 'blocket', 'dba'])
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
        const { matched } = await withTimeout(
          matchListings(supabase, unmatchedIds),
          QUERY_TIMEOUT_MS,
          `matchListings offset ${offset}`,
        )
        totalMatched += matched
        process.stdout.write(`  offset ${offset}: ${matched}/${unmatchedIds.length} matched\n`)
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
    (timeouts ? `, ${timeouts} skipped batch(es)` : ''),
  )
  process.exit(0)
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
