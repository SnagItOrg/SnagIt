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

  // One batched query: listing_product_match JOIN kg_product for all listing_ids at once
  const listingIds = data.map((r) => String(r.listing_id))
  const admin = getSupabaseAdmin()

  type KgProduct = { slug: string | null; thomann_price_dkk: number | null; thomann_url: string | null; image_url: string | null }
  type MatchRow  = { listing_id: string; score: number; kg_product: KgProduct }

  const { data: matchRows, error: matchError } = await admin
    .from('listing_product_match')
    .select('listing_id, score, kg_product!inner(slug, thomann_price_dkk, thomann_url, image_url)')
    .in('listing_id', listingIds)
    .not('kg_product.thomann_price_dkk', 'is', null)
    .order('score', { ascending: false })

  if (matchError) console.error('[saved-listings] kg match error:', matchError.message)

  // Keep highest-score match per listing
  const kgMap = new Map<string, KgProduct>()
  for (const m of ((matchRows ?? []) as unknown as MatchRow[])) {
    const lid = String(m.listing_id)
    if (!kgMap.has(lid)) kgMap.set(lid, m.kg_product)
  }

  const enriched = data.map((row) => {
    const p = kgMap.get(String(row.listing_id))
    return {
      ...row,
      thomann_price_dkk: p?.thomann_price_dkk ?? null,
      thomann_url:       p?.thomann_url       ?? null,
      product_slug:      p?.slug              ?? null,
      thomann_image_url: p?.image_url         ?? null,
    }
  })

  return NextResponse.json(enriched, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
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
