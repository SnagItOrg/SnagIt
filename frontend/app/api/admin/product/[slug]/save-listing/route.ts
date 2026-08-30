import { NextRequest, NextResponse } from 'next/server'
import { sanitizeListingPrice } from '@/lib/listing-price-integrity'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireAdminInRoute } from '@/lib/admin-auth'

type ScrapedListingPayload = {
  title?: string
  price?: number | null
  currency?: string
  url?: string
  image_url?: string | null
  location?: string | null
  source?: string
  country?: string | null
  price_dkk?: number | null
}

// POST /api/admin/product/[slug]/save-listing
// Body: { listing: ScrapedListing }
// 1. Upsert into listings (onConflict: external_id, source)
// 2. Insert listing_product_match with is_valid = true (manual confirmation)
//
// Note on `method`: listing_product_match.method has a CHECK constraint
// limiting it to {EAN, SKU, MODEL, SYNONYM, FUZZY}. The spec asked for
// 'manual' which would fail the constraint, so we record manually-curated
// matches as 'FUZZY' — the same convention used by /api/admin/match/approve.
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const body = (await req.json()) as { listing?: ScrapedListingPayload }
  const listing = body.listing
  if (!listing || !listing.title || !listing.url || !listing.source) {
    return NextResponse.json({ error: 'listing.title, url, and source are required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const { data: product, error: prodErr } = await admin
    .from('kg_product')
    .select('id')
    .eq('slug', params.slug)
    .maybeSingle()

  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 })
  }
  if (!product) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const normalized_text = listing.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const derivedCountry =
    listing.source === 'dba.dk' ? 'DK'
    : listing.source === 'finn' ? 'NO'
    : listing.source === 'blocket' ? 'SE'
    : listing.source === 'kleinanzeigen' ? 'DE'
    : listing.source === 'reverb' ? (listing.country ?? null)
    : null

  const row = {
    external_id: listing.url,
    source: listing.source,
    country: derivedCountry,
    price_dkk: sanitizeListingPrice(listing).price_dkk,
    currency: listing.currency ?? null,
    // Never copy an implausible source price onto a product record.
    price: sanitizeListingPrice(listing).price,
    title: listing.title,
    url: listing.url,
    image_url: listing.image_url ?? null,
    location: listing.location ?? null,
    is_active: true,
    scraped_at: now,
    normalized_text,
  }

  const { data: upserted, error: upsertErr } = await admin
    .from('listings')
    .upsert(row, { onConflict: 'external_id,source' })
    .select('id')
    .single()

  if (upsertErr || !upserted) {
    return NextResponse.json(
      { error: upsertErr?.message ?? 'upsert failed' },
      { status: 500 },
    )
  }

  const { error: matchErr } = await admin
    .from('listing_product_match')
    .upsert(
      {
        listing_id: upserted.id,
        product_id: product.id,
        method: 'FUZZY',
        score: 100,
        is_valid: true,
        explain: {},
        created_at: now,
      },
      { onConflict: 'listing_id,product_id', ignoreDuplicates: true },
    )

  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 })
  }

  return NextResponse.json({ saved: true, listing_id: upserted.id })
}
