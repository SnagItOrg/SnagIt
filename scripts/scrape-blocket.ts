/**
 * scripts/scrape-blocket.ts
 *
 * Fetches Blocket listings for legendary knowledge-graph products
 * and upserts them into the Supabase listings table.
 *
 * Features:
 *   - Reads active legendary products from kg_product + kg_brand
 *   - Scrapes search pages via frontend/lib/scrapers/blocket.ts
 *   - Conservative 3s rate limiting between products
 *   - Upserts on external_id + source using listing.url as the stable key
 *
 * Usage:
 *   npx tsx scripts/scrape-blocket.ts
 *   npx tsx scripts/scrape-blocket.ts --limit=5
 *   npx tsx scripts/scrape-blocket.ts --product="juno 60"
 */

import * as path from 'path'
import * as fs from 'fs'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { scrapeBlocket } from '../frontend/lib/scrapers/blocket'

import { monitoredSlugs, assertResolved } from './lib/source-monitoring'
import { matchScrapedBatch, reportBatchMatch, newIngestionBatchId, fetchBatchListingIds } from './lib/match-new-inflow'

const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

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
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const args = process.argv.slice(2)
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity
const productFilter = args.find(a => a.startsWith('--product='))?.split('=')[1]?.toLowerCase() ?? null

const PRODUCT_DELAY_MS = 3000

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

type ProductRow = {
  id: string
  canonical_name: string
  kg_brand: { name: string } | { name: string }[] | null
}

function resolveBrandName(brand: ProductRow['kg_brand']): string | null {
  if (!brand) return null
  if (Array.isArray(brand)) return brand[0]?.name ?? null
  return brand.name ?? null
}

function buildSearchQuery(brandName: string, canonicalName: string): string {
  const canonical = canonicalName.trim()
  const brand = brandName.trim()
  if (canonical.toLowerCase().startsWith(brand.toLowerCase())) {
    return canonical
  }
  return `${brand} ${canonical}`.trim()
}

function normalizeText(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Explicit marketplace-monitoring set for 'blocket', from
 * data/klup-source-monitoring.json. This scraper no longer selects on
 * kg_product.tier: tier is an EDITORIAL classification, and using it as a
 * query selector meant an editorial promotion silently widened monitoring.
 */
const MONITORED_SLUGS = monitoredSlugs('blocket')

async function loadProducts(): Promise<Array<{ id: string; canonical_name: string; brand_name: string; query: string }>> {
  const { data, error } = await supabase
    .from('kg_product')
    .select('id, slug, canonical_name, kg_brand!inner(name)')
    .in('slug', MONITORED_SLUGS)
    .eq('status', 'active')
    .order('canonical_name')

  if (error) {
    console.error(`❌ Failed to load kg_product: ${error.message}`)
    process.exit(1)
  }
  // Fail loud: a configured product that no longer resolves would silently
  // shrink 'blocket' coverage.
  assertResolved('blocket', MONITORED_SLUGS, ((data ?? []) as Array<{ slug?: string }>).map(r => r.slug ?? ''))


  let products = ((data ?? []) as ProductRow[])
    .map((product) => {
      const brandName = resolveBrandName(product.kg_brand)
      if (!brandName || !product.canonical_name) return null

      return {
        id: product.id,
        canonical_name: product.canonical_name,
        brand_name: brandName,
        query: buildSearchQuery(brandName, product.canonical_name),
      }
    })
    .filter((product): product is { id: string; canonical_name: string; brand_name: string; query: string } => product !== null)

  if (productFilter) {
    products = products.filter((product) => product.canonical_name.toLowerCase().includes(productFilter))
  }

  if (LIMIT !== Infinity) {
    products = products.slice(0, LIMIT)
  }

  return products
}

function buildRows(listings: Awaited<ReturnType<typeof scrapeBlocket>>) {
  return listings.map((listing) => ({
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    url: listing.url,
    image_url: listing.image_url,
    location: listing.location,
    source: listing.source,
    country: listing.country,
    price_dkk: listing.price_dkk ?? null,
    scraped_at: new Date().toISOString(),
    watchlist_id: null,
    normalized_text: normalizeText(listing.title),
    external_id: listing.url,
    is_active: true,
    platform: 'blocket',
  }))
}

async function main() {
  console.log('⚙️  Blocket → Listings Table Scraper')
  if (productFilter) console.log(`   Product filter: ${productFilter}`)
  console.log(`   Limit: ${LIMIT === Infinity ? '∞' : LIMIT} products`)
  console.log(`   Rate limit: ${PRODUCT_DELAY_MS}ms between products`)
  console.log()

  const products = await loadProducts()
  if (products.length === 0) {
    console.log('No matching legendary products found. Exiting.')
    return
  }

  console.log(`Loaded ${products.length} legendary products from knowledge graph.\n`)

  // One immutable identity for this execution, generated before any write.
  const ingestionBatchId = newIngestionBatchId()
  let scrapedProducts = 0
  let totalListings = 0

  for (let i = 0; i < products.length; i++) {
    if (i > 0) await sleep(PRODUCT_DELAY_MS)

    const product = products[i]
    const listings = await scrapeBlocket(product.query, 3)
    const rows = buildRows(listings)

    if (rows.length > 0) {
      // Every INSERT carries this run's identity. On conflict the database
      // trigger preserves the row's ORIGINAL identity, so a refreshed
      // historical row keeps its old (or NULL) value and is not new inflow.
      const { error } = await supabase
        .from('listings')
        .upsert(rows.map(r => ({ ...r, ingestion_batch_id: ingestionBatchId })), {
          onConflict: 'external_id,source',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error(`[scrape-blocket] ${product.canonical_name}: upsert failed (${error.message})`)
        continue
      }

    }

    scrapedProducts += 1
    totalListings += rows.length
    console.log(`[scrape-blocket] ${product.canonical_name}: ${rows.length} listings upserted`)
  }

  console.log(`[scrape-blocket] Done. ${scrapedProducts} products scraped, ${totalListings} listings total.`)

  // Bounded new-inflow matching: only the ids this run just wrote. Runs after
  // the writes complete and never changes this script's exit status.
  // Only rows the DATABASE says this run inserted. A null lookup => 0 writes.
  const inserted = await fetchBatchListingIds(supabase, 'blocket', ingestionBatchId)
  reportBatchMatch(inserted === null
    ? { source: 'blocket', considered: 0, matched: 0, rejected: 0, deferred: 0, skipped: 'batch_identity_lookup_failed' }
    : await matchScrapedBatch(supabase, 'blocket', inserted))
}

main().catch((error) => {
  console.error('❌ scrape-blocket failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
