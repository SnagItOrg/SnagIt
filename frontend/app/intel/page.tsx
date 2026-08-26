import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { hasPlausibleListingPrice } from '@/lib/listing-price-integrity'
import { IntelDashboard } from './IntelDashboard'
import {
  MARKETS,
  type IntelData,
  type IntelListing,
  type IntelProduct,
  type Market,
  type MarketStats,
} from './types'

export const dynamic = 'force-dynamic'

type ProductRow = { id: string; canonical_name: string }

type MatchWithListing = {
  product_id: string
  listings: {
    id: string
    title: string
    url: string
    source: string
    country: string | null
    /** Raw source-currency price — needed for the price-integrity predicate. */
    price: number | string | null
    price_dkk: number | string | null
    location: string | null
    scraped_at: string
  } | null
}

function toNumber(value: number | string | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isMarket(value: string | null): value is Market {
  return value === 'DK' || value === 'DE' || value === 'SE' || value === 'NO' || value === 'US'
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

function statsFromPrices(prices: number[]): MarketStats {
  if (prices.length === 0) {
    return { count: 0, min: null, p25: null, median: null, p75: null, max: null }
  }
  const sorted = [...prices].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  }
}

async function loadIntelData(): Promise<IntelData> {
  const admin = getSupabaseAdmin()

  const { data: products, error: productsError } = await admin
    .from('kg_product')
    .select('id, canonical_name')
    .eq('tier', 'legendary')
    .eq('status', 'active')
    .order('canonical_name', { ascending: true })

  if (productsError) {
    throw new Error(`Failed to load legendary products: ${productsError.message}`)
  }

  const productRows = (products ?? []) as ProductRow[]
  if (productRows.length === 0) {
    return { products: [], lastScrape: null, marketsTracked: MARKETS.length }
  }

  const productIds = productRows.map((p) => p.id)

  const { data: matches, error: matchesError } = await admin
    .from('listing_product_match')
    .select(
      'product_id, listings!inner(id, title, url, source, country, price, price_dkk, location, scraped_at)',
    )
    .in('product_id', productIds)
    .eq('listings.is_active', true)
    .in('listings.country', MARKETS as unknown as string[])

  if (matchesError) {
    throw new Error(`Failed to load matched listings: ${matchesError.message}`)
  }

  const matchRows = (matches ?? []) as unknown as MatchWithListing[]

  const grouped = new Map<string, IntelListing[]>()
  for (const p of productRows) grouped.set(p.id, [])

  let lastScrape: string | null = null
  for (const m of matchRows) {
    const l = m.listings
    if (!l) continue
    if (!isMarket(l.country)) continue
    // Legacy Kleinanzeigen rows with concatenated raw prices would otherwise
    // dominate every DE median and delta on this dashboard. See
    // lib/listing-price-integrity.ts.
    if (!hasPlausibleListingPrice(l)) continue
    const price = toNumber(l.price_dkk)
    if (price == null || price <= 0) continue
    const list = grouped.get(m.product_id)
    if (!list) continue
    list.push({
      id: l.id,
      title: l.title,
      url: l.url,
      source: l.source,
      country: l.country,
      price_dkk: price,
      location: l.location,
      scraped_at: l.scraped_at,
    })
    if (!lastScrape || l.scraped_at > lastScrape) lastScrape = l.scraped_at
  }

  const intelProducts: IntelProduct[] = productRows.map((p) => {
    const listings = (grouped.get(p.id) ?? []).sort((a, b) => a.price_dkk - b.price_dkk)

    const markets = {
      DK: statsFromPrices([]),
      DE: statsFromPrices([]),
      SE: statsFromPrices([]),
      NO: statsFromPrices([]),
      US: statsFromPrices([]),
    } as Record<Market, MarketStats>

    for (const m of MARKETS) {
      const prices = listings.filter((l) => l.country === m).map((l) => l.price_dkk)
      markets[m] = statsFromPrices(prices)
    }

    const dk = markets.DK.median
    const delta = (other: number | null) => (dk != null && other != null ? dk - other : null)

    const foreignMedians = [markets.DE.median, markets.SE.median, markets.NO.median, markets.US.median]
      .filter((v): v is number => v != null)
    const cheapestForeign = foreignMedians.length > 0 ? Math.min(...foreignMedians) : null
    const best_delta = dk != null && cheapestForeign != null ? dk - cheapestForeign : null

    return {
      id: p.id,
      canonical_name: p.canonical_name,
      markets,
      listings,
      delta_dk_de: delta(markets.DE.median),
      delta_dk_se: delta(markets.SE.median),
      delta_dk_no: delta(markets.NO.median),
      delta_dk_us: delta(markets.US.median),
      best_delta,
    }
  })

  intelProducts.sort((a, b) => {
    if (a.best_delta == null && b.best_delta == null) {
      return a.canonical_name.localeCompare(b.canonical_name, 'en')
    }
    if (a.best_delta == null) return 1
    if (b.best_delta == null) return -1
    if (b.best_delta !== a.best_delta) return b.best_delta - a.best_delta
    return a.canonical_name.localeCompare(b.canonical_name, 'en')
  })

  return { products: intelProducts, lastScrape, marketsTracked: MARKETS.length }
}

export default async function IntelPage() {
  const data = await loadIntelData()
  return <IntelDashboard data={data} />
}
