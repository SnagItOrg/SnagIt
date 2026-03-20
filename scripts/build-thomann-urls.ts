/**
 * scripts/build-thomann-urls.ts
 *
 * Reads data/thomann-sitemap.json (produced by download-thomann-sitemap.ts),
 * fuzzy-matches every kg_product canonical_name to a sitemap URL, and writes
 * thomann_url to the database. Only confirmed sitemap URLs are written.
 *
 * Run download-thomann-sitemap.ts first (once weekly), then this script.
 *
 * Strategy:
 *   1. Load data/thomann-sitemap.json
 *   2. Filter out bundle/pack/set/kit pages
 *   3. For each kg_product, tokenise canonical_name into words
 *   4. Score each sitemap filename by: matched_words / total_words
 *   5. Accept matches with score >= 0.75; pick highest score (shortest on tie)
 *   6. Write thomann_url — leaves thomann_price_dkk untouched
 *
 * Usage:
 *   npx tsx scripts/build-thomann-urls.ts
 *   npx tsx scripts/build-thomann-urls.ts --dry-run
 */

import 'dotenv/config'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const SITEMAP_JSON = path.resolve(__dirname, '../data/thomann-sitemap.json')

// ── Load env ──────────────────────────────────────────────────────────────────
const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// ── Config ────────────────────────────────────────────────────────────────────
// Patterns that indicate a bundle/set/pack — not individual products
const BUNDLE_RE = /[_-](bundle|pack|set|kit|rig|starter|combo|value|deal)\b/i

const MIN_SCORE = 0.75

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Load sitemap from JSON cache ──────────────────────────────────────────────
function loadSitemapUrls(): string[] {
  if (!fs.existsSync(SITEMAP_JSON)) {
    console.error(`❌ ${SITEMAP_JSON} not found — run download-thomann-sitemap.ts first`)
    process.exit(1)
  }
  const urls = JSON.parse(fs.readFileSync(SITEMAP_JSON, 'utf8')) as string[]
  console.log(`📂 Loaded ${urls.length.toLocaleString()} URLs from thomann-sitemap.json`)
  return urls
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────
function extractFilename(url: string): string | null {
  const m = url.match(/thomann\.dk\/(?:gb\/)?([a-z0-9_]+)\.htm$/i)
  return m ? m[1].toLowerCase() : null
}

function nameToWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

type SitemapEntry = { url: string; parts: Set<string>; fnLen: number }

function buildEntryList(urls: string[]): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  for (const url of urls) {
    const fn = extractFilename(url)
    if (!fn) continue
    if (BUNDLE_RE.test(fn)) continue
    entries.push({ url, parts: new Set(fn.split('_')), fnLen: fn.length })
  }
  return entries
}

type MatchResult = { url: string; score: number }

function bestMatch(words: string[], entries: SitemapEntry[]): MatchResult | null {
  let best: MatchResult | null = null
  let bestFnLen = Infinity

  for (const entry of entries) {
    const matched = words.filter(w => entry.parts.has(w)).length
    const score = matched / words.length
    if (score < MIN_SCORE) continue
    if (best === null || score > best.score || (score === best.score && entry.fnLen < bestFnLen)) {
      best = { url: entry.url, score }
      bestFnLen = entry.fnLen
    }
  }

  return best
}

// ── Supabase ──────────────────────────────────────────────────────────────────
type Product = {
  id: string
  canonical_name: string
}

async function fetchProducts(): Promise<Product[]> {
  const { data: musicGearCategory } = await supabase
    .from('kg_category')
    .select('id')
    .eq('slug', 'music-gear')
    .single()

  if (!musicGearCategory) {
    console.error('❌ Could not find music-gear category')
    process.exit(1)
  }

  const { data, error } = await supabase
    .from('kg_product')
    .select('id, canonical_name')
    .eq('status', 'active')
    .is('thomann_url', null)
    .is('era', null)
    .eq('category_id', musicGearCategory.id)
    .order('canonical_name')

  if (error) {
    console.error('❌ Failed to fetch products:', error.message)
    process.exit(1)
  }

  return (data ?? []) as Product[]
}

async function setThomannUrl(id: string, url: string): Promise<void> {
  const { error } = await supabase
    .from('kg_product')
    .update({ thomann_url: url })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🗺️  Thomann URL Builder')
  if (DRY_RUN) console.log('   (dry run — no DB writes)')
  console.log()

  const urls = loadSitemapUrls()
  const entries = buildEntryList(urls)
  console.log(`   Entry list built — ${entries.length.toLocaleString()} product pages`)
  console.log()

  const products = await fetchProducts()
  console.log(`🔎 Matching ${products.length} products\n`)

  if (products.length === 0) {
    console.log('No products to process. Exiting.')
    return
  }

  let matched = 0
  let unmatched = 0
  let errors = 0

  for (const p of products) {
    const words = nameToWords(p.canonical_name)
    const result = bestMatch(words, entries)

    if (result) {
      const pct = Math.round(result.score * 100)
      console.log(`✓ ${p.canonical_name} (${pct}%)`)
      console.log(`  ${result.url}`)
      matched++
      if (!DRY_RUN) {
        try {
          await setThomannUrl(p.id, result.url)
        } catch (err) {
          console.error(`  ❌ DB error: ${(err as Error).message}`)
          errors++
        }
      }
    } else {
      console.log(`✗ ${p.canonical_name}`)
      unmatched++
    }
  }

  console.log()
  console.log('─'.repeat(50))
  console.log(`✅ Done — ${products.length} processed`)
  console.log(`   Matched:   ${matched}`)
  console.log(`   Unmatched: ${unmatched}`)
  if (errors > 0) console.log(`   DB errors: ${errors}`)
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${(err as Error).message ?? err}`)
  process.exit(1)
})
