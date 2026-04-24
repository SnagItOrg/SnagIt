import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function verifyAdmin(): Promise<boolean> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  return !!prefs?.is_admin
}

// GET /api/admin/match/search?q=Roland+Juno
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ products: [] })

  const admin = getSupabaseAdmin()

  const { data } = await admin
    .from('kg_product')
    .select('id, canonical_name, slug, kg_brand(name)')
    .eq('status', 'active')
    .ilike('canonical_name', `%${q}%`)
    .order('canonical_name')
    .limit(10)

  return NextResponse.json({ products: data ?? [] })
}
