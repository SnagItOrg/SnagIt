/**
 * What the Reverb sold writer (scripts/process-price-queue.ts) may link to a
 * product, and how far it reads Reverb's sold search (PAN-306).
 *
 * The writer searched "<brand> <model>" and linked the first 20 results with no
 * title check. Measured 2026-10-27: 1,527 of 5,385 linked sold rows were titles
 * the matcher's own line boundaries refuse — pairs, parts, siblings — and 177 of
 * 327 products held exactly those 20, so a refused sale was never replaced.
 * Now a sale is linked only when its title passes the product's boundary, and
 * the search pages on until SOLD_TARGET usable sales pass or SOLD_MAX_PAGES are
 * read.
 */
import { foldHyphens, hyphenateMartinCodes, lineBoundaryRefusal } from '../../frontend/lib/matching/match-listings'
import { isNonFunctioning, isPartOrAccessoryListing } from '../../frontend/lib/price-populations'

/**
 * Products whose page is the vintage original only (PAN-154, owner decisions
 * 2026-09-26/28): a "Brand New" or "B-Stock" sale there is current production.
 */
export const VINTAGE_ONLY: ReadonlySet<string> = new Set([
  'moog-minimoog', 'fender-telecaster-thinline', 'fender-mustang-bass',
])
export const CURRENT_PRODUCTION_CONDITIONS: ReadonlySet<string> = new Set(['brand new', 'b-stock'])

/** Usable sales the writer pages for, per product: one page's worth, as before. */
export const SOLD_TARGET = 20
/** Pages read at most per product, each behind the writer's rate limit. */
export const SOLD_MAX_PAGES = 5

/**
 * Why a sold title is not `slug`'s sale, or null. The matcher's line boundary
 * on the title as the matcher reads it, then PAN-154's sold-only condition cue.
 */
export function soldRefusal(title: string, slug: string, condition: string | null | undefined): string | null {
  const c = (condition ?? '').trim().toLowerCase()
  return lineBoundaryRefusal(hyphenateMartinCodes(foldHyphens(title.toLowerCase().trim())), slug) ??
    (VINTAGE_ONLY.has(slug) && CURRENT_PRODUCTION_CONDITIONS.has(c) ? `condition:${c}` : null)
}

export interface SoldListing {
  title?: string | null
  price?: { amount: string; currency: string }
  condition?: { display_name?: string }
  categories?: unknown
  _links?: { web?: { href?: string } }
}

export interface SoldCollection<T> {
  /** Priced sales whose title passes the boundary, in Reverb's order, one per listing URL. */
  accepted: T[]
  /** Priced sales the boundary refused. Never linked. */
  refused: number
  pages: number
  /** False when a page after the first failed and paging stopped early. */
  complete: boolean
}

/**
 * Reads the sold search page by page. A sale counts towards SOLD_TARGET only
 * when the product page would count it: not a part (PAN-170), not "Non
 * Functioning" (PAN-283). Parts that pass the boundary are still kept, as the
 * writer always recorded them.
 *
 * `fetchPage` returns null when the provider gave no usable answer. A failed
 * first page returns null, so the queue row fails as before; a failed later
 * page stops paging and keeps what was already accepted.
 */
export async function collectSold<T extends SoldListing>(
  slug: string,
  fetchPage: (page: number) => Promise<T[] | null>,
  perPage: number,
): Promise<SoldCollection<T> | null> {
  const accepted: T[] = []
  const seen = new Set<string>()
  let refused = 0
  let usable = 0
  for (let page = 1; page <= SOLD_MAX_PAGES; page++) {
    const listings = await fetchPage(page)
    if (listings === null) {
      if (page === 1) return null
      return { accepted, refused, pages: page - 1, complete: false }
    }
    for (const l of listings) {
      if (!l.price || !(parseFloat(l.price.amount) > 0)) continue
      const url = l._links?.web?.href
      if (url) {
        if (seen.has(url)) continue
        seen.add(url)
      }
      if (soldRefusal(l.title ?? '', slug, l.condition?.display_name) !== null) {
        refused++
        continue
      }
      accepted.push(l)
      if (!isPartOrAccessoryListing(l.categories) && !isNonFunctioning(l.condition?.display_name)) usable++
    }
    if (usable >= SOLD_TARGET || listings.length < perPage) {
      return { accepted, refused, pages: page, complete: true }
    }
  }
  return { accepted, refused, pages: SOLD_MAX_PAGES, complete: true }
}
