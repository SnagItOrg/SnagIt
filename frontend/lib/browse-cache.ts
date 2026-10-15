import { unstable_cache } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  buildBrowseLeafResponse,
  buildBrowseRootResponse,
  buildCatalogueTreeResponse,
  buildDiscoverResponse,
} from '@/lib/browse'

/**
 * PAN-263 — the public catalogue reads, cached for one minute.
 *
 * WHY THIS EXISTS. Every public surface is a client shell that waits on one of
 * these builders, and each builder is 3–6 serial PostgREST round trips at
 * ≈120–180 ms each, with stalls of 1–6 s. Measured on production 2026-10-15:
 * `/api/browse/[root]` 0.78–1.09 s (one run 6.49 s), `/api/browse` 0.61–1.50 s,
 * `/api/discover` 0.55–1.51 s, `/api/catalogue-tree` 0.55–0.63 s on every full
 * page load for the sidebar. Lighthouse (mobile) put 4.1 s of the browse page's
 * 4.8 s LCP in "waiting for the API". None of it was cached anywhere.
 *
 * WHAT THIS REVERSES, STATED PLAINLY. `/api/discover`, `/` and `lib/catalogue`
 * carried "NEVER CACHED" decisions (PAN-68, PAN-84, PAN-86): a depublished
 * product must leave the homepage on the next request. With this cache a
 * withdrawal can stay visible for up to `CATALOGUE_REVALIDATE_SECONDS`. The
 * owner accepted a bounded staleness in PAN-263; one minute is the tightest
 * bound that still removes the cost, and it is the precedent `/api/search/
 * resolve` already runs for the same eligibility set. The cache holds values
 * only: a `CatalogueUnavailableError` is never stored, so a failed read is
 * still a 503 on the route and the next request retries.
 *
 * The debug (admin audit) payloads are NOT routed through here. They are
 * session-gated and answered `private, no-store` by their routes, and a shared
 * cache must never hold them.
 *
 * `unstable_cache` serialises its arguments into the key, so every function
 * here takes primitives only and creates the admin client inside the callback.
 * The same reason keeps `fetchCache = 'force-no-store'` off every caller: under
 * it Next bypasses `unstable_cache` entirely (see app/api/search/resolve).
 */
export const CATALOGUE_REVALIDATE_SECONDS = 60

/** The `Cache-Control` the public JSON routes send, so the Vercel CDN answers repeats. */
export const CATALOGUE_CACHE_CONTROL =
  `public, s-maxage=${CATALOGUE_REVALIDATE_SECONDS}, stale-while-revalidate=600`

export const cachedBrowseRoot = unstable_cache(
  () => buildBrowseRootResponse({ admin: getSupabaseAdmin(), includeDebug: false }),
  ['browse-root'],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS },
)

export const cachedBrowseLeaf = unstable_cache(
  (rootSlug: string, page: number, pageSize: number) =>
    buildBrowseLeafResponse({
      admin: getSupabaseAdmin(),
      rootSlug,
      page,
      pageSize,
      includeDebug: false,
    }),
  ['browse-leaf'],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS },
)

export const cachedCatalogueTree = unstable_cache(
  () => buildCatalogueTreeResponse(getSupabaseAdmin()),
  ['catalogue-tree'],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS },
)

export const cachedDiscover = unstable_cache(
  () => buildDiscoverResponse(getSupabaseAdmin()),
  ['discover'],
  { revalidate: CATALOGUE_REVALIDATE_SECONDS },
)
