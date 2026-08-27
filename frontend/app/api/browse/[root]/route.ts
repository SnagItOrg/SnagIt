import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { isCatalogueUnavailable } from '@/lib/catalogue'
import { buildBrowseLeafResponse } from '@/lib/browse'

/** Never prerendered — see app/api/discover/route.ts. */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  req: NextRequest,
  { params }: { params: { root: string } },
) {
  const admin = getSupabaseAdmin()
  const rootSlug = params.root
  const debugRequested = req.nextUrl.searchParams.get('debug') === '1'
  let includeDebug = false
  if (debugRequested) {
    const adminOk = await isCurrentUserAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    includeDebug = true
  }
  const rawPage = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)
  const rawPageSize = parseInt(req.nextUrl.searchParams.get('page_size') ?? '48', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(Math.max(rawPageSize, 1), 100)
    : 48

  try {
    const response = await buildBrowseLeafResponse({
      admin,
      rootSlug,
      page,
      pageSize,
      includeDebug,
    })

    if (!response) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    return NextResponse.json(response, {
      headers: includeDebug
        ? { 'Cache-Control': 'private, no-store' }
        : { 'Cache-Control': 'no-store' },
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
