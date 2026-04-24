import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PricePoint = {
  sold_at:   string
  price:     number
  condition: string | null
  source:    'reverb' | 'auctionet'
}

export type PriceRange = {
  low:    number
  high:   number
  median: number
  count:  number
}

function iqrFilter(prices: number[]): number[] {
  if (prices.length < 4) return prices
  const sorted = [...prices].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const iqr = q3 - q1
  const lo  = q1 - 1.5 * iqr
  const hi  = q3 + 1.5 * iqr
  return sorted.filter((p) => p >= lo && p <= hi)
}

function median(prices: number[]): number {
  const s = [...prices].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const admin = getSupabaseAdmin()

  const { data: product, error } = await admin
    .from('kg_product')
    .select('*, kg_brand(name, slug)')
    .eq('slug', params.slug)
    .single()

  if (error || !product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const canonicalName = (product as unknown as Record<string, unknown>).canonical_name as string

  const [matchesRes, reverbRes, auctionetRes] = await Promise.all([
    admin
      .from('listing_product_match')
      .select('score, listings(*)')
      .eq('product_id', product.id)
      .order('score', { ascending: false })
      .limit(50),
    admin
      .from('reverb_price_history')
      .select('price, sold_at, condition')
      .ilike('query', `%${canonicalName}%`)
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: true })
      .limit(500),
    admin
      .from('auctionet_price_history')
      .select('price, sold_at, condition')
      .ilike('query', `%${canonicalName}%`)
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: true })
      .limit(500),
  ])

  const listings = (matchesRes.data ?? [])
    .map((m) => m.listings)
    .filter((l) => l != null && (l as unknown as Record<string, unknown>).is_active !== false)
    .slice(0, 20)

  // Build price history time-series
  const priceHistory: PricePoint[] = [
    ...(reverbRes.data ?? []).map((r) => ({
      sold_at:   r.sold_at as string,
      price:     Number(r.price),
      condition: r.condition as string | null,
      source:    'reverb' as const,
    })),
    ...(auctionetRes.data ?? []).map((r) => ({
      sold_at:   r.sold_at as string,
      price:     Number(r.price),
      condition: r.condition as string | null,
      source:    'auctionet' as const,
    })),
  ].sort((a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime())

  // IQR-filtered price range
  const rawPrices = priceHistory.map((p) => p.price).filter((p) => p > 0)
  const filtered  = iqrFilter(rawPrices)
  const priceRange: PriceRange | null = filtered.length >= 3
    ? { low: Math.min(...filtered), high: Math.max(...filtered), median: Math.round(median(filtered)), count: filtered.length }
    : null

  return NextResponse.json({ product, listings, priceHistory, priceRange }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
  })
}
