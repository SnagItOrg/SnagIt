import * as cheerio from 'cheerio'
import type { Listing } from '../supabase'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

export function isDbaListingUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      url.hostname === 'www.dba.dk' &&
      !url.pathname.startsWith('/soeg') &&
      !url.pathname.startsWith('/recommerce/forsale/search')
    )
  } catch {
    return false
  }
}

export async function scrapeDbaListing(listingUrl: string): Promise<ScrapedListing> {
  const res = await fetch(listingUrl, {
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

  // 1. Try JSON-LD — dba.dk embeds Product schema on listing pages
  let product: Record<string, unknown> | null = null
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).html() || '')
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>
        if (p['@type'] === 'Product') {
          product = p
        }
      }
    } catch {
      // skip malformed scripts
    }
  })

  if (product) {
    const offers = product['offers'] as Record<string, unknown> | undefined
    const rawPrice = offers?.['price']
    const price = rawPrice != null ? parseInt(String(rawPrice), 10) : null
    const rawImage = product['image']
    const image_url = rawImage
      ? String(Array.isArray(rawImage) ? rawImage[0] : rawImage)
      : null

    return {
      title: String(product['name'] ?? ''),
      price: price !== null && !isNaN(price) ? price : null,
      currency: String(offers?.['priceCurrency'] ?? 'DKK'),
      url: listingUrl,
      image_url,
      location: null,
      source: 'dba.dk',
    }
  }

  // 2. Fallback: OG meta tags (always present on dba.dk pages)
  const title = $('meta[property="og:title"]').attr('content')?.trim()
  const image_url = $('meta[property="og:image"]').attr('content') ?? null
  const priceText = $('meta[property="product:price:amount"]').attr('content')
  const price = priceText ? parseInt(priceText, 10) : null

  if (!title) {
    throw new Error('Kunne ikke hente annonce fra dba.dk — tjek at linket er korrekt')
  }

  return {
    title,
    price: price !== null && !isNaN(price) ? price : null,
    currency: 'DKK',
    url: listingUrl,
    image_url,
    location: null,
    source: 'dba.dk',
  }
}
