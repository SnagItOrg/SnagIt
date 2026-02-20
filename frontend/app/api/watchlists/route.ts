import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isDbaListingUrl, scrapeDbaListing } from '@/lib/scrapers/dba-listing'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// Runs in the background after the 201 response is sent.
// Scrapes up to 3 pages so the user sees results immediately.
async function runInitialScrape(
  watchlistId: string,
  query: string,
  type: 'query' | 'listing',
  sourceUrl?: string,
) {
  const now = new Date().toISOString()
  const admin = getSupabaseAdmin()

  try {
    if (type === 'listing' && sourceUrl) {
      const listing = await scrapeDbaListing(sourceUrl)
      const row = { ...listing, scraped_at: now, watchlist_id: watchlistId }
      await admin.from('listings').upsert(row, { onConflict: 'url,watchlist_id' })
      await admin.from('price_snapshots').insert({
        listing_url: listing.url,
        watchlist_id: watchlistId,
        price: listing.price,
        currency: listing.currency,
        title: listing.title,
        scraped_at: now,
      })
    } else {
      const listings = await scrapeDba(query, 3)
      if (listings.length === 0) return
      const rows = listings.map((l) => ({ ...l, scraped_at: now, watchlist_id: watchlistId }))
      await admin.from('listings').upsert(rows, { onConflict: 'url,watchlist_id' })
      const snapshots = listings.map((l) => ({
        listing_url: l.url,
        watchlist_id: watchlistId,
        price: l.price,
        currency: l.currency,
        title: l.title,
        scraped_at: now,
      }))
      await admin.from('price_snapshots').insert(snapshots)
    }
  } catch (err) {
    console.error(`Initial scrape failed for watchlist ${watchlistId}:`, err)
  }
}

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query } = await req.json()
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  let insertData: {
    user_id: string
    query: string
    type: 'query' | 'listing'
    source_url?: string
  }

  if (isDbaListingUrl(query)) {
    // Fetch the listing title to use as the display name
    let listing
    try {
      listing = await scrapeDbaListing(query)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kunne ikke hente annonce'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    insertData = {
      user_id: user.id,
      query: listing.title,
      type: 'listing',
      source_url: query,
    }
  } else {
    insertData = {
      user_id: user.id,
      query: query.trim(),
      type: 'query',
    }
  }

  const { data, error } = await supabase
    .from('watchlists')
    .insert(insertData)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Trigger initial scrape in the background — don't block the 201 response
  void runInitialScrape(data.id, insertData.query, insertData.type, insertData.source_url)

  return NextResponse.json(data, { status: 201 })
}
