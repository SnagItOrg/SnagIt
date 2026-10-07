/**
 * Tjek prisen (PAN-207): what one pasted link amounts to.
 *
 * Pure, so the four states are testable from plain Node. The route does the
 * fetching and the reads; everything it learns is classified here.
 */
import { detectListingUrl } from './scrapers/listing-url'
import { classifyListing, verdictFor, type PopulationStats, type Verdict } from './price-populations'
import { partitionByIqr } from './statistics'
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

/** What the answer offers as a guess: a public product, or a navigation family (PAN-244 part 2, PAN-245 stage 1). */
export interface PriceCheckGuess { slug: string; name: string; kind: 'product' | 'family'; href: string }

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
  /** When nothing was recognised: the public products or families the title may mean, best first, three at most (PAN-244 part 2, PAN-245). */
  guesses: PriceCheckGuess[]
  /** The answer is for a product the user picked from the guesses, not one Klup recognised. */
  fromPick: boolean
  /** PAN-250: what the item went for on Reverb, when Klup does not recognise it. Never a verdict, never blended. */
  reverbSold: { low: number; high: number; n: number; href: string } | null
  /** PAN-250: the ad sells several units; the asking price per unit, and no single-unit verdict. */
  lot: { count: number; perUnitDkk: number | null } | null
}

/**
 * PAN-250: a lot. "4 x", "7x", "2 stk" at the start name the count; "par" /
 * "pair" names two. The count the title states first wins ("4 x Urei LA4
 * (pairs)" is four).
 */
export function parseLot(title: string): { count: number } | null {
  const lead = /^\s*(\d{1,3})\s*(?:x|×|stk\.?)\b/i.exec(title)
  if (lead) {
    const count = Number(lead[1])
    return count >= 2 ? { count } : null
  }
  return /\b(?:par|pair|pairs)\b/i.test(title) ? { count: 2 } : null
}

