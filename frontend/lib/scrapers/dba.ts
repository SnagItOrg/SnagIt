import * as cheerio from 'cheerio'
import type { Listing } from '../supabase'
import { normalizeQuery } from '../query-normalizer'
import { lookupSynonym } from '../synonyms'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

// Extract the numeric listing ID from a dba.dk URL for deduplication.
// New format: https://www.dba.dk/recommerce/forsale/item/1234567
// Old format: https://www.dba.dk/roland-juno/id-1234567/
function extractListingId(url: string): string {
  const newFormat = url.match(/\/item\/(\d+)/)
  if (newFormat) return newFormat[1]
  const oldFormat = url.match(/\/id-(\d+)/)
  if (oldFormat) return oldFormat[1]
  return url
}

// Core fetch-and-parse for a single (already normalized) query string.
async function fetchDbaSearch(normalizedQ: string): Promise<ScrapedListing[]> {
  const url = `https://www.dba.dk/recommerce/forsale/search?q=${encodeURIComponent(normalizedQ)}`

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'da-DK,da;q=0.9',
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`dba.dk fetch failed: ${res.status} ${res.statusText}`)
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
        currency: String(offers?.['priceCurrency'] ?? 'DKK'),
        url: String(product['url']),
        image_url: product['image'] ? String(product['image']) : null,
        location: null,
        source: 'dba.dk',
      }
    })
    .filter((l): l is ScrapedListing => l !== null)
}

export async function scrapeDba(query: string): Promise<ScrapedListing[]> {
  const normalized = normalizeQuery(query)

  // Build the set of queries to try
  const queries = new Set<string>([normalized])

  // Also try with hyphens removed: "re-201" → "re201"
  const dehyphenated = normalized.replace(/-/g, '')
  if (dehyphenated !== normalized) queries.add(dehyphenated)

  // Expand synonyms (normalize the canonical form before adding)
  const synonym = lookupSynonym(normalized)
  if (synonym) queries.add(normalizeQuery(synonym))

  // Fetch all query variants in parallel; ignore individual failures
  const results = await Promise.allSettled(
    Array.from(queries).map((q) => fetchDbaSearch(q)),
  )

  const all: ScrapedListing[] = results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  )

  // Deduplicate by dba.dk listing ID (same listing may appear in multiple result sets)
  const seen = new Set<string>()
  return all.filter((l) => {
    const id = extractListingId(l.url)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
