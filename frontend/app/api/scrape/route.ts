import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { query } = await req.json()

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
  }

  let listings
  try {
    listings = await scrapeDba(query.trim())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  if (listings.length === 0) {
    return NextResponse.json({ inserted: 0, message: 'No listings found' })
  }

  const now = new Date().toISOString()
  // watchlist_id: null marks these as manual scrapes (not tied to a watchlist)
  const rows = listings.map((l) => ({ ...l, scraped_at: now, watchlist_id: null }))

  // Upsert — unique constraint is (url, watchlist_id) NULLS NOT DISTINCT
  const { data, error } = await getSupabaseAdmin()
    .from('listings')
    .upsert(rows, { onConflict: 'url,watchlist_id' })
    .select('*')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Also fetch matching Reverb listings already in the DB.
  // Use OR per word so "Juno 106" matches both "Juno-106" and "Juno 106" titles.
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1)
  const { data: reverbData } = words.length > 0
    ? await getSupabaseAdmin()
        .from('listings')
        .select('*')
        .eq('source', 'reverb')
        .or(words.map((w) => `title.ilike.*${w}*`).join(','))
        .limit(50)
    : { data: [] }

  // Merge DBA + Reverb, deduplicate by url
  const seen = new Set<string>()
  const merged = [...(data ?? []), ...(reverbData ?? [])].filter((l) => {
    if (seen.has(l.url)) return false
    seen.add(l.url)
    return true
  })

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_scraped: listings.length,
    query,
    listings: merged,
  })
}
