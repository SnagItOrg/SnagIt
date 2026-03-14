/**
 * scripts/fetch-auctionet-prices.ts
 *
 * Fetches sold auction prices from Auctionet for each active watchlist query
 * and upserts them into the auctionet_price_history table.
 *
 * Auctionet embeds item data as JSON inside a data-react-props attribute on
 * the search results page — no separate API needed.
 * URL: https://auctionet.com/en/search?q={query}&ended=true
 *
 * Usage:
 *   npm run fetch-auctionet-prices                  # full run
 *   npm run fetch-auctionet-prices -- --dry-run     # test without DB writes
 *   npm run fetch-auctionet-prices -- --query=wegner # single query filter
 */

import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Load env ──────────────────────────────────────────────────────────────────
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
const FALLBACK_RATES: Record<string, number> = {
  USD: 7.0,
  EUR: 7.46,
  SEK: 0.65,
  NOK: 0.63,
  DKK: 1.0,
}

let toDKK: Record<string, number> = { ...FALLBACK_RATES }

async function fetchExchangeRates(): Promise<void> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=DKK,SEK,NOK,EUR')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { rates: Record<string, number> }
    const usdToDkk = data.rates['DKK']
    toDKK = {
      DKK: 1.0,
      USD: usdToDkk,
      EUR: usdToDkk / data.rates['EUR'],
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

// ── Auctionet scraper ─────────────────────────────────────────────────────────
const AUCTIONET_BASE = 'https://auctionet.com'
const SCRAPE_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Klup-Scraper/1.0',
}

interface AuctionetItem {
  id: number
  longTitle: string
  currency: string        // original currency of the estimate field
  estimate: number | null // single estimate in original currency
  amountValue: string     // hammer price string e.g. "6,513 DKK" (already DKK)
  url: string             // relative URL e.g. "/en/538020-..."
  auctionEndTime: string  // e.g. "Hammered 11 Dec 2016"
  auctionIsEnded: boolean
}

/** Parse "6,513 DKK" → 6513 */
function parseAmountDKK(s: string): number | null {
  const m = s.replace(/,/g, '').match(/[\d.]+/)
  return m ? Math.round(parseFloat(m[0])) : null
}

/** Parse "Hammered 11 Dec 2016" → ISO date string or null */
function parseHammeredDate(s: string): string | null {
  const m = s.match(/Hammered\s+(\d{1,2}\s+\w+\s+\d{4})/)
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function fetchAuctionetItems(query: string): Promise<AuctionetItem[]> {
  await rateLimit()

  const url = `${AUCTIONET_BASE}/en/search?q=${encodeURIComponent(query)}&ended=true`

  try {
    const res = await fetch(url, { headers: SCRAPE_HEADERS })

    if (res.status === 429) {
      console.warn('  ⚠️  Rate limit hit (429). Pausing 10s…')
      await sleep(10000)
      return []
    }

    if (!res.ok) {
      console.error(`  HTTP ${res.status}: ${res.statusText}`)
      return []
    }

    const html = await res.text()

    // Auctionet embeds item data as JSON in a data-react-props attribute
    const match = html.match(/data-react-props="({.*?})"(?:\s|>)/s)
    if (!match) {
      console.warn('  ⚠️  No data-react-props found on page')
      return []
    }

    // Unescape HTML entities in the JSON string
    const jsonStr = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')

    const data = JSON.parse(jsonStr) as { items?: AuctionetItem[] }
    return (data.items ?? []).filter(item => item.auctionIsEnded)
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
  console.log('🔨 Auctionet Price History Fetcher')
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

  // Deduplicate queries
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

    const items = await fetchAuctionetItems(watchlist.query)

    if (items.length === 0) {
      console.log('   → No sold items found\n')
      continue
    }

    console.log(`   → ${items.length} sold items`)
    totalFetched += items.length

    if (DRY_RUN) {
      for (const item of items) {
        const hammerDKK = parseAmountDKK(item.amountValue)
        const estimateDKK = item.estimate != null
          ? convertToDKK(item.estimate, item.currency)
          : null
        console.log(`     • ${item.longTitle.substring(0, 60)}`)
        console.log(`       Hammer: ${hammerDKK ?? '?'} DKK  Estimate: ${estimateDKK ?? '?'} DKK  Sold: ${parseHammeredDate(item.auctionEndTime) ?? item.auctionEndTime}`)
      }
      console.log()
      continue
    }

    // Build upsert rows — skip items with no parseable hammer price
    const rows = items
      .map(item => {
        const hammerDKK = parseAmountDKK(item.amountValue)
        if (hammerDKK === null || hammerDKK <= 0) return null

        const estimateDKK = item.estimate != null
          ? convertToDKK(item.estimate, item.currency)
          : null

        return {
          watchlist_id:  watchlist.id,
          query:         watchlist.query,
          source:        'auctionet',
          price:         hammerDKK,
          currency:      'DKK',
          condition:     null,
          listing_url:   `${AUCTIONET_BASE}${item.url}`,
          listing_title: item.longTitle ?? null,
          estimate_low:  estimateDKK,
          estimate_high: null,
          sold_at:       parseHammeredDate(item.auctionEndTime),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length === 0) {
      console.log('   → No rows with valid prices, skipping\n')
      continue
    }

    const { error } = await supabase
      .from('auctionet_price_history')
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
  console.log(`   Fetched: ${totalFetched} sold items`)
  if (!DRY_RUN) console.log(`   Upserted: ${totalUpserted} rows into auctionet_price_history`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
