/**
 * Kleinanzeigen music search uses category pages like:
 *   https://www.kleinanzeigen.de/s-musikinstrumente/{query}/k0c74
 * with pagination via ?pageNum=2, ?pageNum=3, etc.
 *
 * The search results page does not expose a useful JSON-LD CollectionPage /
 * ItemList structure, so we scrape the server-rendered listing cards directly
 * from article[data-adid].
 */

import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { Listing } from '../supabase'
import { toDkkApprox } from '../currency'
import { normalizeQuery } from '../query-normalizer'
import { KLEINANZEIGEN_MAX_PRICE_EUR } from '../listing-price-integrity'

type ScrapedListing = Omit<Listing, 'id' | 'scraped_at'>

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function buildKleinanzeigenUrl(normalizedQ: string, page: number): string {
  const q = normalizedQ.replace(/ /g, '+')
  const baseUrl = `https://www.kleinanzeigen.de/s-musikinstrumente/${q}/k0c74`
  return page > 1 ? `${baseUrl}?pageNum=${page}` : baseUrl
}

// The impossible-value bound is shared with the read side — see
// lib/listing-price-integrity.ts. Rows written before this guard existed are
// still in the database and must be filtered on read.
function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/VB|€|\./g, '').trim()
  const n = parseInt(cleaned.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) || n === 0 || n > KLEINANZEIGEN_MAX_PRICE_EUR ? null : n
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

function extractTitle(article: cheerio.Cheerio<AnyNode>): string {
  const title =
    article.find('[class*="cardTitle"]').first().text().trim() ||
    article.find('a[class*="title"]').first().text().trim() ||
    article.find('h2, h3').first().text().trim()

  return title.replace(/\s+/g, ' ').trim()
}

function extractLocation(article: cheerio.Cheerio<AnyNode>): string | null {
  const location =
    article.find('[class*="location"]').first().text().trim() ||
    article.find('[class*="aditem-main--top--left"]').first().text().trim()

  return location ? location.replace(/\s+/g, ' ').trim() : null
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
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`kleinanzeigen fetch failed: ${res.status} ${res.statusText}`)
  }

  const html = await res.text()
  const $ = cheerio.load(html)
  const articles = $('article[data-adid]')

  if (articles.length === 0) return []

  return articles
    .map((_, el): ScrapedListing | null => {
      const article = $(el)
      const title = extractTitle(article)
      const rawUrl = article.find('a[href*="/s-anzeige/"]').first().attr('href')
      const resolvedUrl = absolutizeUrl(rawUrl)

      if (!title || !resolvedUrl) return null

      const rawPrice = article.find('[class*="price"]').first().text().trim()
      const price = rawPrice ? parsePrice(rawPrice) : null

      return {
        title,
        price,
        currency: 'EUR',
        url: resolvedUrl,
        image_url: article.find('img').first().attr('src') ?? null,
        location: extractLocation(article),
        source: 'kleinanzeigen',
        country: 'DE',
        price_dkk: price != null ? toDkkApprox(price, 'EUR') : null,
      }
    })
    .get()
    .filter((listing): listing is ScrapedListing => listing !== null)
}

async function fetchKleinanzeigenSearch(
  normalizedQ: string,
  maxPages: number,
): Promise<ScrapedListing[]> {
  const all: ScrapedListing[] = []
  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await delay(1000)
    const pageResults = await fetchKleinanzeigenPage(normalizedQ, page)
    if (pageResults.length === 0) break
    all.push(...pageResults)
  }
  return all
}

export async function scrapeKleinanzeigen(
  query: string,
  maxPages = 3,
): Promise<ScrapedListing[]> {
  const normalized = normalizeQuery(query)

  const queries: string[] = [normalized]

  const dehyphenated = normalized.replace(/-/g, '')
  if (dehyphenated !== normalized) queries.push(dehyphenated)

  const all: ScrapedListing[] = []
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await delay(2000)
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
