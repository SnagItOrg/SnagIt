import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const admin = getSupabaseAdmin()

  const { data: product, error } = await admin
    .from('kg_product')
    .select('*, kg_brand(name, slug)')
    .eq('slug', params.slug)
    .single()

  if (error || !product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: matches } = await admin
    .from('listing_product_match')
    .select('score, listings(*)')
    .eq('product_id', product.id)
    .order('score', { ascending: false })
    .limit(50)

  const listings = (matches ?? [])
    .map((m) => m.listings)
    .filter((l) => l != null && (l as unknown as Record<string, unknown>).is_active !== false)
    .slice(0, 20)

  return NextResponse.json({ product, listings }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  })
}
