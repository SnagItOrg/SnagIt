/**
 * scripts/process-price-queue.ts
 *
 * Picks up pending rows from price_fetch_queue, fetches Reverb sold prices
 * for each product, and upserts into reverb_price_history.
 *
 * Designed to run every 5 minutes via PM2 cron. Exits cleanly when queue
 * is empty — PM2 must have autorestart: false.
 *
 * Usage:
 *   npm run process-price-queue
 *   npx tsx scripts/process-price-queue.ts
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

// ── Exchange rates ───────────────────────────────────────────────────────────
const FALLBACK_RATES: Record<string, number> = {
  USD: 7.0, EUR: 7.46, SEK: 0.65, NOK: 0.63, DKK: 1.0,
}
let rates: Record<string, number> = { ...FALLBACK_RATES }

async function fetchExchangeRates(): Promise<void> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=DKK,SEK,NOK,EUR')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { rates: Record<string, number> }
    const usdToDkk = data.rates['DKK']
    rates = {
      DKK: 1.0,
      USD: usdToDkk,
      EUR: usdToDkk / data.rates['EUR'],
      SEK: usdToDkk / data.rates['SEK'],
      NOK: usdToDkk / data.rates['NOK'],
    }
    console.log(`  Exchange rates loaded (USD→DKK: ${rates['USD'].toFixed(2)})`)
  } catch {
    console.warn('  Using fallback exchange rates')
  }
}

function convertToDKK(amount: number, currency: string): number {
  const rate = rates[currency.toUpperCase()] ?? rates['USD']
  return Math.round(amount * rate)
}

// ── Rate limiting ────────────────────────────────────────────────────────────
const FETCH_DELAY_MS = 2500
let lastFetchTime = 0

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function rateLimit() {
  const elapsed = Date.now() - lastFetchTime
  const delay = Math.max(0, FETCH_DELAY_MS + (Math.random() * 500 - 250) - elapsed)
  if (delay > 0) await sleep(delay)
  lastFetchTime = Date.now()
}

// ── Reverb API ───────────────────────────────────────────────────────────────
const API_BASE = 'https://api.reverb.com/api'
const HEADERS = {
  'Accept-Version': '3.0',
  'Accept': 'application/hal+json',
  'User-Agent': 'Klup-Scraper/1.0',
}

interface ReverbListing {
  id: number | string
  title: string
  price?: { amount: string; currency: string }
  condition?: { display_name?: string }
  _links?: { web?: { href?: string } }
  published_at?: string
  created_at?: string
}

async function fetchSoldListings(query: string): Promise<ReverbListing[]> {
  await rateLimit()
  const url = `${API_BASE}/listings?query=${encodeURIComponent(query)}&state=sold&per_page=20`

  try {
    const res = await fetch(url, { headers: HEADERS })
    if (res.status === 429) {
      console.warn('    Rate limit (429). Backing off 10s…')
      await sleep(10000)
      return []
    }
    if (!res.ok) {
      console.error(`    HTTP ${res.status}: ${res.statusText}`)
      return []
    }
    const data = (await res.json()) as { listings?: ReverbListing[] }
    return data.listings ?? []
  } catch (err) {
    console.error(`    Fetch error: ${(err as Error).message}`)
    return []
  }
}

// ── Process one queue item ───────────────────────────────────────────────────
async function processItem(item: { id: string; product_slug: string }): Promise<boolean> {
  // Mark as processing
  await supabase
    .from('price_fetch_queue')
    .update({ status: 'processing' })
    .eq('id', item.id)

  // Look up product for search query
  const { data: product } = await supabase
    .from('kg_product')
    .select('model_name, kg_brand!inner(name)')
    .eq('slug', item.product_slug)
    .limit(1)
    .single()

  if (!product) {
    console.log(`    Product not found for slug: ${item.product_slug}`)
    await supabase
      .from('price_fetch_queue')
      .update({ status: 'failed', processed_at: new Date().toISOString() })
      .eq('id', item.id)
    return false
  }

  const brand = (product.kg_brand as unknown as { name: string })?.name
  const searchQuery = `${brand} ${product.model_name}`
  console.log(`    Searching Reverb: "${searchQuery}"`)

  const listings = await fetchSoldListings(searchQuery)

  if (listings.length === 0) {
    console.log('    No sold listings found')
    await supabase
      .from('price_fetch_queue')
      .update({ status: 'done', processed_at: new Date().toISOString() })
      .eq('id', item.id)
    return true
  }

  // Build rows — store product_slug as query for easy lookup
  const rows = listings
    .filter(l => l.price && parseFloat(l.price.amount) > 0)
    .map(l => ({
      watchlist_id: null,
      query: item.product_slug,
      source: 'reverb',
      price: convertToDKK(parseFloat(l.price!.amount), l.price!.currency),
      currency: 'DKK',
      condition: l.condition?.display_name ?? null,
      listing_url: l._links?.web?.href ?? null,
      listing_title: l.title ?? null,
      sold_at: l.published_at ?? l.created_at ?? null,
    }))

  if (rows.length > 0) {
    const { error } = await supabase
      .from('reverb_price_history')
      .upsert(rows, { onConflict: 'listing_url,watchlist_id', ignoreDuplicates: true })

    if (error) {
      console.error(`    Upsert error: ${error.message}`)
      await supabase
        .from('price_fetch_queue')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', item.id)
      return false
    }
    console.log(`    Upserted ${rows.length} price records`)
  }

  await supabase
    .from('price_fetch_queue')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', item.id)

  return true
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Price Queue Worker')

  const { data: pending, error } = await supabase
    .from('price_fetch_queue')
    .select('id, product_slug')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) {
    console.error(`Failed to fetch queue: ${error.message}`)
    process.exit(1)
  }

  if (!pending || pending.length === 0) {
    console.log('Queue empty. Exiting.')
    return
  }

  console.log(`Processing ${pending.length} items\n`)
  await fetchExchangeRates()
  console.log()

  let done = 0
  let failed = 0

  for (const item of pending) {
    console.log(`  [${item.product_slug}]`)
    const ok = await processItem(item)
    if (ok) done++
    else failed++
    console.log()
  }

  console.log(`Done: ${done} processed, ${failed} failed`)
}

main().catch((err: unknown) => {
  console.error(`${(err as Error).message ?? err}`)
  process.exit(1)
})
