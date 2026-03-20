/**
 * scripts/fetch-thomann-prices.ts
 *
 * For each kg_product that has a thomann_url but no thomann_price_dkk yet:
 *   1. Fetch the Thomann product page
 *   2. Extract DKK price from JS bootstrap object ("rawPrice" field)
 *   3. Also extract image_url from "image" field in page HTML
 *   4. Upsert thomann_price_dkk + image_url on kg_product
 *
 * Run build-thomann-urls.ts first to populate thomann_url on all products.
 *
 * Usage:
 *   npx tsx scripts/fetch-thomann-prices.ts
 *   npx tsx scripts/fetch-thomann-prices.ts --dry-run
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
const DELAY_MS = 5000

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': 'https://www.thomann.dk/',
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Price + image extraction ──────────────────────────────────────────────────
type PriceAndImage = {
  priceDkk: number | null
  imageUrl: string | null
}

function extractPriceAndImage(html: string): PriceAndImage {
  // Some pages use "rawPrice":"1299.0000", others use "price":1299
  const priceMatch =
    html.match(/"rawPrice":"([\d.]+)"/) ??
    html.match(/"price":(\d+),/)
  const priceDkk = priceMatch ? Math.round(parseFloat(priceMatch[1])) : null

  // Image from first https URL in a JSON "image" field
  const imgMatch = html.match(/"image"\s*:\s*"(https?:\/\/[^"]+)"/)
  const imageUrl = imgMatch ? imgMatch[1] : null

  return { priceDkk, imageUrl }
}

// ── Fetch product page ────────────────────────────────────────────────────────
async function fetchPage(url: string): Promise<PriceAndImage> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 404) return { priceDkk: null, imageUrl: null }
    if (!res.ok) {
      console.warn(`    HTTP ${res.status}`)
      return { priceDkk: null, imageUrl: null }
    }

    const html = await res.text()
    return extractPriceAndImage(html)
  } catch (err) {
    console.warn(`    Fetch error: ${(err as Error).message}`)
    return { priceDkk: null, imageUrl: null }
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────
type Product = {
  id: string
  canonical_name: string
  thomann_url: string
}

async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('kg_product')
    .select('id, canonical_name, thomann_url')
    .not('thomann_url', 'is', null)
    .is('thomann_price_dkk', null)
    .eq('status', 'active')
    .order('canonical_name')

  if (error) {
    console.error('❌ Failed to fetch products:', error.message)
    process.exit(1)
  }

  return (data ?? []) as Product[]
}

async function updateProduct(id: string, priceDkk: number, imageUrl: string | null): Promise<void> {
  const update: Record<string, unknown> = { thomann_price_dkk: priceDkk }
  if (imageUrl) update.image_url = imageUrl

  const { error } = await supabase
    .from('kg_product')
    .update(update)
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// ── Sleep ─────────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('💰 Thomann Price Fetcher')
  if (DRY_RUN) console.log('   (dry run — no DB writes)')
  console.log()

  const products = await fetchProducts()

  console.log(`Products with thomann_url: ${products.length}`)
  if (products.length === 0) {
    console.log('Nothing to process — run build-thomann-urls.ts first to populate thomann_url.')
    return
  }

  console.log('First 5 URLs to fetch:')
  products.slice(0, 5).forEach((p, i) => console.log(`  ${i + 1}. ${p.thomann_url}`))
  console.log()
  console.log(`Processing ${products.length} products\n`)

  let found = 0
  let notFound = 0
  let errors = 0

  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    process.stdout.write(`[${i + 1}/${products.length}] ${p.canonical_name} … `)

    const { priceDkk, imageUrl } = await fetchPage(p.thomann_url)

    if (priceDkk !== null) {
      const imgNote = imageUrl ? ' 🖼️' : ''
      console.log(`✓ ${priceDkk.toLocaleString('da-DK')} kr${imgNote}`)
      found++
      if (!DRY_RUN) {
        try {
          await updateProduct(p.id, priceDkk, imageUrl)
        } catch (err) {
          console.error(`  ❌ DB error: ${(err as Error).message}`)
          errors++
        }
      }
    } else {
      console.log('→ No price found')
      notFound++
    }

    if (i < products.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  console.log()
  console.log('─'.repeat(50))
  console.log(`✅ Done — ${products.length} processed`)
  console.log(`   Found:     ${found}`)
  console.log(`   Not found: ${notFound}`)
  if (errors > 0) console.log(`   DB errors: ${errors}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
