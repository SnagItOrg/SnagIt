/**
 * scripts/scrape-finn.ts
 *
 * Fetches Finn listings for the explicit 'finn' product set and publishes
 * them through the dba.dk engine's fail-closed path (PAN-307):
 * Musikkinstrumenter, newest first, to exhaustion, run record, coverage
 * evidence, atomic promotion and a per-query stale sweep. The engine lives in
 * scripts/lib/schibsted-market-scrape.ts and is shared with scrape-blocket.
 *
 * Usage:
 *   npx tsx scripts/scrape-finn.ts
 *   npx tsx scripts/scrape-finn.ts --limit=5
 *   npx tsx scripts/scrape-finn.ts --product="juno 60"
 *   npx tsx scripts/scrape-finn.ts --dry-run        # scrape + report, no writes
 */

import * as path from 'path'
import * as fs from 'fs'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { FINN_CONFIG } from '../frontend/lib/scrapers/schibsted'

import { monitoredSlugs, assertResolved } from './lib/source-monitoring'
import { matchScrapedBatch, reportBatchMatch, fetchBatchListingIds } from './lib/match-new-inflow'
import { runSchibstedMarket, buildSearchQuery, SEARCH_OPTIONS, type MarketQuery } from './lib/schibsted-market-scrape'

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
const DRY_RUN = args.includes('--dry-run')

// Bump when scrape/parse behaviour changes; part of the scope hash.
// 2.0.0 (PAN-307): the dba.dk engine — category, newest first, to exhaustion.
const SCRAPER_VERSION = 'finn-2.0.0'

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

/**
 * Explicit marketplace-monitoring set for 'finn', from
 * data/klup-source-monitoring.json. This scraper no longer selects on
 * kg_product.tier: tier is an EDITORIAL classification, and using it as a
 * query selector meant an editorial promotion silently widened monitoring.
 */
const MONITORED_SLUGS = monitoredSlugs('finn')

async function loadProducts(): Promise<Array<MarketQuery & { canonical_name: string }>> {
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
  // shrink 'finn' coverage.
  assertResolved('finn', MONITORED_SLUGS, ((data ?? []) as Array<{ slug?: string }>).map(r => r.slug ?? ''))

  let products = ((data ?? []) as Array<ProductRow & { slug: string }>)
    .map((product) => {
      const brandName = resolveBrandName(product.kg_brand)
      if (!brandName || !product.canonical_name) return null
      return {
        id: product.id,
        slug: product.slug,
        kg_product_id: product.id,
        canonical_name: product.canonical_name,
        query: buildSearchQuery(brandName, product.canonical_name),
      }
    })
    .filter((product): product is MarketQuery & { canonical_name: string } => product !== null)

  if (productFilter) {
    products = products.filter((product) => product.canonical_name.toLowerCase().includes(productFilter))
  }

  if (LIMIT !== Infinity) {
    products = products.slice(0, LIMIT)
  }

  return products
}

async function main() {
  console.log('⚙️  Finn → Listings (dba.dk engine)')
  if (productFilter) console.log(`   Product filter: ${productFilter}`)
  if (DRY_RUN) console.log('   [dry-run] No writes will be made.')
  console.log(`   Limit: ${LIMIT === Infinity ? '∞' : LIMIT} products`)
  console.log(`   Search: sub_category=${SEARCH_OPTIONS.subCategory}, sort=${SEARCH_OPTIONS.sort}`)
  console.log()

  const products = await loadProducts()
  if (products.length === 0) {
    console.log('No matching products found. Exiting.')
    return
  }
  console.log(`Loaded ${products.length} products from the 'finn' monitoring set.\n`)

  // Whether this invocation attempts the FULL set, decided before scraping:
  // a targeted run must never establish or sweep a complete scope.
  const runScope = productFilter === null && LIMIT === Infinity ? 'complete' : 'targeted'
  const { promotedRunId, exitCode } = await runSchibstedMarket(
    supabase,
    { config: FINN_CONFIG, platform: 'finn', scraperVersion: SCRAPER_VERSION, runScope, dryRun: DRY_RUN },
    products,
  )

  // Bounded new-inflow matching. promote_scrape_run() stamps
  // ingestion_batch_id = run id on INSERT only, so rows carrying it are
  // exactly the listings this run introduced. A null lookup means 0 writes.
  if (promotedRunId) {
    const inserted = await fetchBatchListingIds(supabase, 'finn', String(promotedRunId))
    reportBatchMatch(inserted === null
      ? { source: 'finn', considered: 0, matched: 0, rejected: 0, deferred: 0, skipped: 'batch_identity_lookup_failed' }
      : await matchScrapedBatch(supabase, 'finn', inserted))
  }

  if (exitCode !== 0) process.exitCode = exitCode
}

main().catch((error) => {
  console.error('❌ scrape-finn failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
