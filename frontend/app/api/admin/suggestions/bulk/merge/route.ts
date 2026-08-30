import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function verifyAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = getSupabaseAdmin()
  const { data: prefs, error } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  // Fail closed: an unreadable admin flag is not an admin flag.
  if (error || !prefs?.is_admin) return { ok: false }
  return { ok: true, userId: user.id }
}

// POST /api/admin/suggestions/bulk/merge
// Merges all variants into an existing kg_product — no product creation.
// Body: { kg_product_id, kg_product_slug, suggestion_ids, variant_names }
export async function POST(req: NextRequest) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // `kg_product_slug` is still accepted on the wire for compatibility with the
  // current client, but it is deliberately not read: the slug is resolved from
  // the target's primary key below so the audit note cannot name a product the
  // write did not touch.
  const {
    kg_product_id,
    suggestion_ids,
    variant_names,
  }: {
    kg_product_id: string
    kg_product_slug?: string
    suggestion_ids: string[]
    variant_names: string[]
  } = await req.json()

  if (!kg_product_id || !suggestion_ids?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Resolve slug if not provided by client (manual merge from search)
  //
  // The slug is resolved from the target's primary key rather than trusted from
  // the client, so the audit note cannot name a product the write did not touch.
  const { data: product, error: productErr } = await admin
    .from('kg_product')
    .select('slug')
    .eq('id', kg_product_id)
    .single()

  if (productErr || !product?.slug) {
    return NextResponse.json({ error: 'Target product not found' }, { status: 404 })
  }
  const kg_product_slug = product.slug

  // Insert all variant names as synonyms on the existing product
  const synonymsToInsert = variant_names.map(name => ({
    alias: name,
    canonical_query: kg_product_slug,
    product_id: kg_product_id,
    match_type: 'alias',
    lang: 'en',
    priority: 50,
  }))

  // Checked. If the aliases do not land, the suggestions are NOT marked
  // approved — a merge that recorded nothing must not look reviewed.
  if (synonymsToInsert.length > 0) {
    const { error: synonymErr } = await admin
      .from('synonym')
      .upsert(synonymsToInsert, { onConflict: 'alias,product_id', ignoreDuplicates: true })
    if (synonymErr) {
      return NextResponse.json(
        { error: `Merge failed while recording aliases: ${synonymErr.message}` },
        { status: 500 },
      )
    }
  }

  // Mark all suggestions as approved
  const { error } = await admin
    .from('kg_product_suggestions')
    .update({
      status: 'approved',
      reviewed_by: auth.userId,
      reviewed_at: now,
      notes: `bulk merged → ${kg_product_slug}`,
    })
    .in('id', suggestion_ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, merged_into: kg_product_slug })
}
