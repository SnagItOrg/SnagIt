import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CATALOGUE_STATE_SELECT,
  CatalogueUnavailableError,
  isCatalogueUnavailable,
} from '@/lib/catalogue'
import { NAVIGATION_FAMILIES } from '@/lib/families'
import {
  SEARCH_PRODUCT_SELECT,
  buildSearchIndex,
  loadProductEntities,
  type SearchEntity,
} from '@/lib/search-index'
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
 * route resolves against the supported cohort, re-validates against live
 * catalogue state, and returns a decision. It performs no scrape and no write
 * of any kind.
 *
 * THE RESPONSE IS NEVER PRERENDERED OR CACHED. It embeds catalogue eligibility,
 * and WP-1's H1 correction established that a baked eligibility payload keeps
 * advertising a product after it has been withdrawn. `force-dynamic` stops
 * build-time prerendering and keeps every `fetch` here uncached (the Supabase
 * client passes no cache option, so Next treats each one as no-store),
 * `revalidate = 0` stops the full-route data cache, and `no-store` stops the
 * CDN and the browser holding the response. A depublish is visible on the next
 * request.
 *
 * ONLY THE INDEX IS CACHED — see `productEntities` below. That is why there is
 * no `fetchCache = 'force-no-store'` here: under it Next bypasses
 * `unstable_cache` entirely, and `force-dynamic` already keeps the eligibility
 * reads uncached.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * How long the product section of the index may be served before it is re-read.
 *
 * WHY CACHING IS SAFE AT ALL. The index is a claim, not an authority: every
 * slug it yields is re-decided on every request by `revalidate_()` below, and
 * that check is never cached. A stale index therefore cannot publish,
 * unpublish or mislink anything. It can only be late to RECOGNISE a newly
 * supported product, or keep recognising a withdrawn one that the gate then
 * refuses.
 *
 * WHY 60 SECONDS. The goal is that a product the owner supports is searchable
 * within minutes, not at the next deploy. `unstable_cache` serves an expired
 * entry once while it refreshes in the background, so a newly supported product
 * is findable from the first search after the refresh — about a minute. A
 * longer window saves almost nothing: the refresh is two small reads (the ~90
 * supported rows, then their projection rows), at most once a minute rather
 * than on every search. A shorter one would shrink a delay nobody needs shrunk.
 *
 * ON ERROR, FAIL CLOSED. A failed read raises `CatalogueUnavailableError` and
 * the request answers 503. `unstable_cache` stores values only, so a failure is
 * never cached and the next request tries again. If a background refresh
 * fails, Next keeps serving the last good list, which is still safe: the
 * uncached eligibility check reads the same database and 503s if it is down.
 * There is no fallback to a file in the repository. It could only ever be
 * staler than the last good cached list.
 */
const PRODUCT_ENTITIES_REVALIDATE_SECONDS = 60

const productEntities = unstable_cache(
  (): Promise<SearchEntity[]> => {
    const admin = getSupabaseAdmin()
    return loadProductEntities({
      productRows: async () => {
        const res = await admin
          .from('kg_product')
          .select(SEARCH_PRODUCT_SELECT)
          .eq('status', CANONICAL_STATUS)
          .eq('support_state', CANONICAL_SUPPORT)
        return { data: res.data, error: res.error }
      },
      domainRows: async (slugs) => {
        const res = await admin
          .from('browse_product_projection')
          .select('slug, browse_domain')
          .in('slug', slugs)
        return { data: res.data, error: res.error }
      },
    })
  },
  ['search-product-entities'],
  { revalidate: PRODUCT_ENTITIES_REVALIDATE_SECONDS },
)

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

  try {
    const index = buildSearchIndex(await productEntities(), NAVIGATION_FAMILIES)
    const resolved = resolveQuery(raw, index)
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
 * THE INDEX IS A CLAIM, NOT AN AUTHORITY. It is cached for up to a minute, so
 * an operator can depublish or unsupport a product through the promotion seam
 * while the index still names it. Re-checking here is what makes "no result
 * links to a 404" true: a withdrawn product stops being a navigation target and
 * stops being a candidate on the same request that withdrew it.
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
