/**
 * scripts/scrape-kleinanzeigen.ts
 *
 * Fetches Kleinanzeigen.de listings for legendary knowledge-graph products
 * and upserts them into the Supabase listings table.
 *
 * Features:
 *   - Reads active legendary products from kg_product + kg_brand
 *   - Scrapes category search pages directly in this script
 *   - Conservative 3s rate limiting between products
 *   - Upserts on external_id + source using listing.url as the stable key
 *
 * Usage:
 *   npx tsx scripts/scrape-kleinanzeigen.ts
 *   npx tsx scripts/scrape-kleinanzeigen.ts --limit=5
 *   npx tsx scripts/scrape-kleinanzeigen.ts --product="juno 60"
 */

import * as path from 'path'
import * as fs from 'fs'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'

// Resolve Supabase from the frontend workspace because that is where the
// installed dependency lives on this machine.
const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

// ── Load env ─────────────────────────────────────────────────────────────────
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

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity
const productFilter = args.find(a => a.startsWith('--product='))?.split('=')[1]?.toLowerCase() ?? null

// ── Rate limiting ────────────────────────────────────────────────────────────
const PRODUCT_DELAY_MS = 3000
const PAGE_DELAY_MS = 1000
const VARIANT_DELAY_MS = 2000

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[àáâã]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ýÿ]/g, 'y')
    .replace(/ñ/g, 'n')
    .replace(/ç/g, 'c')
    .replace(/ß/g, 'ss')
    .replace(/ö/g, 'oe')
    .replace(/ä/g, 'ae')
    .replace(/[^a-z0-9æøå\-* ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toDkkApprox(price: number, currency: string): number | null {
  const rates: Record<string, number> = {
    DKK: 1.0,
    EUR: 7.45,
  }
  const rate = rates[currency.toUpperCase()]
  if (!rate) return null
  return Math.round(price * rate)
}

type ScrapedListing = {
  title: string
  price: number | null
  currency: 'EUR'
  url: string
  image_url: string | null
  location: string | null
  source: 'kleinanzeigen'
  country: 'DE'
  price_dkk: number | null
}

function buildKleinanzeigenUrl(normalizedQ: string, page: number): string {
  const q = normalizedQ.replace(/ /g, '+')
  const baseUrl = `https://www.kleinanzeigen.de/s-musikinstrumente/${q}/k0c74`
  return page > 1 ? `${baseUrl}?pageNum=${page}` : baseUrl
}

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/VB|€|\./g, '').trim()
  const n = parseInt(cleaned.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) || n === 0 ? null : n
}

function absolutizeUrl(url: string | undefined): string | null {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return `https://www.kleinanzeigen.de${url}`
  return `https://www.kleinanzeigen.de/${url}`
}

function extractListingId(url: string): string {
  const match = url.match(/\/(\d+)\/?$/)
  if (match) return match[1]
  return url
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&uuml;/g, 'ü')
    .replace(/&ouml;/g, 'ö')
    .replace(/&auml;/g, 'ä')
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFirst(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    const value = match?.[1] ? stripTags(match[1]) : null
    if (value) return value
  }
  return null
}

function extractAttr(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern)
  if (!match?.[1]) return null
  return decodeHtmlEntities(match[1]).trim()
}

function extractArticles(html: string): string[] {
  return Array.from(
    html.matchAll(/<article\b[^>]*\bdata-adid\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/article>/gi),
    (match) => match[0],
  )
}

