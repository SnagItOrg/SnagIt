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

// PATCH /api/admin/suggestions/[id]
// Body: { action: 'approve' | 'reject' | 'merge', canonical_name?, model_name?, merge_product_id? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { action, canonical_name, model_name, merge_product_id } = body
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()

  // Fetch the suggestion
  const { data: suggestion, error: fetchErr } = await admin
    .from('kg_product_suggestions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (fetchErr || !suggestion) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }

  // If just editing the name (no action)
  if (!action && canonical_name) {
    const { error } = await admin
      .from('kg_product_suggestions')
      .update({ canonical_name })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reject') {
    const { error } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'rejected',
        reviewed_by: auth.userId,
        reviewed_at: now,
      })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'approve') {
    const name = canonical_name || suggestion.canonical_name
    const slug = slugify(name)

    // Check slug doesn't already exist in kg_product
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

    // Insert into kg_product (with optional model_name)
    const insertData: Record<string, unknown> = {
      slug,
      canonical_name: name,
      brand_id: suggestion.brand_id,
      category_id: suggestion.category_id,
      status: 'active',
    }
    if (model_name && typeof model_name === 'string' && model_name.trim()) {
      insertData.model_name = model_name.trim()
    }

    const { error: insertErr } = await admin
      .from('kg_product')
      .insert(insertData)

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    // Mark suggestion as approved
    const { error: updateErr } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'approved',
        canonical_name: name,
        reviewed_by: auth.userId,
        reviewed_at: now,
      })
      .eq('id', params.id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, slug })
  }

  if (action === 'merge') {
    if (!merge_product_id || typeof merge_product_id !== 'string') {
      return NextResponse.json({ error: 'Missing merge_product_id' }, { status: 400 })
    }

    // Verify the target product exists
    const { data: targetProduct, error: targetErr } = await admin
      .from('kg_product')
      .select('id, slug')
      .eq('id', merge_product_id)
      .single()

    if (targetErr || !targetProduct) {
      return NextResponse.json({ error: 'Target product not found' }, { status: 404 })
    }

    // 1. Add suggestion canonical_name as a synonym
    await admin
      .from('synonym')
      .upsert({
        alias: suggestion.canonical_name,
        product_id: merge_product_id,
        match_type: 'alias',
        lang: 'en',
        priority: 50,
      }, { onConflict: 'alias,product_id', ignoreDuplicates: true })

    // 2. Update any listing_product_match rows that matched via this suggestion's name
    // Match on normalized_text containing key words from the suggestion
    const normalizedSuggestion = suggestion.canonical_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    await admin
      .from('listing_product_match')
      .update({ product_id: merge_product_id })
      .ilike('match_reason', `%${normalizedSuggestion}%`)

    // 3. Mark suggestion as approved with merge note
    const { error: updateErr } = await admin
      .from('kg_product_suggestions')
      .update({
        status: 'approved',
        reviewed_by: auth.userId,
        reviewed_at: now,
        notes: `merged into ${targetProduct.slug}`,
      })
      .eq('id', params.id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, merged_into: targetProduct.slug })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
