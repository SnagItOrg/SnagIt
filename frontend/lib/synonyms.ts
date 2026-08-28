/**
 * Reviewed navigation synonyms.
 *
 * Maps a normalised query to a canonical search term. Keys must already be
 * normalised (lower-case, ASCII-folded) by `lib/query-normalizer.ts`.
 *
 * Stage 3 WP-4 removed the pre-pivot multi-vertical residue — `macmini`,
 * `apple mac mini`, `imac`, `macbook pro`, `airpods pro` — which mapped
 * consumer-electronics terms into a music-instrument catalogue and were left
 * over from the abandoned multi-vertical thesis (build plan §8.3, decision 17).
 * Only the two music entries survive.
 *
 * THESE ARE NAVIGATION SYNONYMS, NEVER MATCHER ALIASES. Nothing here reaches
 * `lib/matching/**`. A synonym may only ever point at a term; whether the
 * resulting product is reachable is decided afterwards by the four-axis
 * eligibility predicate in `lib/catalogue.ts`, and a dangerous term is blocked
 * from auto-navigation before a synonym is consulted at all.
 */
const SYNONYMS: Record<string, string> = {
  'space echo': 'roland re-201',
  're201': 're-201',
}

/**
 * Returns the canonical synonym for a normalised query, or null if none exists.
 */
export function lookupSynonym(normalizedQuery: string): string | null {
  return SYNONYMS[normalizedQuery] ?? null
}

/** Read-only view of the reviewed map, for the resolver and its tests. */
export function allSynonyms(): Readonly<Record<string, string>> {
  return SYNONYMS
}
