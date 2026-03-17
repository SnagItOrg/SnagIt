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
// Body: { action: 'approve' | 'reject', canonical_name?: string }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyAdmin()
  if (!auth.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { action, canonical_name } = body
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

    // Insert into kg_product
    const { error: insertErr } = await admin
      .from('kg_product')
      .insert({
        slug,
        canonical_name: name,
        brand_id: suggestion.brand_id,
        category_id: suggestion.category_id,
        status: 'active',
      })

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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
