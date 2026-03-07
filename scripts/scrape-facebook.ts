/**
 * scripts/scrape-facebook.ts
 *
 * Scrapes Facebook Marketplace (Copenhagen) for listings matching active watchlists.
 * Uses the Apify actor U5DUNxhH3qKt5PnCf via run-sync-get-dataset-items.
 * Upserts results into the Supabase listings table.
 *
 * Usage:
 *   npm run scrape-facebook                  # full run
 *   npm run scrape-facebook -- --dry-run     # test without writing
 */

// ── Env loading (MUST be first) ───────────────────────────────────────────────
import * as dotenv from 'dotenv'
dotenv.config({ path: './frontend/.env.local' })

import { createClient } from '@supabase/supabase-js'

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APIFY_API_KEY = process.env.APIFY_API_KEY

const APIFY_ACTOR_ID = 'U5DUNxhH3qKt5PnCf'
const FETCH_DELAY_MS = 3000  // 1 call per 3 seconds
const MAX_ITEMS = 50

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!APIFY_API_KEY) {
  console.error('❌ Missing APIFY_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Rate limiting ─────────────────────────────────────────────────────────────
let lastFetchTime = 0

async function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function rateLimit() {
  const now = Date.now()
  const elapsed = now - lastFetchTime
  const delay = Math.max(0, FETCH_DELAY_MS - elapsed)
  if (delay > 0) await sleep(delay)
  lastFetchTime = Date.now()
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ApifyListing {
  marketplace_listing_title?: string
  listing_price?: { amount?: string | number }
  listingUrl?: string
  primary_listing_photo?: { photo_image_url?: string }
}

interface ListingRow {
  title: string
  price: number | null
  url: string
  image_url: string | null
  source: string
  scraped_at: string
  watchlist_id: string | null
}

interface Watchlist {
  id: string
  query: string
}

// ── Apify fetch ───────────────────────────────────────────────────────────────
async function fetchFacebookListings(query: string): Promise<ApifyListing[]> {
  await rateLimit()

  const marketplaceUrl = `https://www.facebook.com/marketplace/copenhagen/search/?query=${encodeURIComponent(query)}`
  const apifyUrl = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_KEY}`

  try {
    const res = await fetch(apifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url: marketplaceUrl }],
        maxItems: MAX_ITEMS,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`  HTTP ${res.status}: ${text.slice(0, 200)}`)
      return []
    }

    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.error(`  Fetch error: ${(err as Error).message}`)
    return []
  }
}

// ── Map Apify result to listing row ──────────────────────────────────────────
function mapToRow(item: ApifyListing, watchlistId: string): ListingRow | null {
  const url = item.listingUrl
  if (!url) return null

  const title = item.marketplace_listing_title ?? ''
  const priceRaw = item.listing_price?.amount
  const price = priceRaw != null ? parseInt(String(priceRaw), 10) : null

  return {
    title,
    price: isNaN(price as number) ? null : price,
    url,
    image_url: item.primary_listing_photo?.photo_image_url ?? null,
    source: 'facebook',
    scraped_at: new Date().toISOString(),
    watchlist_id: watchlistId,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🏪 Facebook Marketplace Scraper')
  console.log(`    DRY_RUN: ${DRY_RUN}`)
  console.log(`    Rate limit: ${FETCH_DELAY_MS}ms between calls`)
  console.log()

  // Load active watchlists
  const { data: watchlists, error: wErr } = await supabase
    .from('watchlists')
    .select('id, query')
    .eq('type', 'query')

  if (wErr) {
    console.error(`❌ Failed to load watchlists: ${wErr.message}`)
    process.exit(1)
  }

  if (!watchlists || watchlists.length === 0) {
    console.warn('⚠️  No watchlists found. Nothing to scrape.')
    process.exit(0)
  }

  console.log(`Found ${watchlists.length} watchlists to process.\n`)

  let totalFetched = 0
  let totalUpserted = 0
  let totalErrors = 0

  for (const watchlist of watchlists as Watchlist[]) {
    const { id, query } = watchlist
    console.log(`🔍 "${query}"`)

    const items = await fetchFacebookListings(query)

    if (items.length === 0) {
      console.log(`   → No listings found\n`)
      continue
    }

    console.log(`   → Found ${items.length} listings`)

    const rows = items
      .map(item => mapToRow(item, id))
      .filter((r): r is ListingRow => r !== null)

    totalFetched += rows.length

    if (DRY_RUN) {
      console.log(`   (DRY_RUN) Would upsert ${rows.length} rows`)
      if (rows[0]) console.log(`   Sample: "${rows[0].title}" — ${rows[0].price} DKK`)
      console.log()
      continue
    }

    const { error } = await supabase
      .from('listings')
      .upsert(rows, { onConflict: 'url' })

    if (error) {
      console.error(`   ❌ Upsert failed: ${error.message}`)
      totalErrors++
    } else {
      totalUpserted += rows.length
      console.log(`   ✓ Upserted ${rows.length}`)
    }

    console.log()
  }

  console.log('─'.repeat(50))
  console.log(`✅ Facebook scrape complete`)
  console.log(`   Watchlists processed: ${watchlists.length}`)
  console.log(`   Listings fetched:     ${totalFetched}`)
  if (!DRY_RUN) console.log(`   Upserted:            ${totalUpserted}`)
  if (totalErrors > 0) console.log(`   Errors:              ${totalErrors}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ Error: ${(err as Error).message ?? err}`)
  process.exit(1)
})
