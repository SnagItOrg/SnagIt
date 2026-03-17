/**
 * scripts/expand-knowledge-graph.ts
 *
 * Analyses Reverb listings already in the database and writes
 * product suggestions to the kg_product_suggestions table.
 *
 * Strategy:
 *   - Fetches all Reverb listing titles from listings table
 *   - Matches each title against existing kg_brand names
 *   - Matched titles → new MODEL suggestions (upserted to DB)
 *   - Filters out noise (accessories, long names, emoji)
 *
 * Usage:
 *   npm run expand-kg
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

// ── Noise filter ─────────────────────────────────────────────────────────────
const NOISE_WORDS = new Set([
  'cover', 'case', 'dust', 'parts', 'replacement', 'adapter', 'cable',
  'strap', 'stand', 'bag', 'gig', 'manual', 'knob', 'screw', 'bolt',
])

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

function isNoisySuggestion(name: string): boolean {
  if (name.length > 80) return true
  if (name.includes('*')) return true
  if (name.includes('✅')) return true
  if (EMOJI_RE.test(name)) return true
  const lower = name.toLowerCase()
  for (const word of NOISE_WORDS) {
    if (lower.includes(word)) return true
  }
  return false
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Find the first kg_brand name in the title (longest-first matching). */
function matchBrand(title: string, sortedBrands: { name: string; id: string; category_id: string }[]): typeof sortedBrands[0] | null {
  const lower = title.toLowerCase()
  for (const brand of sortedBrands) {
    if (lower.includes(brand.name.toLowerCase())) return brand
  }
  return null
}

/** Strip brand name from title, clean up punctuation, return model hint. */
function extractModel(title: string, brandName: string): string {
  const re = new RegExp(brandName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'gi')
  return title
    .replace(re, '')
    .replace(/^[\s\-–|:,]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching Reverb listing titles…')

  const PAGE_SIZE = 1000
  const allTitles: string[] = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('listings')
      .select('title')
      .eq('source', 'reverb')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(`Fetch listings: ${error.message}`)
    if (!data || data.length === 0) break
    allTitles.push(...data.map((r: { title: string }) => r.title))
    if (data.length < PAGE_SIZE) break
    page++
  }

  if (allTitles.length === 0) {
    console.log('No Reverb listings found.')
    return
  }
  console.log(`Found ${allTitles.length} Reverb listings.\n`)

  // Fetch existing brands with their IDs and category
  console.log('Fetching kg_brand…')
  const { data: brands, error: brandsErr } = await supabase
    .from('kg_brand')
    .select('id, name, category_id')
  if (brandsErr) throw new Error(`Fetch brands: ${brandsErr.message}`)

  const brandList = (brands ?? []).map((b: { id: string; name: string; category_id: string }) => ({
    id: b.id,
    name: b.name.trim(),
    category_id: b.category_id,
  }))
  // Sort longest-first so multi-word brands match before shorter prefixes
  brandList.sort((a, b) => b.name.length - a.name.length)
  console.log(`Found ${brandList.length} brands.\n`)

  // Fetch existing kg_product canonical_names to skip already-known products
  console.log('Fetching existing kg_product names…')
  const existingProducts = new Set<string>()
  page = 0
  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('canonical_name')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(`Fetch products: ${error.message}`)
    if (!data || data.length === 0) break
    for (const p of data) existingProducts.add(p.canonical_name.toLowerCase())
    if (data.length < PAGE_SIZE) break
    page++
  }
  console.log(`Found ${existingProducts.size} existing products (will skip).\n`)

  // Classify each listing
  type Suggestion = {
    canonical_name: string
    brand_id: string
    brand_name: string
    category_id: string
    count: number
  }
  const suggestions = new Map<string, Suggestion>()

  for (const title of allTitles) {
    const trimmed = (title ?? '').trim()
    if (!trimmed) continue

    const brand = matchBrand(trimmed, brandList)
    if (!brand) continue

    const model = extractModel(trimmed, brand.name)
    if (!model) continue

    // Build canonical name: "Brand Model"
    const canonicalName = `${brand.name} ${model}`

    if (isNoisySuggestion(canonicalName)) continue
    if (existingProducts.has(canonicalName.toLowerCase())) continue

    const key = `${brand.id}|||${model.toLowerCase()}`
    const existing = suggestions.get(key)
    if (existing) {
      existing.count++
    } else {
      suggestions.set(key, {
        canonical_name: canonicalName,
        brand_id: brand.id,
        brand_name: brand.name,
        category_id: brand.category_id,
        count: 1,
      })
    }
  }

  const sorted = Array.from(suggestions.values()).sort((a, b) => b.count - a.count)
  console.log(`${sorted.length} new model suggestions (after filtering).\n`)

  if (sorted.length === 0) return

  // Upsert in batches of 200
  const BATCH_SIZE = 200
  let totalUpserted = 0

  for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
    const batch = sorted.slice(i, i + BATCH_SIZE).map(s => ({
      canonical_name: s.canonical_name,
      brand_id: s.brand_id,
      brand_name: s.brand_name,
      category_id: s.category_id,
      source: 'expand-script',
      listing_count: s.count,
    }))

    const { error } = await supabase
      .from('kg_product_suggestions')
      .upsert(batch, {
        onConflict: 'canonical_name,brand_id',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error(`  Upsert error (batch ${i / BATCH_SIZE + 1}): ${error.message}`)
    } else {
      totalUpserted += batch.length
    }
  }

  // Log top suggestions
  console.log('Top 20 suggestions by listing count:')
  console.log('─'.repeat(72))
  for (const s of sorted.slice(0, 20)) {
    console.log(`  ${s.brand_name.padEnd(20)} | ${s.canonical_name.padEnd(40)} | ${s.count}`)
  }
  console.log()
  console.log(`✅  ${totalUpserted} suggestions upserted to kg_product_suggestions`)
}

main().catch((err: unknown) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
