/**
 * Shared URL detection and single-listing fetching for DBA, Thomann, and Reverb.
 *
 * Used by:
 *   - /api/scrape     (search bar: show the listing inline)
 *   - /api/watchlists (watchlist bar: create a listing-type watchlist)
 */

import type { Listing } from '../supabase'

export type SourceType = 'dba' | 'thomann' | 'reverb' | null

// ── Detection ─────────────────────────────────────────────────────────────────

export function detectListingUrl(input: string): SourceType {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')

  if (host === 'dba.dk') {
    // Exclude search pages
    if (url.pathname.startsWith('/soeg') || url.pathname.startsWith('/recommerce/forsale/search')) return null
    return 'dba'
  }

  if (host === 'thomann.de' || host === 'thomann.dk' || host === 'thomann.com' || host === 'thomannmusic.com') {
    // Product pages end in .htm or .html
    if (/\.html?$/.test(url.pathname)) return 'thomann'
    return null
  }

  if (host === 'reverb.com') {
    // Listing pages: /item/12345-... or /p/...
    if (url.pathname.startsWith('/item/') || url.pathname.startsWith('/p/')) return 'reverb'
    return null
  }

  return null
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7',
}

export type ScrapedListingResult = Omit<Listing, 'id' | 'scraped_at'>

const FALLBACK_RATES: Record<string, number> = { USD: 7.1, EUR: 7.46, GBP: 8.8, DKK: 1.0 }

async function fetchExchangeRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=DKK&to=USD,EUR,GBP', {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return FALLBACK_RATES
    const data = await res.json() as { rates: Record<string, number> }
    // Frankfurter gives DKK→X, we want X→DKK
    const result: Record<string, number> = { DKK: 1.0 }
    for (const [cur, rate] of Object.entries(data.rates)) {
      result[cur] = 1 / rate
    }
    return result
  } catch {
    return FALLBACK_RATES
  }
}

async function fetchThomannListing(url: string): Promise<ScrapedListingResult> {
  const [res, rates] = await Promise.all([
    fetch(url, {
      headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.thomann.dk/' },
      signal: AbortSignal.timeout(15_000),
    }),
    fetchExchangeRates(),
  ])

  if (!res.ok) throw new Error(`Thomann fetch failed: ${res.status}`)

  const html = await res.text()

  // ── Price + currency ──────────────────────────────────────────────────────
  // Strategy 1: JSON-LD Product schema — always refers to the main product,
  // never to accessories or bundles that appear earlier in the page.
  let rawPrice: number | null = null
  let currency = 'EUR'

  const ldRe = /<script type="application\/ld\+json">([^<]+)<\/script>/g
  let ldMatch: RegExpExecArray | null
  while ((ldMatch = ldRe.exec(html)) !== null) {
    try {
      const json = JSON.parse(ldMatch[1]) as Record<string, unknown>
      const offers = json['offers'] as Record<string, unknown> | undefined
      if (json['@type'] === 'Product' && offers?.['price'] != null) {
        rawPrice = parseFloat(String(offers['price']))
        currency = String(offers['priceCurrency'] ?? 'EUR')
        break
      }
    } catch { /* skip malformed */ }
  }

  // Strategy 2: rawPrice + currency in the same JSON object (within 80 chars of each other)
  if (rawPrice === null) {
    const m = html.match(/"rawPrice":"([\d.]+)"[^}]{0,80}"currency":"([A-Z]{3})"/)
           ?? html.match(/"currency":"([A-Z]{3})"[^}]{0,80}"rawPrice":"([\d.]+)"/)
    if (m) {
      // Determine which capture group is price vs currency based on pattern
      const isRawFirst = m[0].indexOf('"rawPrice"') < m[0].indexOf('"currency"')
      rawPrice = parseFloat(isRawFirst ? m[1] : m[2])
      currency = isRawFirst ? m[2] : m[1]
    }
  }

  const rate = rates[currency] ?? FALLBACK_RATES[currency] ?? 1
  const price = rawPrice !== null ? Math.round(rawPrice * rate) : null

  // Image from og:image (the "image" JSON field returns unrelated flag SVGs)
  const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/) ??
                   html.match(/content="([^"]+)"\s+property="og:image"/)
  const image_url = imgMatch ? imgMatch[1] : null

  // Title from og:title
  const titleMatch =
    html.match(/property="og:title"\s+content="([^"]+)"/) ??
    html.match(/content="([^"]+)"\s+property="og:title"/) ??
    html.match(/<title>([^<]+)<\/title>/)
  const rawTitle = titleMatch ? titleMatch[1].replace(/ \| Thomann.*$/, '').trim() : url

  if (price === null) throw new Error('Thomann: kunne ikke finde prisen på denne side')

  return {
    title: rawTitle,
    price,
    currency: 'DKK',
    url,
    image_url,
    location: null,
    source: 'thomann',
    condition: 'Ny',
  }
}

async function fetchReverbListing(pageUrl: string): Promise<ScrapedListingResult> {
  // Extract listing ID from URL: /item/12345-name or /p/12345-name
  const idMatch = pageUrl.match(/\/(?:item|p)\/(\d+)/)
  if (!idMatch) throw new Error('Reverb: ugyldigt link format')

  const listingId = idMatch[1]
  const apiUrl = `https://api.reverb.com/api/listings/${listingId}`

  const res = await fetch(apiUrl, {
    headers: {
      'Accept-Version': '3.0',
      'Accept': 'application/hal+json',
      'User-Agent': 'Klup/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Reverb fetch failed: ${res.status}`)

  type ReverbListing = {
    title?: string
    price?: { amount?: string; currency?: string }
    photos?: Array<{ _links?: { large_crop?: { href?: string } } }>
    condition?: { display_name?: string }
    _links?: { web?: { href?: string } }
    make?: string
  }
  const data = await res.json() as ReverbListing

  const rawPrice = data.price?.amount ? parseFloat(data.price.amount) : null
  const currency = data.price?.currency ?? 'USD'

  // Convert to DKK if needed
  let priceDkk: number | null = null
  if (rawPrice !== null) {
    if (currency === 'DKK') {
      priceDkk = Math.round(rawPrice)
    } else {
      // Use a rough conversion — the worker will do a proper one
      const RATES: Record<string, number> = { USD: 7.0, EUR: 7.46, GBP: 8.8 }
      priceDkk = Math.round(rawPrice * (RATES[currency] ?? 7.0))
    }
  }

  const image_url =
    data.photos?.[0]?._links?.large_crop?.href ?? null

  return {
    title: data.title ?? 'Reverb listing',
    price: priceDkk,
    currency: 'DKK',
    url: data._links?.web?.href ?? pageUrl,
    image_url,
    location: null,
    source: 'reverb',
    condition: data.condition?.display_name ?? null,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect the source and fetch the listing in one call.
 * Returns null if the input is not a recognised listing URL.
 */
export async function fetchListingFromUrl(
  input: string,
): Promise<{ source: SourceType; listing: ScrapedListingResult } | null> {
  const { scrapeDbaListing } = await import('./dba-listing')

  const source = detectListingUrl(input)
  if (!source) return null

  let listing: ScrapedListingResult

  if (source === 'dba') {
    listing = await scrapeDbaListing(input)
  } else if (source === 'thomann') {
    listing = await fetchThomannListing(input)
  } else {
    listing = await fetchReverbListing(input)
  }

  return { source, listing }
}
