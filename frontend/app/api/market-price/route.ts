import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type MarketPrice = {
  min: number
  max: number
  count: number
}

// GET /api/market-price?listing_ids=id1,id2,...  (batched by listing IDs)
// GET /api/market-price?slugs=slug1,slug2,...    (batched by product slugs)
// GET /api/market-price?watchlist_id=X           (legacy — single watchlist)
// GET /api/market-price?query=...                (legacy — single query text)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const listingIdsParam = searchParams.get('listing_ids')
  const slugsParam = searchParams.get('slugs')
  const watchlistId = searchParams.get('watchlist_id')
  const query = searchParams.get('query')

  const supabase = getSupabaseAdmin()

  // ── Batched by listing IDs ──────────────────────────────────────────────
  if (listingIdsParam) {
    const listingIds = listingIdsParam.split(',').filter(Boolean).slice(0, 100)
    if (listingIds.length === 0) {
      return NextResponse.json({})
    }

    // Resolve listing_id → product_slug via listing_product_match + kg_product
    const { data: matches } = await supabase
      .from('listing_product_match')
      .select('listing_id, kg_product!inner(slug)')
      .in('listing_id', listingIds)

    if (!matches || matches.length === 0) {
      return NextResponse.json({})
    }

    // Build listing_id → slug map
    const listingToSlug: Record<string, string> = {}
    const slugSet = new Set<string>()
    for (const m of matches) {
      const slug = (m.kg_product as unknown as { slug: string }).slug
      listingToSlug[m.listing_id] = slug
      slugSet.add(slug)
    }

    const slugs = Array.from(slugSet)
    const pricesBySlug = await fetchPricesBySlug(supabase, slugs)

    // Map back to listing IDs
    const result: Record<string, MarketPrice> = {}
    for (const [listingId, slug] of Object.entries(listingToSlug)) {
      if (pricesBySlug[slug]) {
        result[listingId] = pricesBySlug[slug]
      }
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
    })
  }

  // ── Batched by slugs ────────────────────────────────────────────────────
  if (slugsParam) {
    const slugs = slugsParam.split(',').filter(Boolean).slice(0, 100)
    if (slugs.length === 0) {
      return NextResponse.json({})
    }

    const result = await fetchPricesBySlug(supabase, slugs)
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
    })
  }

  // ── Legacy: single watchlist or query ───────────────────────────────────
  if (!watchlistId && !query) {
    return NextResponse.json({ error: 'listing_ids, slugs, watchlist_id, or query required' }, { status: 400 })
  }

  const [reverbRes, auctionetRes] = await Promise.all([
    watchlistId
      ? supabase.from('reverb_price_history').select('price').eq('watchlist_id', watchlistId)
      : supabase.from('reverb_price_history').select('price').ilike('query', `%${query}%`),
    watchlistId
      ? supabase.from('auctionet_price_history').select('price').eq('watchlist_id', watchlistId)
      : supabase.from('auctionet_price_history').select('price').ilike('query', `%${query}%`),
  ])

  const prices: number[] = [
    ...(reverbRes.data ?? []).map((r) => Number(r.price)),
    ...(auctionetRes.data ?? []).map((r) => Number(r.price)),
  ].filter((p) => p > 0)

  if (prices.length < 3) return NextResponse.json(null)

  return NextResponse.json({
    min: Math.min(...prices),
    max: Math.max(...prices),
    count: prices.length,
  } satisfies MarketPrice)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof getSupabaseAdmin>

async function fetchPricesBySlug(
  supabase: SupabaseClient,
  slugs: string[],
): Promise<Record<string, MarketPrice>> {
  // Query both price history tables for these slugs (stored as query field)
  const [reverbRes, auctionetRes] = await Promise.all([
    supabase
      .from('reverb_price_history')
      .select('query, price')
      .in('query', slugs),
    supabase
      .from('auctionet_price_history')
      .select('query, price')
      .in('query', slugs),
  ])

  // Group prices by slug
  const grouped: Record<string, number[]> = {}
  for (const row of reverbRes.data ?? []) {
    const slug = row.query as string
    if (!grouped[slug]) grouped[slug] = []
    grouped[slug].push(Number(row.price))
  }
  for (const row of auctionetRes.data ?? []) {
    const slug = row.query as string
    if (!grouped[slug]) grouped[slug] = []
    grouped[slug].push(Number(row.price))
  }

  // Build result — require at least 3 data points
  const result: Record<string, MarketPrice> = {}
  for (const [slug, prices] of Object.entries(grouped)) {
    const valid = prices.filter(p => p > 0)
    if (valid.length < 3) continue
    result[slug] = {
      min: Math.min(...valid),
      max: Math.max(...valid),
      count: valid.length,
    }
  }

  return result
}
