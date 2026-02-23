import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo))
}

async function resolveProductId(
  admin: ReturnType<typeof getSupabaseAdmin>,
  listingId?: string | null,
  productSlug?: string | null,
): Promise<string | null> {
  if (listingId) {
    const { data } = await admin
      .from('listing_product_match')
      .select('product_id')
      .eq('listing_id', listingId)
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.product_id ?? null
  }
  if (productSlug) {
    const { data } = await admin
      .from('kg_product')
      .select('id')
      .eq('slug', productSlug)
      .maybeSingle()
    return data?.id ?? null
  }
  return null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const listingId   = searchParams.get('listing_id')
  const productSlug = searchParams.get('product_slug')

  if (!listingId && !productSlug) {
    return NextResponse.json({ error: 'listing_id or product_slug required' }, { status: 400 })
  }

  const admin     = getSupabaseAdmin()
  const productId = await resolveProductId(admin, listingId, productSlug)

  if (!productId) {
    return NextResponse.json({ count: 0, p25: null, p50: null, p75: null })
  }

  const { data: rows, error } = await admin
    .from('price_observation')
    .select('price_dkk')
    .eq('product_id', productId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ count: 0, p25: null, p50: null, p75: null })
  }

  const sorted = rows.map((r) => r.price_dkk).sort((a, b) => a - b)

  return NextResponse.json({
    count: sorted.length,
    p25:   percentile(sorted, 25),
    p50:   percentile(sorted, 50),
    p75:   percentile(sorted, 75),
  })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    listing_id:     string
    price_dkk:      number
    price_min_dkk?: number
    price_max_dkk?: number
  }

  const { listing_id, price_dkk, price_min_dkk, price_max_dkk } = body

  if (!listing_id || price_dkk == null) {
    return NextResponse.json({ error: 'listing_id and price_dkk are required' }, { status: 400 })
  }

  const admin     = getSupabaseAdmin()
  const productId = await resolveProductId(admin, listing_id)

  const { error } = await admin
    .from('price_observation')
    .insert({
      product_id:    productId,
      listing_id,
      price_dkk,
      price_min_dkk: price_min_dkk ?? null,
      price_max_dkk: price_max_dkk ?? null,
      source:        'user',
      user_id:       user.id,
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
