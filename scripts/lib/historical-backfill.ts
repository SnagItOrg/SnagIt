/**
 * scripts/lib/historical-backfill.ts — the cohort of `match-listings.ts --historical-backfill` (PAN-262).
 *
 * The cohort is explicit: ACTIVE listings with a title and NO `listing_product_match` row (any row,
 * rejected included), so a backfill can never touch a verdict. It is ordered oldest scrape first,
 * ties broken by id. The order must be total: the PAN-254 promote gave ~4,300 DBA rows one
 * identical `scraped_at`, and a recency window over tied rows was an arbitrary, unstable slice.
 */

import { createHash } from 'crypto'

export interface BackfillRow {
  id: string
  title: string | null
  external_id: string | null
  /** As PostgREST returns it, ISO-8601 in UTC; same-format strings compare in time order. */
  scraped_at: string
  is_active: boolean
}

/**
 * The backfill cohort, in its stable order, capped at `max`. `ids`, when given, narrows it to
 * those listings (the fixture run); a named listing that holds a match row is still left out.
 * `from` (PAN-266, G4) is a `scraped_at` lower bound, inclusive: a `none` or `deferred` decision
 * writes no row, so without it every round re-selects the oldest `max` rows and a cohort larger
 * than the cap is never covered. Each round's `--from` is the previous round's printed "last".
 */
export function backfillCohort(
  rows: readonly BackfillRow[],
  withMatchRow: ReadonlySet<string>,
  max: number,
  ids?: ReadonlySet<string>,
  from?: string,
): BackfillRow[] {
  return rows
    .filter((r) => r.is_active && r.title !== null && !withMatchRow.has(r.id) && (!ids || ids.has(r.id)) && (!from || r.scraped_at >= from))
    .sort((a, b) => (a.scraped_at < b.scraped_at ? -1 : a.scraped_at > b.scraped_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, max)
}

/**
 * md5 of the selected ids in cohort order, prefixed by the cursor when one is set: the dry run
 * prints it, and --apply must be given it. Without a cursor the digest is the PAN-262 one.
 */
export function selectionDigest(cohort: readonly BackfillRow[], from?: string): string {
  return createHash('md5').update(from ? `from=${from}\n` : '').update(cohort.map((r) => r.id).join('\n')).digest('hex')
}
