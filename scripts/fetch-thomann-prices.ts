/**
 * scripts/fetch-thomann-prices.ts
 *
 * Refreshes Thomann retail prices from confirmed, demand-driven URLs stored
 * in the thomann_product table (populated when users search klup.dk).
 *
 * Unlike the old approach (sitemap-guessed kg_product.thomann_url), these URLs
 * are verified — they were returned by Thomann search and clicked through.
 *
 * Strategy:
 *   1. Pick thomann_product rows that are stale (scraped_at older than STALE_DAYS)
 *      or have never had a price (price_dkk IS NULL), ordered oldest-first.
 *   2. Fetch each product page, extract price via JSON-LD (main product, not bundles).
 *   3. Update thomann_product.price_dkk + scraped_at.
 *   4. If the row is linked to a kg_product (via kg_product_id or thomann_url match),
 *      also update kg_product.thomann_price_dkk + thomann_price_updated_at.
 *   5. Jittered delay between requests to be polite to Thomann.
 *
 * Usage:
 *   npx tsx scripts/fetch-thomann-prices.ts
 *   npx tsx scripts/fetch-thomann-prices.ts --dry-run
 *   npx tsx scripts/fetch-thomann-prices.ts --limit=50
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

// ── Config ────────────────────────────────────────────────────────────────────
const STALE_DAYS      = 14                    // refresh prices older than this
const DELAY_MIN_MS    = 3_000                 // minimum delay between requests
const DELAY_JITTER_MS = 4_000                 // random extra delay on top (uniform)
const TIMEOUT_MS      = 15_000

const args    = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT   = limitArg ? parseInt(limitArg.split('=')[1], 10) : 200

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.thomann.dk/',
}

const FALLBACK_RATES: Record<string, number> = { USD: 7.1, EUR: 7.46, GBP: 8.8, DKK: 1.0 }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Exchange rates ────────────────────────────────────────────────────────────
async function fetchExchangeRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=DKK&to=USD,EUR,GBP', {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return FALLBACK_RATES
    const data = await res.json() as { rates: Record<string, number> }
    const result: Record<string, number> = { DKK: 1.0 }
    for (const [cur, dkkPerOne] of Object.entries(data.rates)) {
      result[cur] = 1 / dkkPerOne  // invert: DKK→X becomes X→DKK
    }
    console.log(`  USD→DKK: ${result['USD']?.toFixed(2)}, EUR→DKK: ${result['EUR']?.toFixed(2)}`)
    return result
  } catch {
    console.warn('  Using fallback exchange rates')
    return FALLBACK_RATES
  }
}

// ── Price extraction ──────────────────────────────────────────────────────────
// Thomann product pages (as of 2026-04) embed a Google Analytics GA4 `view_item`
// payload with the canonical main-product price. The accessory/recommendation
// slots use a different JSON shape ("rawPrice"/"currency":{key:...}), so
// anchoring on `affiliation:"Online Store"` is what tells us "this is the page's
// hero product" versus some ad block. Example:
//   "ecommerce":{"items":[{"item_id":"462509","item_name":"Les Paul Standard 60s IT",
//    "affiliation":"Online Store","currency":"DKK","item_brand":"Gibson",
//    "item_category":"GI","price":19490,...}]}
// On thomann.dk the `currency` is already "DKK" so no FX conversion is needed;
// we still honour the currency field in case that changes or a .de page is fed.
type PriceResult = { priceDkk: number | null; imageUrl: string | null }

function extractPrice(html: string, rates: Record<string, number>): PriceResult {
  let rawPrice: number | null = null
  let currency = 'DKK'

  // Primary: GA4 view_item block — anchored on affiliation to avoid accessory ads
  const ga = html.match(/"affiliation":"Online Store","currency":"([A-Z]{3})"[^}]*?"price":([\d.]+)/)
  if (ga) {
    currency = ga[1]
    rawPrice = parseFloat(ga[2])
  }

  // Fallback: itemprop=price microdata (DKK on thomann.dk)
  if (rawPrice === null) {
    const m = html.match(/itemprop="price"[^>]*content="([\d.]+)"/)
    if (m) {
      rawPrice = parseFloat(m[1])
      currency = 'DKK'
    }
  }

  const rate   = rates[currency] ?? FALLBACK_RATES[currency] ?? 1
  const priceDkk = rawPrice !== null ? Math.round(rawPrice * rate) : null

  // Image: og:image is always the main product photo
  const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/) ??
                   html.match(/content="([^"]+)"\s+property="og:image"/)
  const imageUrl = imgMatch ? imgMatch[1] : null

  return { priceDkk, imageUrl }
}

// ── Fetch one product page ────────────────────────────────────────────────────
async function fetchPage(url: string, rates: Record<string, number>): Promise<PriceResult> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 404) return { priceDkk: null, imageUrl: null }
    if (!res.ok) {
      console.warn(`    HTTP ${res.status}`)
      return { priceDkk: null, imageUrl: null }
    }
    const html = await res.text()
    // Check for Cloudflare challenge
    if (html.includes('Just a moment') && html.includes('cf_chl')) {
      console.warn('    Cloudflare blocked')
      return { priceDkk: null, imageUrl: null }
    }
    return extractPrice(html, rates)
  } catch (err) {
    console.warn(`    Fetch error: ${(err as Error).message}`)
    return { priceDkk: null, imageUrl: null }
  }
}

// ── Supabase queries ──────────────────────────────────────────────────────────
type ThomannRow = {
  id: string
  thomann_url: string
  canonical_name: string
  kg_product_id: string | null
}

async function fetchStaleProducts(): Promise<ThomannRow[]> {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('thomann_product')
    .select('id, thomann_url, canonical_name, kg_product_id')
    .or(`price_dkk.is.null,scraped_at.lt.${cutoff}`)
    .order('scraped_at', { ascending: true, nullsFirst: true })
    .limit(LIMIT)

  if (error) {
    console.error('❌ Failed to fetch thomann_product rows:', error.message)
    process.exit(1)
  }

  return (data ?? []) as ThomannRow[]
}

async function updateThomannProduct(id: string, priceDkk: number, imageUrl: string | null, now: string): Promise<void> {
  const update: Record<string, unknown> = { price_dkk: priceDkk, scraped_at: now }
  if (imageUrl) update.image_url = imageUrl

  const { error } = await supabase
    .from('thomann_product')
    .update(update)
    .eq('id', id)

  if (error) throw new Error(`thomann_product update: ${error.message}`)
}

async function updateKgProduct(kgProductId: string | null, thomannUrl: string, priceDkk: number, imageUrl: string | null, now: string): Promise<void> {
  // If no explicit kg_product_id, try to match by thomann_url
  let query = supabase.from('kg_product')
  const update: Record<string, unknown> = {
    thomann_price_dkk: priceDkk,
    thomann_price_updated_at: now,
  }
  if (imageUrl) update.image_url = imageUrl

  let result
  if (kgProductId) {
    result = await query.update(update).eq('id', kgProductId)
  } else {
    result = await query.update(update).eq('thomann_url', thomannUrl)
  }

  if (result.error) throw new Error(`kg_product update: ${result.error.message}`)
}

// ── Jitter sleep ──────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function jitteredDelay(): Promise<void> {
  const ms = DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS
  return sleep(ms)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('💰 Thomann Price Fetcher (demand-driven)')
  console.log(`   Source: thomann_product table (confirmed URLs from user searches)`)
  console.log(`   Stale threshold: ${STALE_DAYS} days`)
  console.log(`   Delay: ${DELAY_MIN_MS / 1000}–${(DELAY_MIN_MS + DELAY_JITTER_MS) / 1000}s (jittered)`)
  console.log(`   Limit: ${LIMIT} products per run`)
  if (DRY_RUN) console.log('   (dry run — no DB writes)')
  console.log()

  console.log('📈 Fetching exchange rates…')
  const rates = await fetchExchangeRates()
  console.log()

  const products = await fetchStaleProducts()
  console.log(`📋 ${products.length} products to refresh`)

  if (products.length === 0) {
    console.log('Nothing stale — all prices are fresh.')
    return
  }

  console.log()

  let updated = 0
  let noPrice = 0
  let errors  = 0
  const now = new Date().toISOString()

  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    process.stdout.write(`[${i + 1}/${products.length}] ${p.canonical_name} … `)

    const { priceDkk, imageUrl } = await fetchPage(p.thomann_url, rates)

    if (priceDkk !== null) {
      console.log(`✓ ${priceDkk.toLocaleString('da-DK')} kr${imageUrl ? ' 🖼️' : ''}`)
      updated++
      if (!DRY_RUN) {
        try {
          await updateThomannProduct(p.id, priceDkk, imageUrl, now)
          await updateKgProduct(p.kg_product_id, p.thomann_url, priceDkk, imageUrl, now)
        } catch (err) {
          console.error(`  ❌ DB error: ${(err as Error).message}`)
          errors++
        }
      }
    } else {
      console.log('→ No price found')
      noPrice++
    }

    if (i < products.length - 1) {
      await jitteredDelay()
    }
  }

  console.log()
  console.log('─'.repeat(50))
  console.log(`✅ Done — ${products.length} processed`)
  console.log(`   Updated:   ${updated}`)
  console.log(`   No price:  ${noPrice}`)
  if (errors > 0) console.log(`   DB errors: ${errors}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
