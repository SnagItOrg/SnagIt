/**
 * scripts/build-thomann-urls.ts
 *
 * Downloads the Thomann DK sitemap, matches each kg_product slug to a sitemap
 * URL, and writes thomann_url back to the database.
 *
 * Strategy:
 *   1. Fetch https://www.thomann.dk/sitemap3.xml.gz (static, no Cloudflare block)
 *   2. Parse <loc> URLs, filter out bundle/pack/set/kit pages
 *   3. Build a prefix index:  boss_rv_500 → ["boss_rv_500_reverb.htm", ...]
 *   4. For each kg_product without thomann_url, look up slug prefix in index
 *   5. Pick the shortest matching URL (most specific product page)
 *   6. Upsert thomann_url — leaves thomann_price_dkk untouched (fetch script handles that)
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
const SITEMAP_URL = 'https://www.thomann.dk/sitemap3.xml.gz'
const THOMANN_BASE = 'https://www.thomann.dk'

// Patterns that indicate a bundle/set/pack — not individual products
const BUNDLE_RE = /[_-](bundle|pack|set|kit|rig|starter|combo|value|deal)\b/i

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Sitemap download + parse ──────────────────────────────────────────────────
async function fetchSitemapUrls(): Promise<string[]> {
  console.log(`📥 Fetching sitemap: ${SITEMAP_URL}`)

  const res = await fetch(SITEMAP_URL, {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' },
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) throw new Error(`Sitemap fetch failed: HTTP ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())

  // Decompress gzip
  const xml = await new Promise<string>((resolve, reject) => {
    zlib.gunzip(buf, (err, result) => {
      if (err) reject(err)
      else resolve(result.toString('utf8'))
    })
  })

  // Extract all <loc> values
  const urls: string[] = []
  const locRe = /<loc>([^<]+)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = locRe.exec(xml)) !== null) {
    urls.push(m[1].trim())
  }

  console.log(`   Found ${urls.length.toLocaleString()} URLs in sitemap`)
  return urls
}

// ── Build prefix index ────────────────────────────────────────────────────────
// Map: "boss_rv_500" → ["https://www.thomann.dk/boss_rv_500_reverb.htm", ...]
function buildPrefixIndex(urls: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()

  for (const url of urls) {
    // Only process .htm product pages on the DK domain
    const parsed = extractFilename(url)
    if (!parsed) continue
    if (BUNDLE_RE.test(parsed)) continue

    // Build progressively shorter prefixes so we can find a match even if
    // the slug has fewer words than the Thomann filename.
    // e.g. "boss_rv_500_reverb" → prefixes: ["boss_rv_500_reverb", "boss_rv_500", "boss_rv", "boss"]
    const parts = parsed.split('_')
    for (let len = parts.length; len >= 1; len--) {
      const prefix = parts.slice(0, len).join('_')
      if (!index.has(prefix)) index.set(prefix, [])
      index.get(prefix)!.push(url)
    }
  }

  return index
}

function extractFilename(url: string): string | null {
  // Match bare domain or /gb/ variant: thomann.dk/foo.htm or thomann.dk/gb/foo.htm
  const m = url.match(/thomann\.dk\/(?:gb\/)?([a-z0-9_]+)\.htm$/i)
  return m ? m[1].toLowerCase() : null
}

// ── Slug → best URL ───────────────────────────────────────────────────────────
function slugToPrefix(slug: string): string {
  return slug.replace(/-/g, '_').toLowerCase()
}

function bestMatch(prefix: string, index: Map<string, string[]>): string | null {
  // Try the full prefix first, then drop trailing segments until we get a match.
  const parts = prefix.split('_')
  for (let len = parts.length; len >= 2; len--) {
    const key = parts.slice(0, len).join('_')
    const candidates = index.get(key)
    if (!candidates || candidates.length === 0) continue

    // Filter to URLs whose filename actually *starts with* this prefix
    // (not just index entries that happen to share a short prefix)
    const exact = candidates.filter(url => {
      const fn = extractFilename(url)
      return fn && fn.startsWith(key)
    })
    if (exact.length === 0) continue

    // Among matches, prefer the shortest filename (closest to product page, not variant page)
    exact.sort((a, b) => {
      const fa = extractFilename(a)!
      const fb = extractFilename(b)!
      return fa.length - fb.length
    })
    return exact[0]
  }
  return null
}

// ── Supabase ──────────────────────────────────────────────────────────────────
type Product = {
  id: string
  slug: string
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

  // Fetch all active music-gear products without thomann_url, non-vintage
  const { data, error } = await supabase
    .from('kg_product')
    .select('id, slug, canonical_name')
    .eq('status', 'active')
    .is('thomann_url', null)
    .is('era', null)
    .eq('category_id', musicGearCategory.id)
    .order('slug')

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

  const urls = await fetchSitemapUrls()
  const index = buildPrefixIndex(urls)
  console.log(`   Index built — ${index.size.toLocaleString()} prefix entries`)
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
    const prefix = slugToPrefix(p.slug)
    const url = bestMatch(prefix, index)

    if (url) {
      console.log(`✓ ${p.canonical_name}`)
      console.log(`  ${url}`)
      matched++
      if (!DRY_RUN) {
        try {
          await setThomannUrl(p.id, url)
        } catch (err) {
          console.error(`  ❌ DB error: ${(err as Error).message}`)
          errors++
        }
      }
    } else {
      console.log(`✗ ${p.canonical_name} (slug: ${p.slug})`)
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
