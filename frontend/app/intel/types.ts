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

export type IntelProduct = {
  id: string
  canonical_name: string
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
