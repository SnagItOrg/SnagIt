/**
 * Tjek prisen (PAN-207): what one pasted link amounts to.
 *
 * Pure, so the four states are testable from plain Node. The route does the
 * fetching and the reads; everything it learns is classified here.
 */
import { detectListingUrl } from './scrapers/listing-url'
import { classifyListing, verdictFor, type PopulationStats, type Verdict } from './price-populations'
import type { Listing } from './supabase'

export type PriceCheckState = 'verdict' | 'not_enough_data' | 'not_recognised' | 'cant_read'
export type PriceCheckSource = 'dba' | 'thomann'
export type PriceCheckCause =
  | 'not_a_link'
  | 'unsupported_site'
  | 'not_single_ad'
  | 'gone'
  | 'no_price'
  | 'unreachable'

/** A listing as /api/product/[slug] returns it: the row plus the verdict it computed. */
export type PriceCheckListing = Listing & { marketVerdict?: Verdict | null; marketVerdictBasisLabel?: string | null }

/** A public product the answer offers as a guess (PAN-244 part 2). */
export interface PriceCheckGuess { slug: string; name: string }

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
  /**
   * 1–7 Danish asking prices: too few for a band, shown as they are with a
   * small-sample caveat (PAN-109). Never a verdict.
   */
  dkFew: { n: number; low: number; high: number; median: number | null } | null
  guide: { href: string; label: string } | null
  /** Up to five of the product's live listings, Danish first, the pasted ad left out (PAN-244). Empty unless `product` is set. */
  listings: PriceCheckListing[]
  /** When nothing was recognised: the public products the title may mean, best first, three at most (PAN-244 part 2). */
  guesses: PriceCheckGuess[]
  /** The answer is for a product the user picked from the guesses, not one Klup recognised. */
  fromPick: boolean
}

/** How many of the product's listings the answer shows. The product page shows them all. */
const LISTINGS_UNDER_ANSWER = 5

export interface GuessCandidate { slug: string; name: string; model_name: string | null }

/** How many guesses the answer offers. */
const GUESSES = 3

/** Lower-case words: letters (Latin, incl. æøå) and digits, so "Juno-60" and "juno 60" are the same two words. */
const words = (s: string) => s.toLowerCase().split(/[^0-9a-z\u00c0-\u024f]+/).filter(Boolean)

const namesInOrder = (title: readonly string[], model: readonly string[]) =>
  model.length > 0 && title.some((_, i) => model.every((m, j) => title[i + j] === m))

/**
 * PAN-244 part 2: which public products an unrecognised title may mean. A
 * product is a candidate when the title names its model name in full, brand
 * or no brand ("vintage juno 60" names "Juno-60"). Best first: the most name
 * words shared with the title, then the price inside the product's observed
 * range, then the name. Pure: the caller decides which products are public
 * and supplies the ranges it knows.
 */
export function guessProducts(
  title: string,
  priceDkk: number | null,
  products: readonly GuessCandidate[],
  ranges: ReadonlyMap<string, { low: number; high: number }>,
  limit = GUESSES,
): PriceCheckGuess[] {
  const t = words(title)
  return products
    .filter((p) => p.model_name != null && namesInOrder(t, words(p.model_name)))
    .map((p) => {
      const name = new Set(words(p.name))
      const r = ranges.get(p.slug)
      return {
        p,
        overlap: t.filter((w) => name.has(w)).length,
        inRange: priceDkk != null && r != null && priceDkk >= r.low && priceDkk <= r.high ? 1 : 0,
      }
    })
    .sort((a, b) => b.overlap - a.overlap || b.inRange - a.inRange || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(({ p }) => ({ slug: p.slug, name: p.name }))
}

const adUrl = (url: string) => {
  try {
    const u = new URL(url)
    return (u.origin + u.pathname).replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * PAN-244: the product page's listings, as the page orders them, with the
 * Danish ones first and the pasted ad itself left out. Danish is decided by
 * `classifyListing`, the same rule that places a listing in its population.
 */
export function listingsUnderAnswer<T extends Pick<Listing, 'url' | 'source' | 'country'>>(listings: readonly T[], pastedUrl: string): T[] {
  const pasted = adUrl(pastedUrl)
  const rest = listings.filter((l) => adUrl(l.url) !== pasted)
  const danish = (l: T) => classifyListing(l).population === 'dk-asking'
  return [...rest.filter(danish), ...rest.filter((l) => !danish(l))].slice(0, LISTINGS_UNDER_ANSWER)
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
  // DBA's short share link, dba.dk/<id>, is the same ad: it redirects to /recommerce/forsale/item/<id>.
  const shortId = source === 'dba' ? /^\/(\d+)\/?$/.exec(url.pathname)?.[1] : undefined
  if (source === 'dba' && shortId) return { source, url: `${url.origin}/recommerce/forsale/item/${shortId}` }
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
  /** The product's adjudicated Danish asking prices, as /api/product returns them. */
  dkAskingPrices: readonly number[]
}): Pick<PriceCheckResult, 'state' | 'verdict' | 'ranges' | 'dkFew'> {
  if (facts.cause) return { state: 'cant_read', verdict: null, ranges: [], dkFew: null }
  if (!facts.matched) return { state: 'not_recognised', verdict: null, ranges: [], dkFew: null }

  const band = (market: 'dk-asking' | 'reverb-sold') => {
    const p = facts.populations?.[market]
    if (p?.tier !== 'band' || p.median == null) return []
    return [{ market, low: p.q1 ?? p.median, high: p.q3 ?? p.median }]
  }

  const dk = facts.populations?.['dk-asking']
  const prices = facts.dkAskingPrices
  // The median is the population's own, so it exists only from n >= 3.
  const dkFew = dk && dk.tier !== 'band' && prices.length > 0
    ? { n: prices.length, low: Math.min(...prices), high: Math.max(...prices), median: dk.median }
    : null

  if (facts.source === 'dba') {
    const verdict = dk ? verdictFor(facts.priceDkk, 'dk-asking', dk).verdict : null
    if (verdict) return { state: 'verdict', verdict, ranges: band('dk-asking'), dkFew: null }
    // Reverb sold rides along as a labelled reference, never as a verdict.
    return { state: 'not_enough_data', verdict: null, ranges: dkFew ? band('reverb-sold') : [], dkFew }
  }

  const ranges = [...band('dk-asking'), ...band('reverb-sold')]
  return { state: ranges.length > 0 ? 'verdict' : 'not_enough_data', verdict: null, ranges, dkFew }
}
