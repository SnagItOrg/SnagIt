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
 */
export function backfillCohort(
  rows: readonly BackfillRow[],
  withMatchRow: ReadonlySet<string>,
  max: number,
  ids?: ReadonlySet<string>,
): BackfillRow[] {
  return rows
    .filter((r) => r.is_active && r.title !== null && !withMatchRow.has(r.id) && (!ids || ids.has(r.id)))
    .sort((a, b) => (a.scraped_at < b.scraped_at ? -1 : a.scraped_at > b.scraped_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, max)
}

/** md5 of the selected ids in cohort order: the dry run prints it, and --apply must be given it. */
export function selectionDigest(cohort: readonly BackfillRow[]): string {
  return createHash('md5').update(cohort.map((r) => r.id).join('\n')).digest('hex')
}
