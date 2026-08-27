/**
 * The single eligibility authority for public catalogue entities.
 *
 * Stage 3 V1, WP-1. See docs/stage-3-v1-decision-and-build-plan.md §3.1 and §7.5.
 *
 * A slug renders a canonical product page IFF all four hold:
 *
 *   kg_product.status                        = 'active'
 *   kg_product.support_state                 = 'supported'
 *   kg_product.browse_visibility             = 'public'
 *   browse_product_projection.browse_domain  = 'music'
 *
 * That is exactly 14 rows in production today. Everything else is 404 to the
 * public, with two exceptions resolved BEFORE eligibility is evaluated:
 *   - a slug present in lib/families.ts redirects to /family/<slug>;
 *   - an active+supported+qa_only row renders for a verified admin session.
 *
 * WHY THIS FILE HAS NO IMPORTS. It is the one place the five-axis product-state
 * model of CLAUDE.md §2 is turned into a runtime decision, so it must be
 * trivially testable from a plain Node context with no Next.js, Supabase or DOM
 * dependency. Callers pass a fetcher; this module owns the predicate.
 *
 * FAIL-CLOSED. A row loaded without `support_state` — an old cached shape, a
 * partial select, a view that has not been refreshed — is NOT eligible. This
 * mirrors `isMatchableProduct` in lib/matching/match-listings.ts, which refuses
 * to match a product whose support axis it cannot read.
 */

export const CANONICAL_STATUS = 'active' as const
export const CANONICAL_SUPPORT = 'supported' as const
export const CANONICAL_VISIBILITY = 'public' as const
export const CANONICAL_DOMAIN = 'music' as const

/** Admin-only preview state: matcher-eligible but deliberately unpublished. */
export const ADMIN_ONLY_VISIBILITY = 'qa_only' as const

export type SupportState = 'known' | 'reserve' | 'supported'
export type BrowseVisibility = 'public' | 'qa_only' | 'hidden'

/**
 * The four axes an eligibility decision reads, and nothing else.
 * Every field is optional so that a partial row is representable — and refused.
 */
export interface CatalogueStateRow {
  status?: string | null
  support_state?: string | null
  browse_visibility?: string | null
  browse_domain?: string | null
}

/** Columns required from `kg_product` to decide support and visibility. */
export const CATALOGUE_STATE_SELECT = 'slug, status, support_state, browse_visibility'

/** True only for a row that is active, supported and in the music domain. */
export function isSupportedMusicProduct(row: CatalogueStateRow | null | undefined): boolean {
  if (!row) return false
  if (row.status !== CANONICAL_STATUS) return false
  if (row.support_state !== CANONICAL_SUPPORT) return false
  if (row.browse_domain !== CANONICAL_DOMAIN) return false
  return true
}

/**
 * The canonical-product-page predicate. All four axes, exact match, fail-closed.
 * Never infer one axis from another (CLAUDE.md §2).
 */
export function isCanonical(row: CatalogueStateRow | null | undefined): boolean {
  if (!isSupportedMusicProduct(row)) return false
  return row!.browse_visibility === CANONICAL_VISIBILITY
}

/**
 * True for the 34 supported+private rows: matcher-eligible, never public, but
 * renderable to a verified admin session behind a QA banner.
 */
export function isAdminOnly(row: CatalogueStateRow | null | undefined): boolean {
  if (!isSupportedMusicProduct(row)) return false
  return row!.browse_visibility === ADMIN_ONLY_VISIBILITY
}

export type SlugRole = 'canonical' | 'admin_only' | 'family' | 'not_found'

/**
 * Resolve what a slug is allowed to be.
 *
 * ORDER MATTERS. The family check runs FIRST, because the six family-label rows
 * are public-but-unsupported: they would otherwise fall through to `not_found`
 * and 404 instead of redirecting to their navigation route.
 *
 * `isAdmin` must be established server-side (user_preferences.is_admin), never
 * from a client-supplied flag.
 */
export function resolveSlugRole(args: {
  row: CatalogueStateRow | null | undefined
  isFamilySlug: boolean
  isAdmin: boolean
}): SlugRole {
  if (args.isFamilySlug) return 'family'
  if (isCanonical(args.row)) return 'canonical'
  if (args.isAdmin && isAdminOnly(args.row)) return 'admin_only'
  return 'not_found'
}

/* ------------------------------------------------------------------ *
 * Failure model — absence is not unavailability
 * ------------------------------------------------------------------ */

/**
 * Thrown when eligibility CANNOT BE ESTABLISHED: a Supabase error, a network
 * failure, a malformed payload.
 *
 * This is deliberately distinct from "the row is absent or ineligible". Both
 * used to collapse into 404, which told a monitor, a crawler and an operator
 * that a product does not exist when in fact the database was unreachable —
 * and, worse, invited a caller to cache that 404. Absence is a 404;
 * unavailability is a 5xx and is never cached.
 *
 * The message is fixed and carries no database detail. Query errors are logged
 * server-side (operational channel, build plan §12.4.8) and never serialised
 * into a public response.
 */
