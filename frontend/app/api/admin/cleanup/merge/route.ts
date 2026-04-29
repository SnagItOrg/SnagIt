import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function requireAuth() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return user
}

// POST /api/admin/cleanup/merge
// Body: { dirty_id: string, clean_id: string }
export async function POST(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