function parseArticle(articleHtml: string): ScrapedListing | null {
  const title = extractFirst(articleHtml, [
    /<[^>]*class=["'][^"']*cardTitle[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<a\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    /<(?:h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h2|h3)>/i,
  ])

  const href = extractAttr(articleHtml, /<a\b[^>]*href=["']([^"']*\/s-anzeige\/[^"']+)["'][^>]*>/i)
  const url = absolutizeUrl(href ?? undefined)

  if (!title || !url) return null

  const rawPrice = extractFirst(articleHtml, [
    /<[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  ]) ?? ''

  const imageUrl = extractAttr(articleHtml, /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i)
  const location = extractFirst(articleHtml, [
    /<[^>]*class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<[^>]*class=["'][^"']*aditem-main--top--left[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  ])

  const price = rawPrice ? parsePrice(rawPrice) : null

  return {
    title,
    price,
    currency: 'EUR',
    url,
    image_url: imageUrl,
    location,
    source: 'kleinanzeigen',
    country: 'DE',
    price_dkk: price != null ? toDkkApprox(price, 'EUR') : null,
  }
}

async function fetchKleinanzeigenPage(
  normalizedQ: string,
  page: number,
): Promise<ScrapedListing[]> {
  const url = buildKleinanzeigenUrl(normalizedQ, page)

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'de-DE,de;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
    },
  })

  if (!res.ok) {
    throw new Error(`kleinanzeigen fetch failed: ${res.status} ${res.statusText}`)
  }

  const html = await res.text()
  const articles = extractArticles(html)
  if (articles.length === 0) return []

  return articles
    .map(parseArticle)
    .filter((listing): listing is ScrapedListing => listing !== null)
}

async function fetchKleinanzeigenSearch(
  normalizedQ: string,
  maxPages: number,
): Promise<ScrapedListing[]> {
  const all: ScrapedListing[] = []
  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await sleep(PAGE_DELAY_MS)
    const pageResults = await fetchKleinanzeigenPage(normalizedQ, page)
    if (pageResults.length === 0) break
    all.push(...pageResults)
  }
  return all
}

async function scrapeKleinanzeigen(
  query: string,
  maxPages = 3,
): Promise<ScrapedListing[]> {
  const normalized = normalizeQuery(query)

  const queries: string[] = [normalized]

  const dehyphenated = normalized.replace(/-/g, '')
  if (dehyphenated !== normalized) queries.push(dehyphenated)

  const all: ScrapedListing[] = []
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(VARIANT_DELAY_MS)
    try {
      const results = await fetchKleinanzeigenSearch(queries[i], maxPages)
      all.push(...results)
    } catch {
      // ignore individual query failures, try the next variant
    }
  }

  const seen = new Set<string>()
  return all.filter((listing) => {
    const id = extractListingId(listing.url)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

type ProductRow = {
  id: string
  canonical_name: string
  kg_brand: { name: string } | { name: string }[] | null
}

function resolveBrandName(brand: ProductRow['kg_brand']): string | null {
  if (!brand) return null
  if (Array.isArray(brand)) return brand[0]?.name ?? null
  return brand.name ?? null
}

function buildSearchQuery(brandName: string, canonicalName: string): string {
  const canonical = canonicalName.trim()
  const brand = brandName.trim()
  if (canonical.toLowerCase().startsWith(brand.toLowerCase())) {
    return canonical
  }
  return `${brand} ${canonical}`.trim()
}

function normalizeText(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function loadProducts(): Promise<Array<{ id: string; canonical_name: string; brand_name: string; query: string }>> {
  const { data, error } = await supabase
    .from('kg_product')
    .select('id, canonical_name, kg_brand!inner(name)')
    .eq('tier', 'legendary')
    .eq('status', 'active')
    .order('canonical_name')

  if (error) {
    console.error(`❌ Failed to load kg_product: ${error.message}`)
    process.exit(1)
  }

  let products = ((data ?? []) as ProductRow[])
    .map((product) => {
      const brandName = resolveBrandName(product.kg_brand)
      if (!brandName || !product.canonical_name) return null

      return {
        id: product.id,
        canonical_name: product.canonical_name,
        brand_name: brandName,
        query: buildSearchQuery(brandName, product.canonical_name),
      }
    })
    .filter((product): product is { id: string; canonical_name: string; brand_name: string; query: string } => product !== null)

  if (productFilter) {
    products = products.filter((product) => product.canonical_name.toLowerCase().includes(productFilter))
  }

  if (LIMIT !== Infinity) {
    products = products.slice(0, LIMIT)
  }

  return products
}

function buildRows(listings: ScrapedListing[]) {
  return listings.map((listing) => ({
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    url: listing.url,
    image_url: listing.image_url,
    location: listing.location,
    source: listing.source,
    country: listing.country,
    price_dkk: listing.price_dkk ?? null,
    scraped_at: new Date().toISOString(),
    watchlist_id: null,
    normalized_text: normalizeText(listing.title),
    external_id: listing.url,
    is_active: true,
    platform: 'kleinanzeigen',
  }))
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('⚙️  Kleinanzeigen → Listings Table Scraper')
  if (productFilter) console.log(`   Product filter: ${productFilter}`)
  console.log(`   Limit: ${LIMIT === Infinity ? '∞' : LIMIT} products`)
  console.log(`   Rate limit: ${PRODUCT_DELAY_MS}ms between products`)
  console.log()

  const products = await loadProducts()
  if (products.length === 0) {
    console.log('No matching legendary products found. Exiting.')
    return
  }

  console.log(`Loaded ${products.length} legendary products from knowledge graph.\n`)

  let scrapedProducts = 0
  let totalListings = 0

  for (let i = 0; i < products.length; i++) {
    if (i > 0) await sleep(PRODUCT_DELAY_MS)

    const product = products[i]
    const listings = await scrapeKleinanzeigen(product.query, 3)
    const rows = buildRows(listings)

    if (rows.length > 0) {
      const { error } = await supabase
        .from('listings')
        .upsert(rows, {
          onConflict: 'external_id,source',
          ignoreDuplicates: false,
        })

      if (error) {
        console.error(`[scrape-kleinanzeigen] ${product.canonical_name}: upsert failed (${error.message})`)
        continue
      }
    }

    scrapedProducts += 1
    totalListings += rows.length
    console.log(`[scrape-kleinanzeigen] ${product.canonical_name}: ${rows.length} listings upserted`)
  }

  console.log(`[scrape-kleinanzeigen] Done. ${scrapedProducts} products scraped, ${totalListings} listings total.`)
}

main().catch((error) => {
  console.error('❌ scrape-kleinanzeigen failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
