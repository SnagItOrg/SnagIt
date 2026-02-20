import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { scrapeDbaListing } from '@/lib/scrapers/dba-listing'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendNewListingsEmail } from '@/lib/email'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: watchlists, error: wlError } = await getSupabaseAdmin()
    .from('watchlists')
    .select('id, query, user_id, type, source_url')
    .eq('active', true)

  if (wlError) {
    return NextResponse.json({ error: wlError.message }, { status: 500 })
  }

  if (!watchlists || watchlists.length === 0) {
    return NextResponse.json({ ok: true, message: 'No active watchlists', results: [] })
  }

  const results = []

  for (const watchlist of watchlists) {
    const now = new Date().toISOString()

    // ── Specific listing ──────────────────────────────────────────────────────
    if (watchlist.type === 'listing') {
      if (!watchlist.source_url) {
        results.push({ watchlist_id: watchlist.id, error: 'Missing source_url' })
        continue
      }

      let listing
      try {
        listing = await scrapeDbaListing(watchlist.source_url)
      } catch (err) {
        results.push({
          watchlist_id: watchlist.id,
          query: watchlist.query,
          error: err instanceof Error ? err.message : 'Scrape failed',
        })
        continue
      }

      const row = { ...listing, scraped_at: now, watchlist_id: watchlist.id }

      const { error: upsertError } = await getSupabaseAdmin()
        .from('listings')
        .upsert(row, { onConflict: 'url,watchlist_id' })

      if (upsertError) {
        results.push({ watchlist_id: watchlist.id, query: watchlist.query, error: upsertError.message })
        continue
      }

      // Record price snapshot
      await getSupabaseAdmin()
        .from('price_snapshots')
        .insert({
          listing_url: listing.url,
          watchlist_id: watchlist.id,
          price: listing.price,
          currency: listing.currency,
          title: listing.title,
          scraped_at: now,
        })

      // Notify if new (notified_at IS NULL)
      const { data: newListings } = await getSupabaseAdmin()
        .from('listings')
        .select('title, price, currency, url')
        .eq('watchlist_id', watchlist.id)
        .is('notified_at', null)

      let notified = 0
      if (newListings && newListings.length > 0) {
        const { data: { user } } = await getSupabaseAdmin()
          .auth.admin.getUserById(watchlist.user_id)

        if (user?.email) {
          try {
            await sendNewListingsEmail({ to: user.email, query: watchlist.query, listings: newListings })
            notified = newListings.length
          } catch (emailErr) {
            console.error(`Email failed for watchlist ${watchlist.id}:`, emailErr)
          }
        }

        await getSupabaseAdmin()
          .from('listings')
          .update({ notified_at: now })
          .eq('watchlist_id', watchlist.id)
          .is('notified_at', null)
      }

      results.push({ watchlist_id: watchlist.id, query: watchlist.query, type: 'listing', notified })
      continue
    }

    // ── Search query ──────────────────────────────────────────────────────────
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

    const rows = listings.map((l) => ({ ...l, scraped_at: now, watchlist_id: watchlist.id }))

    const { data: upserted, error: upsertError } = await getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'url,watchlist_id' })
      .select('id')

    if (upsertError) {
      results.push({ watchlist_id: watchlist.id, query: watchlist.query, error: upsertError.message })
      continue
    }

    // Record price snapshots for all scraped listings
    const snapshots = listings.map((l) => ({
      listing_url: l.url,
      watchlist_id: watchlist.id,
      price: l.price,
      currency: l.currency,
      title: l.title,
      scraped_at: now,
    }))
    await getSupabaseAdmin().from('price_snapshots').insert(snapshots)

    const { data: newListings } = await getSupabaseAdmin()
      .from('listings')
      .select('title, price, currency, url')
      .eq('watchlist_id', watchlist.id)
      .is('notified_at', null)

    let notified = 0
    if (newListings && newListings.length > 0) {
      const { data: { user } } = await getSupabaseAdmin()
        .auth.admin.getUserById(watchlist.user_id)

      if (user?.email) {
        try {
          await sendNewListingsEmail({ to: user.email, query: watchlist.query, listings: newListings })
          notified = newListings.length
        } catch (emailErr) {
          console.error(`Email failed for watchlist ${watchlist.id}:`, emailErr)
        }
      }

      await getSupabaseAdmin()
        .from('listings')
        .update({ notified_at: now })
        .eq('watchlist_id', watchlist.id)
        .is('notified_at', null)
    }

    results.push({
      watchlist_id: watchlist.id,
      query: watchlist.query,
      type: 'query',
      total_scraped: listings.length,
      upserted: upserted?.length ?? 0,
      notified,
    })
  }

  return NextResponse.json({ ok: true, results })
}
