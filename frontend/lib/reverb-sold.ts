import { fetchExchangeRates } from './scrapers/listing-url'
import { reverbSoldQuery, soldRange } from './price-check'

/**
 * PAN-250: what an item went for on Reverb, for an ad Klup does not recognise.
 *
 * Reverb's price guide is no longer a public endpoint and a comparison page
 * carries only its lowest current asking price, so the honest source is the
 * sold listings themselves: one search, no token, the sales converted with the
 * same Frankfurter rate every other price uses, and the range decided by the
 * pure rule in price-check.ts. Nothing is written anywhere. The answer links
 * back to the sales on Reverb, as Reverb's terms ask.
 *
 * Cached in memory for six hours per query and capped, so a popular link does
 * not hit Reverb on every check and nothing lives longer than Reverb's API
 * terms allow for stored results.
 */
export interface ReverbSoldGuide {
  low: number
  high: number
  n: number
  href: string
}

const TTL_MS = 6 * 60 * 60_000
const MAX_ENTRIES = 500
const cache = new Map<string, { at: number; value: ReverbSoldGuide | null }>()

type SoldListing = { title?: string; price?: { amount?: string; currency?: string } }

export async function reverbSoldGuide(title: string): Promise<ReverbSoldGuide | null> {
  const query = reverbSoldQuery(title)
  if (!query) return null
  const hit = cache.get(query)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  let value: ReverbSoldGuide | null = null
  try {
    // A title with a misspelling or a seller's own words ("Optocompessors") finds nothing; a miss is retried
    // with the title's first three words, then its first two — the brand and the model — so at most three
    // requests, and only when the first came back empty.
    const ws = query.split(' ')
    const attempts = Array.from(new Set([query, ws.slice(0, 3).join(' '), ws.slice(0, 2).join(' ')])).filter((q) => q.length >= 3)
    let listings: SoldListing[] = []
    let used = query
    for (const q of attempts) {
      const res = await fetch(
        `https://api.reverb.com/api/listings?query=${encodeURIComponent(q)}&state=sold&per_page=24`,
        {
          headers: { 'Accept-Version': '3.0', Accept: 'application/hal+json', 'User-Agent': 'Klup/1.0' },
          signal: AbortSignal.timeout(8_000),
          next: { revalidate: 0 },
        },
      )
      if (!res.ok) break
      listings = ((await res.json()) as { listings?: SoldListing[] }).listings ?? []
      used = q
      if (listings.length > 0) break
    }
    if (listings.length > 0) {
      const rates = await fetchExchangeRates()
      const sales = listings.flatMap((l) => {
        const amount = parseFloat(String(l.price?.amount ?? ''))
        const rate = rates[l.price?.currency ?? ''] ?? null
        return l.title && Number.isFinite(amount) && amount > 0 && rate ? [{ title: l.title, priceDkk: Math.round(amount * rate) }] : []
      })
      const range = soldRange(title, sales)
      value = range
        ? { ...range, href: `https://reverb.com/marketplace?query=${encodeURIComponent(used)}&show_only_sold=true` }
        : null
    }
  } catch {
    value = null
  }

  if (cache.size >= MAX_ENTRIES) cache.clear()
  cache.set(query, { at: Date.now(), value })
  return value
}
