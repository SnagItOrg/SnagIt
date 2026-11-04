/**
 * frontend/lib/welcome-stop.ts
 *
 * PAN-308. "Stop dem her" for the welcome series (mails 2 and 3). The owner
 * chose (2026-10-29) to keep the flag on the account itself, in
 * `app_metadata`, which only the service role can write — no table, no
 * migration.
 *
 *   welcome_stop_token  12 base62 characters from the CSPRNG
 *                       (`newMailToken`), written by the runner before the
 *                       first mail that carries a stop link.
 *   welcome_stopped_at  ISO time the account stopped the series. The runner
 *                       sends nothing more once it is set.
 *
 * The link carries the account id and the token: the token is the
 * credential, the same kind of capability `/w/<token>` is, because the mail
 * is mostly opened on a phone that is not signed in. Only a POST stops
 * anything, so a link scanner that fetches every URL in a mail cannot.
 * The one-click URL is for the `List-Unsubscribe` header (RFC 8058).
 *
 * Stopping the series never touches the watchlist alert mails; they have
 * their own stop (PAN-278).
 *
 * Imports only the import-free `watchlist-mail.ts`: the page, the route, the
 * plain-Node runner and the tests all load it.
 */

import { MAIL_TOKEN, newMailToken } from './watchlist-mail'

export const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const newWelcomeStopToken = newMailToken

/** The account's `app_metadata`, as far as the welcome series reads it. */
export type WelcomeMeta = Record<string, unknown> | null | undefined

/** Has this account stopped the welcome series? */
export function welcomeStopped(meta: WelcomeMeta): boolean {
  return typeof meta?.welcome_stopped_at === 'string'
}

/** The account's stop token, when it has a well-formed one. */
export function welcomeStopToken(meta: WelcomeMeta): string | null {
  const t = meta?.welcome_stop_token
  return typeof t === 'string' && MAIL_TOKEN.test(t) ? t : null
}

/**
 * Does `token` open this account's stop? Length-independent comparison, so
 * the time a wrong guess takes says nothing about how much of it was right.
 */
export function welcomeStopMatches(meta: WelcomeMeta, token: string | null | undefined): boolean {
  const stored = welcomeStopToken(meta)
  if (!stored || typeof token !== 'string' || !MAIL_TOKEN.test(token)) return false
  let diff = 0
  for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

/** Are these well-formed link parameters? Says nothing about whether they match. */
export function welcomeStopParams(u: unknown, t: unknown): { userId: string; token: string } | null {
  return typeof u === 'string' && USER_ID.test(u) && typeof t === 'string' && MAIL_TOKEN.test(t)
    ? { userId: u.toLowerCase(), token: t }
    : null
}

/**
 * The two stop links: `page` for the mail's "Stop dem her" (asks once, with a
 * button), `oneClick` for the `List-Unsubscribe` header (a mail client POSTs
 * `List-Unsubscribe=One-Click` to it).
 */
export function welcomeStopUrls(appUrl: string, userId: string, token: string): { page: string; oneClick: string } {
  const q = `u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`
  return { page: `${appUrl}/stop-velkomst?${q}`, oneClick: `${appUrl}/api/welcome/stop?${q}` }
}
