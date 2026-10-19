/**
 * scripts/notify-watchlists.ts
 *
 * PAN-12. One email per active watchlist with the listings that are new since
 * the last run and hit it (`scripts/lib/watchlist-hits.ts`), from every
 * supported marketplace. Runs on panter under PM2 after the nightly scrapes
 * have promoted and matched; it only reads `listings`, so it never competes
 * with ingestion on the listings unique index.
 *
 * New means `listings.ingested_at` (write-once database time, migration 055)
 * after the watchlist was created, after the go-live, and inside the last
 * 7 days. The go-live is the moment migration 066 was applied: it marked the
 * 324 historical rows as seen, so nothing older is ever sent (owner decision 2,
 * 2026-10-07). Every run re-reads the whole window and leaves the dedupe to
 * the (watchlist, listing) claim, so a night the job missed is caught up by
 * the next one and a listing promoted after the run goes out the night after.
 *
 * Honours `notification_preferences` (email_enabled, new_listings; no row
 * means the defaults, both on).
 *
 * Dry run by default: prints the would-send list — watchlist id, query, the
 * hits — and writes nothing. It skips pairs the table already holds, so it
 * shows what tonight's --apply would do. Before 066 is applied it has no
 * go-live and previews the last 24 hours instead; --apply refuses then.
 *   npx tsx scripts/notify-watchlists.ts            # dry run
 *   npx tsx scripts/notify-watchlists.ts --apply
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { sendNewListingsEmail } from '../frontend/lib/email'
import { isNonProduct, matchesWatchlist, notifyHits, type HitListing, type HitWatchlist } from './lib/watchlist-hits'

const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')
if (APPLY && (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)) {
  console.error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL; --apply refuses')
  process.exit(1)
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PAGE = 1000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  const { data: seen, error: seenError } = await supabase
    .from('watchlist_notification')
    .select('attempted_at')
    .eq('outcome', 'seen')
    .order('attempted_at', { ascending: true })
    .limit(1)
  const goLive = !seenError && seen?.[0] ? Date.parse(seen[0].attempted_at) : null
  if (goLive == null && APPLY) {
    console.error('watchlist_notification has no go-live (migration 066 not applied); refusing')
    process.exit(1)
  }
  const since = new Date(goLive == null ? Date.now() - DAY_MS : Math.max(goLive, Date.now() - WINDOW_MS)).toISOString()

  const { data: watchlists, error: wlError } = await supabase
    .from('watchlists')
    .select('id, user_id, query, min_price, max_price, created_at')
    .eq('active', true)
    .eq('type', 'query')
    .not('user_id', 'is', null) // an ownerless watchlist has nobody to mail (production holds some)
  if (wlError) throw new Error(`watchlists: ${wlError.message}`)

  // Keyset on (ingested_at, id). A promoted batch shares one ingested_at, so
  // the id breaks the tie; ordering by id alone walks the whole primary key
  // (7.8 s a page on 115k rows, measured 2026-10-19), this reads the window.
  const listings: HitListing[] = []
  let cursor: { at: string; id: string } | null = null
  for (;;) {
    let q = supabase
      .from('listings')
      .select('id, title, price, currency, price_dkk, url, source, ingested_at')
      .is('watchlist_id', null)
      .gt('ingested_at', since)
      .order('ingested_at')
      .order('id')
      .limit(PAGE)
    if (cursor) q = q.or(`ingested_at.gt."${cursor.at}",and(ingested_at.eq."${cursor.at}",id.gt.${cursor.id})`)
    const { data, error } = await q
    if (error) throw new Error(`listings: ${error.message}`)
    listings.push(...(data as HitListing[]))
    if (!data || data.length < PAGE) break
    const last = data[data.length - 1]
    cursor = { at: last.ingested_at, id: last.id }
  }

  const userIds = [...new Set((watchlists ?? []).map((w) => w.user_id as string))]
  const { data: prefs, error: prefError } = await supabase
    .from('notification_preferences')
    .select('user_id, email_enabled, new_listings')
    .in('user_id', userIds)
  if (prefError) throw new Error(`notification_preferences: ${prefError.message}`)
  const optedOut = new Set(
    (prefs ?? []).filter((p) => p.email_enabled === false || p.new_listings === false).map((p) => p.user_id as string),
  )

  // The dry run honours the claim table too: every pair claimed for a listing
  // in the window was claimed after `since`, so this read is bounded.
  const handled = new Set<string>()
  if (!APPLY && goLive != null) {
    const { data: rows, error } = await supabase
      .from('watchlist_notification')
      .select('watchlist_id, listing_id')
      .gte('attempted_at', since)
    if (error) throw new Error(`watchlist_notification: ${error.message}`)
    for (const r of rows ?? []) handled.add(`${r.watchlist_id}:${r.listing_id}`)
  }

  console.log(
    `${APPLY ? 'apply' : 'dry run'}: since ${since}${goLive == null ? ' (no go-live: 066 not applied, last 24 h shown)' : ''}, `
    + `${listings.length} new listings, ${watchlists?.length ?? 0} active watchlists, ${optedOut.size} user(s) opted out`,
  )

  const tally: Record<string, number> = {}
  let wouldSend = 0
  let wouldSendListings = 0
  const wouldSendUsers = new Set<string>()
  for (const w of (watchlists ?? []) as Array<HitWatchlist & { user_id: string }>) {
    const matched = listings.filter((l) => matchesWatchlist(w, l))
    const hits = matched.filter((l) => !isNonProduct(l)).sort((a, b) => (a.price_dkk ?? Infinity) - (b.price_dkk ?? Infinity))
    if (hits.length === 0) continue

    if (!APPLY) {
      const fresh = hits.filter((l) => !handled.has(`${w.id}:${l.id}`))
      if (fresh.length === 0) continue
      const skipped = matched.length - hits.length
      const note = [
        skipped ? `${skipped} part/wanted skipped` : '',
        optedOut.has(w.user_id) ? 'opted out' : '',
      ].filter(Boolean).join(', ')
      console.log(`  ${w.id}  "${w.query}"  ${fresh.length} hit(s)${note ? ` (${note})` : ''}`)
      for (const l of fresh.slice(0, 5)) {
        console.log(`    • ${l.title} — ${l.price_dkk != null ? `${l.price_dkk.toLocaleString('da-DK')} kr` : 'no price'} (${l.source})`)
      }
      if (fresh.length > 5) console.log(`    …and ${fresh.length - 5} more`)
      if (!optedOut.has(w.user_id)) {
        wouldSend += 1
        wouldSendListings += fresh.length
        wouldSendUsers.add(w.user_id)
      }
      continue
    }

    const { data: user } = await supabase.auth.admin.getUserById(w.user_id)
    const result = await notifyHits(
      supabase,
      { watchlist: w, hits, email: user?.user?.email ?? null, optedOut: optedOut.has(w.user_id) },
      sendNewListingsEmail,
    )
    if (result.outcome) tally[result.outcome] = (tally[result.outcome] ?? 0) + 1
  }

  if (APPLY) console.log(`done: ${JSON.stringify(tally)} (watchlists by outcome)`)
  else console.log(`would send ${wouldSend} email(s) to ${wouldSendUsers.size} user(s), ${wouldSendListings} listing(s); nothing sent, nothing written`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
