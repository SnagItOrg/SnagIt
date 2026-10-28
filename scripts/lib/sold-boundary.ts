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
 *
 * The text search still mostly returns siblings, so 67 products fell below the
 * band's 8 rows. Reverb's own product page does not (PAN-307: 64 of the 67 back
 * to 8 or more), so a product with a `reverb_csp_id` is read from there and the
 * text search is the fallback. The boundary is the same on both: Reverb's
 * product page carries siblings too, e.g. 6505+ sales on the 6505 page.
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
  state?: { slug?: string }
  _links?: { web?: { href?: string } }
}

/** Results per page on Reverb's product page; the text search keeps its own. */
export const PRODUCT_PER_PAGE = 50

/**
 * Reverb's product ids from a `GET /api/csps/<id>` body: its listings link
 * carries them as `cp_ids[]`. A CSP id is not a product id (6505: CSP 8435,
 * cp 17485). Null when the body names none.
 */
export function cpIdsFromCsp(csp: unknown): string[] | null {
  const href = (csp as { _links?: { listings?: { href?: unknown } } } | null)?._links?.listings?.href
  if (typeof href !== 'string') return null
  let ids: string[]
  try {
    ids = new URL(href).searchParams.getAll('cp_ids[]')
  } catch {
    return null
  }
  return ids.length > 0 && ids.every((id) => /^\d+$/.test(id)) ? ids : null
}

export interface SoldSearch {
  /** For the log line. */
  label: string
  perPage: number
  /** Path and query under Reverb's API base. */
  path: (page: number) => string
  /** Every listing must say it is sold, or the page is not a usable answer. */
  requireSoldState: boolean
}

/**
 * Reverb's product page when the product's CSP resolved to a product id, else
 * the text search exactly as before. `show_only_sold=true` is what the product
 * page honours; `state=sold` is what the text search sends. A product-page
 * listing that is not sold would be a live asking price written as a sale, so
 * that path checks each listing's state.
 */
export function soldSearch(cpIds: string[] | null, query: string, textPerPage: number): SoldSearch {
  if (cpIds) {
    const cp = cpIds.map((id) => `cp_ids%5B%5D=${id}`).join('&')
    return {
      label: `product page (cp ${cpIds.join(', ')})`,
      perPage: PRODUCT_PER_PAGE,
      path: (page) => `/listings?${cp}&show_only_sold=true&per_page=${PRODUCT_PER_PAGE}&page=${page}`,
      requireSoldState: true,
    }
  }
  return {
    label: `"${query}"`,
    perPage: textPerPage,
    path: (page) => `/listings?query=${encodeURIComponent(query)}&state=sold&per_page=${textPerPage}&page=${page}`,
    requireSoldState: false,
  }
}

/** True when every listing on the page says it is sold. */
export function allSold(listings: readonly SoldListing[]): boolean {
  return listings.every((l) => l?.state?.slug === 'sold')
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
