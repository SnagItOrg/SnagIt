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

// POST /api/admin/suggestions/bulk/reject
// Body: { suggestion_ids: string[] }
export async function POST(req: NextRequest) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { suggestion_ids }: { suggestion_ids: string[] } = await req.json()
  if (!suggestion_ids?.length) {
    return NextResponse.json({ error: 'Missing suggestion_ids' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { error } = await admin
    .from('kg_product_suggestions')
    .update({
      status: 'rejected',
      reviewed_by: auth.userId,
      reviewed_at: now,
    })
    .in('id', suggestion_ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
