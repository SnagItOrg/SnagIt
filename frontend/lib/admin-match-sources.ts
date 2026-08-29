/**
 * The marketplace sources offered by /admin/match, and the identifiers they
 * actually carry in `listings.source`.
 *
 * WHY THIS MODULE EXISTS. The admin page used to hold its own chip list whose
 * keys were assumed to equal the stored column value. They did not:
 *
 *   chip key 'dba'  ->  SELECT count(*) FROM listings WHERE source = 'dba'
 *                       is 0. Every DBA row is stored as 'dba.dk'.
 *
 * So the DBA chip filtered on a value no row has ever held, and selecting DBA
 * alone returned an empty candidate list — silently, because an empty result is
 * indistinguishable from "nothing left to match". Kleinanzeigen was absent from
 * the list entirely even though its rows were already stored and eligible.
 *
 * `stored` is therefore the authority, and it is a LIST: a marketplace may have
 * been written under more than one identifier across the scrapers' history, and
 * an `in` filter costs nothing. The values below are the ones the scrapers
 * write today — `scripts/scrape-<name>.ts`, verified against the live column.
 *
 * This module is deliberately dependency-free. The route imports it server-side
 * next to the Anthropic SDK; the client page imports it into the browser
 * bundle; the root test runner imports it with no build step. A single import
 * of anything heavier would break one of those three.
 */

export type MatchSource = {
  /** Stable key used in the `sources` query parameter and in React state. */
  key: string
  /** Operator-facing label. */
  label: string
  /** Every value this marketplace may occupy in `listings.source`. */
  stored: readonly string[]
  /** Chip colour, matching the marketplace's own brand. */
  color: string
}

export const MATCH_SOURCES: readonly MatchSource[] = [
  { key: 'dba',           label: 'DBA',           stored: ['dba.dk'],        color: '#00098A' },
  { key: 'finn',          label: 'Finn.no',       stored: ['finn'],          color: '#06bffc' },
  { key: 'blocket',       label: 'Blocket',       stored: ['blocket'],       color: '#F71414' },
  { key: 'reverb',        label: 'Reverb',        stored: ['reverb'],        color: '#EC5A2C' },
  { key: 'kleinanzeigen', label: 'Kleinanzeigen', stored: ['kleinanzeigen'], color: '#86BC25' },
] as const

export const ALL_SOURCE_KEYS: readonly string[] = MATCH_SOURCES.map((s) => s.key)

/**
 * Expand operator-facing keys into the stored identifiers to filter on.
 *
 * An unknown key contributes nothing rather than being passed through as a
 * literal source value — a typo'd or hand-crafted `sources` parameter must not
 * become an arbitrary column filter.
 */
export function storedSourcesFor(keys: readonly string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const source = MATCH_SOURCES.find((s) => s.key === key)
    if (!source) continue
    for (const value of source.stored) if (!out.includes(value)) out.push(value)
  }
  return out
}

/** Map a stored `listings.source` value back to its operator-facing source. */
export function sourceForStored(stored: string): MatchSource | null {
  return MATCH_SOURCES.find((s) => s.stored.includes(stored)) ?? null
}

/**
 * Per-source quota for one candidate sweep.
 *
 * The previous query was a single `.limit(limit * 3)` across every selected
 * source, then `.slice(0, 50)` before scoring. Reverb alone holds ~40,850 active
 * rows against Kleinanzeigen's ~2,141, and PostgREST returns whatever the plan
 * emits first, so a broad product name could fill all 50 scored slots from one
 * marketplace and starve the rest — invisibly, since the operator only ever sees
 * what survived.
 *
 * Querying each source separately with its own ceiling makes the floor
 * explicit: with five sources selected, none can take more than a fifth of the
 * sweep, and a source with only three matching rows still contributes all three.
 */
export function perSourceQuota(limit: number, selectedCount: number): number {
  if (selectedCount <= 0) return 0
  return Math.max(5, Math.ceil((limit * 2) / selectedCount))
}
