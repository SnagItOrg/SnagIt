/**
 * scripts/lib/welcome-series.ts
 *
 * PAN-308. Welcome mails #2 (day 2, "Tjek prisen, før du byder") and #3
 * (day 7, "Din første uge"), sent by a step at the end of
 * scripts/notify-watchlists.ts — the owner's choice (2026-10-29): no PM2 or
 * ecosystem change, and mail 3's numbers are that morning's.
 *
 * ── WHO GETS WHAT ───────────────────────────────────────────────────────
 * `welcomeMailDue()` decides, purely, from the account alone:
 *   - an address, an account created after `SERIES_START` (mail #1's go-live:
 *     nobody gets a "nummer 2 af 3" without a number 1), not stopped
 *     (`welcome_stopped_at`), not opted out of email
 *     (`notification_preferences.email_enabled = false`);
 *   - mail 2 between 2 and 4 days old, mail 3 between 7 and 9 days old and only
 *     with a watchlist; each at most once (`welcome_<n>_sent_at`).
 * The windows are two days wide, so a night panter missed is caught up the
 * next morning; the sent stamp makes the wide window send once, and Resend's
 * idempotency key (`welcome-<n>/<user id>`) covers a doubled run before the
 * stamp is written.
 *
 * ── STATE ───────────────────────────────────────────────────────────────
 * All of it in `app_metadata` (owner: no table, no migration), always
 * written whole with the account's own keys spread first:
 *   welcome_stop_token   written before the first mail with a stop link,
 *                        so the link works the moment the mail arrives;
 *   welcome_<n>_sent_at  written after Resend accepted mail n.
 *
 * ── MAIL 3'S NUMBERS ────────────────────────────────────────────────────
 * `firstWeekStats()`: the listings the alert mail sent for the account's
 * watchlists over the last 7 days (`watchlist_notification`, outcome
 * 'sent'), counted once each; and how many of them their model's own page
 * calls `under typisk` (`loadChildVerdicts`, the read the alert mail uses).
 * A listing no longer on its model's wall has no verdict and is not counted
 * under. No model watch with verdicts → null, and the mail says nothing about
 * the price.
 *
 * Logging: counts and the first 8 characters of an account id. Never an
 * address, never a provider's free text.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildFirstWeekEmail, buildPriceTipEmail, sendWelcomeSeriesEmail, type FirstWeekStats } from '../../frontend/lib/email'
import { loadChildVerdicts, type CardVerdict } from '../../frontend/lib/listing-verdicts'
import { newWelcomeStopToken, welcomeStopToken, welcomeStopUrls, welcomeStopped } from '../../frontend/lib/welcome-stop'

const DAY_MS = 24 * 60 * 60 * 1000

/** Mail #1's go-live: PR #303 merged, 2026-10-29 14:46:29 +01:00. */
export const SERIES_START = Date.parse('2026-10-29T13:46:29Z')

export const PRICE_TIP_WINDOW = { from: 2 * DAY_MS, until: 4 * DAY_MS }
export const FIRST_WEEK_WINDOW = { from: 7 * DAY_MS, until: 9 * DAY_MS }

export type WelcomeMail = 2 | 3

export type WelcomeAccount = {
  id: string
  email: string | null | undefined
  created_at: string
  app_metadata: Record<string, unknown> | null | undefined
}

/** Which welcome mail, if any, this account is due this morning. */
export function welcomeMailDue(
  account: WelcomeAccount,
  ctx: { nowMs: number; optedOut: boolean; hasWatchlist: boolean },
): WelcomeMail | null {
  const meta = account.app_metadata
  const created = Date.parse(account.created_at)
  if (!account.email || Number.isNaN(created) || created < SERIES_START) return null
  if (ctx.optedOut || welcomeStopped(meta)) return null
  const age = ctx.nowMs - created
  const inside = (w: { from: number; until: number }) => age >= w.from && age < w.until
  if (inside(PRICE_TIP_WINDOW) && !meta?.welcome_2_sent_at) return 2
  if (inside(FIRST_WEEK_WINDOW) && ctx.hasWatchlist && !meta?.welcome_3_sent_at) return 3
  return null
}

/** Mail 3's numbers for one account, from its watchlists and the week's sent pairs. */
export function firstWeekStats(
  watchlists: ReadonlyArray<{ id: string; product_id: string | null }>,
  sentPairs: ReadonlyArray<{ watchlist_id: string; listing_id: string }>,
  verdictsByProduct: ReadonlyMap<string, ReadonlyMap<string, CardVerdict>>,
): FirstWeekStats {
  const productOf = new Map(watchlists.map((w) => [w.id, w.product_id]))
  const listings = new Set<string>()
  const under = new Set<string>()
  let judged = false
  for (const w of watchlists) if (w.product_id && verdictsByProduct.has(w.product_id)) judged = true
  for (const p of sentPairs) {
    if (!productOf.has(p.watchlist_id)) continue
    listings.add(p.listing_id)
    const product = productOf.get(p.watchlist_id)
    if (product && verdictsByProduct.get(product)?.get(p.listing_id)?.verdict === 'under') under.add(p.listing_id)
  }
  return { watchCount: watchlists.length, newListings: listings.size, underCount: judged ? under.size : null }
}

type AuthUser = WelcomeAccount

/**
 * The nightly step. Dry run unless `apply`: then it prints what it would send
 * and writes nothing. Returns a tally by outcome.
 */
