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
 *   - Marks listings not seen for STALE_AFTER_DAYS inactive (complete runs only)
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
import { monitoredSlugs, assertResolved } from './lib/source-monitoring'
// Price extraction is shared verbatim with frontend/lib/scrapers/kleinanzeigen.ts.
// This script is the PM2 writer, so a parser fix that lands only in the frontend
// module changes no stored row — which is exactly how the welded-pair shape
// survived its own 2026-05 diagnosis.
import {
  extractCardPriceOutcome,
  mayReplaceStoredPrice,
  recordPriceOutcome,
  recordWriteGateRefusal,
  type PriceReason,
} from '../frontend/lib/scrapers/kleinanzeigen-price'
import { extractCardLocation } from '../frontend/lib/scrapers/kleinanzeigen-location'
import {
  classifyKleinanzeigenPrice,
  recoverKleinanzeigenPrice,
} from '../frontend/lib/listing-price-integrity'
import { matchScrapedBatch, reportBatchMatch, newIngestionBatchId, fetchBatchListingIds } from './lib/match-new-inflow'
import { decodeHtmlEntities } from '../frontend/lib/html-entities'
import { coverageIsComplete, evaluateRun, startRun, finishRun, type ListingSample } from './lib/scrape-health'
import { baselineNotAttempted } from './lib/baseline'

/**
 * Per-run price tally, emitted once at the end of the run.
 *
 * Every refusal reason is counted here on the same terms, including
 * `no_price_stated`, which the removed per-advert warning excluded entirely.
 *
 * This REPLACES that warning rather than supplementing it. The retained PM2
 * error log holds 8,455 `price_rejected` lines, each carrying a listing URL —
 * an unbounded log that also put listing identity into an operational channel,
 * both of which this ticket forbids. The aggregate already holds every reason
 * the per-advert line reported, so nothing is lost by deleting it.
 */
const priceTally: Record<string, number> = {}

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
// A targeted run (--product / --limit) looks at a subset, so it must never
// conclude that a listing outside that subset is gone. Same rule as scrape-dba.
const RUN_SCOPE: 'complete' | 'targeted' =
  productFilter === null && LIMIT === Infinity ? 'complete' : 'targeted'

/**
 * A listing not seen for this long, by a run that looked at everything, is no
 * longer counted as active (PAN-150).
 *
 * Chosen from production data (2026-09-25, read-only). The job runs daily. Of
 * the rows last seen 1, 2, 3 and 4 runs before the latest, the counts are
 * 114, 113, 141 and 150 — the same range as the 88–173 (mean 131) last seen on
 * each of the 18 outage nights before them. If missed rows routinely came
 * back, the youngest buckets would be inflated by rows still due to return;
 * they are not, so waiting longer recovers almost nothing and keeps ~130 gone
 * rows per extra day counted as active. Three days is also three consecutive
 * daily misses, the threshold scrape-dba applies (DELIST_AFTER_MISSES).
 *
 * Reversible by construction: a re-seen row is upserted with is_active: true.
 */
