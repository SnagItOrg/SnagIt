import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: { root: string } },
) {
  const admin = getSupabaseAdmin()
  const rootSlug = params.root

  // Fetch the root category
  const { data: rootCat, error: rootErr } = await admin
    .from('kg_category')
    .select('id, slug, name_da, name_en')
    .eq('slug', rootSlug)
    .eq('domain', 'music')
    .is('parent_id', null)
    .single()

  if (rootErr || !rootCat) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  // Fetch subcategories of this root
  const { data: subcatsRaw, error: subErr } = await admin
    .from('kg_category')
    .select('id, slug, name_da, name_en')
    .eq('parent_id', rootCat.id)
    .order('name_en')

  if (subErr) {
    return NextResponse.json({ error: 'Failed to load subcategories' }, { status: 500 })
  }

  const subcatsList = subcatsRaw ?? []
  const subcatIds = subcatsList.map((s) => s.id)
  // Map from compound slug (e.g. "electric-guitars/solid-body") → bare sub slug ("solid-body")
  const subcatById = new Map(subcatsList.map((s) => [s.id, s]))

  if (subcatIds.length === 0) {
    return NextResponse.json({
      category: rootCat,
      subcategories: [],
      products: [],
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    })
  }

  // Fetch products classified under these subcategories
  type RawProduct = {
    id: string
    slug: string
    canonical_name: string
    subcategory_id: string | null
    kg_brand: { name: string } | null
  }

  const { data: productsRaw, error: prodErr } = await admin
    .from('kg_product')
    .select('id, slug, canonical_name, subcategory_id, kg_brand!inner(name)')
    .in('subcategory_id', subcatIds)
    .limit(200) as { data: RawProduct[] | null; error: unknown }

  if (prodErr) {
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }

  const products = productsRaw ?? []
  const productIds = products.map((p) => p.id)

  // Get active listing counts
  const listingCountByProduct: Record<string, number> = {}
  if (productIds.length > 0) {
    const { data: matches } = await admin
      .from('listing_product_match')
      .select('product_id, listings!inner(is_active)')
      .in('product_id', productIds)
      .eq('listings.is_active', true)

    for (const m of (matches ?? []) as { product_id: string }[]) {
      listingCountByProduct[m.product_id] = (listingCountByProduct[m.product_id] ?? 0) + 1
    }
  }

  const shaped = products
    .map((p) => {
      const subcat = p.subcategory_id ? subcatById.get(p.subcategory_id) : null
      const bareSlug = subcat?.slug?.split('/')[1] ?? subcat?.slug ?? ''
      return {
        slug: p.slug,
        canonical_name: p.canonical_name,
        brand_name: p.kg_brand?.name ?? '',
        subcategory_name_da: subcat?.name_da ?? '',
        subcategory_name_en: subcat?.name_en ?? '',
        subcategory_slug: bareSlug,
        active_listing_count: listingCountByProduct[p.id] ?? 0,
      }
    })
    .sort((a, b) => b.active_listing_count - a.active_listing_count)
    .slice(0, 48)

  // Strip compound prefix from subcategory slugs for URL/filter use
  const subcategories = subcatsList.map((s) => ({
    id: s.id,
    slug: s.slug.split('/')[1] ?? s.slug,
    name_da: s.name_da,
    name_en: s.name_en,
  }))

  return NextResponse.json({
    category: rootCat,
    subcategories,
    products: shaped,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  })
}
