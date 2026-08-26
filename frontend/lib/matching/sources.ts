/**
 * Single source of truth for which marketplace sources the automatic matcher
 * is allowed to process.
 *
 * WHY THIS EXISTS: the identifiers here must be the values actually stored in
 * `listings.source`, not the short names used in UI filters or CLI flags. The
 * matcher previously filtered on the literal `'dba'`, but DBA rows are stored
 * as `'dba.dk'` (see `frontend/lib/scrapers/schibsted.ts` DBA_CONFIG and
 * `frontend/lib/scrapers/dba-listing.ts`). The filter therefore silently
 * matched nothing for DBA, and `'kleinanzeigen'` was never listed at all — so
 * neither source was ever auto-matched. Both gaps are invisible at runtime:
 * the query succeeds and simply returns fewer rows.
 *
 * This list is an ALLOWLIST, deliberately. A new scraper does not become
 * matchable by accident — it has to be added here, which is the point at
 * which someone has to think about whether its titles are structured enough
 * to match safely.
 *
 * `thomann` is intentionally excluded: it is a NEW/retail price reference, not
 * a secondhand listing source, and mixing it into product matching would put
 * retail prices into secondhand price statistics.
 */

export const MATCHER_SOURCES = [
  'reverb',
  'finn',
  'blocket',
  'dba.dk',
  'kleinanzeigen',
] as const

export type MatcherSource = (typeof MATCHER_SOURCES)[number]

/** Mutable copy for query builders (PostgREST `.in()` wants a plain array). */
export function matcherSourceList(): string[] {
  return [...MATCHER_SOURCES]
}

export function isMatcherSource(source: string | null | undefined): source is MatcherSource {
  if (!source) return false
  return (MATCHER_SOURCES as readonly string[]).includes(source)
}