export async function runWelcomeSeries(
  supabase: SupabaseClient,
  opts: { apply: boolean; nowMs: number; appUrl: string },
): Promise<Record<string, number>> {
  const tally: Record<string, number> = {}
  const count = (k: string) => { tally[k] = (tally[k] ?? 0) + 1 }

  // Every account young enough for mail 3's window and born after the series began.
  const oldest = Math.max(SERIES_START, opts.nowMs - FIRST_WEEK_WINDOW.until)
  const accounts: AuthUser[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers: ${error.name}`)
    for (const u of data.users) {
      if (Date.parse(u.created_at) >= oldest) accounts.push({ id: u.id, email: u.email, created_at: u.created_at, app_metadata: u.app_metadata })
    }
    if (data.users.length < 1000) break
  }
  if (accounts.length === 0) return tally

  const ids = accounts.map((a) => a.id)
  const [{ data: watchlists, error: wlError }, { data: prefs, error: prefError }] = await Promise.all([
    supabase.from('watchlists').select('id, user_id, product_id').in('user_id', ids),
    supabase.from('notification_preferences').select('user_id, email_enabled').in('user_id', ids),
  ])
  if (wlError) throw new Error(`watchlists: ${wlError.message}`)
  if (prefError) throw new Error(`notification_preferences: ${prefError.message}`)
  const watchesOf = new Map<string, Array<{ id: string; product_id: string | null }>>()
  for (const w of (watchlists ?? []) as Array<{ id: string; user_id: string; product_id: string | null }>) {
    const list = watchesOf.get(w.user_id) ?? []
    list.push({ id: w.id, product_id: w.product_id })
    watchesOf.set(w.user_id, list)
  }
  const optedOut = new Set((prefs ?? []).filter((p) => p.email_enabled === false).map((p) => p.user_id as string))

  const due = accounts
    .map((a) => ({ account: a, mail: welcomeMailDue(a, { nowMs: opts.nowMs, optedOut: optedOut.has(a.id), hasWatchlist: (watchesOf.get(a.id)?.length ?? 0) > 0 }) }))
    .filter((d): d is { account: AuthUser; mail: WelcomeMail } => d.mail != null)

  // Mail 3's numbers: the week's sent pairs and the watched models' verdicts.
  const weekWatches = due.filter((d) => d.mail === 3).flatMap((d) => watchesOf.get(d.account.id) ?? [])
  const sentPairs: Array<{ watchlist_id: string; listing_id: string }> = []
  let verdicts = new Map<string, Map<string, CardVerdict>>()
  if (weekWatches.length > 0) {
    const { data, error } = await supabase
      .from('watchlist_notification')
      .select('watchlist_id, listing_id')
      .eq('outcome', 'sent')
      .gte('attempted_at', new Date(opts.nowMs - 7 * DAY_MS).toISOString())
      .in('watchlist_id', weekWatches.map((w) => w.id))
    if (error) throw new Error(`watchlist_notification: ${error.message}`)
    sentPairs.push(...((data ?? []) as typeof sentPairs))
    const productIds = [...new Set(weekWatches.map((w) => w.product_id).filter((p): p is string => !!p))]
    if (productIds.length > 0) {
      try {
        // The root and frontend copies of @supabase/supabase-js are two type identities of one client.
        verdicts = await loadChildVerdicts(supabase as unknown as Parameters<typeof loadChildVerdicts>[0], productIds)
      } catch {
        console.error(JSON.stringify({ channel: 'operational', component: 'welcome-series', event: 'verdicts_unavailable' }))
      }
    }
  }

  console.log(`welcome series: ${accounts.length} account(s) since ${new Date(oldest).toISOString()}, `
    + `${due.filter((d) => d.mail === 2).length} due mail 2, ${due.filter((d) => d.mail === 3).length} due mail 3`
    + `${opts.apply ? '' : ' (dry run: nothing sent, nothing written)'}`)

  for (const { account, mail } of due) {
    const stats = mail === 3 ? firstWeekStats(watchesOf.get(account.id) ?? [], sentPairs, verdicts) : null
    if (!opts.apply) {
      console.log(`  ${account.id.slice(0, 8)}  mail ${mail}`
        + (stats ? `  ${stats.watchCount} watch(es), ${stats.newListings} listing(s), under ${stats.underCount ?? '–'}` : ''))
      count(`would_send_${mail}`)
      continue
    }

    let meta: Record<string, unknown> = { ...(account.app_metadata ?? {}) }
    const write = async (patch: Record<string, unknown>) => {
      meta = { ...meta, ...patch }
      const { error } = await supabase.auth.admin.updateUserById(account.id, { app_metadata: meta })
      if (error) throw new Error(`app_metadata: ${error.name}`)
    }
    try {
      let token = welcomeStopToken(meta)
      if (!token) await write({ welcome_stop_token: (token = newWelcomeStopToken()) })
      const urls = welcomeStopUrls(opts.appUrl, account.id, token)
      const content = mail === 2
        ? buildPriceTipEmail({ stopUrl: urls.page })
        : buildFirstWeekEmail({ ...stats!, stopUrl: urls.page })
      await sendWelcomeSeriesEmail(account.email!, account.id, mail, content, urls.oneClick)
      await write({ [`welcome_${mail}_sent_at`]: new Date(opts.nowMs).toISOString() })
      count(`sent_${mail}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      console.error(JSON.stringify({
        channel: 'operational', component: 'welcome-series', event: 'welcome_mail_failed', mail,
        detail: /^(resend_rejected|app_metadata): ?[a-z_]+$/i.test(message) ? message : null,
      }))
      count(`failed_${mail}`)
    }
  }
  return tally
}
