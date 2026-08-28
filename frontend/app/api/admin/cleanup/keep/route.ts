import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// POST /api/admin/cleanup/keep
// Body: { id: string }
export async function POST(req: NextRequest) {
  // S1. Admin authorisation runs FIRST — before the body is parsed, before a
  // Supabase client is constructed and before any read or write. The edge
  // classification in lib/route-access.ts already denies non-admins, and it
  // stays; this is the second layer, so a middleware regression cannot turn a
  // catalogue-mutating route into an open one.
  //
  // It replaces a local `requireAuth()` that checked only for A SESSION. Any
  // signed-in visitor satisfied it, and these routes inactivate, merge and
  // insert `kg_product` rows. requireAdminInRoute() is the repository's
  // existing helper: 401 without a session, 403 without `is_admin`.
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { id }: { id: string } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('kg_product')
    .update({ cleanup_status: 'clean' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
