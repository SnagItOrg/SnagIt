/**
 * scripts/process-reverb-data.ts
 *
 * Parses Reverb API data (categories, brands) and merges them into
 * data/knowledge-graph.json. Handles identifying brands and models
 * from Reverb's structure and mapping them to our KG.
 *
 * Usage:
 *   npx tsx scripts/process-reverb-data.ts
 *
 * Env (loaded from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// ── Env loading ───────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── Paths ─────────────────────────────────────────────────────────────────────
const KG_PATH      = path.resolve(__dirname, '../data/knowledge-graph.json')
const REVERB_CATS  = path.resolve(__dirname, '../data/reverb-categories.json')
const REVERB_BRANDS = path.resolve(__dirname, '../data/reverb-brands.json') // Might be empty
const LOG_PATH     = path.resolve(__dirname, 'reverb-scrape-log.json')

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReverbCategory {
  uuid: string
  name: string
  slug: string
  full_name: string
  root_slug?: string
  _links: { web: { href: string } }
}

interface ReverbBrand { [key: string]: string } // Simplified, or could be an array

interface KgProduct {
  name: string
  type: string
  era?: string
  reference_url?: string
  related?: string[]
  clones?: string[]
  [key: string]: unknown
}
interface BrandData { products: Record<string, KgProduct>; note?: string }
interface CategoryData { brands: Record<string, BrandData> }
interface KnowledgeGraph {
  version: string
  description: string
  categories: Record<string, CategoryData>
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)) }

function slugify(s: string): string {
  return s.toLowerCase().replace(/[\s\/\-]+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/^-+|-+$/g, '')
}

/** Infer brand from Reverb category full_name */
// e.g. "Keyboards and Synths / Synths / Roland JD-800" → "roland"
function inferBrandFromFullName(fullName: string): string | null {
  const parts = fullName.split('/').map(p => p.trim())
  if (parts.length >= 3) {
    // Assuming the pattern Category / SubCategory / Brand Model
    const brandPart = parts[parts.length - 2]
    if (brandPart && !['synths', 'effects', 'accessories'].includes(brandPart.toLowerCase())) {
      return slugify(brandPart)
    }
  }
  // Fallback: try to find common brand names in the name or full_name
  const commonBrands = ['roland', 'korg', 'yamaha', 'moog', 'sequential', 'oberheim', 'akai', 'casio', 'alesis', 'novation', 'behringer', 'elektron', 'emu', 'akai', 'fender', 'gibson']
  const text = fullName.toLowerCase()
  for (const brand of commonBrands) {
    if (text.includes(brand)) return brand
  }
  return null
}

// -----------------------------------------------------------------------------
async function main() {
  console.log('⚙️  Processing Reverb data…')

  // Load KG and Reverb data
  const kg: KnowledgeGraph = JSON.parse(fs.readFileSync(KG_PATH, 'utf8'))
  let reverbCategories: ReverbCategory[] = []
  try {
    reverbCategories = JSON.parse(fs.readFileSync(REVERB_CATS, 'utf8')).categories
    console.log(`Loaded ${reverbCategories.length} Reverb categories.`) 
  } catch (err) {
    console.error('❌ Error loading Reverb categories:', err)
    process.exit(1)
  }

  // NOTE: Reverb brands API returned empty, so we'll infer brands from category names.
  // This might not be perfect, but it's the best we have for now.

  const musicGear = kg.categories['music-gear']
  if (!musicGear) {
    console.error('❌  music-gear category not found in KG. Cannot proceed.')
    process.exit(1)
  }

  let addedCount = 0
  const log = []

  for (const category of reverbCategories) {
    // Infer brand from category name. This needs work, as not all categories
    // clearly indicate a brand (e.g., "Effects Pedals").
    // We'll prioritize brands that are clearly specified in the hierarchy.
    // Example: "Amps / Guitar Amps / Guitar Combos" → extract "Guitar Amps" or "Amps"
    .
    // A better approach is to have a dedicated brand mapping or use the brands API if it works.

    // For now, just process categories and assume we can map them later.
    // A simple heuristic: if the hierarchy includes a known brand name, use it.
    let potentialBrandSlug: string | null = null
    const parts = category.full_name.split('/').map(p => p.trim())
    for (const part of parts) {
      const slug = slugify(part)
      // A very basic check for known brands that might appear in hierarchy
      if (['roland', 'moog', 'korg', 'yamaha', 'akai', 'sequential', 'oberheim', 'arturia', 'behringer', 'elektron', 'casio', 'alesis', 'novation', 'gibson', 'fender'].includes(slug)) {
        potentialBrandSlug = slug
        break
      }
    }

    if (!potentialBrandSlug) {
      potentialBrandSlug = inferBrandFromFullName(category.full_name)
    }

    if (!potentialBrandSlug) {
      // Cannot determine brand, skip for now.
      // console.log(`Skipping category (no brand found): ${category.full_name}`)
      continue 
    }

    // Ensure brand exists in KG
    if (!musicGear.brands[potentialBrandSlug]) {
      musicGear.brands[potentialBrandSlug] = { products: {} }
    }

    // We're adding categories here as a placeholder for where brands/models would go.
    // The actual model scraping needs to be done from a different endpoint
    // or by parsing the category pages themselves to find instrument links.
    // For now, just ensure the brand exists and log the category.
    console.log(`Processing category: ${category.full_name} → Brand: ${potentialBrandSlug}`)
    // TODO: Need to fetch actual product pages for each category to populate KG.
    // This requires fetching the category's instrument list first.
  }

  // Save KG (even if only minor changes or just ensuring brand buckets exist)
  if (!DRY_RUN) {
    fs.writeFileSync(KG_PATH, JSON.stringify(kg, null, 2))
    console.log(`\n✅  knowledge-graph.json updated.`) 
  }

  console.log(`\n── Processing Summary ──
Added/Ensured ${addedCount} brand entries. (Brand inference is basic, needs refinement)
Potential TODOs: Add specific product scraping logic per category.
`)

  // Save log file
  fs.writeFileSync(LOG_PATH, JSON.stringify({
    run_date: new Date().toISOString(),
    categories_processed: reverbCategories.length,
    brands_ensured: Object.keys(musicGear.brands).length,
    log: log,
  }, null, 2))
  console.log(`📝  Log saved to ${LOG_PATH}`)
}

main().catch((err: unknown) => {
  console.error('❌', (err as Error).message ?? err)
  process.exit(1)
})
