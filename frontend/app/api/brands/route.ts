import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// Touches Supabase admin env vars, which aren't available at build time.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = getSupabaseAdmin()

  const [brandsResult, categoriesResult, activeProductsResult] = await Promise.all([
    supabase.from('kg_brand').select('id, slug, name, category_id').order('name'),
    supabase.from('kg_category').select('id, slug, name_da, name_en').order('name_da'),
    supabase.from('kg_product').select('brand_id, listing_product_match!inner(listing_id)'),
  ])

  if (brandsResult.error) {
    return NextResponse.json({ error: brandsResult.error.message }, { status: 500 })
  }

  const activeBrandIds = [
    ...Array.from(new Set(
      (activeProductsResult.data ?? [])
        .map((r) => (r as unknown as { brand_id: string }).brand_id)
        .filter((id): id is string => !!id),
    )),
  ]

  return NextResponse.json({
    categories: categoriesResult.data ?? [],
    brands: brandsResult.data ?? [],
    activeBrandIds,
  })
}
