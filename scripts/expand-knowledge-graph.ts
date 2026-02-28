/**
 * scripts/expand-knowledge-graph.ts
 *
 * Analyses Reverb listings already in the database and suggests
 * new brands / models to add to the knowledge graph.
 *
 * Usage:
 *   npm run expand-kg
 *
 * Output:
 *   Console – NEW BRANDS and NEW MODELS tables
 *   File    – scripts/kg-suggestions.json
 *
 * Env (loaded from .env.local or frontend/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// ── Env ───────────────────────────────────────────────────────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────────────
interface ListingRow {
  make:       string | null
  model:      string | null
  categories: string[] | null
}

interface BrandSuggestion {
  make:  string
  count: number
}

interface ModelSuggestion {
  brand:    string
  model:    string
  count:    number
  category: string
}

interface KgSuggestions {
  generated_at: string
  new_brands:   BrandSuggestion[]
  new_models:   ModelSuggestion[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normaliseKey(s: string): string {
  return s.trim().toLowerCase()
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {

  // ── Step 1: Fetch all Reverb listings (make / model / categories) ──────────
  console.log('Fetching Reverb listings from database…')

  const { data: listings, error: listingsErr } = await supabase
    .from('listings')
    .select('make, model, categories')
    .eq('source', 'reverb')

  if (listingsErr) throw new Error(`Fetch listings: ${listingsErr.message}`)
  if (!listings || listings.length === 0) {
    console.log('No Reverb listings found in database.')
    return
  }

  console.log(`Found ${listings.length} Reverb listings.\n`)

  // Group by make + model + categories (mirrors the SQL GROUP BY)
  type GroupKey = string
  const groupMap = new Map<GroupKey, {
    make:       string
    model:      string | null
    categories: string[] | null
    count:      number
  }>()

  for (const row of listings as ListingRow[]) {
    const make = row.make?.trim() ?? ''
    if (!make) continue

    const model      = row.model?.trim() || null
    const categories = row.categories ?? null
    const key: GroupKey = `${make}|||${model ?? ''}|||${JSON.stringify(categories)}`

    const existing = groupMap.get(key)
    if (existing) {
      existing.count++
    } else {
      groupMap.set(key, { make, model, categories, count: 1 })
    }
  }

  const grouped = Array.from(groupMap.values()).sort((a, b) => b.count - a.count)

  // ── Step 2: Fetch existing kg_brand names ──────────────────────────────────
  console.log('Fetching existing kg_brand names…')

  const { data: brands, error: brandsErr } = await supabase
    .from('kg_brand')
    .select('name')

  if (brandsErr) throw new Error(`Fetch brands: ${brandsErr.message}`)

  const existingBrands = new Set(
    (brands ?? []).map((b: { name: string }) => normaliseKey(b.name))
  )

  console.log(`Found ${existingBrands.size} existing brands in knowledge graph.\n`)

  // ── Step 3: Build suggestion lists ────────────────────────────────────────

  // Aggregate listing counts per make
  const makeCountMap = new Map<string, number>()
  for (const row of grouped) {
    makeCountMap.set(row.make, (makeCountMap.get(row.make) ?? 0) + row.count)
  }

  // NEW BRANDS — makes not found in kg_brand
  const newBrands: BrandSuggestion[] = Array.from(makeCountMap.entries())
    .filter(([make]) => !existingBrands.has(normaliseKey(make)))
    .map(([make, count]) => ({ make, count }))
    .sort((a, b) => b.count - a.count)

  // NEW MODELS — model values whose brand IS already in kg_brand
  // Deduplicate by brand+model, sum counts, take first category.
  const modelMap = new Map<string, ModelSuggestion>()
  for (const row of grouped) {
    if (!row.model) continue
    if (!existingBrands.has(normaliseKey(row.make))) continue

    const key = `${normaliseKey(row.make)}|||${normaliseKey(row.model)}`
    const existing = modelMap.get(key)
    if (existing) {
      existing.count += row.count
    } else {
      modelMap.set(key, {
        brand:    row.make,
        model:    row.model,
        count:    row.count,
        category: (row.categories ?? []).join(', ') || 'unknown',
      })
    }
  }

  const newModels: ModelSuggestion[] = Array.from(modelMap.values())
    .sort((a, b) => b.count - a.count)

  // ── Console output ─────────────────────────────────────────────────────────
  const HR  = '═'.repeat(70)
  const hr  = '─'.repeat(70)

  console.log(HR)
  console.log('NEW BRANDS (make values not in kg_brand):')
  console.log(hr)
  if (newBrands.length === 0) {
    console.log('  (none)')
  } else {
    for (const b of newBrands) {
      console.log(`  ${b.make.padEnd(45)} | ${b.count} listings`)
    }
  }

  console.log()
  console.log(HR)
  console.log('NEW MODELS (model values for existing brands):')
  console.log(hr)
  if (newModels.length === 0) {
    console.log('  (none)')
  } else {
    for (const m of newModels) {
      const brand    = m.brand.padEnd(20)
      const model    = m.model.padEnd(30)
      const count    = String(m.count).padStart(4)
      console.log(`  ${brand} | ${model} | ${count} | ${m.category}`)
    }
  }
  console.log()

  // ── Save JSON ──────────────────────────────────────────────────────────────
  const output: KgSuggestions = {
    generated_at: new Date().toISOString(),
    new_brands:   newBrands,
    new_models:   newModels,
  }

  const outPath = path.resolve(__dirname, 'kg-suggestions.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`✅  Saved to ${outPath}`)
  console.log(`    ${newBrands.length} new brand(s), ${newModels.length} new model(s)`)
}

main().catch((err: unknown) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
