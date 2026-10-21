/**
 * frontend/lib/watchlist-mail.ts
 *
 * PAN-276 / PAN-278. One watchlist email = one `watchlist_mail` row
 * (migration 070), keyed by a token. Everything the mail links to goes
 * through `klup.dk/w/<token>`, so the page shows exactly the mail's listings
 * and a visit counts as a click. This module owns the token, the links and
 * the disengagement rule; the runner (scripts/notify-watchlists.ts), the mail
 * (lib/email.ts) and the routes (app/(shell)/w/[token]) all read it.
 *
 * ── THE TOKEN ───────────────────────────────────────────────────────────
 * 12 base62 characters from the platform CSPRNG, ~71 bits. Never an id, never
 * a counter: a stranger cannot reach another recipient's page by guessing.
 * Rejection sampling keeps every character equally likely.
 *
 * ── DISENGAGEMENT ───────────────────────────────────────────────────────
 * A watchlist's run of unclicked mails starts after the latest of: its last
 * click on any of its mails, and its last 'pause' mail (so a watchlist the
 * user switched back on starts a fresh count). The mail that would be the
 * 3rd or 4th of a run asks "Skal vi stoppe?"; the 5th says it is the last
 * and the runner pauses the watchlist after sending it (owner, PAN-278).
 *
 * No imports: the page, the route handlers and the plain-Node runner and
 * tests all load it.
 */

export const MAIL_TOKEN = /^[0-9A-Za-z]{12}$/

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function newMailToken(): string {
  let token = ''
  while (token.length < 12) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    for (const b of bytes) {
      if (b < 248 && token.length < 12) token += ALPHABET[b % 62] // 248 = 4 × 62
    }
  }
  return token
}

export type MailPrompt = 'ask' | 'pause'

export const ASK_FROM = 3
export const PAUSE_AT = 5

/** A watchlist's earlier mails, as the runner reads them. */
export type MailEngagement = { sent_at: string; clicked_at: string | null; prompt: MailPrompt | null }

/** What the NEXT mail of this watchlist carries, given its earlier mails. */
export function mailPrompt(previous: readonly MailEngagement[]): MailPrompt | null {
  let boundary = -Infinity
  for (const m of previous) {
    if (m.clicked_at) boundary = Math.max(boundary, Date.parse(m.clicked_at))
    if (m.prompt === 'pause') boundary = Math.max(boundary, Date.parse(m.sent_at))
  }
  const unclicked = previous.filter((m) => Date.parse(m.sent_at) > boundary).length
  const position = unclicked + 1
  if (position >= PAUSE_AT) return 'pause'
  if (position >= ASK_FROM) return 'ask'
  return null
}

/** The link role, as `utm_content` names it. */
export type MailLinkRole = 'see_all' | 'stop' | 'keep' | 'resume' | 'settings'

const UTM = 'utm_source=klup&utm_medium=email&utm_campaign=watchlist'

/**
 * Every link a watchlist mail carries. A listing's link is `/w/<token>/<n>`
 * (1-based, the mail's order): it records the click and redirects to the ad,
 * so it carries no UTM — the marketplace is not ours to tag.
 */
export function mailLinks(appUrl: string, token: string) {
  const page = `${appUrl}/w/${token}`
  const tagged = (path: string, role: MailLinkRole, svar?: string) =>
    `${path}?${svar ? `svar=${svar}&` : ''}${UTM}&utm_content=${role}`
  return {
    seeAll: tagged(page, 'see_all'),
    listing: (n: number) => `${page}/${n}`,
    stop: tagged(page, 'stop', 'stop'),
    keep: tagged(page, 'keep', 'fortsaet'),
    resume: tagged(page, 'resume', 'fortsaet'),
    settings: tagged(`${appUrl}/profile`, 'settings'),
  }
}
