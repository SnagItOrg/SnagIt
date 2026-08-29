export const MARKETS = ['DK', 'DE', 'SE', 'NO', 'US'] as const
export type Market = (typeof MARKETS)[number]

export type IntelListing = {
  id: string
  title: string
  url: string
  source: string
  country: Market
  price_dkk: number
  location: string | null
  scraped_at: string
}

export type MarketStats = {
  count: number
  min: number | null
  p25: number | null
  median: number | null
  p75: number | null
  max: number | null
}

/**
 * One real, dated price observation. There is no synthesised point in here:
 * if a product has no rows, the series is empty and the UI says so.
 */
export type TrendPoint = {
  at: string
  price_dkk: number
}

/**
 * What the trend series actually is, stated rather than implied.
 *
 * `market_price_daily` (migration 041) is the only correct basis for "the
 * market level on date X", and it holds zero rows in production — nothing in
 * this repository writes to it. So the one dated per-product price series that
 * exists is Reverb's sold comps, already normalised to DKK and already trusted
 * by the public product page. It is US sold-comp evidence spanning years, NOT
 * a 30-day DK market level, and every label on it says so.
 */
export type Trend = {
  points: TrendPoint[]
  source: 'reverb'
  priceType: 'sold'
  market: Market
}

export type IntelProduct = {
  id: string
  canonical_name: string
  trend: Trend | null
  markets: Record<Market, MarketStats>
  listings: IntelListing[]
  delta_dk_de: number | null
  delta_dk_se: number | null
  delta_dk_no: number | null
  delta_dk_us: number | null
  best_delta: number | null
}

export type IntelData = {
  products: IntelProduct[]
  lastScrape: string | null
  marketsTracked: number
}