export class CatalogueUnavailableError extends Error {
  readonly kind = 'catalogue_unavailable' as const

  constructor(readonly stage: string) {
    super('Catalogue eligibility could not be established.')
    this.name = 'CatalogueUnavailableError'
  }
}

export function isCatalogueUnavailable(error: unknown): error is CatalogueUnavailableError {
  return error instanceof CatalogueUnavailableError
}

/** Outcome of a single-slug eligibility lookup. */
export type LookupOutcome<T> =
  | { status: 'found'; row: T }
  | { status: 'absent' }

/* ------------------------------------------------------------------ *
 * Slug-set loaders
 * ------------------------------------------------------------------ */

export type CatalogueFetchResult = {
  data: unknown
  error: unknown
}

export type CatalogueFetcher = () => Promise<CatalogueFetchResult>

/**
 * Rows are re-validated here rather than trusted from the query, so a caller
 * that forgets a filter still cannot widen the set.
 *
 * `browse_domain` is not a column on `kg_product`, so these loaders assert the
 * support and visibility axes only. The music axis is enforced separately and
 * verifiably: the projection query that consumes these slugs pins
 * `browse_domain='music'`, the product route reads the projection per slug, and
 * `assertSupportedCohortIsMusic()` below turns the remaining assumption into a
 * checked assertion.
 */
function collectSlugs(rows: unknown, wantVisibility: string | null): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(rows)) return out

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const slug = row.slug
    if (typeof slug !== 'string' || slug.length === 0) continue
    if (row.status !== CANONICAL_STATUS) continue
    if (row.support_state !== CANONICAL_SUPPORT) continue
    if (wantVisibility !== null && row.browse_visibility !== wantVisibility) continue
    out.add(slug)
  }

  return out
}

/**
 * NO CACHING, DELIBERATELY.
 *
 * An earlier revision memoised these sets for 60 seconds. That made a depublish
 * or an unsupport take up to a minute to disappear from the homepage, browse
 * and discover — a window in which a product the operator had just withdrawn
 * was still being advertised, and in which the promotion seam's own before/after
 * manifest disagreed with what the site was serving. Eligibility is a
 * correctness boundary, not a hot path: the supported cohort is 48 rows on a
 * single indexed predicate, and the build plan is explicit that performance is
 * not a concern at this size. A withdrawal is now visible on the NEXT request.
 */
async function loadSlugSet(
  fetcher: CatalogueFetcher,
  wantVisibility: string | null,
  stage: string,
): Promise<Set<string>> {
  let result: CatalogueFetchResult
  try {
    result = await fetcher()
  } catch {
    throw new CatalogueUnavailableError(stage)
  }
  if (result.error) throw new CatalogueUnavailableError(stage)
  if (!Array.isArray(result.data)) throw new CatalogueUnavailableError(stage)
  return collectSlugs(result.data, wantVisibility)
}

/** The 48 matcher-eligible slugs: active + supported. Never cached. */
export function loadSupportedSlugs(fetcher: CatalogueFetcher): Promise<Set<string>> {
  return loadSlugSet(fetcher, null, 'supported_slugs')
}

/** The 14 canonical slugs: active + supported + public. Never cached. */
export function loadCanonicalSlugs(fetcher: CatalogueFetcher): Promise<Set<string>> {
  return loadSlugSet(fetcher, CANONICAL_VISIBILITY, 'canonical_slugs')
}

/**
 * Turns the "every supported product is music" assumption into an assertion.
 *
 * The four-axis contract in §3.1 is enforced per-slug by the product route,
 * which reads `browse_domain` from the projection. The slug-set loaders above
 * can only see three axes, so this closes the gap for every set-based surface:
 * it fails loudly if a supported row ever appears outside the music domain
 * instead of letting a non-music product ride into a public list.
 *
 * `rows` are `{ slug, browse_domain }` from `browse_product_projection`.
 */
export function assertSupportedCohortIsMusic(
  supportedSlugs: Set<string>,
  rows: Array<{ slug?: string | null; browse_domain?: string | null }>,
): void {
  const seen = new Set<string>()
  const offenders: string[] = []

  for (const row of rows) {
    if (typeof row.slug !== 'string') continue
    if (!supportedSlugs.has(row.slug)) continue
    seen.add(row.slug)
    if (row.browse_domain !== CANONICAL_DOMAIN) offenders.push(row.slug)
  }

  if (offenders.length > 0) {
    throw new CatalogueUnavailableError(
      `supported_cohort_not_music:${offenders.sort().join(',')}`,
    )
  }
}
