/**
 * scripts/lib/watchlist-hits.ts
 *
 * PAN-12. Which new listings are a hit for a watchlist, and the one step that
 * mails them: claim, send, record. The runner is `scripts/notify-watchlists.ts`.
 *
 * ── A HIT ───────────────────────────────────────────────────────────────
 * Every word of the watchlist's query is a whole word of the listing's title
 * ("Juno 60" hits "Roland Juno-60", "ph 5" does not hit "phaser 50"), the
 * DKK price sits inside the watchlist's min/max, and the title offers the
 * product itself — not a part of it, and not a wanted ad. The last test is
 * the matcher's own `detectNonProductIntent`: measured 2026-10-19 the
 * cheapest word-hits for "Roland Juno-106" were voice chips and the cheapest
 * for "fender telecaster" a pickguard, and a mail that leads with those is a
 * mail nobody opens. Words split on anything that is not a letter or a
 * digit, so the rule is the same for every marketplace.
 *
 * ── A PRODUCT HIT (PAN-273) ─────────────────────────────────────────────
 * A product watchlist (`product_id` set) has no words. It hits a listing the
 * MATCHER tied to that product — a `listing_product_match` row that is not
 * rejected (`is_valid IS NOT FALSE`, the price-evidence rule) — when the
 * listing is active and the price and age pass the same window as above.
 * No title test and no part/wanted guard here: the matcher's own gates
 * already decided what the listing is. The runner loads the matches and
 * drops watchlists whose product is no longer canonical before it gets here.
 *
 * ── AT MOST ONCE ────────────────────────────────────────────────────────
 * `watchlist_notification` (migration 066) is unique on (watchlist, listing).
 * The claim is an INSERT ... ON CONFLICT DO NOTHING that returns only the rows
 * it inserted, so a pair already claimed — by an earlier run, or by a run
 * racing this one — is never mailed again. The claimed rows then carry the
 * outcome. A send that fails is recorded and NOT retried: one missed mail is
 * better than a repeated one, and the row says it happened.
 *
 * ── THE MAIL ROW (PAN-276/278) ──────────────────────────────────────────
 * With `mailRows` (migration 070 applied) a send first writes a
 * `watchlist_mail` row: a fresh token, the fresh listings in the mail's
 * order, and the runner's `prompt`. Every link in the mail then goes through
 * `/w/<token>`. A send that fails deletes its row, so an undelivered mail
 * never counts as an ignored one. A row that cannot be written does not stop
 * the mail: it goes out with the PAN-273 links and no prompt. After a sent
 * 'pause' mail the watchlist is paused (`active = false`) — the mail said so.
 *
 * ── LOGGING ─────────────────────────────────────────────────────────────
 * Static outcome codes only. `detail` keeps the provider's bounded reason code
 * and nothing else; never the address, the titles or a provider message.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardVerdict } from '../../frontend/lib/listing-verdicts'
import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'
import { newMailToken, type MailPrompt } from '../../frontend/lib/watchlist-mail'

export type HitListing = {
  id: string
  title: string
  price: number | null
  currency: string
  price_dkk: number | null
  url: string
  source: string
  ingested_at: string
  /** PAN-273: read by the product rule only; the query rule never asked. */
  is_active?: boolean | null
  /** PAN-308: the listing's own photo, the one its card shows on the site; a thumbnail in the mail. */
  image_url?: string | null
  /**
   * PAN-297: the verdict the watched model's product page shows for this
   * listing, set by the runner on a product watchlist's hits and handed to
   * the mail as it is. A query watchlist's hits never carry one.
   */
  verdict?: CardVerdict | null
}

export type HitWatchlist = {
  id: string
  query: string
  min_price: number | null
  max_price: number | null
  created_at: string
  /** PAN-273: the watched kg_product; null on a query watchlist. */
  product_id?: string | null
}

export type HitOutcome = 'sent' | 'failed' | 'no_recipient' | 'opted_out' | 'claim_failed'

const PROVIDER_CODE = /^resend_rejected:[a-z_]+$/

