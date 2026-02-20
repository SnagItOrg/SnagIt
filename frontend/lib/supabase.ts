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
  type: 'query' | 'listing'
  source_url: string | null
  new_count: number
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
}
