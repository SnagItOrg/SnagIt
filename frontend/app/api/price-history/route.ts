import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PricePoint = {
  sold_at:   string
  price:     number
  condition: string | null
  source:    'reverb' | 'auctionet'
}

// GET /api/price-history?watchlist_id=X
// GET /api/price-history?query=...
// Returns combined time-series from reverb_price_history + auctionet_price_history.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const watchlistId = searchParams.get('watchlist_id')
  const query       = searchParams.get('query')

  if (!watchlistId && !query) {
    return NextResponse.json({ error: 'watchlist_id or query required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  const [reverbRes, auctionetRes] = await Promise.all([
    watchlistId
      ? supabase.from('reverb_price_history')
          .select('price, sold_at, condition')
          .eq('watchlist_id', watchlistId)
          .not('sold_at', 'is', null)
          .order('sold_at', { ascending: true })
      : supabase.from('reverb_price_history')
          .select('price, sold_at, condition')
          .ilike('query', `%${query}%`)
          .not('sold_at', 'is', null)
          .order('sold_at', { ascending: true }),
    watchlistId
      ? supabase.from('auctionet_price_history')
          .select('price, sold_at, condition')
          .eq('watchlist_id', watchlistId)
          .not('sold_at', 'is', null)
          .order('sold_at', { ascending: true })
      : supabase.from('auctionet_price_history')
          .select('price, sold_at, condition')
          .ilike('query', `%${query}%`)
          .not('sold_at', 'is', null)
          .order('sold_at', { ascending: true }),
  ])

  const reverb: PricePoint[] = (reverbRes.data ?? []).map((r) => ({
    sold_at:   r.sold_at,
    price:     Number(r.price),
    condition: r.condition ?? null,
    source:    'reverb' as const,
  }))

  const auctionet: PricePoint[] = (auctionetRes.data ?? []).map((r) => ({
    sold_at:   r.sold_at,
    price:     Number(r.price),
    condition: r.condition ?? null,
    source:    'auctionet' as const,
  }))

  // Merge and sort by date
  const combined = [...reverb, ...auctionet].sort(
    (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime()
  )

  return NextResponse.json(combined)
}
