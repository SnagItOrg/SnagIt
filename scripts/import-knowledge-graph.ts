/**
 * scripts/import-knowledge-graph.ts
 *
 * Reads data/knowledge-graph.json and data/synonyms.json, then upserts all
 * data to Supabase via the service role key.
 *
 * Upsert order: categories → brands → products → identifiers → relations → synonyms
 *
 * Idempotent: categories/brands/products upsert on slug; identifiers,
 * relations, and synonyms are fully replaced on each run (delete + insert).
 *
 * Usage:
 *   npm run import-kg
 *   # or: npx tsx scripts/import-knowledge-graph.ts
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

// ── JSON types ────────────────────────────────────────────────────────────────
interface ProductEntry {
  name: string
  type?: string
  era?: string
  reference_url?: string
  price_range_dkk?: [number, number]
  related?: string[]
  clones?: string[]
  model?: string
  sku?: string[]
  ean?: string[]
  [key: string]: unknown
}

interface BrandEntry {
  products: Record<string, ProductEntry>
  [key: string]: unknown
}

interface CategoryEntry {
  brands: Record<string, BrandEntry>
}

interface KnowledgeGraph {
  version: string
  description: string
  categories: Record<string, CategoryEntry>
}

interface SynonymFile {
  version: string
  description: string
  synonyms: Record<string, string[]>
}

// ── Supabase row types ────────────────────────────────────────────────────────
interface CategoryRow { slug: string; name_da: string; name_en: string }
interface BrandRow    { slug: string; name: string; category_id: string }
interface ProductRow  {
  slug: string
  canonical_name: string
  model_name: string | null
  brand_id: string
  category_id: string
  price_min_dkk: number | null
  price_max_dkk: number | null
  era: string | null
  reference_url: string | null
  attributes: Record<string, unknown>
  status: string
}
interface IdentifierRow { product_id: string; type: string; value: string; confidence: number; source: string }
interface RelationRow   { from_product_id: string; to_product_id: string; type: string; weight: number }
interface SynonymRow    { alias: string; canonical_query: string; lang: string; match_type: string; priority: number }

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATEGORY_NAMES: Record<string, { da: string; en: string }> = {
  'music-gear':    { da: 'Musikudstyr',  en: 'Music Gear' },
  'danish-modern': { da: 'Dansk Design', en: 'Danish Modern' },
  'photography':   { da: 'Fotografi',    en: 'Photography' },
  'tech':          { da: 'Teknologi',    en: 'Technology' },
}

const BRAND_NAME_OVERRIDES: Record<string, string> = {
  'ssl':                'SSL',
  'api':                'API',
  'ua':                 'Universal Audio',
  'emu':                'E-mu',
  'bae':                'BAE Audio',
  'kush-audio':         'Kush Audio',
  'tube-tech':          'Tube-Tech',
  'warm-audio':         'Warm Audio',
  'poul-kjærholm':      'Poul Kjærholm',
  'hans-j-wegner':      'Hans J. Wegner',
  'arne-jacobsen':      'Arne Jacobsen',
  'teenage-engineering':'Teenage Engineering',
  'hp':                 'HP',
}

function brandDisplayName(slug: string): string {
  if (BRAND_NAME_OVERRIDES[slug]) return BRAND_NAME_OVERRIDES[slug]
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function log(msg: string) { console.log(msg) }

async function deleteAll(table: string) {
  const { error } = await supabase.from(table).delete().not('id', 'is', null)
  if (error) throw new Error(`Delete ${table}: ${error.message}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

async function upsert(table: string, rows: AnyRow[], conflict: string, batchSize = 100) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + batchSize), { onConflict: conflict })
    if (error) throw new Error(`Upsert ${table} batch ${i}: ${error.message}`)
  }
}

async function insertBatch(table: string, rows: AnyRow[], batchSize = 100) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + batchSize))
    if (error) throw new Error(`Insert ${table} batch ${i}: ${error.message}`)
  }
}

async function fetchIdMap(table: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from(table).select('id, slug')
  if (error) throw new Error(`Fetch ${table}: ${error.message}`)
  const map: Record<string, string> = {}
  for (const row of (data as Array<{ id: string; slug: string }>) ?? []) map[row.slug] = row.id
  return map
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const kgPath  = path.resolve(__dirname, '../data/knowledge-graph.json')
  const synPath = path.resolve(__dirname, '../data/synonyms.json')

  const kg:  KnowledgeGraph = JSON.parse(fs.readFileSync(kgPath,  'utf-8'))
  const syn: SynonymFile    = JSON.parse(fs.readFileSync(synPath, 'utf-8'))

  log(`📖  knowledge-graph.json  v${kg.version}`)
  log(`📖  synonyms.json         v${syn.version}`)

  // ── 1. Categories ──────────────────────────────────────────────────────────
  log('\n── Categories ──')
  const categoryRows: CategoryRow[] = Object.keys(kg.categories).map(slug => ({
    slug,
    name_da: CATEGORY_NAMES[slug]?.da ?? slug,
    name_en: CATEGORY_NAMES[slug]?.en ?? slug,
  }))
  await upsert('kg_category', categoryRows, 'slug')
  const catMap = await fetchIdMap('kg_category')
  log(`  ✓  ${categoryRows.length} categories`)

  // ── 2. Brands ──────────────────────────────────────────────────────────────
  log('\n── Brands ──')
  const brandRows: BrandRow[] = []
  for (const [catSlug, cat] of Object.entries(kg.categories)) {
    for (const brandSlug of Object.keys(cat.brands)) {
      brandRows.push({ slug: brandSlug, name: brandDisplayName(brandSlug), category_id: catMap[catSlug] })
    }
  }
  await upsert('kg_brand', brandRows, 'slug')
  const brandMap = await fetchIdMap('kg_brand')
  log(`  ✓  ${brandRows.length} brands`)

  // ── 3. Products ────────────────────────────────────────────────────────────
  log('\n── Products ──')
  const productRows: ProductRow[] = []
  const identifiersBySlug: Record<string, Array<{ type: string; value: string }>> = {}
  const relatedBySlug:     Record<string, string[]> = {}
  const clonesBySlug:      Record<string, string[]> = {}

  for (const [catSlug, cat] of Object.entries(kg.categories)) {
    for (const [brandSlug, brand] of Object.entries(cat.brands)) {
      for (const [productSlug, p] of Object.entries(brand.products)) {
        productRows.push({
          slug:           productSlug,
          canonical_name: p.name,
          model_name:     p.model ?? null,
          brand_id:       brandMap[brandSlug],
          category_id:    catMap[catSlug],
          price_min_dkk:  p.price_range_dkk?.[0] ?? null,
          price_max_dkk:  p.price_range_dkk?.[1] ?? null,
          era:            p.era ?? null,
          reference_url:  p.reference_url ?? null,
          attributes:     p.type ? { type: p.type } : {},
          status:         'active',
        })

        const idents: Array<{ type: string; value: string }> = []
        for (const v of p.sku ?? []) idents.push({ type: 'SKU', value: v })
        for (const v of p.ean ?? []) idents.push({ type: 'EAN', value: v })
        if (p.model && !p.sku?.includes(p.model)) idents.push({ type: 'MODEL', value: p.model })
        identifiersBySlug[productSlug] = idents

        relatedBySlug[productSlug] = p.related ?? []
        clonesBySlug[productSlug]  = p.clones  ?? []
      }
    }
  }

  await upsert('kg_product', productRows, 'slug')
  const productMap = await fetchIdMap('kg_product')
  log(`  ✓  ${productRows.length} products`)

  // ── 4. Identifiers ─────────────────────────────────────────────────────────
  log('\n── Identifiers ──')
  await deleteAll('kg_identifier')

  const identRows: IdentifierRow[] = []
  for (const [slug, idents] of Object.entries(identifiersBySlug)) {
    const productId = productMap[slug]
    if (!productId) continue
    for (const { type, value } of idents) {
      identRows.push({ product_id: productId, type, value, confidence: 80, source: 'seed' })
    }
  }
  if (identRows.length > 0) await insertBatch('kg_identifier', identRows)
  log(`  ✓  ${identRows.length} identifiers`)

  // ── 5. Relations ───────────────────────────────────────────────────────────
  log('\n── Relations ──')
  await deleteAll('kg_relation')

  const seen = new Set<string>()
  const relationRows: RelationRow[] = []

  for (const [fromSlug, relSlugs] of Object.entries(relatedBySlug)) {
    const fromId = productMap[fromSlug]
    if (!fromId) continue
    for (const toSlug of relSlugs) {
      const toId = productMap[toSlug]
      if (!toId) continue
      const key = `${fromSlug}→${toSlug}:sibling`
      if (seen.has(key)) continue
      seen.add(key)
      relationRows.push({ from_product_id: fromId, to_product_id: toId, type: 'sibling', weight: 50 })
    }
  }

  // clones[]: these are clones OF the current product (original = from, clone = to... wait)
  // In JSON: product.clones = ["behringer-ju-06"] means behringer-ju-06 IS A CLONE of this product
  // In DB: from_product_id = clone, to_product_id = original, type = 'clone'
  for (const [originalSlug, cloneSlugs] of Object.entries(clonesBySlug)) {
    const toId = productMap[originalSlug] // original is the "to"
    if (!toId) continue
    for (const cloneSlug of cloneSlugs) {
      const fromId = productMap[cloneSlug] // clone is the "from"
      if (!fromId) continue
      const key = `${cloneSlug}→${originalSlug}:clone`
      if (seen.has(key)) continue
      seen.add(key)
      relationRows.push({ from_product_id: fromId, to_product_id: toId, type: 'clone', weight: 50 })
    }
  }

  if (relationRows.length > 0) await insertBatch('kg_relation', relationRows)
  log(`  ✓  ${relationRows.length} relations`)

  // ── 6. Synonyms ────────────────────────────────────────────────────────────
  log('\n── Synonyms ──')
  await deleteAll('synonym')

  const synonymRows: SynonymRow[] = []
  for (const [canonical, aliases] of Object.entries(syn.synonyms)) {
    // canonical itself as exact match
    synonymRows.push({ alias: canonical, canonical_query: canonical, lang: 'da', match_type: 'exact', priority: 100 })
    // each alias
    for (const alias of aliases) {
      synonymRows.push({ alias, canonical_query: canonical, lang: 'da', match_type: 'alias', priority: 50 })
    }
  }
  if (synonymRows.length > 0) await insertBatch('synonym', synonymRows)
  log(`  ✓  ${synonymRows.length} synonyms (${Object.keys(syn.synonyms).length} canonical queries)`)

  log('\n✅  Import complete.')
}

main().catch(err => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
