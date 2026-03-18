/**
 * scripts/fetch-thomann-prices.ts
 *
 * For each active kg_product (music-gear category, non-vintage, no thomann_url yet):
 *   1. Convert slug → Thomann filename  (boss-rv-500 → boss_rv_500)
 *   2. Fetch https://www.thomann.dk/{filename}.htm
 *   3. Extract rawPrice from the JS bootstrap payload
 *   4. Convert EUR → DKK via live Frankfurter rate
 *   5. Upsert thomann_price_dkk + thomann_url on kg_product
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
const BATCH_SIZE = 100
const DELAY_MS = 3000
const THOMANN_BASE = 'https://www.thomann.dk'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

// ── Exchange rate ─────────────────────────────────────────────────────────────
let eurToDkk = 7.46 // fallback

async function fetchEurToDkk(): Promise<void> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=DKK')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { rates: { DKK: number } }
    eurToDkk = data.rates.DKK
    console.log(`💱 EUR→DKK: ${eurToDkk.toFixed(4)} (live)`)
  } catch (err) {
    console.warn(`⚠️  Exchange rate fetch failed (${(err as Error).message}). Using fallback ${eurToDkk}.`)
  }
}

// ── Thomann fetch + parse ─────────────────────────────────────────────────────
function slugToFilename(slug: string): string {
  return slug.replace(/-/g, '_')
}

function buildUrl(slug: string): string {
  return `${THOMANN_BASE}/${slugToFilename(slug)}.htm`
}

// Matches the first rawPrice in the page's JS bootstrap data.
// Thomann embeds product data as:  "rawPrice":"1299.0000"  or  "rawPrice":1299
const RAW_PRICE_RE = /"rawPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/

async function fetchPrice(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Klup-Bot/1.0)',
        'Accept-Language': 'da-DK,da;q=0.9',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (res.status === 404) return null
    if (!res.ok) {
      console.warn(`    HTTP ${res.status}`)
      return null
    }

    const html = await res.text()

    // Find the rawPrice closest to the start of the page — this is the main
    // product price, not a related-article price which appears later in the DOM.
    const match = RAW_PRICE_RE.exec(html)
    if (!match) return null

    const eur = parseFloat(match[1])
    if (!isFinite(eur) || eur <= 0) return null

    return Math.round(eur * eurToDkk)
  } catch (err) {
    console.warn(`    Fetch error: ${(err as Error).message}`)
    return null
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

type Product = {
  id: string
  slug: string
  canonical_name: string
}

async function fetchProducts(): Promise<Product[]> {
  // Join via kg_brand to filter by music-gear category
  const { data: musicGearCategory } = await supabase
    .from('kg_category')
    .select('id')
    .eq('slug', 'music-gear')
    .single()

  if (!musicGearCategory) {
    console.error('❌ Could not find music-gear category')
    process.exit(1)
  }

  const { data, error } = await supabase
    .from('kg_product')
    .select('id, slug, canonical_name')
    .eq('status', 'active')
    .is('thomann_url', null)
    .is('era', null)           // skip vintage (era IS NOT NULL = vintage)
    .eq('category_id', musicGearCategory.id)
    .order('slug')
    .limit(BATCH_SIZE)

  if (error) {
    console.error('❌ Failed to fetch products:', error.message)
    process.exit(1)
  }

  return (data ?? []) as Product[]
}

async function upsertProduct(id: string, url: string, priceDkk: number): Promise<void> {
  const { error } = await supabase
    .from('kg_product')
    .update({
      thomann_url: url,
      thomann_price_dkk: priceDkk,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

async function markNoUrl(id: string, url: string): Promise<void> {
  // Still set thomann_url so we don't retry on the next run
  const { error } = await supabase
    .from('kg_product')
    .update({ thomann_url: url })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// ── Sleep ─────────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🛒 Thomann Price Fetcher')
  if (DRY_RUN) console.log('   (dry run — no DB writes)')
  console.log()

  await fetchEurToDkk()
  console.log()

  const products = await fetchProducts()

  if (products.length === 0) {
    console.log('No products to process. Exiting.')
    return
  }

  console.log(`Processing ${products.length} products\n`)

  let found = 0
  let notFound = 0
  let errors = 0

  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const url = buildUrl(p.slug)

    process.stdout.write(`[${i + 1}/${products.length}] ${p.canonical_name} … `)

    const priceDkk = await fetchPrice(url)

    if (priceDkk !== null) {
      console.log(`✓ ${priceDkk.toLocaleString('da-DK')} kr`)
      found++
      if (!DRY_RUN) {
        try {
          await upsertProduct(p.id, url, priceDkk)
        } catch (err) {
          console.error(`  ❌ DB error: ${(err as Error).message}`)
          errors++
        }
      }
    } else {
      console.log(`→ No price found`)
      notFound++
      if (!DRY_RUN) {
        try {
          await markNoUrl(p.id, url)
        } catch (err) {
          console.error(`  ❌ DB error: ${(err as Error).message}`)
          errors++
        }
      }
    }

    // Rate limit — skip delay after last item
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
