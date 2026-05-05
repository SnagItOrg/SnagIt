import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// POST /api/admin/product/[slug]/reject-match
// Body: { listing_id: string, reason?: string }
// Sets is_valid=false, rejected_reason on listing_product_match for the
// (listing_id, product_id) pair — guarded by slug → product_id resolution.
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { listing_id, reason } = (await req.json()) as {
    listing_id?: string
    reason?: string
  }

  if (!listing_id) {
    return NextResponse.json({ error: 'listing_id is required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: product, error: prodErr } = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', params.slug)
    .maybeSingle()

  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 })
  }
  if (!product) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 })
  }

  const { data: updated, error: updateErr } = await admin
    .from('listing_product_match')
    .update({
      is_valid: false,
      rejected_reason: reason ?? null,
    })
    .eq('listing_id', listing_id)
    .eq('product_id', product.id)
    .select('id')

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  return NextResponse.json({ updated: true })
}
