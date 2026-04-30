import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const admin = getSupabaseAdmin()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  type ProductRow    = { id: string; subcategory_id: string | null; tier: string }
  type MatchCountRow = { product_id: string; count: number }

  const [rootsRes, subsRes, matchCountsRes, allProducts, musicGearRes] = await Promise.all([
    admin
      .from('kg_category')
      .select('id, slug, name_da, name_en, image_url')
      .eq('domain', 'music')
      .is('parent_id', null)
      .neq('slug', 'music-gear'),
    admin
      .from('kg_category')
      .select('id, parent_id')
      .eq('domain', 'music')
      .not('parent_id', 'is', null),
    // Aggregate: one row per product_id — avoids the 1000-row PostgREST cap on the
    // prior row-per-match approach. PostgREST 12 supports the implicit join filter
    // on listings.is_active without embedding listings in the select.
    admin
      .from('listing_product_match')
      .select('product_id, count:product_id.count()')
      .eq('listings.is_active', true),
    // Paginated fetch — PostgREST silently caps at 1000 rows regardless of .limit();
    // range() is the only way to retrieve the full ~3,800-product catalogue.
    (async (): Promise<ProductRow[]> => {
      const rows: ProductRow[] = []
      let from = 0
      while (true) {
        const { data, error } = await admin
          .from('kg_product')
          .select('id, subcategory_id, tier')
          .eq('status', 'active')
          .not('subcategory_id', 'is', null)
          .range(from, from + 999)
        if (error || !data || data.length === 0) break
        rows.push(...(data as ProductRow[]))
        if (data.length < 1000) break
        from += 1000
      }
      return rows
    })(),
    // music-gear root image — inherited by keyboards-and-synths
    admin
      .from('kg_category')
      .select('image_url')
      .eq('slug', 'music-gear')
      .single(),
  ])

  if (rootsRes.error || subsRes.error) {
    return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 })
  }

  const musicGearImageUrl = musicGearRes.data?.image_url ?? null

  // subcategory_id → root_id
  const subToRoot = new Map<string, string>()
  for (const sub of subsRes.data ?? []) {
    if (sub.parent_id) subToRoot.set(sub.id, sub.parent_id)
  }

  // Build set of product IDs that have active listings
  const withListings = new Set<string>()
  for (const m of ((matchCountsRes.data ?? []) as MatchCountRow[])) {
    withListings.add(m.product_id)
  }

  // root_id → qualifying product count (listings ≥1 OR tier classic/legendary)
  const countByRoot = new Map<string, number>()
  for (const p of allProducts) {
    const qualifies = withListings.has(p.id) || p.tier === 'classic' || p.tier === 'legendary'
    if (!qualifies) continue
    const rootId = subToRoot.get(p.subcategory_id!)
    if (rootId) countByRoot.set(rootId, (countByRoot.get(rootId) ?? 0) + 1)
  }

  const storageFallback = (slug: string) =>
    `${supabaseUrl}/storage/v1/object/public/onboarding-assets/categories/${slug}.webp`

  const categories = (rootsRes.data ?? [])
    .map((c) => {
      // keyboards-and-synths inherits the music-gear vertical image
      const imageUrl =
        c.slug === 'keyboards-and-synths' && musicGearImageUrl
          ? musicGearImageUrl
          : (c.image_url ?? storageFallback(c.slug))
      return {
        id: c.id,
        slug: c.slug,
        name_da: c.name_da,
        name_en: c.name_en,
        product_count: countByRoot.get(c.id) ?? 0,
        image_url: imageUrl,
      }
    })
    .filter((c) => c.product_count > 0)
    .sort((a, b) => b.product_count - a.product_count)

  return NextResponse.json({ categories }, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' },
  })
}
