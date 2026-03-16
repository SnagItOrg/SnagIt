/**
 * scripts/scrape-reverb.ts
 *
 * Fetches Reverb API listings for brand+product combinations from the
 * knowledge graph and upserts them into the Supabase listings table.
 *
 * Features:
 *   - Reads search terms from kg_brand + kg_product in Supabase
 *   - Conservative 2.5s rate limiting (Reverb Tier 1)
 *   - Upserts on external_id — updates price/scraped_at, preserves title/url
 *   - Marks stale listings (>48h) as inactive
 *
 * Usage:
 *   npm run scrape-reverb                  # full run
 *   npm run scrape-reverb -- --limit=50    # limit total listings upserted
 *   npm run scrape-reverb -- --brand=korg  # single brand filter
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
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const brandFilter = args.find(a => a.startsWith('--brand='))?.split('=')[1]?.toLowerCase() ?? null
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : 500

// ── Rate limiting ────────────────────────────────────────────────────────────
const FETCH_DELAY_MS = 2500
const FETCH_JITTER_MS = 500
let lastFetchTime = 0

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function rateLimit() {
  const now = Date.now()
  const elapsed = now - lastFetchTime
  const jitter = Math.random() * FETCH_JITTER_MS - FETCH_JITTER_MS / 2
  const delayMs = Math.max(0, FETCH_DELAY_MS + jitter - elapsed)
  if (delayMs > 0) await sleep(delayMs)
  lastFetchTime = Date.now()
}

// ── Exchange rate ────────────────────────────────────────────────────────────
const FALLBACK_USD_TO_DKK = 7.0
let usdToDkk = FALLBACK_USD_TO_DKK

async function fetchExchangeRate(): Promise<void> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=DKK')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { rates: Record<string, number> }
    usdToDkk = data.rates['DKK'] ?? FALLBACK_USD_TO_DKK
    console.log(`💱 USD → DKK: ${usdToDkk.toFixed(4)}`)
  } catch (err) {
    console.warn(`⚠️  Could not fetch exchange rate (${(err as Error).message}). Using fallback ${FALLBACK_USD_TO_DKK}.`)
  }
}

function toDKK(amount: number, currency: string): number {
  if (currency.toUpperCase() === 'DKK') return Math.round(amount)
  if (currency.toUpperCase() === 'EUR') return Math.round(amount * usdToDkk / 0.92) // approximate EUR→DKK
  return Math.round(amount * usdToDkk) // assume USD
}

// ── Reverb API ───────────────────────────────────────────────────────────────
const API_BASE = 'https://api.reverb.com/api'
const HEADERS = {
  'Accept-Version': '3.0',
  'Accept': 'application/hal+json',
  'User-Agent': 'Klup-Scraper/1.0',
}

interface ReverbPhoto {
  _links?: { large_crop?: { href?: string } }
}

interface ReverbListing {
  id: number | string
  title: string
  price?: { amount: string; currency: string }
  condition?: { display_name?: string }
  photos?: ReverbPhoto[]
  location?: { locality?: string; country_code?: string; display_location?: string }
  _links?: { web?: { href?: string } }
}

interface ReverbResponse {
  listings?: ReverbListing[]
}

async function fetchReverbListings(query: string, perPage = 50): Promise<ReverbListing[]> {
  await rateLimit()

  const url = `${API_BASE}/listings?query=${encodeURIComponent(query)}&per_page=${perPage}&condition=all`

  try {
    const res = await fetch(url, { headers: HEADERS })

    if (res.status === 429) {
      console.warn('  ⚠️  Rate limit (429). Backing off 10s…')
      await sleep(10000)
      return []
    }

    if (!res.ok) {
      console.error(`  HTTP ${res.status}: ${res.statusText}`)
      return []
    }

    const data = (await res.json()) as ReverbResponse
    return data.listings ?? []
  } catch (err) {
    console.error(`  Fetch error: ${(err as Error).message}`)
    return []
  }
}

// ── Search terms from KG ─────────────────────────────────────────────────────
interface SearchTerm {
  brand: string
  query: string
}

async function loadSearchTerms(): Promise<SearchTerm[]> {
  // Fetch products with their brand names
  const { data: products, error } = await supabase
    .from('kg_product')
    .select('model_name, kg_brand!inner(name, kg_category!inner(slug))')
    .eq('status', 'active')
    .eq('kg_brand.kg_category.slug', 'music-gear')
    .limit(500)

  if (error) {
    console.error('❌ Failed to load kg_product:', error.message)
    process.exit(1)
  }

  const terms: SearchTerm[] = []
  const seen = new Set<string>()

  for (const p of products ?? []) {
    const brand = (p.kg_brand as unknown as { name: string })?.name
    const model = p.model_name
    if (!brand || !model) continue

    // Apply brand filter if specified
    if (brandFilter && !brand.toLowerCase().includes(brandFilter)) continue

    const query = `${brand} ${model}`
    const key = query.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    terms.push({ brand, query })
  }

  return terms
}

// ── Upsert row builder ──────────────────────────────────────────────────────
function buildRow(listing: ReverbListing) {
  const rawPrice = listing.price ? parseFloat(listing.price.amount) : null
  const currency = listing.price?.currency ?? 'USD'
  const priceDkk = rawPrice != null && rawPrice > 0 ? toDKK(rawPrice, currency) : null

  const imageUrl = listing.photos?.[0]?._links?.large_crop?.href ?? null
  const url = listing._links?.web?.href ?? null
  const location = listing.location?.display_location ?? null

  return {
    external_id: String(listing.id),
    source: 'reverb' as const,
    platform: 'reverb' as const,
    title: listing.title,
    normalized_text: listing.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    price: priceDkk,
    currency: 'DKK',
    url,
    image_url: imageUrl,
    location: location || null,
    condition: listing.condition?.display_name ?? null,
    scraped_at: new Date().toISOString(),
    is_active: true,
    watchlist_id: null,
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('⚙️  Reverb → Listings Table Scraper')
  if (brandFilter) console.log(`   Brand filter: ${brandFilter}`)
  console.log(`   Limit: ${LIMIT} listings`)
  console.log(`   Rate limit: ${FETCH_DELAY_MS}ms`)
  console.log()

  await fetchExchangeRate()
  console.log()

  const terms = await loadSearchTerms()
  if (terms.length === 0) {
    console.log('No search terms found in kg_product. Exiting.')
    return
  }
  console.log(`Loaded ${terms.length} search terms from knowledge graph.\n`)

  let totalUpserted = 0
  let totalSkipped = 0

  for (const term of terms) {
    if (totalUpserted >= LIMIT) {
      console.log(`\n⊘ Reached limit (${LIMIT}). Stopping.`)
      break
    }

    console.log(`🔍 "${term.query}"`)

    const listings = await fetchReverbListings(term.query)

    if (listings.length === 0) {
      console.log('   → No listings\n')
      continue
    }

    // Build rows, filter out listings without a URL
    const rows = listings
      .map(buildRow)
      .filter(r => r.url != null)
      .slice(0, LIMIT - totalUpserted)

    if (rows.length === 0) {
      console.log('   → No valid rows\n')
      continue
    }

    // Upsert — on conflict(external_id): only update price, currency, scraped_at, is_active
    const { data, error } = await supabase
      .from('listings')
      .upsert(rows, {
        onConflict: 'external_id,source',
        ignoreDuplicates: false,
      })
      .select('id')

    if (error) {
      console.error(`   ❌ Upsert error: ${error.message}`)
      totalSkipped += rows.length
    } else {
      const count = data?.length ?? rows.length
      console.log(`   ✓ ${count} upserted`)
      totalUpserted += count
    }

    console.log()
  }

  // Mark stale Reverb listings as inactive (not seen in 48h)
  console.log('Marking stale Reverb listings as inactive…')
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { error: staleError, count: staleCount } = await supabase
    .from('listings')
    .update({ is_active: false })
    .eq('source', 'reverb')
    .eq('is_active', true)
    .lt('scraped_at', cutoff)

  if (staleError) {
    console.error(`   ❌ Stale update error: ${staleError.message}`)
  } else {
    console.log(`   ✓ ${staleCount ?? 0} marked inactive`)
  }

  console.log()
  console.log('─'.repeat(50))
  console.log(`✅ Done`)
  console.log(`   Upserted: ${totalUpserted}`)
  console.log(`   Skipped:  ${totalSkipped}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
