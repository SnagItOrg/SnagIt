/**
 * scripts/lib/kleinanzeigen-paging.ts
 *
 * How the Kleinanzeigen scraper pages one search, and how it knows it saw all of it (PAN-307).
 *
 * The scraper used to read 3 pages × 25 of every search and treat an empty page as the end. Measured on
 * 2026-10-28 (read-only, unauthenticated, 4–6 s apart; 23 pages of "fender stratocaster" in c74 and three
 * small searches), the site behaves like this, and each point is a rule below:
 *
 *   - The default order is newest first, and every page carries "1 - 25 von 1.854" in `breadcrumb-summary`.
 *     That line, not an empty page, says where the search ends.
 *   - It answers 50 pages and no more: `?pageNum=51` redirects to `seite:50`. A search above 1,250 ads is
 *     therefore CAPPED — Stratocaster (1,855) and Les Paul (1,307) today — and its absence proves nothing
 *     about the older ads.
 *   - A page past the end redirects to page 1. `roland juno 106` (12 ads) `?pageNum=2` answers page 1 again,
 *     so the old loop read page 1 three times for every small search and never saw an empty page.
 *   - A valid page sometimes answers 200 with "Es wurden keine … gefunden" (pages 30 and 50 once each,
 *     ~2.2 s responses; both answered normally on a second read). Taken as the end, that would let the stale
 *     sweep retire every older ad of the search, so an empty or misplaced page is read once more and is a
 *     failed search if it stays that way.
 *
 * Import-free so the decision is testable from plain Node; the fetch and the pauses are injected.
 */

/** The deepest page Kleinanzeigen answers (2026-10-28: `?pageNum=51` redirects to `seite:50`). */
export const KLEINANZEIGEN_MAX_PAGES = 50
/** Ads per result page, as `breadcrumb-summary` counts them (top ads come on top of these). */
export const KLEINANZEIGEN_PAGE_SIZE = 25

/** `breadcrumb-summary` read as numbers: "26 - 50 von 1.854" → { from: 26, to: 50, total: 1854 }. */
export type ResultSummary = { from: number; to: number; total: number }

/**
 * Where a search stopped.
 * - `end`: a page said it held the last ad. Only this proves that an unseen ad is not in the search.
 * - `capped`: page 50 was read and the search holds more. Unseen proves nothing.
 * - `failed`: a page stayed empty, misplaced or unreadable. Unseen proves nothing.
 */
export type SearchOutcome = 'end' | 'capped' | 'failed'

export type PagedSearch<T> = { listings: T[]; pages: number; outcome: SearchOutcome }

export type SearchPage<T> = { listings: T[]; summary: ResultSummary | null }

const germanInt = (s: string) => parseInt(s.replace(/\./g, ''), 10)

export function parseResultSummary(html: string): ResultSummary | null {
  const raw = html.match(/breadcrumb-summary[^>]*>([\s\S]*?)<\//i)?.[1]
  if (raw == null) return null
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const range = text.match(/(\d[\d.]*)\s*-\s*(\d[\d.]*)\s+von\s+(\d[\d.]*)/)
  if (range) return { from: germanInt(range[1]), to: germanInt(range[2]), total: germanInt(range[3]) }
  if (/^Es wurden keine\b/i.test(text)) return { from: 0, to: 0, total: 0 }
  return null
}

/** Whether `page` answered as page `page` of a search: its own range, with ads in it. */
function answersAsPage(res: SearchPage<unknown>, page: number): boolean {
  const s = res.summary
  if (!s || s.total === 0) return false
  return s.from === (page - 1) * KLEINANZEIGEN_PAGE_SIZE + 1 && res.listings.length > 0
}

/**
 * Reads one search newest first until a page says it holds the last ad, or `maxPages` are read.
 *
 * Never asks for a page past the end, so a small search costs one request. A page that does not answer as
 * itself is read once more after `retryPause`; on page 1 an empty answer that repeats is an empty search
 * (`end`, nothing found), anywhere else it is `failed`. `fetchPage` throwing (an HTTP error) propagates —
 * the caller counts it as a failed request, as before.
 */
export async function pageSearch<T>(
  fetchPage: (page: number) => Promise<SearchPage<T>>,
  opts: { maxPages: number; pause: () => Promise<void>; retryPause: () => Promise<void> },
): Promise<PagedSearch<T>> {
  const listings: T[] = []
  let pages = 0
  for (let page = 1; page <= opts.maxPages; page++) {
    if (page > 1) await opts.pause()
    let res = await fetchPage(page)
    pages += 1
    if (!answersAsPage(res, page)) {
      await opts.retryPause()
      res = await fetchPage(page)
      pages += 1
      if (!answersAsPage(res, page)) {
        const empty = res.summary?.total === 0
        return { listings, pages, outcome: page === 1 && empty ? 'end' : 'failed' }
      }
    }
    listings.push(...res.listings)
    if (res.summary!.to >= res.summary!.total) return { listings, pages, outcome: 'end' }
  }
  return { listings, pages, outcome: 'capped' }
}

/** Lower-case alphanumerics separated by single spaces — the alphabet of `listings.normalized_text`. */
export function normalizeText(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The words a stored title must contain to be shielded from the stale sweep when its product's search was
 * capped: the model without the brand ("stratocaster", "les paul"), because a seller often leaves the brand
 * out. Shielding a row the search would not have returned only delays its retirement; a row it would have
 * returned, retired, is a live ad gone from a product page — the PAN-307 defect.
 */
export function sweepShieldPhrase(brandName: string, canonicalName: string): string {
  const canonical = canonicalName.trim()
  const brand = brandName.trim()
  const model = canonical.toLowerCase().startsWith(brand.toLowerCase()) ? canonical.slice(brand.length) : canonical
  return normalizeText(model) || normalizeText(canonical)
}
