import { NextResponse } from 'next/server'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { CATALOGUE_CACHE_CONTROL, cachedDiscover } from '@/lib/browse-cache'
import type { ProductFamilyRef } from '@/lib/family-cards'

/**
 * NEVER PRERENDERED; CACHED FOR ONE MINUTE (PAN-263).
 *
 * This route has no dynamic inputs — no params, no searchParams, no cookies —
 * so Next.js will happily treat it as static and bake a catalogue payload into
 * .next/server/app/api/discover.body at build time. That payload then survives
 * every depublish until the next deploy: a product withdrawn through the
 * promotion seam would keep appearing on the homepage of a running deployment,
 * with no way to correct it short of redeploying.
 *
 * Eligibility is a correctness boundary, so it is never baked in:
 *   - `force-dynamic` stops build-time prerendering;
 *   - `revalidate = 0` stops the full-route data cache;
 *   - the payload comes from lib/browse-cache.ts, which re-reads the supported
 *     set every `CATALOGUE_REVALIDATE_SECONDS`, and the `Cache-Control` lets
 *     the CDN hold it for the same window.
 * A withdrawal is visible within one minute. This used to be "on the NEXT
 * request" at a measured cost of 0.55–1.5 s per homepage view; the trade is
 * recorded in lib/browse-cache.ts. No `fetchCache = 'force-no-store'` here: it
 * would bypass the cache (see app/api/search/resolve).
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export type DiscoverProduct = {
  slug: string
  canonical_name: string
  image_url: string | null
  brand_name: string
  active_listing_count: number
  family: ProductFamilyRef | null
}

/**
 * Homepage shelves.
 *
 * Stage 3 WP-1 added /api/discover to PUBLIC_PREFIXES. It was auth-gated, so
 * the anonymous homepage fetched it, received the /login redirect, and
 * silently rendered zero catalogue — a header, a headline, a search box and a
 * footer. The selection itself now filters to the supported cohort in
 * lib/browse.ts, so opening the route cannot expose an unsupported product.
 */
export async function GET() {
  try {
    const response = await cachedDiscover()
    return NextResponse.json(response, {
      headers: { 'Cache-Control': CATALOGUE_CACHE_CONTROL },
    })
  } catch (error) {
    // Absence and unavailability are different facts. A catalogue we cannot
    // read is 503, not an empty-but-successful homepage — and neither is
    // cached, because an empty catalogue cached for five minutes reads to a
    // visitor as "Klup follows nothing".
    if (isCatalogueUnavailable(error)) {
      console.error('[operational] discover eligibility unavailable', {
        route: '/api/discover',
        stage: error.stage,
      })
      return NextResponse.json({ error: 'catalogue_unavailable' }, {
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
        status: 503,
      })
    }
    return NextResponse.json({ legendary: [], popular: [] }, {
      headers: { 'Cache-Control': 'no-store' },
      status: 500,
    })
  }
}
