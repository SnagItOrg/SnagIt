import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type MarketPrice = {
  min: number
  max: number
  count: number
}

// GET /api/market-price?watchlist_id=X  (by watchlist)
// GET /api/market-price?query=...        (by search query text)
// Returns null if fewer than 3 data points exist.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const watchlistId = searchParams.get('watchlist_id')
  const query       = searchParams.get('query')

  if (!watchlistId && !query) {
    return NextResponse.json({ error: 'watchlist_id or query required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Query both history tables and collect all DKK prices
  const [reverbRes, auctionetRes] = await Promise.all([
    watchlistId
      ? supabase.from('reverb_price_history').select('price').eq('watchlist_id', watchlistId)
      : supabase.from('reverb_price_history').select('price').ilike('query', `%${query}%`),
    watchlistId
      ? supabase.from('auctionet_price_history').select('price').eq('watchlist_id', watchlistId)
      : supabase.from('auctionet_price_history').select('price').ilike('query', `%${query}%`),
  ])

  const prices: number[] = [
    ...(reverbRes.data  ?? []).map((r) => Number(r.price)),
    ...(auctionetRes.data ?? []).map((r) => Number(r.price)),
  ].filter((p) => p > 0)

  if (prices.length < 3) return NextResponse.json(null)

  return NextResponse.json({
    min:   Math.min(...prices),
    max:   Math.max(...prices),
    count: prices.length,
  } satisfies MarketPrice)
}
