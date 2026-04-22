import * as cheerio from 'cheerio'
import type { Listing } from '../supabase'
import { normalizeQuery } from '../query-normalizer'
import { lookupSynonym } from '../synonyms'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export type SchibstedConfig = {
  host: string
  source: string
  currency: string
  acceptLanguage: string
}

export const DBA_CONFIG: SchibstedConfig = {
  host: 'www.dba.dk',
  source: 'dba.dk',
  currency: 'DKK',
  acceptLanguage: 'da-DK,da;q=0.9',
}

export const FINN_CONFIG: SchibstedConfig = {
  host: 'www.finn.no',
  source: 'finn',
  currency: 'NOK',
  acceptLanguage: 'nb-NO,nb;q=0.9',
}

export const BLOCKET_CONFIG: SchibstedConfig = {
  host: 'www.blocket.se',
  source: 'blocket',
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
): Promise<ScrapedListing[]> {
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

  const mainEntity = collectionPage?.['mainEntity'] as Record<string, unknown> | undefined
  const itemListElement = mainEntity?.['itemListElement'] as unknown[] | undefined

  if (!itemListElement?.length) return []

  return itemListElement
    .map((entry): ScrapedListing | null => {
      const product = (entry as Record<string, unknown>)['item'] as Record<string, unknown> | undefined
      if (!product?.['url'] || !product?.['name']) return null

      const offers = product['offers'] as Record<string, unknown> | undefined
      const rawPrice = offers?.['price']
      const price = rawPrice ? parseInt(String(rawPrice), 10) : null

      return {
        title: String(product['name']),
        price: price !== null && !isNaN(price) ? price : null,
        currency: String(offers?.['priceCurrency'] ?? config.currency),
        url: String(product['url']),
        image_url: product['image'] ? String(product['image']) : null,
        location: null,
        source: config.source,
      }
    })
    .filter((l): l is ScrapedListing => l !== null)
}

async function fetchSchibstedSearch(
  config: SchibstedConfig,
  normalizedQ: string,
  maxPages: number,
): Promise<ScrapedListing[]> {
  const all: ScrapedListing[] = []
  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await delay(1000)
    const pageResults = await fetchSchibstedPage(config, normalizedQ, page)
    if (pageResults.length === 0) break
    all.push(...pageResults)
  }
  return all
}

export async function scrapeSchibsted(
  config: SchibstedConfig,
  query: string,
  maxPages = 1,
): Promise<ScrapedListing[]> {
  const normalized = normalizeQuery(query)

  const queries: string[] = [normalized]

  const dehyphenated = normalized.replace(/-/g, '')
  if (dehyphenated !== normalized) queries.push(dehyphenated)

  const synonym = lookupSynonym(normalized)
  if (synonym) queries.push(normalizeQuery(synonym))

  const all: ScrapedListing[] = []
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await delay(2000)
    try {
      const results = await fetchSchibstedSearch(config, queries[i], maxPages)
      all.push(...results)
    } catch {
      // ignore individual query failures, try the next variant
    }
  }

  const seen = new Set<string>()
  return all.filter((l) => {
    const id = extractListingId(l.url)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
