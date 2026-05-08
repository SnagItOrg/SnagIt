import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/admin/product/[slug]/reassign-match
// Body: { listing_id: string, target_slug: string }
// Moves a listing_product_match from the source product (resolved via params.slug)
// to the target product (resolved via target_slug). Marks the match valid and
// clears any rejected_reason — manual reassignment is a confirmation.
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { listing_id, target_slug } = (await req.json()) as {
    listing_id?: string
    target_slug?: string
  }

  if (!listing_id || !UUID_RE.test(listing_id)) {
    return NextResponse.json({ error: 'listing_id must be a valid UUID' }, { status: 400 })
  }
  const targetSlug = (target_slug ?? '').trim()
  if (!targetSlug) {
    return NextResponse.json({ error: 'target_slug is required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const [sourceRes, targetRes] = await Promise.all([
    admin.from('kg_product').select('id').eq('slug', params.slug).maybeSingle(),
    admin.from('kg_product').select('id').eq('slug', targetSlug).maybeSingle(),
  ])

  if (sourceRes.error) {
    return NextResponse.json({ error: sourceRes.error.message }, { status: 500 })
  }
  if (targetRes.error) {
    return NextResponse.json({ error: targetRes.error.message }, { status: 500 })
  }
  if (!sourceRes.data) {
    return NextResponse.json({ error: 'source product not found' }, { status: 404 })
  }
  if (!targetRes.data) {
    return NextResponse.json({ error: 'target product not found' }, { status: 404 })
  }

  const { data: updated, error: updateErr } = await admin
    .from('listing_product_match')
    .update({
      product_id: targetRes.data.id,
      is_valid: true,
      method: 'FUZZY',
      rejected_reason: null,
    })
    .eq('listing_id', listing_id)
    .eq('product_id', sourceRes.data.id)
    .select('id')

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  return NextResponse.json({ moved: true, target_slug: targetSlug })
}
