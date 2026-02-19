import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: watchlists, error: wlError } = await getSupabaseAdmin()
    .from('watchlists')
    .select('id, query')
    .eq('active', true)

  if (wlError) {
    return NextResponse.json({ error: wlError.message }, { status: 500 })
  }

  if (!watchlists || watchlists.length === 0) {
    return NextResponse.json({ ok: true, message: 'No active watchlists', results: [] })
  }

  const results = []

  for (const watchlist of watchlists) {
    let listings
    try {
      listings = await scrapeDba(watchlist.query)
    } catch (err) {
      results.push({
        watchlist_id: watchlist.id,
        query: watchlist.query,
        error: err instanceof Error ? err.message : 'Scrape failed',
      })
      continue
    }

    if (listings.length === 0) {
      results.push({ watchlist_id: watchlist.id, query: watchlist.query, upserted: 0 })
      continue
    }

    const now = new Date().toISOString()
    const rows = listings.map((l) => ({ ...l, scraped_at: now, watchlist_id: watchlist.id }))

    const { data, error } = await getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'url,watchlist_id' })
      .select('id')

    results.push({
      watchlist_id: watchlist.id,
      query: watchlist.query,
      total_scraped: listings.length,
      upserted: data?.length ?? 0,
      ...(error && { error: error.message }),
    })
  }

  return NextResponse.json({ ok: true, results })
}
