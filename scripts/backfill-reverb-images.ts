/**
 * scripts/backfill-reverb-images.ts
 *
 * One-time backfill: fetches image URLs from Reverb API for listings
 * in the DB that have NULL image_url.
 *
 * Usage:
 *   npx tsx scripts/backfill-reverb-images.ts
 *   npx tsx scripts/backfill-reverb-images.ts --limit=100
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ─────────────────────────────────────────────────────────────────
const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const args = process.argv.slice(2)
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : 500

const HEADERS = {
  'Accept-Version': '3.0',
  'Accept': 'application/hal+json',
  'User-Agent': 'Klup-Scraper/1.0',
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

interface ReverbPhoto {
  _links?: { large_crop?: { href?: string } }
}

interface ReverbListing {
  id: number | string
  photos?: ReverbPhoto[]
}

async function fetchReverbListing(externalId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.reverb.com/api/listings/${externalId}`, { headers: HEADERS })
    if (!res.ok) return null
    const data = (await res.json()) as ReverbListing
    return data.photos?.[0]?._links?.large_crop?.href ?? null
  } catch {
    return null
  }
}

async function main() {
  console.log('Backfill Reverb images')
  console.log(`  Limit: ${LIMIT}\n`)

  // Fetch Reverb listings with NULL image_url
  const { data: listings, error } = await supabase
    .from('listings')
    .select('id, external_id, title')
    .eq('source', 'reverb')
    .is('image_url', null)
    .not('external_id', 'is', null)
    .limit(LIMIT)

  if (error) {
    console.error(`DB error: ${error.message}`)
    process.exit(1)
  }

  if (!listings || listings.length === 0) {
    console.log('No listings need backfill.')
    return
  }

  console.log(`Found ${listings.length} listings without images\n`)

  let updated = 0
  let skipped = 0

  for (const listing of listings) {
    await sleep(2500) // Rate limit

    const imageUrl = await fetchReverbListing(listing.external_id)

    if (!imageUrl) {
      skipped++
      continue
    }

    const { error: updateError } = await supabase
      .from('listings')
      .update({ image_url: imageUrl })
      .eq('id', listing.id)

    if (updateError) {
      console.error(`  Failed to update ${listing.id}: ${updateError.message}`)
      skipped++
    } else {
      updated++
      if (updated % 10 === 0) console.log(`  ${updated} updated...`)
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped`)
}

main().catch((err: unknown) => {
  console.error(`${(err as Error).message ?? err}`)
  process.exit(1)
})
