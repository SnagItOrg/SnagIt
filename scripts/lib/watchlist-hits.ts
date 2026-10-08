/**
 * scripts/lib/watchlist-hits.ts
 *
 * PAN-12. Which new listings are a hit for a watchlist, and the one step that
 * mails them: claim, send, record. The runner is `scripts/notify-watchlists.ts`.
 *
 * ── A HIT ───────────────────────────────────────────────────────────────
 * Every word of the watchlist's query is a whole word of the listing's title
 * ("Juno 60" hits "Roland Juno-60", "ph 5" does not hit "phaser 50"), and the
 * DKK price sits inside the watchlist's min/max. Words split on anything that
 * is not a letter or a digit, so the rule is the same for every marketplace.
 *
 * ── EXACTLY ONCE ────────────────────────────────────────────────────────
 * `watchlist_notification` (migration 066) is unique on (watchlist, listing).
 * The claim is an INSERT ... ON CONFLICT DO NOTHING that returns only the rows
 * it inserted, so a pair already claimed — by an earlier run, or by a run
 * racing this one — is never mailed again. The claimed rows then carry the
 * outcome. A send that fails is recorded and NOT retried: one missed mail is
 * better than a repeated one, and the row says it happened.
 *
 * ── LOGGING ─────────────────────────────────────────────────────────────
 * Static outcome codes only. `detail` keeps the provider's bounded reason code
 * and nothing else; never the address, the titles or a provider message.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type HitListing = {
  id: string
  title: string
  price: number | null
  currency: string
  price_dkk: number | null
  url: string
  source: string
  ingested_at: string
}

export type HitWatchlist = {
  id: string
  query: string
  min_price: number | null
  max_price: number | null
  created_at: string
}

export type HitOutcome = 'sent' | 'failed' | 'no_recipient' | 'opted_out' | 'claim_failed'

const PROVIDER_CODE = /^resend_rejected:[a-z_]+$/

export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

export function isHit(w: HitWatchlist, l: HitListing): boolean {
  const query = words(w.query)
  if (query.length === 0) return false
  if (Date.parse(l.ingested_at) <= Date.parse(w.created_at)) return false
  if (w.max_price != null && (l.price_dkk == null || l.price_dkk > w.max_price)) return false
  if (w.min_price != null && (l.price_dkk == null || l.price_dkk < w.min_price)) return false
  const title = new Set(words(l.title))
  return query.every((q) => title.has(q))
}

export async function notifyHits(
  db: SupabaseClient,
  args: {
    watchlist: HitWatchlist
    hits: HitListing[]
    /** The owner's address, or null when the account has none. */
    email: string | null
    /** notification_preferences says no new-listing mail. */
    optedOut: boolean
  },
  send: (input: {
    to: string
    query: string
    listings: Array<Pick<HitListing, 'title' | 'price' | 'currency' | 'url' | 'source'>>
  }) => Promise<void>,
): Promise<{ outcome: HitOutcome | null; listings: number }> {
  const { watchlist, hits, email, optedOut } = args
  if (hits.length === 0) return { outcome: null, listings: 0 }

  const { data: claimed, error: claimError } = await db
    .from('watchlist_notification')
    .upsert(
      hits.map((l) => ({ watchlist_id: watchlist.id, listing_id: l.id, outcome: 'pending' })),
      { onConflict: 'watchlist_id,listing_id', ignoreDuplicates: true },
    )
    .select('listing_id')
  if (claimError) return log(watchlist.id, 'claim_failed', null, hits.length)

  const ids = new Set((claimed ?? []).map((r: { listing_id: string }) => r.listing_id))
  const fresh = hits.filter((l) => ids.has(l.id))
  if (fresh.length === 0) return { outcome: null, listings: 0 }

  let outcome: HitOutcome = 'sent'
  let detail: string | null = null
  if (optedOut) outcome = 'opted_out'
  else if (!email) outcome = 'no_recipient'
  else {
    try {
      await send({ to: email, query: watchlist.query, listings: fresh })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      outcome = 'failed'
      detail = PROVIDER_CODE.test(message) ? message : null
    }
  }

  // A failed record leaves the rows 'pending': visible, and still never re-sent.
  await db
    .from('watchlist_notification')
    .update({ outcome, detail, attempted_at: new Date().toISOString() })
    .eq('watchlist_id', watchlist.id)
    .in('listing_id', fresh.map((l) => l.id))

  if (outcome === 'failed' || outcome === 'no_recipient') return log(watchlist.id, outcome, detail, fresh.length)
  return { outcome, listings: fresh.length }
}

function log(watchlistId: string, outcome: HitOutcome, detail: string | null, listings: number) {
  console.error(JSON.stringify({
    channel: 'operational',
    component: 'notify-watchlists',
    event: 'watchlist_hit_not_sent',
    watchlist_id: watchlistId,
    outcome,
    detail,
    listings,
  }))
  return { outcome, listings }
}
