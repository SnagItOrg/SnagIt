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
 *   npm run scrape-reverb                  # full run (~3,300 queries, several hours)
 *   npm run scrape-reverb -- --limit=50    # limit total listings upserted
 *   npm run scrape-reverb -- --brand=korg  # single brand filter
 */

import * as path from 'path'
import * as fs from 'fs'
// Uses the frontend copy of supabase-js, the documented pattern for scripts/
// (CLAUDE.md "Module resolution pattern"). Required so the shared matcher
// handoff below type-checks against the same SupabaseClient identity.
import { matchScrapedBatch, reportBatchMatch, newIngestionBatchId, fetchBatchListingIds } from './lib/match-new-inflow'
import { classifyIngestionRun } from './lib/scrape-health'
const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

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
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity

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

/**
 * Bounded per-run tally. Static keys only — an HTTP status, never a URL, a
 * listing id, a response body or a credential. Counting rather than logging
 * per request keeps the volume fixed: the 2026-09-03 run wrote 12,798 error
 * lines, one per failed request, and still concluded that all was well.
 */
const runTally = {
  requestsOk: 0,
  requestFailures: 0,
  writeFailures: 0,
  lifecycleFailed: false,
  byStatus: {} as Record<string, number>,
}

function countRequestFailure(code: string): void {
  runTally.requestFailures += 1
  runTally.byStatus[code] = (runTally.byStatus[code] ?? 0) + 1
}
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
      // Backoff behaviour unchanged; it is now also counted.
      countRequestFailure('http_429')
      await sleep(10000)
      return []
    }

    if (!res.ok) {
      countRequestFailure(`http_${res.status}`)
      return []
    }

    const data = (await res.json()) as ReverbResponse
    runTally.requestsOk += 1
    return data.listings ?? []
  } catch (err) {
    // The message can carry a host or a URL, so only the class is recorded.
    countRequestFailure(err instanceof Error && err.name ? `fetch_${err.name}` : 'fetch_error')
    return []
  }
}

// ── Search terms from KG ─────────────────────────────────────────────────────
interface SearchTerm {
  brand: string
  query: string
}

async function loadSearchTerms(): Promise<SearchTerm[]> {
  const PAGE_SIZE = 1000
  let page = 0
  const allProducts: Array<{ canonical_name: string | null; model_name: string | null; kg_brand: unknown }> = []

  // Paginate to fetch all music-gear products
  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('canonical_name, model_name, kg_brand!inner(name, kg_category!inner(slug))')
      .eq('status', 'active')
      .eq('kg_brand.kg_category.slug', 'music-gear')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) {
      console.error('❌ Failed to load kg_product:', error.message)
      process.exit(1)
    }

    if (!data || data.length === 0) break
    allProducts.push(...data)
    if (data.length < PAGE_SIZE) break
    page++
  }

  console.log(`   Loaded ${allProducts.length} products from knowledge graph`)

  // Fetch all watchlist queries to rank products by demand
  const { data: watchlistData } = await supabase
    .from('watchlists')
    .select('query')
  const watchlistQueries = (watchlistData ?? []).map(w => w.query.toLowerCase())
  console.log(`   Loaded ${watchlistQueries.length} watchlists for demand ranking`)

  // Deduplicate into terms and count watchlist matches per query
  const termMap = new Map<string, SearchTerm & { watchlistCount: number }>()

  for (const p of allProducts) {
    const brand = (p.kg_brand as unknown as { name: string })?.name
    if (!brand) continue

    const query = p.canonical_name?.trim()
      ?? (p.model_name ? `${brand} ${p.model_name}` : null)
    if (!query) continue

    if (brandFilter && !brand.toLowerCase().includes(brandFilter)) continue

    const key = query.toLowerCase()
    if (termMap.has(key)) continue

    const watchlistCount = watchlistQueries.filter(wq => wq.includes(key)).length
    termMap.set(key, { brand, query, watchlistCount })
  }

  // Sort: most-watched first, then alphabetically
  return Array.from(termMap.values())
    .sort((a, b) => b.watchlistCount - a.watchlistCount || a.query.localeCompare(b.query))
    .map(({ brand, query }) => ({ brand, query }))
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
    country: 'US',
    price_dkk: priceDkk,
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

  const ingestionBatchId = newIngestionBatchId()
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
      .upsert(rows.map(r => ({ ...r, ingestion_batch_id: ingestionBatchId })), {
        onConflict: 'external_id,source',
        ignoreDuplicates: false,
      })
      .select('id')

    if (error) {
      console.error(`   ❌ Upsert error: ${error.message}`)
      runTally.writeFailures += 1
      totalSkipped += rows.length
    } else {
      const count = data?.length ?? rows.length
      console.log(`   ✓ ${count} upserted`)
      totalUpserted += count
    }

    console.log()
  }

  // Bounded new-inflow matching: only the ids this run just wrote. Runs after
  // the writes complete and never changes this script's exit status.
  const insertedReverb = await fetchBatchListingIds(supabase, 'reverb', ingestionBatchId)
  reportBatchMatch(insertedReverb === null
    ? { source: 'reverb', considered: 0, matched: 0, rejected: 0, deferred: 0, skipped: 'batch_identity_lookup_failed' }
    : await matchScrapedBatch(supabase, 'reverb', insertedReverb))

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
    runTally.lifecycleFailed = true
  } else {
    console.log(`   ✓ ${staleCount ?? 0} marked inactive`)
  }

  /**
   * The verdict. `✅ Done` used to print unconditionally, so three nights of
   * zero writes behind an HTTP 403 wall read as three healthy runs.
   */
  const { outcome, reason } = classifyIngestionRun({
    eligible: terms.length,
    written: totalUpserted,
    requestFailures: runTally.requestFailures,
    writeFailures: runTally.writeFailures,
    lifecycleFailed: runTally.lifecycleFailed,
  })

  console.log()
  console.log('─'.repeat(50))
  console.log(
    JSON.stringify({
      channel: 'operational',
      component: 'scrape-reverb',
      event: 'run_summary',
      source: 'reverb',
      outcome,
      reason,
      eligible_terms: terms.length,
      upserted: totalUpserted,
      skipped: totalSkipped,
      requests_ok: runTally.requestsOk,
      request_failures: runTally.requestFailures,
      write_failures: runTally.writeFailures,
      lifecycle_failed: runTally.lifecycleFailed,
      by_status: runTally.byStatus,
    }),
  )

  const icon = outcome === 'success' ? '✅' : outcome === 'partial' ? '⚠️ ' : '❌'
  console.log(`${icon} ${outcome.toUpperCase()} (${reason})`)
  console.log(`   Upserted: ${totalUpserted}`)
  console.log(`   Skipped:  ${totalSkipped}`)

  // Partial keeps exit 0: it made real progress and its rows are already
  // written. Only a run that was given work and produced nothing while
  // failing is a failure PM2 should surface.
  if (outcome === 'failed') process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
