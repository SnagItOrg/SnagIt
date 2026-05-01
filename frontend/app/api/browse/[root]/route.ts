import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { buildBrowseLeafResponse } from '@/lib/browse'

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
        : { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load browse category'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
