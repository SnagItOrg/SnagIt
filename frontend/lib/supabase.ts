import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env.local file.')
}

// Browser / server-component client (anon key — respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types matching the database tables
export type Watchlist = {
  id: string
  user_id: string
  query: string
  created_at: string
  active: boolean
  type: 'query' | 'listing' | 'product'
  source_url: string | null
  max_price: number | null
  /** PAN-273: the watched kg_product on a `product` watchlist; absent until migration 069. */
  product_id?: string | null
  /** PAN-273: resolved by /api/watchlists for the link to the product page. */
  product_slug?: string | null
  new_count: number
  preview_image_url: string | null
}

export type UserPreferences = {
  id: string
  user_id: string
  categories: string[]
  brands: string[]
  onboarding_completed: boolean
  created_at: string
}

export type Listing = {
  id: string
  title: string
  price: number | null
  currency: string
  url: string
  image_url: string | null
  location: string | null
  scraped_at: string
  source: string
  country?: string | null
  price_dkk?: number | null
  platform?: string | null
  watchlist_id?: string | null
  external_id?: string | null
  normalized_text?: string | null
  condition?: string | null
  brand_id?: string | null
  is_active?: boolean | null
}
