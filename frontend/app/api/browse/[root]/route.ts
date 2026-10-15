import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { buildBrowseLeafResponse } from '@/lib/browse'
import { CATALOGUE_CACHE_CONTROL, cachedBrowseLeaf } from '@/lib/browse-cache'

/**
 * Never prerendered — see app/api/discover/route.ts.
 *
 * PAN-263: the public payload is served from the one-minute catalogue cache
 * (lib/browse-cache.ts, keyed by root) and carries a CDN
 * `Cache-Control`; the admin audit payload is still built per request and
 * stays `private, no-store`.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ root: string }> },
) {
  const params = await ctx.params
  const admin = getSupabaseAdmin()
  const rootSlug = params.root
  const debugRequested = req.nextUrl.searchParams.get('debug') === '1'
  let includeDebug = false
  if (debugRequested) {
    const adminOk = await isCurrentUserAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    includeDebug = true
  }
  // PAN-267: no `page` / `page_size` any more — the response is the whole
  // root, and the page reveals it in steps. The parameters are ignored if an
  // old client still sends them.
  try {
    const response = includeDebug
      ? await buildBrowseLeafResponse({ admin, rootSlug, includeDebug })
      : await cachedBrowseLeaf(rootSlug)

    if (!response) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

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
        route: '/api/browse/[root]',
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
