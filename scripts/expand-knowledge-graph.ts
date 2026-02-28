/**
 * scripts/expand-knowledge-graph.ts
 *
 * Analyses Reverb listings already in the database and suggests
 * new brands / models to add to the knowledge graph.
 *
 * Strategy:
 *   - Fetches all Reverb listing titles from listings table
 *   - Matches each title against existing kg_brand names
 *   - Matched titles → potential new MODEL suggestions
 *   - Unmatched titles → potential new BRAND suggestions (first token)
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
interface BrandSuggestion {
  make:  string
  count: number
}

interface ModelSuggestion {
  brand: string
  model: string
  count: number
}

interface KgSuggestions {
  generated_at: string
  new_brands:   BrandSuggestion[]
  new_models:   ModelSuggestion[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the first kg_brand name contained in the listing title (case-insensitive).
 * Sorted longest-first so "Warm Audio" matches before "Warm".
 */
function matchBrand(title: string, sortedBrands: string[]): string | null {
  const lower = title.toLowerCase()
  for (const brand of sortedBrands) {
    if (lower.includes(brand.toLowerCase())) return brand
  }
  return null
}

/**
 * Strip the matched brand name from the title and return the remainder as a
 * model hint. Removes leading dashes, pipes, numbers in parentheses, etc.
 */
function extractModel(title: string, brand: string): string {
  const re = new RegExp(brand.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'gi')
  return title
    .replace(re, '')
    .replace(/^[\s\-–|:,]+/, '')   // strip leading punctuation
    .replace(/\s{2,}/g, ' ')        // collapse multiple spaces
    .trim()
    .slice(0, 80)                   // cap length
}

/**
 * Extract the most likely brand token from an unmatched title (first 1–2 words,
 * stopping before purely-numeric tokens or common noise words).
 */
const NOISE = new Set(['used', 'new', 'vintage', 'rare', 'the', 'a', 'an'])

function extractBrandGuess(title: string): string {
  const words = title.trim().split(/\s+/)
  const out: string[] = []
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z0-9\-&.]/g, '')
    if (!clean || /^\d+$/.test(clean) || NOISE.has(clean.toLowerCase())) break
    out.push(clean)
    // Stop at two tokens — keeps guesses concise
    if (out.length === 2) break
  }
  return out.join(' ')
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {

  // ── Step 1: Fetch all Reverb listing titles ────────────────────────────────
  console.log('Fetching Reverb listing titles from database…')

  const { data: listings, error: listingsErr } = await supabase
    .from('listings')
    .select('title')
    .eq('source', 'reverb')

  if (listingsErr) throw new Error(`Fetch listings: ${listingsErr.message}`)
  if (!listings || listings.length === 0) {
    console.log('No Reverb listings found in database.')
    return
  }

  console.log(`Found ${listings.length} Reverb listings.\n`)

  // ── Step 2: Fetch existing kg_brand names ──────────────────────────────────
  console.log('Fetching existing kg_brand names…')

  const { data: brands, error: brandsErr } = await supabase
    .from('kg_brand')
    .select('name')

  if (brandsErr) throw new Error(`Fetch brands: ${brandsErr.message}`)

  const brandNames: string[] = (brands ?? [])
    .map((b: { name: string }) => b.name.trim())
    .filter(Boolean)

  // Sort longest-first so multi-word brand names match before shorter prefixes
  const sortedBrands = [...brandNames].sort((a, b) => b.length - a.length)

  console.log(`Found ${brandNames.length} existing brands in knowledge graph.\n`)

  // ── Step 3: Classify each listing ─────────────────────────────────────────
  const brandGuessCount = new Map<string, number>()      // NEW BRANDS
  const modelKey = new Map<string, ModelSuggestion>()   // NEW MODELS  (brand|||model)

  for (const row of listings as Array<{ title: string }>) {
    const title = (row.title ?? '').trim()
    if (!title) continue

    const matched = matchBrand(title, sortedBrands)

    if (matched) {
      // Known brand — extract model hint
      const model = extractModel(title, matched)
      if (!model) continue
      const key = `${matched.toLowerCase()}|||${model.toLowerCase()}`
      const existing = modelKey.get(key)
      if (existing) {
        existing.count++
      } else {
        modelKey.set(key, { brand: matched, model, count: 1 })
      }
    } else {
      // Unknown brand — first tokens as brand guess
      const guess = extractBrandGuess(title)
      if (!guess) continue
      brandGuessCount.set(guess, (brandGuessCount.get(guess) ?? 0) + 1)
    }
  }

  const newBrands: BrandSuggestion[] = Array.from(brandGuessCount.entries())
    .map(([make, count]) => ({ make, count }))
    .sort((a, b) => b.count - a.count)

  const newModels: ModelSuggestion[] = Array.from(modelKey.values())
    .sort((a, b) => b.count - a.count)

  // ── Console output ─────────────────────────────────────────────────────────
  const HR = '═'.repeat(72)
  const hr = '─'.repeat(72)

  console.log(HR)
  console.log('NEW BRANDS (title tokens not matched to any kg_brand):')
  console.log(hr)
  if (newBrands.length === 0) {
    console.log('  (none — all titles matched an existing brand)')
  } else {
    for (const b of newBrands) {
      console.log(`  ${b.make.padEnd(45)} | ${b.count} listings`)
    }
  }

  console.log()
  console.log(HR)
  console.log('NEW MODELS (model suggestions for existing brands):')
  console.log(hr)
  if (newModels.length === 0) {
    console.log('  (none)')
  } else {
    for (const m of newModels) {
      const brand = m.brand.padEnd(22)
      const model = m.model.padEnd(40)
      const count = String(m.count).padStart(4)
      console.log(`  ${brand} | ${model} | ${count}`)
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
  console.log(`    ${newBrands.length} potential new brand(s), ${newModels.length} model suggestion(s)`)
}

main().catch((err: unknown) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
