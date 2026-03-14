/**
 * scripts/fetch-reverb-prices.ts
 *
 * Fetches sold listing prices from Reverb for each active watchlist query
 * and upserts them into the reverb_price_history table.
 *
 * This provides market-value intelligence: "what did similar items actually
 * sell for recently?" — useful for price recommendations and alerts.
 *
 * Usage:
 *   npm run fetch-reverb-prices                  # full run
 *   npm run fetch-reverb-prices -- --dry-run     # test without DB writes
 *   npm run fetch-reverb-prices -- --query=korg  # single query filter
 */

import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ──────────────────────────────────────────────────────────────────
// Try frontend/.env.local first, then .env.local at root
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

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const queryFilter = args.find(a => a.startsWith('--query='))?.split('=')[1]?.toLowerCase() ?? null

// ── Exchange rates ────────────────────────────────────────────────────────────
// Rates: how many DKK per 1 unit of foreign currency
const FALLBACK_RATES: Record<string, number> = {
  USD: 7.0,
  EUR: 7.46,
  SEK: 0.65,
  NOK: 0.63,
  DKK: 1.0,
}

// Populated at startup from Frankfurter API; falls back to FALLBACK_RATES
let toDKK: Record<string, number> = { ...FALLBACK_RATES }

async function fetchExchangeRates(): Promise<void> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=DKK,SEK,NOK,EUR')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { rates: Record<string, number> }
    // data.rates gives DKK/SEK/NOK/EUR per 1 USD
    // We need: for each currency, how many DKK is 1 unit?
    const usdToDkk = data.rates['DKK']
    toDKK = {
      DKK: 1.0,
      USD: usdToDkk,
      EUR: usdToDkk / data.rates['EUR'],  // 1 EUR = (DKK/USD) / (EUR/USD)
      SEK: usdToDkk / data.rates['SEK'],
      NOK: usdToDkk / data.rates['NOK'],
    }
    console.log(`💱 Live rates (DKK): USD=${toDKK['USD'].toFixed(4)}, EUR=${toDKK['EUR'].toFixed(4)}, SEK=${toDKK['SEK'].toFixed(4)}, NOK=${toDKK['NOK'].toFixed(4)}`)
  } catch (err) {
    console.warn(`⚠️  Could not fetch live exchange rates (${(err as Error).message}). Using fallback rates.`)
  }
}

function convertToDKK(amount: number, currency: string): number {
  const rate = toDKK[currency.toUpperCase()] ?? toDKK['USD']
  return Math.round(amount * rate)
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const FETCH_DELAY_MS = 2500
const FETCH_JITTER_MS = 500
let lastFetchTime = 0

async function sleep(ms: number) {
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

// ── Reverb API ────────────────────────────────────────────────────────────────
const API_BASE = 'https://api.reverb.com/api'
const HEADERS = {
  'Accept-Version': '3.0',
  'Accept': 'application/hal+json',
  'User-Agent': 'Klup-Scraper/1.0',
}

interface ReverbPrice {
  amount: string
  currency: string
}

interface ReverbCondition {
  display_name: string
  uuid: string
}

interface ReverbListing {
  id: number | string
  title: string
  price?: ReverbPrice
  condition?: ReverbCondition
  _links?: { web?: { href?: string } }
  published_at?: string
  created_at?: string
}

interface ReverbResponse {
  listings?: ReverbListing[]
}

async function fetchSoldListings(query: string): Promise<ReverbListing[]> {
  await rateLimit()

  const url = `${API_BASE}/listings?query=${encodeURIComponent(query)}&state=sold&per_page=20`

  try {
    const res = await fetch(url, { headers: HEADERS })

    if (res.status === 429) {
      console.warn('  ⚠️  Rate limit hit (429). Pausing 10s…')
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

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface Watchlist {
  id: string
  query: string
}

async function fetchWatchlists(): Promise<Watchlist[]> {
  const { data, error } = await supabase
    .from('watchlists')
    .select('id, query')
    .eq('active', true)

  if (error) {
    console.error('❌ Failed to fetch watchlists:', error.message)
    process.exit(1)
  }

  return data ?? []
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('💰 Reverb Price History Fetcher')
  if (DRY_RUN) console.log('   (dry run — no DB writes)')
  if (queryFilter) console.log(`   Query filter: ${queryFilter}`)
  console.log()

  await fetchExchangeRates()
  console.log()

  const watchlists = await fetchWatchlists()

  if (watchlists.length === 0) {
    console.log('No active watchlists found. Exiting.')
    return
  }

  // Deduplicate queries — multiple watchlists may share the same query string
  const seen = new Set<string>()
  const unique: Watchlist[] = []
  for (const w of watchlists) {
    const key = w.query.trim().toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(w)
    }
  }

  console.log(`Found ${watchlists.length} watchlists (${unique.length} unique queries)\n`)

  let totalFetched = 0
  let totalUpserted = 0

  for (const watchlist of unique) {
    if (queryFilter && !watchlist.query.toLowerCase().includes(queryFilter)) continue

    console.log(`🔍 Query: "${watchlist.query}"`)

    const listings = await fetchSoldListings(watchlist.query)

    if (listings.length === 0) {
      console.log('   → No sold listings found\n')
      continue
    }

    console.log(`   → ${listings.length} sold listings`)
    totalFetched += listings.length

    if (DRY_RUN) {
      for (const l of listings) {
        const raw = l.price ? parseFloat(l.price.amount) : null
        const dkk = raw != null ? convertToDKK(raw, l.price!.currency) : null
        console.log(`     • ${l.title} — ${dkk ?? '?'} DKK (${l.condition?.display_name ?? 'unknown condition'})`)
      }
      console.log()
      continue
    }

    // Build upsert rows
    const rows = listings
      .filter(l => l.price && parseFloat(l.price.amount) > 0)
      .map(l => ({
        watchlist_id:  watchlist.id,
        query:         watchlist.query,
        source:        'reverb',
        price:         convertToDKK(parseFloat(l.price!.amount), l.price!.currency),
        currency:      'DKK',
        condition:     l.condition?.display_name ?? null,
        listing_url:   l._links?.web?.href ?? null,
        listing_title: l.title ?? null,
        sold_at:       l.published_at ?? l.created_at ?? null,
      }))

    if (rows.length === 0) {
      console.log('   → No rows with valid prices, skipping\n')
      continue
    }

    const { error } = await supabase
      .from('reverb_price_history')
      .upsert(rows, { onConflict: 'listing_url,watchlist_id', ignoreDuplicates: true })

    if (error) {
      console.error(`   ❌ Upsert error: ${error.message}`)
    } else {
      console.log(`   ✓ Upserted ${rows.length} rows`)
      totalUpserted += rows.length
    }

    console.log()
  }

  console.log('─'.repeat(50))
  console.log(`✅ Done`)
  console.log(`   Fetched: ${totalFetched} sold listings`)
  if (!DRY_RUN) console.log(`   Upserted: ${totalUpserted} rows into reverb_price_history`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