const STALE_AFTER_DAYS = 3

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
  /** Why `price` is null, when it is. Decides whether a stored price may be replaced. */
  priceReason: PriceReason | null
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


  const imageUrl = extractAttr(articleHtml, /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i)
  const location = extractCardLocation(articleHtml)

  /**
   * Price, with the reason when there is none.
   *
   * The outcome is COUNTED, never logged per advert, so a parser regression is
   * visible in the run's own output instead of arriving weeks later as a wrong
   * number on a product page. Nothing identifying leaves this line: the tally
   * takes static reason codes as keys and nothing else.
   */
  const priceOutcome = extractCardPriceOutcome(articleHtml)
  recordPriceOutcome(priceTally, priceOutcome)
  const price = priceOutcome.value

  return {
    title,
    price,
    priceReason: priceOutcome.reason,
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
): Promise<{ listings: ScrapedListing[]; requestFailed: boolean }> {
  const normalized = normalizeQuery(query)

  const queries: string[] = [normalized]

  const dehyphenated = normalized.replace(/-/g, '')
  if (dehyphenated !== normalized) queries.push(dehyphenated)

  const all: ScrapedListing[] = []
  // A failed variant is still skipped, but no longer silently: the stale sweep
  // may only infer "gone" from a product whose every request succeeded.
  let requestFailed = false
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(VARIANT_DELAY_MS)
    try {
      const results = await fetchKleinanzeigenSearch(queries[i], maxPages)
      all.push(...results)
    } catch {
      requestFailed = true
    }
  }

  const seen = new Set<string>()
  const listings = all.filter((listing) => {
    const id = extractListingId(listing.url)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  return { listings, requestFailed }
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

/**
 * Explicit marketplace-monitoring set for 'kleinanzeigen', from
 * data/klup-source-monitoring.json. This scraper no longer selects on
 * kg_product.tier: tier is an EDITORIAL classification, and using it as a
 * query selector meant an editorial promotion silently widened monitoring.
 */
const MONITORED_SLUGS = monitoredSlugs('kleinanzeigen')

async function loadProducts(): Promise<Array<{ id: string; canonical_name: string; brand_name: string; query: string }>> {
  const { data, error } = await supabase
    .from('kg_product')
    .select('id, slug, canonical_name, kg_brand!inner(name)')
    .in('slug', MONITORED_SLUGS)
    .eq('status', 'active')
    .order('canonical_name')

  if (error) {
    console.error(`❌ Failed to load kg_product: ${error.message}`)
    process.exit(1)
  }
  // Fail loud: a configured product that no longer resolves would silently
  // shrink 'kleinanzeigen' coverage.
  assertResolved('kleinanzeigen', MONITORED_SLUGS, ((data ?? []) as Array<{ slug?: string }>).map(r => r.slug ?? ''))


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

/** Refuse an implausible price at the write boundary; never alter identity. */
function guardedPrice(price: number | null): number | null {
  if (price == null) return null
  // Defence in depth: the parser already separates a discount pair, but this
  // boundary must reach the same answer on its own or the two could diverge.
  const recovered = recoverKleinanzeigenPrice(price)
  const verdict = classifyKleinanzeigenPrice(recovered.value)
  if (verdict.ok) return recovered.value
  // Counted, not logged per advert: this boundary carried a listing URL too,
  // and it fired 0 times in the measured run — invisible volume, real leak.
  recordWriteGateRefusal(priceTally, verdict.reason ?? 'above_impossible_bound')
  return null
}

function buildRows(listings: ScrapedListing[]) {
  /**
   * Last gate before the upsert.
   *
   * The parser already refuses an implausible value, but this row shape is also
   * reachable from the detail-page path and from a future caller, and a wrong
   * price is the one defect that is believed downstream: it enters the admin
   * queue, the public band and the price history. The guard is applied at the
   * write boundary as well as at the parse boundary, on purpose — identity,
   * timestamps and the `external_id` conflict target are untouched, only the
   * price field is neutralised.
   */
  const built = listings.map((listing) => {
    // Guarded ONCE per listing. Two calls charged the run tally twice for the
    // same refusal, so the count the aggregate exists to report would be double
    // the truth.
    const price = guardedPrice(listing.price)
    const row = {
      title: listing.title,
      price,
      currency: listing.currency,
      url: listing.url,
      image_url: listing.image_url,
      location: listing.location,
      source: listing.source,
      country: listing.country,
      price_dkk: price != null ? listing.price_dkk ?? null : null,
      scraped_at: new Date().toISOString(),
      watchlist_id: null,
      normalized_text: normalizeText(listing.title),
      external_id: listing.url,
      is_active: true,
      platform: 'kleinanzeigen',
    }
    return { row, replacesPrice: mayReplaceStoredPrice(price, listing.priceReason) }
  })

  return {
    replacing: built.filter(b => b.replacesPrice).map(b => b.row),
    // A failure to read is not an observation: these rows carry no price column
    // at all, so a stored price survives and a new row is inserted without one.
    keeping: built
      .filter(b => !b.replacesPrice)
      .map(({ row: { price: _price, price_dkk: _priceDkk, ...withoutPrice } }) => withoutPrice),
  }
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

  /**
   * One `scrape_run` row per run (PAN-150).
   *
   * The price-outcome tally used to exist only in the PM2 log on the Mac Mini,
   * so 18 nights of 100% null prices were invisible from production data. The
   * row carries the tally in `notes` and the quality gate's verdict in
   * `status`. For this source the verdict is RECORDED, not enforced: rows are
   * upserted directly, with no staging or promotion, so `quarantined` here
   * excludes nothing. `startRun` logs its own failure; the scrape still runs.
   */
  const run = await startRun(supabase, 'kleinanzeigen')

  // One immutable identity for this execution, generated before any write.
  const ingestionBatchId = newIngestionBatchId()
  let scrapedProducts = 0
  let totalListings = 0
  let failedProducts = 0
  const samples: ListingSample[] = []
  // One of requestsOk / requestFailures per product, as coverageIsComplete expects.
  const coverage = { requestsOk: 0, requestFailures: 0, writeFailures: 0 }

  for (let i = 0; i < products.length; i++) {
    if (i > 0) await sleep(PRODUCT_DELAY_MS)

    const product = products[i]
    const { listings, requestFailed } = await scrapeKleinanzeigen(product.query, 3)
    if (requestFailed) {
      coverage.requestFailures += 1
      failedProducts += 1
    } else {
      coverage.requestsOk += 1
    }
    const { replacing, keeping } = buildRows(listings)
    const rowCount = replacing.length + keeping.length
    for (const r of [...replacing, ...keeping.map(k => ({ ...k, price: null, price_dkk: null }))]) {
      samples.push({
        external_id: r.external_id, url: r.url, title: r.title,
        price: r.price, currency: r.currency, price_dkk: r.price_dkk,
      })
    }

    if (rowCount > 0) {
      // Every INSERT carries this run's identity. On conflict the database
      // trigger preserves the row's ORIGINAL identity, so a refreshed
      // historical row keeps its old (or NULL) value and is not new inflow.
      //
      // Two statements, not one: PostgREST writes every column that ANY row in
      // a batch carries, so a row without `price` inside a batch that has it
      // would be written NULL. A statement that never sends the column cannot
      // touch it — the technique scripts/lib/reverb-category-seed.ts uses to
      // protect name_da.
      const upsert = (batch: object[]) => supabase
        .from('listings')
        .upsert(batch.map(r => ({ ...r, ingestion_batch_id: ingestionBatchId })), {
          onConflict: 'external_id,source',
          ignoreDuplicates: false,
        })
      let error = replacing.length > 0 ? (await upsert(replacing)).error : null
      if (!error && keeping.length > 0) error = (await upsert(keeping)).error

      if (error) {
        console.error(`[scrape-kleinanzeigen] ${product.canonical_name}: upsert failed (${error.message})`)
        coverage.writeFailures += 1
        if (!requestFailed) failedProducts += 1
        continue
      }

    }

    scrapedProducts += 1
    totalListings += rowCount
    console.log(`[scrape-kleinanzeigen] ${product.canonical_name}: ${rowCount} listings upserted`)
  }

  console.log(`[scrape-kleinanzeigen] Done. ${scrapedProducts} products scraped, ${totalListings} listings total.`)

  // The distribution by reason, readable straight from one normal run's log.
  console.log(
    JSON.stringify({
      channel: 'operational',
      component: 'scrape-kleinanzeigen',
      event: 'price_outcome_summary',
      source: 'kleinanzeigen',
      ...priceTally,
    }),
  )

  // Only rows the DATABASE says this run inserted. A null lookup => 0 writes.
  const inserted = await fetchBatchListingIds(supabase, 'kleinanzeigen', ingestionBatchId)

  // Closed before matching, so a matcher failure cannot leave the run open.
  const newListings = inserted?.length ?? 0
  const counters = {
    productsAttempted: products.length,
    productsFailed: failedProducts,
    listingsFetched: samples.length,
    listingsSaved: totalListings,
    newListings,
    // Not measured: the upsert does not report which rows changed price.
    priceChanges: 0,
    refoundListings: Math.max(totalListings - newListings, 0),
  }
  const { status, violations, metrics } = evaluateRun(
    samples,
    counters,
    // No cohort identity is stamped for this source, so no baseline applies.
    baselineNotAttempted('cohort_identity_incomplete'),
  )

  /**
   * Stale sweep — the rule scrape-reverb applies, with the same precondition.
   *
   * "Not seen" is an inference about the SOURCE, valid only if this run looked
   * at everything: every monitored product (no --product / --limit), every
   * request answered, every write accepted. A `failed` verdict is untrusted for
   * lifecycle by scrape-health's own rule, and a run that found almost nothing
   * is more likely a markup change than an empty market — sweeping after it
   * would deactivate the whole source.
   */
  let delisted = 0
  const sweepAllowed =
    RUN_SCOPE === 'complete' &&
    status !== 'failed' &&
    !violations.some(v => v.code === 'suspiciously_low_volume') &&
    coverageIsComplete({ eligible: products.length, ...coverage })
  if (!sweepAllowed) {
    console.log('[scrape-kleinanzeigen] Skipping stale sweep: incomplete or untrusted run, so absence proves nothing.')
  } else {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { error: staleError, count } = await supabase
      .from('listings')
      .update({ is_active: false }, { count: 'exact' })
      .eq('source', 'kleinanzeigen')
      .eq('is_active', true)
      .lt('scraped_at', cutoff)
    if (staleError) {
      console.error(`[scrape-kleinanzeigen] Stale sweep failed (${staleError.message})`)
    } else {
      delisted = count ?? 0
      console.log(`[scrape-kleinanzeigen] Stale sweep: ${delisted} not seen for ${STALE_AFTER_DAYS} days marked inactive.`)
    }
  }

  await finishRun(
    supabase, run?.id ?? null, status, counters, metrics, violations, delisted,
    // Static reason codes and counts only — the same payload as the log line.
    JSON.stringify(priceTally),
  )

  // Bounded new-inflow matching: only the ids this run just wrote. Runs after
  // the writes complete and never changes this script's exit status.
  reportBatchMatch(inserted === null
    ? { source: 'kleinanzeigen', considered: 0, matched: 0, rejected: 0, deferred: 0, skipped: 'batch_identity_lookup_failed' }
    : await matchScrapedBatch(supabase, 'kleinanzeigen', inserted))
}

main().catch((error) => {
  console.error('❌ scrape-kleinanzeigen failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