export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** The listing is newer than the watchlist and its DKK price sits inside min/max. */
function inWindow(w: HitWatchlist, l: HitListing): boolean {
  if (Date.parse(l.ingested_at) <= Date.parse(w.created_at)) return false
  if (w.max_price != null && (l.price_dkk == null || l.price_dkk > w.max_price)) return false
  if (w.min_price != null && (l.price_dkk == null || l.price_dkk < w.min_price)) return false
  return true
}

/** The query's words are all in the title, the price is in range, and the listing is newer than the watchlist. */
export function matchesWatchlist(w: HitWatchlist, l: HitListing): boolean {
  const query = words(w.query)
  if (query.length === 0) return false
  if (!inWindow(w, l)) return false
  const title = new Set(words(l.title))
  return query.every((q) => title.has(q))
}

/**
 * PAN-273. `matched` is the set of product ids the matcher tied this listing
 * to, rejected rows left out; absent means no match row at all.
 */
export function matchesProductWatchlist(
  w: HitWatchlist,
  l: HitListing,
  matched: ReadonlySet<string> | undefined,
): boolean {
  if (!w.product_id) return false
  if (l.is_active === false) return false
  if (!inWindow(w, l)) return false
  return matched?.has(w.product_id) ?? false
}

/** A part, an accessory or a wanted ad: never worth a mail. */
export function isNonProduct(l: HitListing): boolean {
  const intent = detectNonProductIntent(l.title)?.intent
  return intent === 'part_or_accessory' || intent === 'wanted_or_non_sale'
}

export function isHit(w: HitWatchlist, l: HitListing): boolean {
  return matchesWatchlist(w, l) && !isNonProduct(l)
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
    /** PAN-273: where the mail's "Se alle" goes; the mail defaults to the search. */
    seeAllUrl?: string
    /** PAN-276: migration 070 is applied, so the send writes a `watchlist_mail` row. */
    mailRows?: boolean
    /** PAN-278: what this mail carries besides the listings (`mailPrompt()`). */
    prompt?: MailPrompt | null
  },
  send: (input: {
    to: string
    query: string
    listings: Array<Pick<HitListing, 'title' | 'price' | 'currency' | 'url' | 'source' | 'verdict' | 'image_url'>>
    seeAllUrl?: string
    mail?: { token: string; prompt: MailPrompt | null }
  }) => Promise<void>,
): Promise<{ outcome: HitOutcome | null; listings: number; prompt?: MailPrompt | null }> {
  const { watchlist, hits, email, optedOut, seeAllUrl, mailRows = false, prompt = null } = args
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
  let sentPrompt: MailPrompt | null = null
  if (optedOut) outcome = 'opted_out'
  else if (!email) outcome = 'no_recipient'
  else {
    let mail: { token: string; prompt: MailPrompt | null } | undefined
    if (mailRows) {
      const row = { token: newMailToken(), watchlist_id: watchlist.id, listing_ids: fresh.map((l) => l.id), prompt }
      const { error } = await db.from('watchlist_mail').insert(row)
      if (!error) mail = { token: row.token, prompt }
    }
    try {
      await send({ to: email, query: watchlist.query, listings: fresh, seeAllUrl, mail })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      outcome = 'failed'
      detail = PROVIDER_CODE.test(message) ? message : null
      if (mail) await db.from('watchlist_mail').delete().eq('token', mail.token)
    }
    if (outcome === 'sent' && mail?.prompt === 'pause') {
      const { error } = await db.from('watchlists').update({ active: false }).eq('id', watchlist.id)
      if (error) {
        console.error(JSON.stringify({
          channel: 'operational', component: 'notify-watchlists', event: 'watchlist_pause_failed', watchlist_id: watchlist.id,
        }))
      }
    }
    sentPrompt = mail?.prompt ?? null
  }

  // A failed record leaves the rows 'pending': visible, and still never re-sent.
  await db
    .from('watchlist_notification')
    .update({ outcome, detail, attempted_at: new Date().toISOString() })
    .eq('watchlist_id', watchlist.id)
    .in('listing_id', fresh.map((l) => l.id))

  if (outcome === 'failed' || outcome === 'no_recipient') return log(watchlist.id, outcome, detail, fresh.length)
  return outcome === 'sent' && sentPrompt ? { outcome, listings: fresh.length, prompt: sentPrompt } : { outcome, listings: fresh.length }
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
