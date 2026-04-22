import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { detectListingUrl, fetchListingFromUrl } from '@/lib/scrapers/listing-url'

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
      const result = await fetchListingFromUrl(sourceUrl)
      if (!result) return
      const { listing } = result
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

  // Priority 0: canonical product image from kg_product — mirrors what appears
  // as the Thomann top-card on the search page. Runs per-watchlist in parallel.
  const kgImagePromises = data.map(async (w) => {
    if (w.query.startsWith('http')) return [w.id, null] as const
    const words = w.query.split(/\s+/).filter((word: string) => word.length > 1)
    if (words.length === 0) return [w.id, null] as const
    let q = supabase
      .from('kg_product')
      .select('image_url')
      .not('image_url', 'is', null)
      .eq('status', 'active')
    for (const word of words) {
      q = q.ilike('canonical_name', `%${word}%`)
    }
    const { data: rows } = await q.limit(1)
    let img = rows?.[0]?.image_url as string | null | undefined
    if (img) img = img.replace(/\\\//g, '/')
    // /sbpics/ are Thomann salesperson portraits, not product shots
    if (img && img.includes('/sbpics/')) img = null
    return [w.id, img ?? null] as const
  })

  // Remaining sub-queries are independent — run in parallel
  const [kgImageResults, { data: unnotified }, { data: recentImages }, { data: topPriceImages }] = await Promise.all([
    Promise.all(kgImagePromises),

    // Count unnotified listings per watchlist
    supabase
      .from('listings')
      .select('watchlist_id')
      .is('notified_at', null)
      .in('watchlist_id', ids),

    // Priority 1: most recently scraped image per watchlist (no limit — global ordering would starve old watchlists)
    supabase
      .from('listings')
      .select('watchlist_id, image_url')
      .in('watchlist_id', ids)
      .not('image_url', 'is', null)
      .order('scraped_at', { ascending: false }),

    // Priority 2: most expensive listing image per watchlist (fills gaps left by priority 1)
    supabase
      .from('listings')
      .select('watchlist_id, image_url')
      .in('watchlist_id', ids)
      .not('image_url', 'is', null)
      .not('price', 'is', null)
      .order('price', { ascending: false }),
  ])

  const countMap = new Map<string, number>()
  for (const row of unnotified ?? []) {
    if (row.watchlist_id) {
      countMap.set(row.watchlist_id, (countMap.get(row.watchlist_id) ?? 0) + 1)
    }
  }

  const imageMap = new Map<string, string>()
  // Priority 0: canonical product image
  for (const [id, img] of kgImageResults) {
    if (img) imageMap.set(id, img)
  }
  // Priority 1: most recently scraped listing image
  for (const row of recentImages ?? []) {
    if (row.watchlist_id && row.image_url && !imageMap.has(row.watchlist_id)) {
      imageMap.set(row.watchlist_id, row.image_url)
    }
  }
  // Priority 2: highest-priced listing image
  for (const row of topPriceImages ?? []) {
    if (row.watchlist_id && row.image_url && !imageMap.has(row.watchlist_id)) {
      imageMap.set(row.watchlist_id, row.image_url)
    }
  }

  const result = data.map((w) => ({
    ...w,
    new_count: countMap.get(w.id) ?? 0,
    preview_image_url: imageMap.get(w.id) ?? null,
  }))
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { query, min_price, max_price } = body

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  const minPrice: number | undefined =
    typeof min_price === 'number' && min_price > 0 ? min_price : undefined
  const maxPrice: number | undefined =
    typeof max_price === 'number' && max_price > 0 ? max_price : undefined

  let insertData: {
    user_id: string
    query: string
    type: 'query' | 'listing'
    source_url?: string
    min_price?: number
    max_price?: number
  }

  const urlSource = detectListingUrl(query)

  if (urlSource) {
    // Fetch the listing to use its title as the watchlist display name
    let result
    try {
      result = await fetchListingFromUrl(query)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kunne ikke hente annonce'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    if (!result) {
      return NextResponse.json({ error: 'Ukendt link format' }, { status: 400 })
    }

    insertData = {
      user_id: user.id,
      query: result.listing.title,
      type: 'listing',
      source_url: query,
      ...(minPrice !== undefined && { min_price: minPrice }),
      ...(maxPrice !== undefined && { max_price: maxPrice }),
    }
  } else {
    insertData = {
      user_id: user.id,
      query: query.trim(),
      type: 'query',
      ...(minPrice !== undefined && { min_price: minPrice }),
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
