/**
 * scripts/export-knowledge-graph.ts
 *
 * Reads all kg_* and synonym tables from Supabase, then writes back to:
 *   data/knowledge-graph.json  (preserves version/description from existing file)
 *   data/synonyms.json         (preserves version/description from existing file)
 *
 * The output JSON structure matches the seed file format used by import-knowledge-graph.ts.
 *
 * Usage:
 *   npm run export-kg
 *   # or: npx tsx scripts/export-knowledge-graph.ts
 *
 * Env (loaded from frontend/.env.local or .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// ── Env loading ───────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── DB row types ──────────────────────────────────────────────────────────────
interface DbCategory {
  id: string
  slug: string
  name_da: string
  name_en: string
}

interface DbBrand {
  id: string
  slug: string
  name: string
  category_id: string
}

interface DbProduct {
  id: string
  slug: string
  canonical_name: string
  model_name: string | null
  brand_id: string
  category_id: string
  price_min_dkk: number | null
  price_max_dkk: number | null
  era: string | null
  reference_url: string | null
  attributes: Record<string, unknown> | null
  status: string
}

interface DbIdentifier {
  id: string
  product_id: string
  type: string
  value: string
}

interface DbRelation {
  id: string
  from_product_id: string
  to_product_id: string
  type: string
}

interface DbSynonym {
  id: string
  alias: string
  canonical_query: string | null
  match_type: string
  lang: string
  priority: number
}

// ── Output JSON types ─────────────────────────────────────────────────────────
interface ProductOut {
  name: string
  type?: string
  era?: string
  related?: string[]
  clones?: string[]
  reference_url?: string
  price_range_dkk?: [number, number]
  model?: string
  sku?: string[]
  ean?: string[]
}

function log(msg: string) { console.log(msg) }

async function fetchAll<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw new Error(`Fetch ${table}: ${error.message}`)
  return (data as T[]) ?? []
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('📡  Fetching data from Supabase...')

  const [categories, brands, products, identifiers, relations, synonyms] = await Promise.all([
    fetchAll<DbCategory>('kg_category'),
    fetchAll<DbBrand>('kg_brand'),
    fetchAll<DbProduct>('kg_product'),
    fetchAll<DbIdentifier>('kg_identifier'),
    fetchAll<DbRelation>('kg_relation'),
    fetchAll<DbSynonym>('synonym'),
  ])

  log(`  ✓  ${categories.length} categories`)
  log(`  ✓  ${brands.length} brands`)
  log(`  ✓  ${products.length} products`)
  log(`  ✓  ${identifiers.length} identifiers`)
  log(`  ✓  ${relations.length} relations`)
  log(`  ✓  ${synonyms.length} synonyms`)

  // ── Build lookup maps ─────────────────────────────────────────────────────
  const productById: Record<string, DbProduct> = {}
  for (const p of products) productById[p.id] = p

  // Identifiers grouped by product_id
  const identsByProduct: Record<string, DbIdentifier[]> = {}
  for (const ident of identifiers) {
    if (!identsByProduct[ident.product_id]) identsByProduct[ident.product_id] = []
    identsByProduct[ident.product_id].push(ident)
  }

  // sibling/predecessor/successor relations: from_product_id → [to_product slug]
  // clone relations: to_product_id (original) → [from_product slug (clone)]
  const siblingsByProduct: Record<string, string[]> = {}
  const clonesOfProduct:   Record<string, string[]> = {}

  for (const rel of relations) {
    if (['sibling', 'predecessor', 'successor', 'alternative', 'compatible'].includes(rel.type)) {
      if (!siblingsByProduct[rel.from_product_id]) siblingsByProduct[rel.from_product_id] = []
      const toSlug = productById[rel.to_product_id]?.slug
      if (toSlug) siblingsByProduct[rel.from_product_id].push(toSlug)
    } else if (rel.type === 'clone') {
      if (!clonesOfProduct[rel.to_product_id]) clonesOfProduct[rel.to_product_id] = []
      const cloneSlug = productById[rel.from_product_id]?.slug
      if (cloneSlug) clonesOfProduct[rel.to_product_id].push(cloneSlug)
    }
  }

  // ── Build knowledge-graph.json ─────────────────────────────────────────────
  log('\n── Building knowledge-graph.json ──')

  const kgCategories: Record<string, { brands: Record<string, { products: Record<string, ProductOut> }> }> = {}

  for (const cat of categories) {
    const catBrands: Record<string, { products: Record<string, ProductOut> }> = {}

    for (const brand of brands.filter(b => b.category_id === cat.id)) {
      const brandProducts: Record<string, ProductOut> = {}

      for (const product of products.filter(p => p.brand_id === brand.id)) {
        const idents    = identsByProduct[product.id] ?? []
        const skus      = idents.filter(i => i.type === 'SKU').map(i => i.value)
        const eans      = idents.filter(i => i.type === 'EAN').map(i => i.value)
        const related   = siblingsByProduct[product.id] ?? []
        const clones    = clonesOfProduct[product.id]   ?? []
        const attrs     = product.attributes ?? {}
        const productType = typeof attrs.type === 'string' ? attrs.type : undefined

        const out: ProductOut = { name: product.canonical_name }
        if (productType)                                          out.type            = productType
        if (product.era)                                          out.era             = product.era
        if (related.length > 0)                                   out.related         = related
        if (clones.length  > 0)                                   out.clones          = clones
        if (product.reference_url)                                out.reference_url   = product.reference_url
        if (product.price_min_dkk != null && product.price_max_dkk != null)
                                                                  out.price_range_dkk = [product.price_min_dkk, product.price_max_dkk]
        if (product.model_name)                                   out.model           = product.model_name
        if (skus.length > 0)                                      out.sku             = skus
        if (eans.length > 0)                                      out.ean             = eans

        brandProducts[product.slug] = out
      }

      catBrands[brand.slug] = { products: brandProducts }
    }

    kgCategories[cat.slug] = { brands: catBrands }
  }

  // Preserve version/description from existing file
  const kgPath = path.resolve(__dirname, '../data/knowledge-graph.json')
  let kgVersion     = '1.2.0'
  let kgDescription = ''
  try {
    const existing = JSON.parse(fs.readFileSync(kgPath, 'utf-8')) as { version?: string; description?: string }
    if (existing.version)     kgVersion     = existing.version
    if (existing.description) kgDescription = existing.description
  } catch { /* file may not exist yet */ }

  const kgOutput = { version: kgVersion, description: kgDescription, categories: kgCategories }
  fs.writeFileSync(kgPath, JSON.stringify(kgOutput, null, 2) + '\n')
  log(`  ✓  data/knowledge-graph.json  (${products.length} products across ${categories.length} categories)`)

  // ── Build synonyms.json ────────────────────────────────────────────────────
  log('\n── Building synonyms.json ──')

  // Group aliases by canonical_query; skip exact-match rows (canonical = alias)
  const synMap: Record<string, string[]> = {}
  for (const syn of synonyms) {
    if (!syn.canonical_query || syn.match_type === 'exact') continue
    if (!synMap[syn.canonical_query]) synMap[syn.canonical_query] = []
    synMap[syn.canonical_query].push(syn.alias)
  }

  const synPath = path.resolve(__dirname, '../data/synonyms.json')
  let synVersion     = '1.2.0'
  let synDescription = ''
  try {
    const existing = JSON.parse(fs.readFileSync(synPath, 'utf-8')) as { version?: string; description?: string }
    if (existing.version)     synVersion     = existing.version
    if (existing.description) synDescription = existing.description
  } catch { /* file may not exist yet */ }

  const synOutput = { version: synVersion, description: synDescription, synonyms: synMap }
  fs.writeFileSync(synPath, JSON.stringify(synOutput, null, 2) + '\n')
  log(`  ✓  data/synonyms.json  (${Object.keys(synMap).length} canonical queries)`)

  log('\n✅  Export complete.')
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
