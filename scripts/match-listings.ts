/**
 * scripts/match-listings.ts
 *
 * Finds all listings without an entry in listing_product_match and runs the
 * matching pipeline against the knowledge graph.
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
  // Fetch all listing IDs and already-matched IDs to determine the unmatched set
  const [
    { data: alreadyMatched, error: mErr },
    { data: listingsData,   error: lErr },
  ] = await Promise.all([
    supabase.from('listing_product_match').select('listing_id'),
    supabase.from('listings').select('id').not('title', 'is', null),
  ])

  if (mErr) throw new Error(`Fetch listing_product_match: ${mErr.message}`)
  if (lErr) throw new Error(`Fetch listings: ${lErr.message}`)

  const matchedIds = new Set(
    ((alreadyMatched as Array<{ listing_id: string }>) ?? []).map(r => r.listing_id)
  )
  const allIds       = ((listingsData as Array<{ id: string }>) ?? []).map(r => r.id)
  const unmatchedIds = allIds.filter(id => !matchedIds.has(id))

  console.log(`📋  ${unmatchedIds.length} unmatched listings (${matchedIds.size} already matched)`)

  if (unmatchedIds.length === 0) {
    console.log('\n✅  Nothing to do.')
    return
  }

  const { matched, total } = await matchListings(supabase, unmatchedIds)
  console.log(`\n✅  Matched ${matched}/${total} listings`)
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
