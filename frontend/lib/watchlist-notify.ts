/**
 * frontend/lib/watchlist-notify.ts
 *
 * One watchlist notification step: send the mail, then stamp `notified_at`
 * ONLY when the provider confirmed the send.
 *
 * ── WHY THIS EXISTS (PAN-72) ────────────────────────────────────────────
 * `/api/cron/scrape` wrote `notified_at` outside both the `if (user?.email)`
 * guard and the surrounding `try/catch`, in two duplicated blocks. A stamped
 * row therefore proved only that execution reached that line. A watchlist
 * owner with no email address, a swallowed provider error and a real delivery
 * were indistinguishable in the database — the same false success PAN-39 and
 * PAN-62 removed from the Reverb jobs.
 *
 * Measured 2026-09-19: 448 of 112,735 rows carry a marker whose meaning cannot
 * be recovered, last written 2026-03-16. They are deliberately NOT backfilled;
 * inventing a status for them would be worse than leaving them unknowable.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────
 * The marker has one writer and one precondition: `send` returned without
 * throwing. Every other outcome leaves `notified_at` NULL, so the listing is
 * offered again on the next run — the correct behaviour for a notification
 * that did not go out.
 *
 * ── LOGGING ─────────────────────────────────────────────────────────────
 * Reasons are static codes. The recipient address, the listing titles and the
 * provider's own free-text message never reach a log line or a response body.
 * `detail` carries the provider's bounded reason code and only when it has the
 * shape `sendNewListingsEmail` produces; anything else is dropped rather than
 * forwarded, because an arbitrary transport error message is not known to be
 * free of PII.
 *
 * `send` is a parameter rather than a direct import so the provider-failure
 * path can be exercised by a test without a provider. It is the one seam the
 * route cannot offer: the route module cannot be imported outside Next.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListingSnippet } from './email'

/** Why a qualifying listing was left unmarked. Static; never interpolated. */
export type NotifyFailure = 'no_recipient' | 'send_failed' | 'mark_failed'

export interface NotifyOutcome {
  /** Listings whose `notified_at` was stamped. Non-zero only after a send that succeeded. */
  notified: number
  /** Listings that qualified for a notification and were deliberately left unmarked. */
  unnotified: number
  /** Static failure code, or null when the mail went out and the marking succeeded. */
  failure: NotifyFailure | null
  /** Provider reason code when it is one of the bounded codes; never free text. */
  detail: string | null
}

const PROVIDER_CODE = /^resend_rejected:[a-z_]+$/

export async function notifyWatchlist(
  db: SupabaseClient,
  args: {
    watchlistId: string
    query: string
    /** The owner's address, or null/undefined when the account has none. */
    email: string | null | undefined
    listings: ListingSnippet[]
    now: string
  },
  send: (input: { to: string; query: string; listings: ListingSnippet[] }) => Promise<void>,
): Promise<NotifyOutcome> {
  const { watchlistId, query, email, listings, now } = args
  const qualifying = listings.length

  if (qualifying === 0) return { notified: 0, unnotified: 0, failure: null, detail: null }

  if (!email) return refuse(watchlistId, qualifying, 'no_recipient', null)

  try {
    await send({ to: email, query, listings })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    return refuse(watchlistId, qualifying, 'send_failed', PROVIDER_CODE.test(message) ? message : null)
  }

  const { error } = await db
    .from('listings')
    .update({ notified_at: now })
    .eq('watchlist_id', watchlistId)
    .is('notified_at', null)

  // The mail went out but the marker did not land. Reported as unnotified
  // because that is what the database now says; the next run will offer these
  // listings again, which is a duplicate mail rather than a silent gap.
  if (error) return refuse(watchlistId, qualifying, 'mark_failed', null)

  return { notified: qualifying, unnotified: 0, failure: null, detail: null }
}

function refuse(
  watchlistId: string,
  qualifying: number,
  failure: NotifyFailure,
  detail: string | null,
): NotifyOutcome {
  console.error(
    JSON.stringify({
      channel: 'operational',
      component: 'cron',
      event: 'watchlist_notification_failed',
      watchlist_id: watchlistId,
      failure,
      detail,
      unnotified: qualifying,
    }),
  )
  return { notified: 0, unnotified: qualifying, failure, detail }
}
