/**
 * scripts/scrape-reverb.ts
 *
 * Scrapes Reverb API for music gear listings across priority categories.
 * Merges data into knowledge-graph.json, handling brand normalization
 * and duplicate detection.
 *
 * Features:
 *   - Conservative 2.5s rate limiting (Tier 1 limits are harsh)
 *   - Brand normalization (e-mu → emu, etc.)
 *   - Duplicate detection within KG
 *   - Audit logging
 *
 * Usage:
 *   npm run scrape-reverb                  # full run
 *   npm run scrape-reverb -- --dry-run     # test without writing
 *   npm run scrape-reverb -- --limit=50    # limit listings processed
 *   npm run scrape-reverb -- --brand=korg  # single brand filter
 */

import * as fs from 'fs'
import * as path from 'path'

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const brandFilter = args.find(a => a.startsWith('--brand='))?.split('=')[1]?.toLowerCase() ?? null
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : 200

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Reverb API Tier 1: harsh limits. Be conservative.
const FETCH_DELAY_MS = 2500  // 2.5s between requests
const FETCH_JITTER_MS = 500  // ±250ms random jitter
let lastFetchTime = 0

async function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function rateLimit() {
  const now = Date.now()
  const elapsed = now - lastFetchTime
  const delayMs = Math.max(0, FETCH_DELAY_MS + (Math.random() * FETCH_JITTER_MS - FETCH_JITTER_MS / 2) - elapsed)
  if (delayMs > 0) {
    await sleep(delayMs)
  }
  lastFetchTime = Date.now()
}

// ── Brand normalization ───────────────────────────────────────────────────────
const BRAND_NORM_MAP: Record<string, string> = {
  // Normalize variant spellings and kebab-case variants
  'e-mu': 'emu',
  'emu': 'emu',
  'moog': 'moog',
  'mini-moog': 'moog',
  'minimoog': 'moog',
  'korg': 'korg',
  'roland': 'roland',
  'yamaha': 'yamaha',
  'akai': 'akai',
  'casio': 'casio',
  'sequential': 'sequential',
  'oberheim': 'oberheim',
  'arp': 'arp',
  'elektron': 'elektron',
  'novation': 'novation',
  'arturia': 'arturia',
  'behringer': 'behringer',
  'gibson': 'gibson',
  'fender': 'fender',
  'martin': 'martin',
  'ibanez': 'ibanez',
  'epiphone': 'epiphone',
  'schecter': 'schecter',
  'kramer': 'kramer',
  'marshall': 'marshall',
  'vox': 'vox',
  'mesa-boogie': 'mesa',
  'mesa': 'mesa',
  'traynor': 'traynor',
  'boss': 'boss',
  'zoom': 'zoom',
  'strymon': 'strymon',
  'earthquaker-devices': 'earthquaker-devices',
  'earthquaker': 'earthquaker-devices',
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[\s\/\-\.]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/^-+|-+$/g, '')
}

