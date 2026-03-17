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

// POST /api/admin/suggestions/bulk/merge
// Merges all variants into an existing kg_product — no product creation.
// Body: { kg_product_id, kg_product_slug, suggestion_ids, variant_names }
export async function POST(req: NextRequest) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const {
    kg_product_id,
    kg_product_slug,
    suggestion_ids,
    variant_names,
  }: {
    kg_product_id: string
    kg_product_slug: string
    suggestion_ids: string[]
    variant_names: string[]
  } = await req.json()

  if (!kg_product_id || !suggestion_ids?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Insert all variant names as synonyms on the existing product
  const synonymsToInsert = variant_names.map(name => ({
    alias: name,
    product_id: kg_product_id,
    match_type: 'alias',
    lang: 'en',
    priority: 50,
  }))

  if (synonymsToInsert.length > 0) {
    await admin
      .from('synonym')
      .upsert(synonymsToInsert, { onConflict: 'alias,product_id', ignoreDuplicates: true })
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

  return NextResponse.json({ ok: true })
}
