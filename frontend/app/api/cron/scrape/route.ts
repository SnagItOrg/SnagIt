/**
 * Vercel watchlist cron. Scrapes each ACTIVE watchlist, writes listings, and
 * hands the matcher exactly the rows this execution FIRST inserted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BATCH LIFECYCLE: one batch id per ROUTE EXECUTION, not per watchlist.
 *
 * A single invocation loops over every active watchlist, so it can write
 * several sources (`dba.dk` from the query path; `dba.dk` / `reverb` /
 * `thomann` from the listing path) and the same listing URL can legitimately
 * appear under more than one watchlist. Execution scope is the natural unit
 * because the identity boundary asks "which rows did this execution insert?" —
 * a per-watchlist id would answer the same question with N times the lookups
 * and would still have to be reconciled across watchlists before matching.
 *
 * The id is minted BEFORE the first listing write, stamped on every attempted
 * INSERT payload, and made immutable by migration 055's trigger. Both writes
 * are `ON CONFLICT (url, watchlist_id) DO UPDATE`, so a conflict refresh keeps
 * the row's ORIGINAL identity: a legacy row stays NULL and a row inserted by an
 * earlier execution keeps that earlier id. Neither is handed off again.
 *
 * ELIGIBILITY is re-queried from the database afterwards and verified again in
 * memory — never the upsert's returned ids, which include refreshed rows, and
 * never `scraped_at` / `first_seen_at` / wall-clock inference. Missing,
 * malformed, mismatched, incomplete, oversized or failed identity evidence
 * performs ZERO matcher writes for the whole execution.
 */

import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sendNewListingsEmail } from '@/lib/email'
import { newIngestionBatchId, matchRunInflow, reportBatchMatch } from '@/lib/matching/ingestion-batch'
import { fetchListingFromUrl } from '@/lib/scrapers/listing-url'

export async function GET(req: NextRequest) {
  // S3. CONFIGURATION IS CHECKED BEFORE AUTHORISATION, AND BEFORE ANY WORK.
  //
  // This read `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``. With the
  // variable unset the template produced the literal string "Bearer undefined",
  // so a caller sending exactly that header passed the guard and started the
  // scraper: live marketplace fetches and `listings` writes, from the public
  // internet. Measured, not theorised — `Bearer undefined` was admitted while
  // an absent header and a wrong token were both refused.
  //
  // A missing secret is a misconfiguration, never an authorisation. It answers
  // 503 and returns before the Supabase client is constructed, so no scraper
  // and no database work can run in that state. The reason code names the
  // variable; the value is never read into a message, a log line or a response.
  const cronSecret = process.env.CRON_SECRET
  if (typeof cronSecret !== 'string' || cronSecret.length === 0) {
    console.error(
      JSON.stringify({
        channel: 'operational',
        component: 'cron',
        event: 'cron_secret_not_configured',
        detail: 'CRON_SECRET is unset or empty; the scrape cron refuses to run',
      }),
    )
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: watchlists, error: wlError } = await getSupabaseAdmin()
    .from('watchlists')
    .select('id, query, user_id, type, source_url, max_price')
    .eq('active', true)

  if (wlError) {
    return NextResponse.json({ error: wlError.message }, { status: 500 })
  }

  if (!watchlists || watchlists.length === 0) {
    return NextResponse.json({ ok: true, message: 'No active watchlists', results: [] })
  }

  const results = []

  // One immutable identity for this execution, generated before ANY listing
  // write. Migration 055's trigger stamps `ingested_at` from database time on
  // first insert and carries both values over verbatim on every refresh.
  const ingestionBatchId = newIngestionBatchId()

  // `listings.source` values this execution actually ATTEMPTED to write. Taken
  // from the rows themselves rather than from a source→path mapping, so a new
  // fetcher cannot silently fall outside the handoff.
  const writtenSources = new Set<string>()

  for (const watchlist of watchlists) {
    const now = new Date().toISOString()

    // ── Specific listing ──────────────────────────────────────────────────────
    if (watchlist.type === 'listing') {
      if (!watchlist.source_url) {
        results.push({ watchlist_id: watchlist.id, error: 'Missing source_url' })
        continue
      }

      let fetchResult
      try {
        fetchResult = await fetchListingFromUrl(watchlist.source_url)
      } catch (err) {
        results.push({
          watchlist_id: watchlist.id,
          query: watchlist.query,
          error: err instanceof Error ? err.message : 'Scrape failed',
        })
        continue
      }

      if (!fetchResult) {
        results.push({ watchlist_id: watchlist.id, query: watchlist.query, error: 'Ukendt link format' })
        continue
      }

      const listing = fetchResult.listing
      // `ingested_at` is deliberately NOT sent: migration 055 establishes it
      // from DATABASE time. `scraped_at` keeps its own meaning (last observed).
      const row = {
        ...listing,
        scraped_at: now,
        watchlist_id: watchlist.id,
        ingestion_batch_id: ingestionBatchId,
      }

      const { error: upsertError } = await getSupabaseAdmin()
        .from('listings')
        .upsert(row, { onConflict: 'url,watchlist_id' })

      if (upsertError) {
        results.push({ watchlist_id: watchlist.id, query: watchlist.query, error: upsertError.message })
        continue
      }

      // Matching is NOT run here. The upsert's returned ids include rows the
      // conflict path merely refreshed, which are not first ingestion. The
      // execution-scoped handoff below asks the database instead.
      if (listing.source) writtenSources.add(listing.source)

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

    // Filter out listings that exceed the watchlist's max_price
    const filtered = watchlist.max_price
      ? listings.filter((l) => l.price === null || l.price <= watchlist.max_price!)
      : listings

    if (filtered.length === 0) {
      results.push({ watchlist_id: watchlist.id, query: watchlist.query, upserted: 0, filtered_by_price: listings.length })
      continue
    }

    // Every attempted INSERT carries this execution's identity; `ingested_at`
    // is left to migration 055 (database time), never an application clock.
    const rows = filtered.map((l) => ({
      ...l,
      scraped_at: now,
      watchlist_id: watchlist.id,
      ingestion_batch_id: ingestionBatchId,
    }))

    const { error: upsertError } = await getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'url,watchlist_id' })

    if (upsertError) {
      results.push({ watchlist_id: watchlist.id, query: watchlist.query, error: upsertError.message })
      continue
    }

    // Matching is NOT run here — see the listing path above.
    for (const l of filtered) if (l.source) writtenSources.add(l.source)

    // Record price snapshots for all price-filtered listings
    const snapshots = filtered.map((l) => ({
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
      filtered_by_price: listings.length - filtered.length,
      // Rows WRITTEN (inserted or refreshed). Deliberately not called "new":
      // how many were first ingestion is decided by the database below, not by
      // the size of an upsert.
      upserted: filtered.length,
      notified,
    })
  }

  // ── Execution-scoped new-inflow handoff ───────────────────────────────────
  // Runs once, after every watchlist has been written, so the same listing
  // identity seen under several watchlists is reconciled before matching.
  // Fail-closed: an unusable boundary matches nothing for this execution.
  const inflow = await matchRunInflow(getSupabaseAdmin(), ingestionBatchId, writtenSources)
  for (const r of inflow.results) reportBatchMatch(r)

  return NextResponse.json({
    ok: true,
    results,
    ingestion: {
      complete: inflow.complete,
      // Counts only — never listing titles, urls or secrets.
      sources: inflow.results.map((r) => ({
        source: r.source,
        considered: r.considered,
        matched: r.matched,
        rejected: r.rejected,
        deferred: r.deferred,
        skipped: r.skipped ?? null,
      })),
    },
  })
}
