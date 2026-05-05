import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

// DELETE /api/admin/product/[slug]/synonym/[id]
// Guard: synonym must belong to the product addressed by [slug] — prevents
// deleting another product's synonym by id.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string; id: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

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

  const { data: deleted, error: delErr } = await admin
    .from('synonym')
    .delete()
    .eq('id', params.id)
    .eq('product_id', product.id)
    .select('id')

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'synonym not found' }, { status: 404 })
  }

  return NextResponse.json({ deleted: true })
}
