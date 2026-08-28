import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// POST /api/admin/cleanup/self-clean
// Body: { dirty_id: string, clean_name: string }
// Creates a new clean kg_product from the cleaned name, reassigns matches, marks dirty as merged.
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

  const { dirty_id, clean_name }: { dirty_id: string; clean_name: string } = await req.json()
  if (!dirty_id || !clean_name?.trim()) {
    return NextResponse.json({ error: 'Missing dirty_id or clean_name' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // Fetch dirty product to copy relevant fields
  const { data: dirty, error: dirtyErr } = await admin
    .from('kg_product')
    .select('id, brand_id, subcategory_id, tier, reverb_root_slug, reverb_sub_slug')
    .eq('id', dirty_id)
    .single()

  if (dirtyErr || !dirty) {
    return NextResponse.json({ error: 'Dirty product not found' }, { status: 404 })
  }

  const newSlug = toSlug(clean_name.trim())

  // Guard against slug collision
  const { data: existing } = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', newSlug)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `Slug "${newSlug}" already exists — use Merge instead` },
      { status: 409 },
    )
  }

  // Create clean product
  const { data: newProduct, error: insertErr } = await admin
    .from('kg_product')
    .insert({
      slug: newSlug,
      canonical_name: clean_name.trim(),
      brand_id: dirty.brand_id,
      subcategory_id: dirty.subcategory_id,
      tier: dirty.tier ?? 'standard',
      reverb_root_slug: dirty.reverb_root_slug,
      reverb_sub_slug: dirty.reverb_sub_slug,
      status: 'active',
      cleanup_status: 'clean',
    })
    .select('id')
    .single()

  if (insertErr || !newProduct) {
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Reassign listing matches to new product
  const { data: matches, error: matchErr } = await admin
    .from('listing_product_match')
    .select('listing_id')
    .eq('product_id', dirty_id)

  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 })

  if (matches && matches.length > 0) {
    const reassigned = matches.map((m) => ({ listing_id: m.listing_id, product_id: newProduct.id }))
    const { error: upsertErr } = await admin
      .from('listing_product_match')
      .upsert(reassigned, { onConflict: 'listing_id,product_id', ignoreDuplicates: true })
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  // Mark dirty as merged + inactive
  const { error: dirtyUpdateErr } = await admin
    .from('kg_product')
    .update({ cleanup_status: 'merged', status: 'inactive' })
    .eq('id', dirty_id)

  if (dirtyUpdateErr) return NextResponse.json({ error: dirtyUpdateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, new_id: newProduct.id, new_slug: newSlug })
}
