/**
 * flag-dirty-products.ts
 *
 * Identifies kg_product rows that are likely listing-title pollution
 * rather than canonical "Brand Model" products.
 *
 * Read-only — writes a JSON report, never modifies the database.
 *
 * Usage:
 *   npm run flag-dirty-products
 *
 * Output:
 *   scripts/dirty-products-report.json
 */

import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Flag patterns ─────────────────────────────────────────────────────────────

const YEAR_RE = /\d{4}/

const CONDITION_WORDS = [
  'refin', 'relic', 'aged', 'heavy aged', 'light aged',
  'murphy lab', 'ultra light aged', 'played in',
]
const CONDITION_RE = new RegExp(
  CONDITION_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|'),
  'i',
)

const LANGUAGE_WORDS = [
  'chitarra', 'basso', 'clavier', 'guitare', 'elektrisch',
  'gitarre', 'acustica', 'elettrico', 'elettrica',
]
const LANGUAGE_RE = new RegExp(LANGUAGE_WORDS.join('|'), 'i')

const MAX_WORDS = 8

function checkFlags(slug: string, canonicalName: string, brandName: string): string[] {
  const flags: string[] = []

  if (YEAR_RE.test(canonicalName)) {
    flags.push('has_year')
  }

  if (CONDITION_RE.test(canonicalName)) {
    flags.push('has_condition_word')
  }

  if (LANGUAGE_RE.test(canonicalName)) {
    flags.push('has_language_qualifier')
  }

  // Duplicated brand: brand name appears twice in slug
  // e.g. fender-fender-stratocaster, roland-roland-juno-106
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (brandSlug && slug.includes(`${brandSlug}-${brandSlug}`)) {
    flags.push('duplicated_brand')
  }

  const wordCount = canonicalName.trim().split(/\s+/).length
  if (wordCount > MAX_WORDS) {
    flags.push('too_long')
  }

  return flags
}

// ── Main ──────────────────────────────────────────────────────────────────────

type ProductRow = {
  id: string
  slug: string
  canonical_name: string
  brand_id: string | null
  kg_brand: { name: string } | null
}

async function main() {
  console.log('Fetching active standard-tier products...')

  // Paginate — PostgREST caps at 1000 rows per request
  const all: ProductRow[] = []
  const PAGE = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('id, slug, canonical_name, brand_id, kg_brand(name)')
      .eq('status', 'active')
      .eq('tier', 'standard')
      .range(from, from + PAGE - 1) as { data: ProductRow[] | null; error: unknown }

    if (error) {
      console.error('Query error:', error)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
    console.log(`  Fetched ${all.length} rows...`)
  }

  console.log(`Total rows fetched: ${all.length}`)

  // ── Flag each row ───────────────────────────────────────────────────────────

  type FlaggedRow = {
    id: string
    slug: string
    canonical_name: string
    brand_name: string
    flags: string[]
    listing_match_count: number
  }

  const flagged: FlaggedRow[] = []
  const breakdown = {
    has_year: 0,
    has_condition_word: 0,
    has_language_qualifier: 0,
    duplicated_brand: 0,
    too_long: 0,
  }

  for (const row of all) {
    const brandName = row.kg_brand?.name ?? ''
    const flags = checkFlags(row.slug, row.canonical_name, brandName)
    if (flags.length === 0) continue

    for (const f of flags) {
      breakdown[f as keyof typeof breakdown]++
    }

    flagged.push({
      id: row.id,
      slug: row.slug,
      canonical_name: row.canonical_name,
      brand_name: brandName,
      flags,
      listing_match_count: 0, // populated below
    })
  }

  console.log(`Flagged: ${flagged.length} of ${all.length}`)

  // ── Fetch listing match counts for flagged rows ─────────────────────────────

  if (flagged.length > 0) {
    console.log('Fetching listing match counts...')
    const flaggedIds = flagged.map((r) => r.id)

    // Batch in chunks of 100 to stay within PostgREST header limits
    const CHUNK = 100
    const countById = new Map<string, number>()

    for (let i = 0; i < flaggedIds.length; i += CHUNK) {
      const chunk = flaggedIds.slice(i, i + CHUNK)
      const { data: matches, error: mErr } = await supabase
        .from('listing_product_match')
        .select('product_id')
        .in('product_id', chunk)

      if (mErr) {
        console.error('Match query error:', mErr)
        process.exit(1)
      }

      for (const m of matches ?? []) {
        countById.set(m.product_id, (countById.get(m.product_id) ?? 0) + 1)
      }
    }

    for (const row of flagged) {
      row.listing_match_count = countById.get(row.id) ?? 0
    }
  }

  // Sort: products with matches first (they need the most careful review)
  flagged.sort((a, b) => b.listing_match_count - a.listing_match_count)

  // ── Write report ────────────────────────────────────────────────────────────

  const report = {
    total_scanned: all.length,
    total_flagged: flagged.length,
    breakdown,
    flagged,
  }

  const outPath = path.resolve(__dirname, 'dirty-products-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

  console.log('\n── Report ───────────────────────────────────────────')
  console.log(`Total scanned:  ${report.total_scanned}`)
  console.log(`Total flagged:  ${report.total_flagged}`)
  console.log('Breakdown:')
  for (const [key, count] of Object.entries(breakdown)) {
    console.log(`  ${key.padEnd(25)} ${count}`)
  }
  console.log(`\nReport written to: ${outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
