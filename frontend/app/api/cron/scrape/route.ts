import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendNewListingsEmail } from '@/lib/email'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: watchlists, error: wlError } = await getSupabaseAdmin()
    .from('watchlists')
    .select('id, query, user_id')
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

    const { data: upserted, error: upsertError } = await getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'url,watchlist_id' })
      .select('id')

    if (upsertError) {
      results.push({ watchlist_id: watchlist.id, query: watchlist.query, error: upsertError.message })
      continue
    }

    // Find listings that haven't been notified yet (genuinely new since last cron run)
    const { data: newListings } = await getSupabaseAdmin()
      .from('listings')
      .select('title, price, currency, url')
      .eq('watchlist_id', watchlist.id)
      .is('notified_at', null)

    let notified = 0
    if (newListings && newListings.length > 0) {
      // Get the watchlist owner's email
      const { data: { user } } = await getSupabaseAdmin()
        .auth.admin.getUserById(watchlist.user_id)

      if (user?.email) {
        try {
          await sendNewListingsEmail({
            to: user.email,
            query: watchlist.query,
            listings: newListings,
          })
          notified = newListings.length
        } catch (emailErr) {
          // Log but don't fail the whole cron run
          console.error(`Email failed for watchlist ${watchlist.id}:`, emailErr)
        }
      }

      // Mark as notified whether or not the email succeeded,
      // to avoid re-sending on the next cron tick
      await getSupabaseAdmin()
        .from('listings')
        .update({ notified_at: now })
        .eq('watchlist_id', watchlist.id)
        .is('notified_at', null)
    }

    results.push({
      watchlist_id: watchlist.id,
      query: watchlist.query,
      total_scraped: listings.length,
      upserted: upserted?.length ?? 0,
      notified,
    })
  }

  return NextResponse.json({ ok: true, results })
}
