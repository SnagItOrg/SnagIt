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

// GET /api/admin/msrp?q=fender — search kg_product
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json([])

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('kg_product')
    .select('id, canonical_name, msrp_dkk, thomann_url, kg_brand!inner(name)')
    .ilike('canonical_name', `%${q}%`)
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// PATCH /api/admin/msrp — update msrp_dkk or thomann_url
export async function PATCH(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, msrp_dkk, thomann_url } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (msrp_dkk !== undefined) updates.msrp_dkk = msrp_dkk === '' ? null : parseInt(String(msrp_dkk), 10)
  if (thomann_url !== undefined) updates.thomann_url = thomann_url === '' ? null : String(thomann_url)

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('kg_product')
    .update(updates)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