/** The title without its lot prefix and its parentheses, as a Reverb search. */
export function reverbSoldQuery(title: string): string {
  return title
    .replace(/^\s*\d{1,3}\s*(?:x|×|stk\.?)\s+/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** Sold titles that name a part of the thing, software for it, or a lot of it — not the thing. */
const NOT_THE_ITEM = /\b(?:cards?|plug-?ins?|uad|software|ears|caps?|knobs?|manual|remote|cable|psu|power supply|parts?)\b/i

/**
 * Words as a model code reads them: a short letter run joined to the digits it
 * precedes across one hyphen or space ("LA-4", "DEP-5", "EMT 140", "SSL 4000G"
 * are one word each), and digits joined to a trailing letter across a hyphen
 * ("BX20-E"). Long words stay apart ("Lexicon 200", "Stratocaster 1977").
 */
const modelWords = (s: string) =>
  words(s.toLowerCase().replace(/\b([a-z]{1,4})[-\s](?=\d)/g, '$1').replace(/(\d)-(?=[a-z])/g, '$1'))

/**
 * The word the ad names its model by: the first word mixing letters and digits
 * ("LA4", "BX20", "FL201", "DEP5"), else a number of three or more digits that
 * is not a year, else the last word of five or more letters — the model
 * tends to follow the brand ("Marshall Time Modulator").
 */
export function modelToken(title: string): string | null {
  const t = modelWords(reverbSoldQuery(title))
  return t.find((w) => /[a-z]/.test(w) && /\d/.test(w))
    ?? t.find((w) => /^\d{3,}$/.test(w) && !/^(?:19|20)\d\d$/.test(w))
    ?? [...t].reverse().find((w) => /^[a-z\u00c0-\u024f]{5,}$/.test(w) && !GENERIC_WORDS.has(w))
    ?? null
}

/**
 * The confidence rule: a sale counts when its own title carries the ad's model
 * token as a word — hyphens and spaces inside the word ignored, so "LA-4" is
 * "LA4", and a token with a letter may lead a longer word ("BX20" leads
 * "BX20E") — and it is neither a part, nor software, nor a lot.
 */
export function namesModel(soldTitle: string, token: string): boolean {
  return modelWords(soldTitle).some((w) => w === token || (/[a-z]/.test(token) && w.startsWith(token)))
}

/**
 * The sold range: the model-naming sales, outliers dropped the way every other
 * population drops them, two sales at least — rare studio gear sells seldom,
 * and the answer states the count — as low–high in kr.
 */
export function soldRange(title: string, sales: readonly { title: string; priceDkk: number }[]): { low: number; high: number; n: number } | null {
  const token = modelToken(title)
  if (!token) return null
  const kept = partitionByIqr(
    sales.filter((s) => namesModel(s.title, token) && !NOT_THE_ITEM.test(s.title) && !parseLot(s.title)).map((s) => s.priceDkk),
  ).kept
  if (kept.length < 2) return null
  const low = Math.min(...kept)
  const high = Math.max(...kept)
  // Sales that span more than tenfold are not one thing ("Lexicon 200" also names knobs and manuals); say nothing.
  if (high > low * 10) return null
  return { low, high, n: kept.length }
}

/** How many of the product's listings the answer shows. The product page shows them all. */
const LISTINGS_UNDER_ANSWER = 5

/** A row the guess step may offer: a public product, or a navigation family (its label, brand and navigation aliases). */
export interface GuessCandidate {
  slug: string
  name: string
  model_name: string | null
  /** Lower-case brand name; null when the row has none. */
  brand_name: string | null
  kind: 'product' | 'family'
  aliases?: readonly string[]
}

export interface RankedCandidate extends GuessCandidate {
  sim: number
  /** Name words the title shares with the row beyond the brand. */
  shared: number
  /** The share of the row's own naming words the title carries: 1 when the title says everything the row's name says. */
  coverage: number
}

/** How many guesses the answer offers. */
const GUESSES = 3

/** How many trigram neighbours the candidate step keeps — the method measured on PAN-245. */
const TRIGRAM_CANDIDATES = 10

/**
 * Words that name no model: a title sharing only one of these with a row is not
 * naming it ("Orange Crush Bass 50" is not a Mustang Bass). Numbers alone are
 * not names either ("IC-20" is not an MS-20).
 */
const GENERIC_WORDS = new Set(['bass', 'guitar', 'custom', 'standard', 'special', 'deluxe', 'vintage', 'pro', 'plus', 'edition', 'series', 'model', 'ii', 'iii', 'mk', 'mkii', 'mk2'])
const namesSomething = (w: string) => /[a-z\u00c0-\u024f]/.test(w) && !GENERIC_WORDS.has(w)

/** Lower-case words: letters (Latin, incl. æøå) and digits, so "Juno-60" and "juno 60" are the same two words. */
const words = (s: string) => s.toLowerCase().split(/[^0-9a-z\u00c0-\u024f]+/).filter(Boolean)

const namesInOrder = (title: readonly string[], model: readonly string[]) =>
  model.length > 0 && title.some((_, i) => model.every((m, j) => title[i + j] === m))

/**
 * pg_trgm's `similarity`, as the PAN-245 measurement ran it on production: each
 * word is padded "  w " and cut into trigrams, and the score is the shared
 * trigrams over the union. Calling pg_trgm from the app would need a function
 * in the database, which is a migration; this is the same number in process.
 */
const trigrams = (s: string): Set<string> => {
  const out = new Set<string>()
  for (const w of words(s)) {
    const padded = `  ${w} `
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  }
  return out
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  ta.forEach((t) => { if (tb.has(t)) shared++ })
  return shared / (ta.size + tb.size - shared)
}

/**
 * PAN-245 stage 1, the candidate step. Three ways in: the ten rows nearest the
 * title by trigram similarity (over the name and the model name); every row
 * whose model name or navigation alias the title names in full; and, when the
 * title offers a brand (its earliest brand word, the matcher's own notion), that
 * brand's rows. The brand guard stays: with a brand offered, rows of another
 * brand are out — an external brand, which no row carries, leaves nothing. A
 * row also needs one shared word that names something — beyond the brand, not
 * a number, not a generic word — so the brand alone is not a guess. Pure: the
 * caller decides which rows are public and which brand the title offers.
 */
export function guessCandidates(
  title: string,
  rows: readonly GuessCandidate[],
  brand: string | null,
): RankedCandidate[] {
  const t = words(title)
  const brandWords = new Set(brand ? words(brand) : [])
  const scored: Array<GuessCandidate & { sim: number }> = rows
    .filter((r) => !brand || !r.brand_name || r.brand_name === brand)
    .map((r) => ({
      ...r,
      sim: Math.max(trigramSimilarity(title, r.name), r.model_name ? trigramSimilarity(title, r.model_name) : 0),
    }))
  const nearest = new Set(
    [...scored].sort((a, b) => b.sim - a.sim || a.slug.localeCompare(b.slug)).slice(0, TRIGRAM_CANDIDATES).map((r) => r.slug),
  )
  const named = (r: GuessCandidate) =>
    [r.model_name, ...(r.aliases ?? [])].some((n) => n != null && namesInOrder(t, words(n)))
  return scored
    .filter((r) => nearest.has(r.slug) || named(r) || (brand != null && r.brand_name === brand))
    .map((r) => {
      // The row's own naming words: everything past the brand. Coverage is how many of them the title carries.
      const naming = words(r.name).filter((w) => !brandWords.has(w) && !(r.brand_name && words(r.brand_name).includes(w)))
      const shared = naming.filter((w) => t.includes(w))
      const candidate: RankedCandidate = { ...r, shared: shared.length, coverage: naming.length > 0 ? shared.length / naming.length : 0 }
      return { candidate, names: shared.some(namesSomething) }
    })
    .filter(({ names }) => names)
    .map(({ candidate }) => candidate)
}

/**
 * The ranking (PAN-244 part 2, refined on PAN-245): the row the title supports
 * best — the share of its naming words the title carries, then how many — then
 * the price inside the product's observed range, then the nearest by trigram,
 * then the name. Three at most. A family wins over a variant the title does not
 * name; a variant wins when the title names it.
 */
export function guessProducts(
  title: string,
  priceDkk: number | null,
  candidates: readonly RankedCandidate[],
  ranges: ReadonlyMap<string, { low: number; high: number }>,
  limit = GUESSES,
): PriceCheckGuess[] {
  void title
  return candidates
    .map((c) => {
      const r = ranges.get(c.slug)
      return { c, inRange: priceDkk != null && r != null && priceDkk >= r.low && priceDkk <= r.high ? 1 : 0 }
    })
    .sort((a, b) => b.c.coverage - a.c.coverage || b.c.shared - a.c.shared || b.inRange - a.inRange || b.c.sim - a.c.sim || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(({ c }) => ({ slug: c.slug, name: c.name, kind: c.kind, href: `/${c.kind}/${c.slug}` }))
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
