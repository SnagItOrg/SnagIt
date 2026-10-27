import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// price_observation's three price columns are `int` (migration 010): whole
// kroner, at least 1, and far below the column's range.
const MAX_PRICE_DKK = 10_000_000

function isPriceDkk(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_PRICE_DKK
}

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
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: {
    listing_id?:    unknown
    price_dkk?:     unknown
    price_min_dkk?: unknown
    price_max_dkk?: unknown
  } = (await req.json().catch(() => null)) ?? {}

  const { listing_id, price_dkk, price_min_dkk, price_max_dkk } = body

  // PAN-298, finding 5: the body went to the insert unchecked.
  if (typeof listing_id !== 'string' || !UUID_RE.test(listing_id)) {
    return NextResponse.json({ error: 'invalid', field: 'listing_id' }, { status: 400 })
  }
  if (!isPriceDkk(price_dkk)) {
    return NextResponse.json({ error: 'invalid', field: 'price_dkk' }, { status: 400 })
  }
  if (price_min_dkk != null && !isPriceDkk(price_min_dkk)) {
    return NextResponse.json({ error: 'invalid', field: 'price_min_dkk' }, { status: 400 })
  }
  if (price_max_dkk != null && !isPriceDkk(price_max_dkk)) {
    return NextResponse.json({ error: 'invalid', field: 'price_max_dkk' }, { status: 400 })
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
    // A bounded code, never the database's message (table and column names).
    console.error('[price-observations] insert failed', error.code)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
