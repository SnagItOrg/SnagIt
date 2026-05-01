import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCurrentAdminState } from '@/lib/admin-auth'

export async function GET(req: NextRequest) {
  const { userId, isAdmin } = await getCurrentAdminState()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const q = req.nextUrl.searchParams.get('q')?.trim()
  const tier = req.nextUrl.searchParams.get('tier')

  let query = admin
    .from('kg_product')
    .select('id, slug, canonical_name, tier, browse_visibility, year_released, image_url, kg_brand(name)')
    .eq('status', 'active')
    .order('canonical_name')
    .limit(60)

  if (q) {
    query = query.ilike('canonical_name', `%${q}%`)
  } else if (tier) {
    query = query.eq('tier', tier)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
}
