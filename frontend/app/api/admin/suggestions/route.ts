import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function verifyAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  if (!prefs?.is_admin) return { ok: false }
  return { ok: true, userId: user.id }
}

// GET /api/admin/suggestions?status=pending&offset=0&limit=50
export async function GET(req: NextRequest) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10)
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)

  const admin = getSupabaseAdmin()

  const { data, error, count } = await admin
    .from('kg_product_suggestions')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('listing_count', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suggestions: data ?? [], total: count ?? 0 })
}
