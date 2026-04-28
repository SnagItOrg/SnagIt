import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type DiscoverProduct = {
  slug: string
  canonical_name: string
  image_url: string | null
  brand_name: string
  active_listing_count: number
}

type RawProduct = {
  id: string
  slug: string
  canonical_name: string
  image_url: string | null
  kg_brand: { name: string } | null
}

export async function GET() {
  const admin = getSupabaseAdmin()

  // Active listing counts per product_id
  const { data: matches } = await admin
    .from('listing_product_match')
    .select('product_id, listings!inner(is_active)')
    .eq('listings.is_active', true)
    .limit(5000)

  const countByProduct = new Map<string, number>()
  for (const m of (matches ?? []) as { product_id: string }[]) {
    countByProduct.set(m.product_id, (countByProduct.get(m.product_id) ?? 0) + 1)
  }

  // Legendary products
  const { data: legendaryRaw } = await admin
    .from('kg_product')
    .select('id, slug, canonical_name, image_url, kg_brand!inner(name)')
    .eq('tier', 'legendary')
    .eq('status', 'active')
    .order('canonical_name')
    .limit(24) as { data: RawProduct[] | null }

  const legendary: DiscoverProduct[] = (legendaryRaw ?? []).map((p) => ({
    slug: p.slug,
    canonical_name: p.canonical_name,
    image_url: p.image_url,
    brand_name: p.kg_brand?.name ?? '',
    active_listing_count: countByProduct.get(p.id) ?? 0,
  }))

  // Popular: top products by active listing count, excluding legendary
  const topIds = [...countByProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([id]) => id)

  const popular: DiscoverProduct[] = []

  if (topIds.length > 0) {
    const { data: popularRaw } = await admin
      .from('kg_product')
      .select('id, slug, canonical_name, image_url, kg_brand!inner(name)')
      .in('id', topIds)
      .eq('status', 'active')
      .neq('tier', 'legendary') as { data: RawProduct[] | null }

    for (const p of popularRaw ?? []) {
      popular.push({
        slug: p.slug,
        canonical_name: p.canonical_name,
        image_url: p.image_url,
        brand_name: p.kg_brand?.name ?? '',
        active_listing_count: countByProduct.get(p.id) ?? 0,
      })
    }
    popular.sort((a, b) => b.active_listing_count - a.active_listing_count)
    popular.splice(20)
  }

  return NextResponse.json({ legendary, popular }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  })
}
