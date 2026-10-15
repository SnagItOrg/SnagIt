import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { buildBrowseRootResponse } from '@/lib/browse'
import { CATALOGUE_CACHE_CONTROL, cachedBrowseRoot } from '@/lib/browse-cache'

/**
 * Never prerendered: the tile counts are catalogue eligibility, and a baked
 * payload would keep advertising a withdrawn product until the next deploy.
 * See app/api/discover/route.ts for the full reasoning.
 *
 * PAN-263: the public payload is served from the one-minute catalogue cache
 * (lib/browse-cache.ts) and carries a CDN `Cache-Control`; the admin audit
 * payload is still built per request and stays `private, no-store`.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  const debugRequested = req.nextUrl.searchParams.get('debug') === '1'
  let includeDebug = false
  if (debugRequested) {
    const adminOk = await isCurrentUserAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    includeDebug = true
  }

  try {
    const response = includeDebug
      ? await buildBrowseRootResponse({ admin, includeDebug })
      : await cachedBrowseRoot()

    return NextResponse.json(response, {
      headers: includeDebug
        ? { 'Cache-Control': 'private, no-store' }
        : { 'Cache-Control': CATALOGUE_CACHE_CONTROL },
    })
  } catch (error) {
    // Absence is not unavailability, and a public body never carries the
    // internal message — it used to echo error.message verbatim.
    if (isCatalogueUnavailable(error)) {
      console.error('[operational] browse eligibility unavailable', {
        route: '/api/browse',
        stage: error.stage,
      })
      return NextResponse.json({ error: 'catalogue_unavailable' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
      })
    }
    console.error('[operational] browse request failed', error)
    return NextResponse.json({ error: 'internal_error' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
