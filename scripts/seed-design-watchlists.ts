/**
 * scripts/seed-design-watchlists.ts
 *
 * Automatically seeds Supabase watchlists for design-objects products from the knowledge graph.
 *
 * Features:
 *   - Reads data/knowledge-graph.json and extracts all design-objects products
 *   - Creates watchlist entries using canonical product names
 *   - For high-priority products, also adds synonym watchlists
 *   - Idempotent: skips if watchlist with same query already exists
 *   - Sets user_id: null (system watchlists)
 *
 * Usage:
 *   npm run seed-design-watchlists
 *   npm run seed-design-watchlists -- --dry-run     # test without writing
 *   npm run seed-design-watchlists -- --brand=knoll # single brand filter
 *
 * High-priority products (with synonym entries):
 *   - Egg Chair, Series 7, PH5, Wishbone Chair, Panton Chair, Eames Lounge Chair
 */

// ── Env loading (MUST be first) ───────────────────────────────────────────────
import * as dotenv from 'dotenv'
dotenv.config({ path: './frontend/.env.local' })

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const brandFilter = args.find(a => a.startsWith('--brand='))?.split('=')[1]?.toLowerCase() ?? null

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = !DRY_RUN && SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
}) : null

// ── Types ─────────────────────────────────────────────────────────────────────
interface KgProduct {
  name: string
  synonyms?: string[]
  [key: string]: unknown
}

interface BrandData {
  products: Record<string, KgProduct>
  [key: string]: unknown
}

interface KnowledgeGraph {
  version: string
  categories: {
    'design-objects'?: {
      brands: Record<string, BrandData>
    }
    [key: string]: unknown
  }
}

interface WatchlistEntry {
  query: string
  type: 'query' | 'listing'
  user_id: null
  description?: string
}

// ── High-priority products ─────────────────────────────────────────────────────
const HIGH_PRIORITY_PRODUCTS = [
  'egg chair',
  'series 7',
  'ph5',
  'wishbone chair',
  'panton chair',
  'eames lounge chair',
]

function isHighPriority(name: string): boolean {
  return HIGH_PRIORITY_PRODUCTS.some(p => name.toLowerCase().includes(p))
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🎯 Design Watchlist Seeder')
  console.log(`    DRY_RUN: ${DRY_RUN}`)
  if (brandFilter) console.log(`    Brand filter: ${brandFilter}`)
  console.log()

  // Load KG
  const kgPath = path.resolve(__dirname, '../data/knowledge-graph.json')
  let kg: KnowledgeGraph
  try {
    kg = JSON.parse(fs.readFileSync(kgPath, 'utf-8'))
  } catch (err) {
    console.error(`❌ Failed to load ${kgPath}`)
    process.exit(1)
  }

  const designObjects = kg.categories['design-objects']
  if (!designObjects) {
    console.warn('⚠️  No design-objects category found in KG')
    process.exit(0)
  }

  // Fetch existing watchlist queries to avoid duplicates
  const existingQueries = new Set<string>()
  if (supabase && !DRY_RUN) {
    const { data: existing } = await supabase.from('watchlists').select('query')
    for (const w of (existing ?? [])) {
      existingQueries.add((w as any).query.toLowerCase())
    }
  }

  console.log(`📋 Existing watchlists: ${existingQueries.size}`)
  console.log()

  // Collect all watchlist entries
  const toInsert: WatchlistEntry[] = []
  const brandList = Object.keys(designObjects.brands)
  let skipped = 0
  let ready = 0

  for (const brandSlug of brandList) {
    // Apply brand filter if specified
    if (brandFilter && !brandSlug.includes(brandFilter)) {
      continue
    }

    const brand = designObjects.brands[brandSlug]
    const products = brand.products ?? {}

    for (const [productSlug, product] of Object.entries(products)) {
      const name = (product as any).name ?? productSlug

      // Main product entry
      const queryLower = name.toLowerCase()
      if (!existingQueries.has(queryLower)) {
        toInsert.push({
          query: name,
          type: 'query',
          user_id: null,
          description: `Design product: ${name} (${brandSlug})`,
        })
        ready++
      } else {
        skipped++
      }

      // Synonyms for high-priority products
      if (isHighPriority(name)) {
        const synonyms = (product as any).synonyms ?? []
        for (const synonym of synonyms) {
          const synLower = synonym.toLowerCase()
          if (!existingQueries.has(synLower)) {
            toInsert.push({
              query: synonym,
              type: 'query',
              user_id: null,
              description: `Design synonym: "${synonym}" → ${name}`,
            })
            ready++
          } else {
            skipped++
          }
        }
      }
    }
  }

  console.log(`✓ Ready to seed: ${ready} watchlist entries`)
  console.log(`⊘ Already exist: ${skipped} entries`)
  console.log()

  if (toInsert.length === 0) {
    console.log('(Nothing to insert)')
    process.exit(0)
  }

  if (DRY_RUN) {
    console.log('Sample entries (first 5):')
    toInsert.slice(0, 5).forEach(entry => {
      console.log(`  • "${entry.query}" (${entry.description})`)
    })
    console.log()
    console.log('(DRY_RUN — no data written)')
    process.exit(0)
  }

  // Insert in batches
  if (!supabase) {
    console.error('❌ Supabase client not initialized')
    process.exit(1)
  }

  console.log(`⏳ Inserting ${toInsert.length} watchlists...`)
  const batchSize = 50
  let inserted = 0

  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize)
    const { error } = await supabase.from('watchlists').insert(batch)

    if (error) {
      console.error(`❌ Batch insert failed:`, error.message)
      process.exit(1)
    }

    inserted += batch.length
    console.log(`  ✓ Inserted ${inserted}/${toInsert.length}`)
  }

  console.log()
  console.log('✅ Seeding complete!')
  console.log(`   Total inserted: ${toInsert.length}`)
  console.log(`   Total skipped (existing): ${skipped}`)
  console.log()
  console.log('💡 Watchlists are now ready for scraping.')
  console.log('   To view: SELECT COUNT(*) FROM watchlists WHERE user_id IS NULL')
}

main().catch((err: unknown) => {
  console.error(`\n❌ Error: ${(err as Error).message ?? err}`)
  process.exit(1)
})
