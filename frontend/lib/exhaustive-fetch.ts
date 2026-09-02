/**
 * Exhaustive, deterministic retrieval.
 *
 * WHY THIS EXISTS. The product route fetched matched listings with `.limit(50)`
 * and every price statistic was computed from whatever came back. That limit
 * sat BEFORE the `is_active` filter, so it did not mean "50 listings" — it
 * meant "the 50 highest-scoring matched rows, active or not". Measured
 * 2026-09-01, seven of the fourteen canonical products were over it, and
 * `roland-juno-106` had 156 matched rows of which 82 were active.
 *
 * Raising the number to 500 would have fixed today's dataset and preserved the
 * defect: a statistic whose completeness depends on a constant that nobody
 * re-checks when the catalogue grows. A population is either complete or it is
 * not a population, so this module pages until the source is exhausted and the
 * caller never states a maximum.
 *
 * DETERMINISM. Pagination over an unstably-ordered source silently drops and
 * duplicates rows across page boundaries. Callers must order by a key that is
 * unique — here `score DESC, id ASC` — so equal scores cannot reorder between
 * requests. This module additionally de-duplicates by key, so a boundary error
 * at the source degrades into a correct-but-slower read rather than a wrong
 * number.
 *
 * COST. One request per `pageSize` rows, not one per listing. At the current
 * catalogue every product is a single page.
 *
 * Import-free, so the root `tsx --test` harness can exercise it with an
 * injected page fetcher and no Supabase client.
 */

/** Rows per request. One page covers every canonical product today. */
export const DEFAULT_PAGE_SIZE = 1000

/**
 * Refuses to loop forever if a source keeps returning full pages. At the
 * default page size this is 500,000 rows — far past any real product, and
 * still bounded.
 */
export const MAX_PAGES = 500

export interface ExhaustiveFetchResult<T> {
  rows: T[]
  /** Requests actually issued. Reported so query cost stays visible. */
  pages: number
  /** True when MAX_PAGES stopped the loop before the source was exhausted. */
  truncated: boolean
  /** Rows discarded because their key had already been seen. */
  duplicatesDropped: number
}

export interface ExhaustiveFetchOptions {
  pageSize?: number
  maxPages?: number
}

/**
 * Page through `fetchPage` until it returns a short or empty page.
 *
 * `fetchPage(from, to)` uses an inclusive range, matching PostgREST's
 * `.range()`. `keyOf` must return a stable unique identity per row.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  keyOf: (row: T) => string,
  options: ExhaustiveFetchOptions = {},
): Promise<ExhaustiveFetchResult<T>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = options.maxPages ?? MAX_PAGES
  if (pageSize < 1) throw new Error('pageSize must be at least 1')

  const rows: T[] = []
  const seen = new Set<string>()
  let duplicatesDropped = 0
  let pages = 0

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize
    const batch = await fetchPage(from, from + pageSize - 1)
    pages += 1

    for (const row of batch) {
      const key = keyOf(row)
      /**
       * A missing key would make every row look like the same row, and the
       * de-duplication below would silently collapse an entire population to
       * one observation. That is precisely the failure this module exists to
       * prevent, so it is an error rather than a quiet wrong answer. Caught in
       * review 2026-09-01, when a fixture omitted `id` and a 63-row population
       * was reported as 1.
       */
      if (typeof key !== 'string' || key === '' || key === 'undefined' || key === 'null') {
        throw new Error('fetchAllPages: keyOf returned no usable key; pagination cannot be de-duplicated safely')
      }
      if (seen.has(key)) {
        duplicatesDropped += 1
        continue
      }
      seen.add(key)
      rows.push(row)
    }

    // A short page — including an empty one — means the source is exhausted.
    // A page that is exactly full is ambiguous, so we ask once more; that is
    // why an exactly-divisible total costs one extra, empty request.
    if (batch.length < pageSize) {
      return { rows, pages, truncated: false, duplicatesDropped }
    }
  }

  return { rows, pages, truncated: true, duplicatesDropped }
}
