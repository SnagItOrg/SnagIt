import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CATALOGUE_STATE_SELECT,
  CatalogueUnavailableError,
  isCatalogueUnavailable,
} from '@/lib/catalogue'
import { NAVIGATION_FAMILIES } from '@/lib/families'
import { loadSearchIndex } from '@/lib/search-index'
import {
  applyEligibility,
  filterEligibleSlugs,
  resolveQuery,
  type SearchOutcome,
} from '@/lib/search-resolver'

/**
 * The restricted-catalogue resolver endpoint.
 *
 * Stage 3 WP-4. See docs/stage-3-v1-decision-and-build-plan.md §8.2.
 *
 * WHAT THIS REPLACES. `/search` used to call `/api/scrape`, which ran four
 * live marketplace scrapes per query and upserted every result into
 * `listings` — an unauthenticated public write path driven by free text. This
 * route reads the committed index, re-validates against live catalogue state,
 * and returns a decision. It performs no scrape and no write of any kind.
 *
 * NEVER PRERENDERED, NEVER CACHED. The response embeds catalogue eligibility,
 * and WP-1's H1 correction established that a baked eligibility payload keeps
 * advertising a product after it has been withdrawn. `force-dynamic` stops
 * build-time prerendering, `revalidate = 0` stops the full-route data cache,
 * and `no-store` stops the CDN and the browser holding it. A depublish is
 * visible on the next request.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const MAX_QUERY_LENGTH = 120

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Eligibility could not be established — as distinct from "nothing matched".
 *
 * Absence is a resolved outcome with an honest message; unavailability is 503
 * and is never cached. Carries no database detail: the stage is logged on the
 * operational channel (build plan §12.4.8) and never serialised.
 */
function catalogueUnavailable() {
  return NextResponse.json(
    { error: 'catalogue_unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
  )
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('q') ?? ''

  if (raw.trim().length === 0) {
    return noStore({ error: 'missing_query' }, 400)
  }
  if (raw.length > MAX_QUERY_LENGTH) {
    return noStore({ error: 'query_too_long' }, 400)
  }

  const index = loadSearchIndex()
  const resolved = resolveQuery(raw, index)

  try {
    const settled = await revalidate_(resolved)
    return noStore(settled, 200)
  } catch (error) {
    if (isCatalogueUnavailable(error)) {
      console.error('[operational] search eligibility unavailable', {
        route: '/api/search/resolve',
        stage: error.stage,
      })
      return catalogueUnavailable()
    }
    console.error('[operational] search resolve failed', error)
    return noStore({ error: 'internal_error' }, 500)
  }
}

/**
 * Re-decide every claimed slug against live state before it reaches a visitor.
 *
 * THE INDEX IS A CLAIM, NOT AN AUTHORITY. It is generated at build time, so
 * between deploys an operator can depublish or unsupport a product through the
 * promotion seam. Re-checking here is what makes "no result links to a 404"
 * true: a withdrawn product stops being a navigation target and stops being a
 * candidate on the same request that withdrew it.
 */
async function revalidate_(outcome: SearchOutcome): Promise<SearchOutcome> {
  const productSlugs = [
    ...outcome.candidates.filter((c) => c.kind === 'product').map((c) => c.slug),
    ...outcome.suggestions.filter((c) => c.kind === 'product').map((c) => c.slug),
  ]
  if (outcome.navigateTo?.startsWith('/product/')) {
    productSlugs.push(outcome.navigateTo.slice('/product/'.length))
  }

  const unique = Array.from(new Set(productSlugs))

  const admin = getSupabaseAdmin()
  const eligibleProducts = await filterEligibleSlugs(
    {
      canonicalRows: async () => {
        const res = await admin
          .from('kg_product')
          .select(CATALOGUE_STATE_SELECT)
          .eq('status', CANONICAL_STATUS)
          .eq('support_state', CANONICAL_SUPPORT)
          .in('slug', unique)
          .then(
            (r) => r,
            (err) => ({ data: null, error: err ?? new Error('transport') }),
          )
        return { data: res.data, error: res.error }
      },
      domainRows: async () => {
        const res = await admin
          .from('browse_product_projection')
          .select('slug, browse_domain')
          .in('slug', unique)
          .then(
            (r) => r,
            () => {
              throw new CatalogueUnavailableError('search_domain_transport')
            },
          )
        return { data: res.data, error: res.error }
      },
    },
    unique,
  )

  // Families are reviewed code, not a database entity, so they are validated
  // against the family list rather than against the four-axis predicate. An
  // empty `NAVIGATION_FAMILIES` (the state until WP-2 lands) therefore removes
  // every family result rather than linking to a route that does not exist.
  const eligibleFamilies = new Set(NAVIGATION_FAMILIES.map((f) => f.slug))

  return applyEligibility(outcome, eligibleProducts, eligibleFamilies)
}
