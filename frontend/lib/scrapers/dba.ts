import * as cheerio from 'cheerio'
import type { Listing } from '../supabase'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export async function scrapeDba(query: string): Promise<ScrapedListing[]> {
  const url = `https://www.dba.dk/soeg/?soeg=${encodeURIComponent(query)}`

  const res = await fetch(url, {
    headers: {
      // Mimic a real browser to avoid blocks
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'da-DK,da;q=0.9',
    },
    next: { revalidate: 0 }, // Never cache scrape results
  })

  if (!res.ok) {
    throw new Error(`dba.dk fetch failed: ${res.status} ${res.statusText}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  // dba.dk embeds all listing data in a JSON-LD CollectionPage script
  let collectionPage: Record<string, unknown> | null = null
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).html() || '')
      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>)['@type'] === 'CollectionPage') {
        collectionPage = parsed as Record<string, unknown>
      }
    } catch {
      // skip malformed scripts
    }
  })

  const mainEntity = collectionPage?.['mainEntity'] as Record<string, unknown> | undefined
  const itemListElement = mainEntity?.['itemListElement'] as unknown[] | undefined

  if (!itemListElement?.length) {
    return []
  }

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
        location: null, // not in JSON-LD; can add CSS scraping later
        source: 'dba.dk',
      }
    })
    .filter((l): l is ScrapedListing => l !== null)
}
