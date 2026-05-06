import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/admin/product/[slug]/set-price
// Body: { listing_id: string, price_dkk: number }
// Updates listings.price_dkk. If listings.price was NULL, also sets price and
// currency = 'DKK' so the listing has a usable price in both columns.
export async function POST(
  req: NextRequest,
  _ctx: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { listing_id, price_dkk } = (await req.json()) as {
    listing_id?: string
    price_dkk?: unknown
  }

  if (!listing_id || !UUID_RE.test(listing_id)) {
    return NextResponse.json({ error: 'listing_id must be a valid UUID' }, { status: 400 })
  }

  const n = Number(price_dkk)
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) {
    return NextResponse.json(
      { error: 'price_dkk must be a number > 0 and < 10000000' },
      { status: 400 },
    )
  }
  const priceDkkInt = Math.round(n)

  const admin = getSupabaseAdmin()

  const { data: listing, error: fetchErr } = await admin
    .from('listings')
    .select('id, price')
    .eq('id', listing_id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!listing) {
    return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  }

  const updateRow: Record<string, unknown> = { price_dkk: priceDkkInt }
  if (listing.price == null) {
    updateRow.price = priceDkkInt
    updateRow.currency = 'DKK'
  }

  const { error: updateErr } = await admin
    .from('listings')
    .update(updateRow)
    .eq('id', listing_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ updated: true })
}
