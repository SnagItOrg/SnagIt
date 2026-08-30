/**
 * scripts/expand-knowledge-graph.ts
 *
 * Analyses Reverb listings already in the database and writes
 * product suggestions to the kg_product_suggestions table.
 *
 * Strategy:
 *   - Fetches all Reverb listing titles from listings table
 *   - Restricts the brand pool to the ACTIVE MUSIC VERTICAL
 *     (kg_brand -> kg_category.domain = 'music')
 *   - Matches each title against that pool on token boundaries, after a
 *     deterministic punctuation/Unicode fold
 *   - Matched titles → new MODEL suggestions (upserted to DB)
 *   - Unmatched titles are dropped as unclassified — never reassigned to a
 *     lower-ranked brand
 *   - Filters out noise (accessories, long names, emoji)
 *
 * Both the fold and the eligibility predicate live in
 * frontend/lib/kg/brand-identity.ts, which documents what they replaced and why.
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
import {
  ACTIVE_BRAND_DOMAIN,
  matchBrandInTitle,
  selectActiveMusicBrands,
  stripBrandSpan,
  type BrandRow,
} from '../frontend/lib/kg/brand-identity'

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
//
// Brand matching and model extraction moved to frontend/lib/kg/brand-identity.ts
// so they are pure, shared and testable from the root runner without a build.
// What used to be here was `lower.includes(brand.name.toLowerCase())` over a
// longest-name-first list — raw substring, no token boundary, no vertical
// filter, and a fall-through to the next brand on failure.

/**
 * Read every row of a table in bounded pages.
 *
 * PostgREST caps an unbounded `.select()` at 1000 rows and reports no error
 * when it truncates. Both the brand pool and the category table are read
 * through this, so growth past the cap cannot silently narrow the pool — a
 * silently short brand list would reintroduce fall-through by another route.
 */
async function readAllRows<T>(table: string, columns: string): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw new Error(`Fetch ${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as unknown as T[]))
    if (data.length < PAGE) break
  }
  return out
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

  // Fetch the vertical of every category. This is the stored provenance the
  // eligibility guard reads; there is no eligibility field on kg_brand itself.
  console.log('Fetching kg_category domains…')
  const categories = await readAllRows<{ id: string; domain: string | null }>(
    'kg_category',
    'id, domain',
  )
  const domainByCategoryId = new Map<string, string>()
  for (const c of categories) {
    if (c.domain) domainByCategoryId.set(c.id, c.domain)
  }
  if (domainByCategoryId.size === 0) {
    // Fail closed. Continuing with an empty domain map would make every brand
    // ineligible, which is safe — but an empty map more likely means the read
    // failed to return, and guessing is how the pool got polluted before.
    throw new Error('kg_category returned no domains — refusing to run with an unverifiable brand pool')
  }

  // Fetch existing brands with their IDs and category
  console.log('Fetching kg_brand…')
  const allBrands = await readAllRows<{ id: string; name: string; category_id: string | null }>(
    'kg_brand',
    'id, name, category_id',
  )

  const brandList: BrandRow[] = allBrands.map((b) => ({
    id: b.id,
    name: (b.name ?? '').trim(),
    category_id: b.category_id,
  }))

  /**
   * Restrict the pool to the active music vertical.
   *
   * Production holds 43 brands under retired verticals — cycling, tech,
   * photography, design-objects, danish-modern — and they had accumulated 498
   * pending suggestions between them, 66 of them on the bicycle manufacturer
   * `Canyon` from Electro-Harmonix Canyon pedal titles. None of those brands
   * owns an active, supported or public product. The filter reads stored
   * provenance only; there is no brand-name list and no Canyon-specific branch.
   */
  const eligibleBrands = selectActiveMusicBrands(brandList, domainByCategoryId)
  const excluded = brandList.length - eligibleBrands.length
  console.log(
    `Found ${brandList.length} brands; ${eligibleBrands.length} eligible for ` +
    `domain '${ACTIVE_BRAND_DOMAIN}' (${excluded} excluded as out-of-vertical or unclassified).\n`,
  )
  if (eligibleBrands.length === 0) {
    throw new Error(`No brands eligible for domain '${ACTIVE_BRAND_DOMAIN}' — refusing to run`)
  }

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
  let unclassified = 0

  for (const title of allTitles) {
    const trimmed = (title ?? '').trim()
    if (!trimmed) continue

    // No eligible brand → unclassified input. Dropped, never reassigned to a
    // lower-ranked brand; the fall-through is what produced the bicycle rows.
    const match = matchBrandInTitle(trimmed, eligibleBrands)
    if (!match) { unclassified++; continue }
    const brand = match.brand

    const model = stripBrandSpan(trimmed, match).slice(0, 80).trim()
    if (!model) continue

    // Narrowing only. `isActiveMusicBrand` already rejects a null category, so
    // an eligible brand always carries one; this keeps that guarantee explicit
    // rather than asserting it away.
    const categoryId = brand.category_id
    if (!categoryId) continue

    // Build canonical name from the STORED display name, not the title's
    // spelling, so suggestions stay consistent with kg_brand.
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
        category_id: categoryId,
        count: 1,
      })
    }
  }

  const sorted = Array.from(suggestions.values()).sort((a, b) => b.count - a.count)
  console.log(
    `${sorted.length} new model suggestions (after filtering); ` +
    `${unclassified} titles matched no eligible music brand and were dropped.\n`,
  )

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
