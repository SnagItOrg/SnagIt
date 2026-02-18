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
  let collectionPage: any = null
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '')
      if (parsed['@type'] === 'CollectionPage') {
        collectionPage = parsed
      }
    } catch {
      // skip malformed scripts
    }
  })

  if (!collectionPage?.mainEntity?.itemListElement) {
    return []
  }

  const items: any[] = collectionPage.mainEntity.itemListElement

  return items
    .map((entry: any): ScrapedListing | null => {
      const product = entry.item
      if (!product?.url || !product?.name) return null

      const rawPrice = product.offers?.price
      const price = rawPrice ? parseInt(rawPrice, 10) : null

      return {
        title: product.name,
        price: isNaN(price as number) ? null : price,
        currency: product.offers?.priceCurrency ?? 'DKK',
        url: product.url,
        image_url: product.image ?? null,
        location: null, // not in JSON-LD; can add CSS scraping later
        source: 'dba.dk',
      }
    })
    .filter((l): l is ScrapedListing => l !== null)
}
