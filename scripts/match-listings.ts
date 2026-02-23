/**
 * scripts/match-listings.ts
 *
 * Finds all listings without an entry in listing_product_match and runs the
 * matching pipeline against the knowledge graph.
 *
 * Fetches listings in batches of 200 to avoid URL-length limits on .in() calls.
 * For each batch, checks which IDs are already matched before processing.
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const BATCH        = 200
  let   offset       = 0
  let   totalMatched = 0
  let   totalFound   = 0

  console.log('🔍  Scanning listings in batches of 200…\n')

  while (true) {
    // Fetch one page of listings
    const { data: batch, error: lErr } = await supabase
      .from('listings')
      .select('id, title')
      .not('title', 'is', null)
      .range(offset, offset + BATCH - 1)

    if (lErr) throw new Error(`Fetch listings: ${lErr.message}`)
    if (!batch || batch.length === 0) break

    const batchIds = (batch as Array<{ id: string }>).map(r => r.id)

    // Check which of this batch are already matched (small .in() — safe)
    const { data: alreadyMatched, error: mErr } = await supabase
      .from('listing_product_match')
      .select('listing_id')
      .in('listing_id', batchIds)

    if (mErr) throw new Error(`Fetch listing_product_match: ${mErr.message}`)

    const matchedSet   = new Set(((alreadyMatched ?? []) as Array<{ listing_id: string }>).map(r => r.listing_id))
    const unmatchedIds = batchIds.filter(id => !matchedSet.has(id))

    if (unmatchedIds.length > 0) {
      totalFound += unmatchedIds.length
      const { matched } = await matchListings(supabase, unmatchedIds)
      totalMatched += matched
      process.stdout.write(`  offset ${offset}: ${matched}/${unmatchedIds.length} matched\n`)
    }

    if (batch.length < BATCH) break
    offset += BATCH
  }

  console.log(`\n✅  Done — matched ${totalMatched}/${totalFound} unmatched listings`)
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
