import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('saved_listings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json([])

  // Enrich with Thomann price + product slug — two explicit queries, no PostgREST join syntax
  const listingIds = data.map((r) => String(r.listing_id))
  const admin = getSupabaseAdmin()

  // Step 1: best product match per listing
  const { data: matchRows, error: matchError } = await admin
    .from('listing_product_match')
    .select('listing_id, product_id, score')
    .in('listing_id', listingIds)
    .order('score', { ascending: false })

  if (matchError) console.error('[saved-listings] listing_product_match error:', matchError.message)

  // Keep only highest-score match per listing
  const listingToProduct = new Map<string, string>()
  for (const m of (matchRows ?? [])) {
    const lid = String(m.listing_id)
    if (!listingToProduct.has(lid)) listingToProduct.set(lid, String(m.product_id))
  }

  // Step 2: fetch kg_product rows for matched product ids
  type ProductInfo = { id: string; slug: string | null; thomann_price_dkk: number | null; thomann_url: string | null; image_url: string | null }
  const productMap = new Map<string, ProductInfo>()
  const productIds = Array.from(new Set(listingToProduct.values()))

  if (productIds.length > 0) {
    const { data: products, error: productError } = await admin
      .from('kg_product')
      .select('id, slug, thomann_price_dkk, thomann_url, image_url')
      .in('id', productIds)

    if (productError) console.error('[saved-listings] kg_product error:', productError.message)

    for (const p of (products ?? [])) {
      productMap.set(String(p.id), p as unknown as ProductInfo)
    }
  }

  const enriched = data.map((row) => {
    const productId = listingToProduct.get(String(row.listing_id))
    const p = productId ? productMap.get(productId) : undefined
    return {
      ...row,
      thomann_price_dkk: p?.thomann_price_dkk ?? null,
      thomann_url:       p?.thomann_url       ?? null,
      product_slug:      p?.slug              ?? null,
      thomann_image_url: p?.image_url         ?? null,
    }
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { listing_id, listing_data } = body

  if (!listing_id || typeof listing_id !== 'string') {
    return NextResponse.json({ error: 'Missing listing_id' }, { status: 400 })
  }
  if (!listing_data || typeof listing_data !== 'object') {
    return NextResponse.json({ error: 'Missing listing_data' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('saved_listings')
    .upsert(
      { user_id: user.id, listing_id, listing_data },
      { onConflict: 'user_id,listing_id' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire-and-forget: queue price fetch if product lacks price history
  void (async () => {
    try {
      const admin = getSupabaseAdmin()
      const { data: match } = await admin
        .from('listing_product_match')
        .select('product_id, kg_product!inner(slug)')
        .eq('listing_id', listing_id)
        .limit(1)
        .single()

      if (!match) return
      const slug = (match.kg_product as unknown as { slug: string }).slug

      const { count } = await admin
        .from('reverb_price_history')
        .select('id', { count: 'exact', head: true })
        .eq('query', slug)

      if ((count ?? 0) >= 5) return

      await admin
        .from('price_fetch_queue')
        .upsert(
          { product_slug: slug, status: 'pending' },
          { onConflict: 'product_slug,status' },
        )
    } catch {
      // Non-critical — don't let queue errors affect the save response
    }
  })()

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { listing_id } = body

  if (!listing_id || typeof listing_id !== 'string') {
    return NextResponse.json({ error: 'Missing listing_id' }, { status: 400 })
  }

  const { error } = await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listing_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
