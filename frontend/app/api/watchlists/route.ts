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
  if (!data || data.length === 0) return NextResponse.json([])

  const ids = data.map((w) => w.id)

  // Count unnotified listings per watchlist
  const { data: unnotified } = await supabase
    .from('listings')
    .select('watchlist_id')
    .is('notified_at', null)
    .in('watchlist_id', ids)

  const countMap = new Map<string, number>()
  for (const row of unnotified ?? []) {
    if (row.watchlist_id) {
      countMap.set(row.watchlist_id, (countMap.get(row.watchlist_id) ?? 0) + 1)
    }
  }

  // Most recent image per watchlist (ordered DESC so first hit per id wins)
  const { data: images } = await supabase
    .from('listings')
    .select('watchlist_id, image_url')
    .in('watchlist_id', ids)
    .not('image_url', 'is', null)
    .order('scraped_at', { ascending: false })

  const imageMap = new Map<string, string>()
  for (const row of images ?? []) {
    if (row.watchlist_id && row.image_url && !imageMap.has(row.watchlist_id)) {
      imageMap.set(row.watchlist_id, row.image_url)
    }
  }

  const result = data.map((w) => ({
    ...w,
    new_count: countMap.get(w.id) ?? 0,
    preview_image_url: imageMap.get(w.id) ?? null,
  }))
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { query, max_price } = body

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  const maxPrice: number | undefined =
    typeof max_price === 'number' && max_price > 0 ? max_price : undefined

  let insertData: {
    user_id: string
    query: string
    type: 'query' | 'listing'
    source_url?: string
    max_price?: number
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
      ...(maxPrice !== undefined && { max_price: maxPrice }),
    }
  } else {
    insertData = {
      user_id: user.id,
      query: query.trim(),
      type: 'query',
      ...(maxPrice !== undefined && { max_price: maxPrice }),
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

  return NextResponse.json({ ...data, new_count: 0, preview_image_url: null }, { status: 201 })
}
