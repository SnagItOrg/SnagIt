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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// POST /api/admin/suggestions/bulk/approve
// Body: { canonical_name, model_name, brand_id, category_id, suggestion_ids, variant_names }
export async function POST(req: NextRequest) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const {
    canonical_name,
    model_name,
    brand_id,
    category_id,
    suggestion_ids,
    variant_names,
  }: {
    canonical_name: string
    model_name: string
    brand_id: string
    category_id: string | null
    suggestion_ids: string[]
    variant_names: string[]
  } = await req.json()

  if (!canonical_name || !brand_id || !suggestion_ids?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()
  const slug = slugify(canonical_name)
  const now = new Date().toISOString()

  // Check slug doesn't already exist
  const { data: existing } = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `Product with slug "${slug}" already exists` },
      { status: 409 },
    )
  }

  // Insert kg_product
  const insertData: Record<string, unknown> = {
    slug,
    canonical_name,
    brand_id,
    status: 'active',
  }
  if (category_id) insertData.category_id = category_id
  if (model_name?.trim()) insertData.model_name = model_name.trim()

  const { data: newProduct, error: insertErr } = await admin
    .from('kg_product')
    .insert(insertData)
    .select('id')
    .single()

  if (insertErr || !newProduct) {
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Insert all variant names as synonyms (skip the canonical name itself)
  const synonymsToInsert = variant_names
    .filter(name => name.toLowerCase() !== canonical_name.toLowerCase())
    .map(name => ({
      alias: name,
      canonical_query: slug,
      product_id: newProduct.id,
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
  const { error: updateErr } = await admin
    .from('kg_product_suggestions')
    .update({
      status: 'approved',
      reviewed_by: auth.userId,
      reviewed_at: now,
      notes: `bulk approved → ${slug}`,
    })
    .in('id', suggestion_ids)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, slug, product_id: newProduct.id })
}
