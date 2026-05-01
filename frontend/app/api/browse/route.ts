import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { buildBrowseRootResponse } from '@/lib/browse'

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const debugRequested = req.nextUrl.searchParams.get('debug') === '1'
  let includeDebug = false
  if (debugRequested) {
    const adminOk = await isCurrentUserAdmin()
    if (!adminOk) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    includeDebug = true
  }

  try {
    const response = await buildBrowseRootResponse({
      admin,
      supabaseUrl,
      includeDebug,
    })

    return NextResponse.json(response, {
      headers: includeDebug
        ? { 'Cache-Control': 'private, no-store' }
        : { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load categories'
    console.error('Browse root API failed:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
