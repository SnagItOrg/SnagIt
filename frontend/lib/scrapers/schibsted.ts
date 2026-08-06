import * as cheerio from 'cheerio'
import type { Listing } from '../supabase'
import { normalizeQuery } from '../query-normalizer'
import { lookupSynonym } from '../synonyms'
import { toDkkApprox } from '../currency'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export type SchibstedConfig = {
  host: string
  source: string
  country: string
  currency: string
  acceptLanguage: string
}

export const DBA_CONFIG: SchibstedConfig = {
  host: 'www.dba.dk',
  source: 'dba.dk',
  country: 'DK',
  currency: 'DKK',
  acceptLanguage: 'da-DK,da;q=0.9',
}

export const FINN_CONFIG: SchibstedConfig = {
  host: 'www.finn.no',
  source: 'finn',
  country: 'NO',
  currency: 'NOK',
  acceptLanguage: 'nb-NO,nb;q=0.9',
}

export const BLOCKET_CONFIG: SchibstedConfig = {
  host: 'www.blocket.se',
  source: 'blocket',
  country: 'SE',
  currency: 'SEK',
  acceptLanguage: 'sv-SE,sv;q=0.9',
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Extract the numeric listing ID from a Schibsted recommerce URL for dedupe.
// New format: /recommerce/forsale/item/1234567
// Old DBA format: /<slug>/id-1234567/
function extractListingId(url: string): string {
  const newFormat = url.match(/\/item\/(\d+)/)
  if (newFormat) return newFormat[1]
  const oldFormat = url.match(/\/id-(\d+)/)
  if (oldFormat) return oldFormat[1]
  return url
}

async function fetchSchibstedPage(
  config: SchibstedConfig,
  normalizedQ: string,
  page: number,
): Promise<{ listings: ScrapedListing[]; schemaValid: boolean; rawCount: number }> {
  // Build URL manually — URLSearchParams encodes * as %2A, breaking wildcard searches
  const q = normalizedQ.replace(/ /g, '+')
  const url = `https://${config.host}/recommerce/forsale/search?q=${q}${page > 1 ? `&page=${page}` : ''}`

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': config.acceptLanguage,
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`${config.host} fetch failed: ${res.status} ${res.statusText}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  let collectionPage: Record<string, unknown> | null = null
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).html() || '')
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>)['@type'] === 'CollectionPage'
      ) {
        collectionPage = parsed as Record<string, unknown>
      }
    } catch {
      // skip malformed scripts
    }
  })

  // A missing/changed schema and a genuinely empty result page both used to
  // return [] here, so a schema break was indistinguishable from exhausted
  // pagination — and would have been treated as terminal `empty_page`.
  // schemaValid=false means "we could not read the page", never "no results".
  if (!collectionPage) {
    return { listings: [], schemaValid: false, rawCount: 0 }
  }
  const mainEntity = collectionPage['mainEntity'] as Record<string, unknown> | undefined
  const itemListElement = mainEntity?.['itemListElement'] as unknown[] | undefined

  if (!Array.isArray(itemListElement)) {
    return { listings: [], schemaValid: false, rawCount: 0 }
  }
  if (itemListElement.length === 0) {
    // Valid schema, genuinely zero results → terminal.
    return { listings: [], schemaValid: true, rawCount: 0 }
  }

  const parsedListings = itemListElement
    .map((entry): ScrapedListing | null => {
      const product = (entry as Record<string, unknown>)['item'] as Record<string, unknown> | undefined
      if (!product?.['url'] || !product?.['name']) return null

      const offers = product['offers'] as Record<string, unknown> | undefined
      const rawPrice = offers?.['price']
      const parsed = rawPrice ? parseInt(String(rawPrice), 10) : null
      const price = parsed !== null && !isNaN(parsed) ? parsed : null
      const currency = String(offers?.['priceCurrency'] ?? config.currency)

      return {
        title: String(product['name']),
        price,
        currency,
        country: config.country,
        // Convert here, not only in the API route. The cron scrapers
        // (scrape-dba/finn/blocket) write straight to `listings` and were
        // persisting NULL price_dkk for every NOK/SEK row, which made the
        // NO and SE markets invisible to /intel's arbitrage medians.
        price_dkk: price != null ? toDkkApprox(price, currency) : null,
        url: String(product['url']),
        image_url: product['image'] ? String(product['image']) : null,
        location: null,
        source: config.source,
      }
    })
    .filter((l): l is ScrapedListing => l !== null)

  return { listings: parsedListings, schemaValid: true, rawCount: itemListElement.length }
}

/**
 * Why pagination termination must be reported, not inferred:
 * exiting because `page > maxPages` means MORE listings may exist that we
 * never saw. Treating that as complete coverage would let a truncated run
 * establish a false universe, and repeated truncation could then fabricate
 * mass delistings. Only 'empty_page' proves we reached the end.
 */
export type TerminationReason =
  | 'empty_page'      // terminal: pagination genuinely exhausted
  | 'no_next_token'   // terminal
  | 'known_last_page' // terminal
  | 'max_pages_hit'   // NON-terminal: more may exist
  | 'error'           // NON-terminal
  | 'unknown'         // NON-terminal

export interface QueryCoverage {
  query: string
  queryStarted: boolean
  queryCompleted: boolean
  pagesFetched: number
  terminationReason: TerminationReason
  rawCount: number
  parsedCount: number
  parseErrorCount: number
  paginationTokens: number[]
}

async function fetchSchibstedSearch(
  config: SchibstedConfig,
  normalizedQ: string,
  maxPages: number,
): Promise<{ listings: ScrapedListing[]; coverage: QueryCoverage }> {
  const all: ScrapedListing[] = []
  const pages: number[] = []
  const seenPageSignatures = new Set<string>()
  let termination: TerminationReason = 'unknown'
  let completed = false
  let pagesFetched = 0
  let rawTotal = 0

  // Pagination runs to DOCUMENTED EXHAUSTION. maxPages is a fuse against a
  // runaway loop, never a success signal: hitting it means listings may exist
  // that we never saw, which cannot support delisting.
  let page = 1
  for (; page <= maxPages; page++) {
    if (page > 1) await delay(1000)

    let pageRes: { listings: ScrapedListing[]; schemaValid: boolean; rawCount: number }
    try {
      pageRes = await fetchSchibstedPage(config, normalizedQ, page)
    } catch {
      // Never swallowed: a failed page is not an exhausted one.
      termination = 'error'
      completed = false
      break
    }

    pagesFetched++
    pages.push(page)
    rawTotal += pageRes.rawCount

    // HTTP 200 with an unreadable schema is an ERROR, never a valid empty
    // page — a site redesign must not look like "everything sold".
    //
    // But absence of the schema is ambiguous on its own: Schibsted omits the
    // CollectionPage block entirely on a past-the-end page. Page 1 resolves
    // the ambiguity — if it parsed, the parser matches the current site, so a
    // later page without the block means "no more results" (terminal). If
    // page 1 itself is unreadable, the contract is genuinely broken (error).
    if (!pageRes.schemaValid) {
      if (page === 1) {
        termination = 'error'      // parser no longer matches the site
        completed = false
        break
      }
      // no_next_token is an INFERENCE, not proof: an intermittently missing
      // schema block (load, partial blocking) is indistinguishable from being
      // past the last page. Re-fetch the same page after a jittered pause and
      // require the same answer. Disagreement means the signal is unstable,
      // so the query cannot support lifecycle coverage.
      await delay(2000 + Math.random() * 2000)
      let recheck: { listings: ScrapedListing[]; schemaValid: boolean; rawCount: number }
      try {
        recheck = await fetchSchibstedPage(config, normalizedQ, page)
      } catch {
        termination = 'error'
        completed = false
        break
      }
      pagesFetched++
      if (!recheck.schemaValid || recheck.rawCount === 0) {
        termination = 'no_next_token'  // reproduced → genuinely past the end
        completed = true
      } else {
        termination = 'error'          // page came back with data → unstable
        completed = false
      }
      break
    }

    if (pageRes.rawCount === 0) {
      // Valid schema, genuinely zero results → exhausted.
      termination = 'empty_page'
      completed = true
      break
    }

    // Repeated identical page = pagination is looping, not advancing.
    const signature = pageRes.listings.map(r => r.url).join('|')
    if (seenPageSignatures.has(signature)) {
      termination = 'error'
      completed = false
      break
    }
    seenPageSignatures.add(signature)

    all.push(...pageRes.listings)
  }

  if (!completed && termination === 'unknown') {
    // Ran out of fuse rather than out of results.
    termination = 'max_pages_hit'
    completed = true // ended in a controlled way, but coverage is NOT proven
  }

  return {
    listings: all,
    coverage: {
      query: normalizedQ,
      queryStarted: true,
      queryCompleted: completed,
      pagesFetched,
      terminationReason: termination,
      rawCount: rawTotal,
      parsedCount: all.length,
      parseErrorCount: Math.max(0, rawTotal - all.length),
      paginationTokens: pages,
    },
  }
}

/**
 * Coverage-reporting variant. Returns the same listings as scrapeSchibsted
 * plus per-query pagination evidence, so a caller can decide whether the run
 * is complete enough to support lifecycle decisions (delisting).
 */
export async function scrapeSchibstedWithCoverage(
  config: SchibstedConfig,
  query: string,
  maxPages = 1,
): Promise<{ listings: ScrapedListing[]; coverage: QueryCoverage[] }> {
  const normalized = normalizeQuery(query)

  const queries: string[] = [normalized]
  const dehyphenated = normalized.replace(/-/g, '')
  if (dehyphenated !== normalized) queries.push(dehyphenated)
  const synonym = lookupSynonym(normalized)
  if (synonym) queries.push(normalizeQuery(synonym))

  const all: ScrapedListing[] = []
  const coverage: QueryCoverage[] = []

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await delay(2000)
    // Failures are RECORDED, never swallowed: a failed variant must be
    // distinguishable from a variant that legitimately found nothing.
    const res = await fetchSchibstedSearch(config, queries[i], maxPages)
    all.push(...res.listings)
    coverage.push(res.coverage)
  }

  const seen = new Set<string>()
  const deduped = all.filter((l) => {
    const id = extractListingId(l.url)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  return { listings: deduped, coverage }
}

export async function scrapeSchibsted(
  config: SchibstedConfig,
  query: string,
  maxPages = 1,
): Promise<ScrapedListing[]> {
  const { listings } = await scrapeSchibstedWithCoverage(config, query, maxPages)
  return listings
}
