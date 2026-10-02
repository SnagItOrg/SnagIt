/**
 * Tjek prisen (PAN-207): what one pasted link amounts to.
 *
 * Pure, so the four states are testable from plain Node. The route does the
 * fetching and the reads; everything it learns is classified here.
 */
import { detectListingUrl } from './scrapers/listing-url'
import { verdictFor, type PopulationStats, type Verdict } from './price-populations'

export type PriceCheckState = 'verdict' | 'not_enough_data' | 'not_recognised' | 'cant_read'
export type PriceCheckSource = 'dba' | 'thomann'
export type PriceCheckCause =
  | 'not_a_link'
  | 'unsupported_site'
  | 'not_single_ad'
  | 'gone'
  | 'no_price'
  | 'unreachable'

export interface PriceCheckResult {
  state: PriceCheckState
  source: PriceCheckSource | null
  cause: PriceCheckCause | null
  /** The ad's title, or the Thomann product's name. */
  title: string | null
  /** The ad's asking price, or Thomann's new price. */
  priceDkk: number | null
  /** Set for a public product only. A private one is never named or linked. */
  product: { slug: string; name: string } | null
  verdict: Verdict | null
  /** Each range belongs to one market and is labelled by it. Never blended. */
  ranges: Array<{ market: 'dk-asking' | 'reverb-sold'; low: number; high: number }>
  guide: { href: string; label: string } | null
}

/** What the pasted text is, before any request is made. */
export function readLink(
  input: string,
): { source: PriceCheckSource; url: string } | { cause: PriceCheckCause; query: string | null } {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { cause: 'not_a_link', query: null }
  }
  // Origin and path only: a tracking parameter is not part of the ad.
  const clean = url.origin + url.pathname
  const source = detectListingUrl(url.href)
  if (source === 'thomann') return { source, url: clean }
  if (source === 'dba' && url.pathname.includes('/item/')) return { source, url: clean }
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'dba.dk' || host.startsWith('thomann.')) {
    return { cause: 'not_single_ad', query: url.searchParams.get('q') }
  }
  return { cause: 'unsupported_site', query: null }
}

type Populations = Partial<Record<'dk-asking' | 'reverb-sold', PopulationStats>>

/**
 * One of four states.
 *
 * A DBA ad is judged against Danish asking prices or not at all: `verdictFor`
 * refuses any other population. A Thomann product is not an ad, so it never
 * gets a verdict; its answer is that a used-price band exists.
 */
export function classify(facts: {
  source: PriceCheckSource | null
  cause: PriceCheckCause | null
  matched: boolean
  priceDkk: number | null
  populations: Populations | null
}): Pick<PriceCheckResult, 'state' | 'verdict' | 'ranges'> {
  if (facts.cause) return { state: 'cant_read', verdict: null, ranges: [] }
  if (!facts.matched) return { state: 'not_recognised', verdict: null, ranges: [] }

  const band = (market: 'dk-asking' | 'reverb-sold') => {
    const p = facts.populations?.[market]
    if (p?.tier !== 'band' || p.median == null) return []
    return [{ market, low: p.q1 ?? p.median, high: p.q3 ?? p.median }]
  }

  if (facts.source === 'dba') {
    const dk = facts.populations?.['dk-asking']
    const verdict = dk ? verdictFor(facts.priceDkk, 'dk-asking', dk).verdict : null
    return verdict
      ? { state: 'verdict', verdict, ranges: band('dk-asking') }
      : { state: 'not_enough_data', verdict: null, ranges: [] }
  }

  const ranges = [...band('dk-asking'), ...band('reverb-sold')]
  return { state: ranges.length > 0 ? 'verdict' : 'not_enough_data', verdict: null, ranges }
}