function normalizeBrandSlug(name: string): string {
  const slug = slugify(name)
  return BRAND_NORM_MAP[slug] || slug
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReverbListing {
  id: number | string
  title: string
  make?: string
  model?: string
  year?: string
  price?: { currency: string; amount: number }
  _links?: { web?: { href?: string } }
}

interface ReverbListingsResponse {
  listings?: ReverbListing[]
  pagination?: { total?: number }
}

interface KgProduct {
  name: string
  type: string
  era?: string
  reference_url?: string
  price_range_dkk?: [number, number]
  related?: string[]
  clones?: string[]
  [key: string]: unknown
}

interface BrandData {
  name?: string
  products: Record<string, KgProduct>
  note?: string
}

interface CategoryData {
  brands: Record<string, BrandData>
}

interface KnowledgeGraph {
  version: string
  description: string
  categories: Record<string, CategoryData>
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const KG_PATH = path.resolve(__dirname, '../data/knowledge-graph.json')
const LOG_PATH = path.resolve(__dirname, 'reverb-scrape-log.json')

// ── API ───────────────────────────────────────────────────────────────────────
const API_BASE = 'https://api.reverb.com/api'
const HEADERS = {
  'Accept-Version': '3.0',
  'Accept': 'application/hal+json',
  'User-Agent': 'Klup-Scraper/1.0',
}

async function fetchReverbListings(query: string): Promise<ReverbListing[]> {
  await rateLimit()

  const url = `${API_BASE}/listings?query=${encodeURIComponent(query)}&per_page=100&condition=all`

  try {
    const res = await fetch(url, { headers: HEADERS })

    if (res.status === 429) {
      console.warn('⚠️  Rate limit hit (429). Pausing…')
      await sleep(10000) // Back off 10s
      return []
    }

    if (!res.ok) {
      console.error(`  HTTP ${res.status}: ${res.statusText}`)
      return []
    }

    const data = (await res.json()) as ReverbListingsResponse
    return data.listings ?? []
  } catch (err) {
    console.error(`  Fetch error: ${(err as Error).message}`)
    return []
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('⚙️  Reverb API Scraper — Knowledge Graph Expansion')
  if (brandFilter) console.log(`    Brand filter: ${brandFilter}`)
  console.log(`    Limit: ${LIMIT} listings per brand`)
  console.log(`    Rate limit: ${FETCH_DELAY_MS}ms (Tier 1 conservative)`)
  console.log()

  // Load KG
  let kg: KnowledgeGraph
  try {
    kg = JSON.parse(fs.readFileSync(KG_PATH, 'utf8'))
  } catch (err) {
    console.error(`❌ Failed to load ${KG_PATH}`)
    process.exit(1)
  }

  // Ensure music-gear category exists
  if (!kg.categories) kg.categories = {}
  if (!kg.categories['music-gear']) {
    kg.categories['music-gear'] = { brands: {} }
  }
  const musicGear = kg.categories['music-gear']

  // Get list of brands to scrape
  const brandsToScrape = Object.keys(musicGear.brands)
  if (brandsToScrape.length === 0) {
    console.warn('⚠️  No brands found in music-gear category. Nothing to scrape.')
    process.exit(0)
  }

  console.log(`Found ${brandsToScrape.length} brands to process.\n`)

  let totalProcessed = 0
  let totalAdded = 0
  let totalDuplicates = 0
  let totalErrors = 0
  const log: any = {
    run_at: new Date().toISOString(),
    limit: LIMIT,
    brands_processed: [],
    summary: { total_processed: 0, total_added: 0, total_duplicates: 0, total_errors: 0 },
  }

  // Process each brand
  for (const brandSlug of brandsToScrape) {
    if (totalProcessed >= LIMIT) {
      console.log(`\n⊘ Reached listing limit (${LIMIT}). Stopping.`)
      break
    }

    // Apply brand filter if specified
    if (brandFilter && !brandSlug.includes(brandFilter)) {
      continue
    }

    const brandData = musicGear.brands[brandSlug]
    const brandName = brandData?.name || brandSlug

    console.log(`📦 ${brandSlug} (${brandName})`)

    // Fetch listings for this brand
    const listings = await fetchReverbListings(brandName)

    if (listings.length === 0) {
      console.log(`   → No listings found`)
      continue
    }

    console.log(`   → Found ${listings.length} listings, processing…`)

    let brandAdded = 0
    let brandDuplicates = 0

    // Process each listing
    for (const listing of listings.slice(0, LIMIT - totalProcessed)) {
      // Build product key
      const productName = listing.title || listing.make || brandName
      const productKey = slugify(`${brandSlug}-${productName}`)

      // Check if already exists
      if (brandData.products?.[productKey]) {
        brandDuplicates++
        continue
      }

      // Create KG entry
      const kgEntry: KgProduct = {
        name: productName,
        type: 'instrument', // Default; could be refined based on title patterns
        reference_url: listing._links?.web?.href || `https://reverb.com/search?query=${encodeURIComponent(brandName)}`,
      }

      // Add to KG
      if (!musicGear.brands[brandSlug].products) {
        musicGear.brands[brandSlug].products = {}
      }
      musicGear.brands[brandSlug].products[productKey] = kgEntry

      brandAdded++
      totalAdded++
      totalProcessed++
    }

    totalDuplicates += brandDuplicates
    log.brands_processed.push({
      brand: brandSlug,
      listings_found: listings.length,
      added: brandAdded,
      duplicates: brandDuplicates,
    })

    console.log(`   ✓ Added ${brandAdded}, Duplicates: ${brandDuplicates}\n`)
  }

  // Summary
  log.summary = {
    total_processed: totalProcessed,
    total_added: totalAdded,
    total_duplicates: totalDuplicates,
    total_errors: totalErrors,
  }

  console.log('─'.repeat(50))
  console.log(`✅ Reverb scrape complete`)
  console.log(`   Added: ${totalAdded}`)
  console.log(`   Duplicates skipped: ${totalDuplicates}`)
  console.log(`   Total products in KG: ${Object.values(musicGear.brands).reduce((acc, b) => acc + Object.keys(b.products || {}).length, 0)}`)
  console.log()

  // Save results
  if (!DRY_RUN && totalAdded > 0) {
    // Bump version
    const [major, minor, patch] = (kg.version ?? '1.0.0').split('.').map(Number)
    kg.version = `${major}.${minor + 1}.${patch ?? 0}`

    fs.writeFileSync(KG_PATH, JSON.stringify(kg, null, 2))
    console.log(`📄 knowledge-graph.json updated (v${kg.version})`)
  } else if (DRY_RUN) {
    console.log('(Dry run — no files written)')
  } else {
    console.log('(No new entries — nothing to save)')
  }

  // Write audit log
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2))
  console.log(`📝 Audit log: ${LOG_PATH}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ Error: ${(err as Error).message ?? err}`)
  process.exit(1)
})
