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
 * 2026-10-07). A run without 066 applied refuses.
 *
 * Honours `notification_preferences` (email_enabled, new_listings; no row
 * means the defaults, both on).
 *
 * Dry run by default: prints what it would send and writes nothing.
 *   npx tsx scripts/notify-watchlists.ts            # dry run
 *   npx tsx scripts/notify-watchlists.ts --apply
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { sendNewListingsEmail } from '../frontend/lib/email'
import { isHit, notifyHits, type HitListing, type HitWatchlist } from './lib/watchlist-hits'

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
const PAGE = 1000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  const { data: seen, error: seenError } = await supabase
    .from('watchlist_notification')
    .select('attempted_at')
    .eq('outcome', 'seen')
    .order('attempted_at', { ascending: true })
    .limit(1)
  if (seenError || !seen?.[0]) {
    console.error('watchlist_notification has no go-live (migration 066 not applied); refusing')
    process.exit(1)
  }
  const since = new Date(Math.max(Date.parse(seen[0].attempted_at), Date.now() - WINDOW_MS)).toISOString()

  const { data: watchlists, error: wlError } = await supabase
    .from('watchlists')
    .select('id, user_id, query, min_price, max_price, created_at')
    .eq('active', true)
    .eq('type', 'query')
  if (wlError) throw new Error(`watchlists: ${wlError.message}`)

  const listings: HitListing[] = []
  let lastId: string | null = null
  for (;;) {
    let q = supabase
      .from('listings')
      .select('id, title, price, currency, price_dkk, url, source, ingested_at')
      .is('watchlist_id', null)
      .gt('ingested_at', since)
      .order('id')
      .limit(PAGE)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`listings: ${error.message}`)
    listings.push(...(data as HitListing[]))
    if (!data || data.length < PAGE) break
    lastId = data[data.length - 1].id
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

  console.log(`since ${since}: ${listings.length} new listings, ${watchlists?.length ?? 0} active watchlists${APPLY ? '' : ' (dry run)'}`)

  const tally: Record<string, number> = {}
  for (const w of (watchlists ?? []) as Array<HitWatchlist & { user_id: string }>) {
    const hits = listings.filter((l) => isHit(w, l))
    if (hits.length === 0) continue

    if (!APPLY) {
      console.log(`  watchlist ${w.id}: ${hits.length} hit(s)${optedOut.has(w.user_id) ? ', opted out' : ''}`)
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
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
