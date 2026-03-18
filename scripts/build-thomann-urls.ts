/**
 * scripts/build-thomann-urls.ts
 *
 * Downloads all 4 Thomann DK sitemaps, fuzzy-matches each kg_product
 * canonical_name to a sitemap URL, and writes thomann_url to the database.
 *
 * Strategy:
 *   1. Fetch sitemap1–4.xml.gz and union all <loc> URLs
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
import * as zlib from 'zlib'
import { createClient } from '@supabase/supabase-js'

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
const SITEMAP_URLS = [
  'https://www.thomann.dk/sitemap1.xml.gz',
  'https://www.thomann.dk/sitemap2.xml.gz',
  'https://www.thomann.dk/sitemap3.xml.gz',
  'https://www.thomann.dk/sitemap4.xml.gz',
]

// Patterns that indicate a bundle/set/pack — not individual products
const BUNDLE_RE = /[_-](bundle|pack|set|kit|rig|starter|combo|value|deal)\b/i

const MIN_SCORE = 0.75

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Sitemap download + parse ──────────────────────────────────────────────────
async function fetchOneSitemap(sitemapUrl: string): Promise<string[]> {
  const name = sitemapUrl.split('/').pop()!
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 403) {
      console.warn(`   ⚠️  ${name} — 403 Forbidden, skipping`)
      return []
    }
    if (!res.ok) {
      console.warn(`   ⚠️  ${name} — HTTP ${res.status}, skipping`)
      return []
    }

    const buf = Buffer.from(await res.arrayBuffer())
    const xml = await new Promise<string>((resolve, reject) => {
      zlib.gunzip(buf, (err, result) => {
        if (err) reject(err)
        else resolve(result.toString('utf8'))
      })
    })

    const urls: string[] = []
    const locRe = /<loc>([^<]+)<\/loc>/g
    let m: RegExpExecArray | null
    while ((m = locRe.exec(xml)) !== null) {
      urls.push(m[1].trim())
    }
    return urls
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    console.warn(`   ⚠️  ${name} — ${msg}, skipping`)
    return []
  }
}

async function fetchAllSitemapUrls(): Promise<string[]> {
  console.log('📥 Fetching Thomann sitemaps…')
  const all: string[] = []
  for (const url of SITEMAP_URLS) {
    const urls = await fetchOneSitemap(url)
    if (urls.length > 0) {
      console.log(`   ${url.split('/').pop()} → ${urls.length.toLocaleString()} URLs`)
    }
    all.push(...urls)
  }
  console.log(`   Total: ${all.length.toLocaleString()} URLs`)
  return all
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

  const urls = await fetchAllSitemapUrls()
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
