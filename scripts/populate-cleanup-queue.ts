/**
 * populate-cleanup-queue.ts
 *
 * Flags dirty kg_product rows as cleanup_status = 'pending'.
 * Uses the same criteria as flag-dirty-products.ts.
 * Skips rows already set. Read-only detection, targeted writes.
 *
 * Usage:
 *   npm run populate-cleanup-queue
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

// ── Flag patterns (identical to flag-dirty-products.ts) ───────────────────────

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

function isDirty(slug: string, canonicalName: string, brandName: string): boolean {
  if (YEAR_RE.test(canonicalName)) return true
  if (CONDITION_RE.test(canonicalName)) return true
  if (LANGUAGE_RE.test(canonicalName)) return true
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (brandSlug && slug.includes(`${brandSlug}-${brandSlug}`)) return true
  if (canonicalName.trim().split(/\s+/).length > MAX_WORDS) return true
  return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

type ProductRow = {
  id: string
  slug: string
  canonical_name: string
  cleanup_status: string | null
  kg_brand: { name: string } | null
}

async function main() {
  console.log('Fetching active standard-tier products...')

  const all: ProductRow[] = []
  const PAGE = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('id, slug, canonical_name, cleanup_status, kg_brand(name)')
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

  console.log(`Total fetched: ${all.length}`)

  // Identify dirty rows not already marked
  const toMark = all
    .filter((row) => {
      if (row.cleanup_status !== null) return false // already set, skip
      return isDirty(row.slug, row.canonical_name, row.kg_brand?.name ?? '')
    })
    .map((row) => row.id)

  console.log(`Dirty and unmarked: ${toMark.length}`)

  if (toMark.length === 0) {
    console.log('Nothing to mark. Done.')
    return
  }

  // Update in batches of 100
  const CHUNK = 100
  let marked = 0

  for (let i = 0; i < toMark.length; i += CHUNK) {
    const chunk = toMark.slice(i, i + CHUNK)
    const { error: updateErr } = await supabase
      .from('kg_product')
      .update({ cleanup_status: 'pending' })
      .in('id', chunk)

    if (updateErr) {
      console.error(`Batch ${i / CHUNK + 1} error:`, updateErr)
      process.exit(1)
    }

    marked += chunk.length
    process.stdout.write(`\r  Marked ${marked}/${toMark.length}...`)
  }

  console.log(`\nMarked ${marked} rows as pending cleanup.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
