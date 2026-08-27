import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { buildDiscoverResponse } from '@/lib/browse'
import { isCatalogueUnavailable } from '@/lib/catalogue'

/**
 * NEVER PRERENDERED, NEVER CACHED.
 *
 * This route has no dynamic inputs — no params, no searchParams, no cookies —
 * so Next.js will happily treat it as static and bake a catalogue payload into
 * .next/server/app/api/discover.body at build time. That payload then survives
 * every depublish until the next deploy: a product withdrawn through the
 * promotion seam would keep appearing on the homepage of a running deployment,
 * with no way to correct it short of redeploying.
 *
 * Eligibility is a correctness boundary, so it is resolved per request:
 *   - `force-dynamic` stops build-time prerendering;
 *   - `revalidate = 0` stops the full-route data cache;
 *   - `no-store` stops the CDN and the browser holding it;
 *   - lib/catalogue.ts holds no memo, so the supported set is re-read too.
 * A withdrawal is visible on the NEXT request.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export type DiscoverProduct = {
  slug: string
  canonical_name: string
  image_url: string | null
  brand_name: string
  active_listing_count: number
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
  const admin = getSupabaseAdmin()

  try {
    const response = await buildDiscoverResponse(admin)
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
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
