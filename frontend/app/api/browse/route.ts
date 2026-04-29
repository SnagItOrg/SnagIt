import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const admin = getSupabaseAdmin()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  const [rootsRes, subsRes, productsRes, matchesRes] = await Promise.all([
    admin
      .from('kg_category')
      .select('id, slug, name_da, name_en, image_url')
      .eq('domain', 'music')
      .is('parent_id', null),
    admin
      .from('kg_category')
      .select('id, parent_id')
      .eq('domain', 'music')
      .not('parent_id', 'is', null),
    admin
      .from('kg_product')
      .select('id, subcategory_id, tier')
      .eq('status', 'active')
      .not('subcategory_id', 'is', null)
      .limit(10000),
    // Product IDs with at least one active listing match
    admin
      .from('listing_product_match')
      .select('product_id, listings!inner(is_active)')
      .eq('listings.is_active', true)
      .limit(50000),
  ])

  if (rootsRes.error || subsRes.error || productsRes.error) {
    return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 })
  }

  // subcategory_id → root_id
  const subToRoot = new Map<string, string>()
  for (const sub of subsRes.data ?? []) {
    if (sub.parent_id) subToRoot.set(sub.id, sub.parent_id)
  }

  // Build set of product IDs that have active listings
  const withListings = new Set<string>()
  for (const m of (matchesRes.data ?? []) as { product_id: string }[]) {
    withListings.add(m.product_id)
  }

  // root_id → qualifying product count (listings ≥1 OR tier classic/legendary)
  const countByRoot = new Map<string, number>()
  for (const p of productsRes.data ?? []) {
    const qualifies = withListings.has(p.id) || p.tier === 'classic' || p.tier === 'legendary'
    if (!qualifies) continue
    const rootId = subToRoot.get(p.subcategory_id!)
    if (rootId) countByRoot.set(rootId, (countByRoot.get(rootId) ?? 0) + 1)
  }

  const categories = (rootsRes.data ?? [])
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name_da: c.name_da,
      name_en: c.name_en,
      product_count: countByRoot.get(c.id) ?? 0,
      image_url: c.image_url ?? `${supabaseUrl}/storage/v1/object/public/onboarding-assets/categories/${c.slug}.webp`,
    }))
    .filter((c) => c.product_count > 0)
    .sort((a, b) => b.product_count - a.product_count)

  return NextResponse.json({ categories }, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
  })
}
