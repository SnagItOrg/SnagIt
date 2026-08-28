import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// POST /api/admin/cleanup/merge
// Body: { dirty_id: string, clean_id: string }
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

  const { dirty_id, clean_id }: { dirty_id: string; clean_id: string } = await req.json()
  if (!dirty_id || !clean_id) {
    return NextResponse.json({ error: 'Missing dirty_id or clean_id' }, { status: 400 })
  }
  if (dirty_id === clean_id) {
    return NextResponse.json({ error: 'dirty_id and clean_id must differ' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // 1. Fetch current listing matches for dirty product
  const { data: matches, error: matchErr } = await admin
    .from('listing_product_match')
    .select('listing_id')
    .eq('product_id', dirty_id)

  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 })

  // 2. Reassign matches to clean product (upsert, skip duplicates)
  if (matches && matches.length > 0) {
    const reassigned = matches.map((m) => ({
      listing_id: m.listing_id,
      product_id: clean_id,
    }))
    const { error: upsertErr } = await admin
      .from('listing_product_match')
      .upsert(reassigned, { onConflict: 'listing_id,product_id', ignoreDuplicates: true })
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  // 3. Mark dirty product as merged + inactive
  const { error: dirtyErr } = await admin
    .from('kg_product')
    .update({ cleanup_status: 'merged', status: 'inactive' })
    .eq('id', dirty_id)
  if (dirtyErr) return NextResponse.json({ error: dirtyErr.message }, { status: 500 })

  // 4. Mark clean product as clean
  const { error: cleanErr } = await admin
    .from('kg_product')
    .update({ cleanup_status: 'clean' })
    .eq('id', clean_id)
  if (cleanErr) return NextResponse.json({ error: cleanErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
