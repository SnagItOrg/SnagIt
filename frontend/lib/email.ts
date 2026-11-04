import { Resend } from 'resend'
import { sourceForStored } from './admin-match-sources'
import { fill, translations } from './i18n'
import type { CardVerdict } from './listing-verdicts'
import { VERDICT_BASIS_REVERB_FALLBACK } from './price-populations'
import { mailLinks, type MailPrompt } from './watchlist-mail'

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not set')
  return new Resend(apiKey)
}

export type ListingSnippet = {
  title: string
  price: number | null
  currency: string
  url: string
  /** `listings.source`. PAN-12: the mail names each listing's own marketplace. */
  source?: string
  /**
   * PAN-297: the verdict the watched model's own product page shows for this
   * listing (`lib/listing-verdicts.ts`, measured against that model's bands
   * alone). Absent or null on a free-text watchlist, and on a listing whose
   * model has no band: then the mail says nothing about the price.
   */
  verdict?: CardVerdict | null
  /**
   * PAN-308: the listing's own photo — the seller's, the one its card on the
   * site shows. A thumbnail beside the line; absent, or not https, and the
   * line goes without one.
   */
  image_url?: string | null
}

/**
 * The verdict as `MarketVerdictBadge` says it, in words only: the word, then
 * "· målt mod Reverb" when the band is borrowed (PAN-268 C — a mail must not
 * let a Reverb verdict pass as a Danish one), then the few-listings note.
 */
function verdictWords(v: CardVerdict, t: typeof translations.da): string {
  const word = v.verdict === 'under' ? t.verdictUnder : v.verdict === 'over' ? t.verdictOver : t.verdictTypical
  const basis = v.basisLabelKey === VERDICT_BASIS_REVERB_FALLBACK ? ` · ${t.verdictBasisReverbFallback}` : ''
  const few = v.fewN != null ? ` (${fill(t.verdictFewData, { n: v.fewN })})` : ''
  return `${word}${basis}${few}`
}

/**
 * Mail clients read no CSS variables, so the verdict's ink is literal: the
 * light theme's `--ramp-green-ink` and `--ramp-red-ink` (app/globals.css:44
 * and :49). `under` is the one place the mail carries Klup's green — the
 * same PAN-63 judgement the badge paints — `over` the cautionary ink, and
 * `typical` the mail's own grey.
 */
const VERDICT_INK: Readonly<Record<CardVerdict['verdict'], string>> = {
  under:   '#0a7c41',
  typical: '#5b616e',
  over:    '#c81e1e',
}

/** PAN-276: the mail's `watchlist_mail` row, when migration 070 holds one. */
export type MailRow = { token: string; prompt: MailPrompt | null }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The watchlist mail, built and not sent: subject, text and HTML. Pure, so the
 * PR can render it locally and a test can read it.
 *
 * PAN-12: one mail per watchlist per night, the five cheapest-first lines the
 * runner hands over, and the rest as a count. PAN-276: with a `mail` row every
 * link goes through `/w/<token>` — "Se alle" to the page of exactly these
 * listings, each listing through `/w/<token>/<n>`, which records the click and
 * redirects to the ad — and the HTML part names each link in words instead of
 * printing it. Without one (070 not applied, or its row failed) the mail is
 * the PAN-273 mail: listing links straight to the ad, "Se alle" to `seeAllUrl`
 * or the search. PAN-278: `prompt` adds the stop question or the pause notice.
 *
 * Danish: there is no stored locale for a recipient, and Danish is the site's
 * default. The copy lives in `translations` in both languages all the same.
 */
export function buildNewListingsEmail({
  query,
  listings,
  seeAllUrl,
  mail,
}: {
  query: string
  listings: ListingSnippet[]
  /** PAN-273: a product watchlist's "Se alle" is its product page, not a search. */
  seeAllUrl?: string
  mail?: MailRow
}): { subject: string; text: string; html: string } {
  const t = translations.da
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'
  const links = mail ? mailLinks(appUrl, mail.token) : null
  const preview = listings.slice(0, 5)
  const n = listings.length
  const rest = n - preview.length

  const rows = preview.map((l, i) => ({
    title: l.title,
    price: l.price != null ? `${l.price.toLocaleString('da-DK')} ${l.currency === 'DKK' ? 'kr' : l.currency}` : t.priceNotListed,
    source: l.source ? (sourceForStored(l.source)?.label ?? l.source) : null,
    verdict: l.verdict ? { words: verdictWords(l.verdict, t), ink: VERDICT_INK[l.verdict.verdict] } : null,
    href: links ? links.listing(i + 1) : l.url,
    image: l.image_url?.startsWith('https://') ? l.image_url : null,
  }))
  const seeAll = links?.seeAll ?? seeAllUrl ?? `${appUrl}/search?q=${encodeURIComponent(query)}`
  const settings = links?.settings ?? `${appUrl}/profile`
  const prompt = links ? mail!.prompt : null

  const subject = n === 1 ? fill(t.mailSubjectOne, { query }) : fill(t.mailSubjectMany, { n, query })
  const intro = n === 1 ? fill(t.mailIntroOne, { query }) : fill(t.mailIntroMany, { n, query })
  const overflow = rest > 0 ? (rest === 1 ? t.mailOverflowOne : fill(t.mailOverflowMany, { n: rest })) : null

  // PAN-308: the watch identity — Klup's radar mark, the watch's name and its
  // state. A pause mail is the last one before the watch stops, so it says so.
  const status = prompt === 'pause' ? t.watchStatusPaused : t.watchStatusActive

  const text = [
    `${t.mailWatchLabel}: ${query} · ${status}`,
    '',
    intro,
    '',
    rows.map((r) =>
      `• ${r.title} — ${r.price}${r.source ? ` (${r.source})` : ''}${r.verdict ? `\n  ${r.verdict.words}` : ''}\n  ${r.href}`).join('\n\n'),
    overflow ? `\n${overflow}` : '',
    '',
    `${t.mailSeeAll}: ${seeAll}`,
    ...(prompt === 'ask' && links
      ? ['', t.mailAskQuestion, fill(t.mailAskWhy, { query }), `${t.mailAskYes}: ${links.stop}`, `${t.mailAskNo}: ${links.keep}`]
      : []),
    ...(prompt === 'pause' && links ? ['', fill(t.mailPaused, { query }), `${t.mailResume}: ${links.resume}`] : []),
    '',
    fill(t.mailWhy, { query }),
    `${t.mailSettings}: ${settings}`,
  ].join('\n')

  // Mail clients read no CSS variables, so the few colours are literal here:
  // the neutral ink and greys of the site. The accent green appears on the
  // `under` verdict word (VERDICT_INK) and on the watch tag's Aktiv badge —
  // two of the three uses frontend/CLAUDE.md permits — and nowhere else. The
  // badge is the light theme's `--accent-subtle` / `--accent-border` /
  // `--accent-text` with the brand green dot (app/globals.css).
  const a = (href: string, label: string, style = 'color:#111418') =>
    `<a href="${esc(href)}" style="${style}">${esc(label)}</a>`
  const button = (href: string, label: string) =>
    a(href, label, 'display:inline-block;padding:8px 14px;margin:4px 8px 0 0;border:1px solid #c9ccd3;border-radius:8px;color:#111418;text-decoration:none;font-weight:600')
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111418;max-width:560px">',
    `<p style="margin:0 0 16px"><img src="${appUrl}/mail/radar.png" width="30" height="30" alt="" style="vertical-align:middle;border:0">`
      + '<span style="vertical-align:middle;margin-left:10px;font-weight:600;font-size:17px">Klup.dk</span></p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#f3f4f6;border:1px solid #e3e4e8;border-radius:16px">',
    '<tr><td style="padding:12px 0 12px 14px;width:44px;vertical-align:middle">'
      + `<img src="${appUrl}/mail/radar.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:20px"></td>`
      + '<td style="padding:12px 12px;vertical-align:middle">'
      + `<div style="font-size:12px;color:#5f636b">${esc(t.mailWatchLabel)}</div>`
      + `<div style="font-size:17px;font-weight:600">${esc(query)}</div></td>`
      + '<td style="padding:12px 14px 12px 0;vertical-align:middle;text-align:right;white-space:nowrap">'
      + (prompt === 'pause'
        ? `<span style="font-size:12px;font-weight:600;color:#5f636b;background:#e1e3e7;padding:4px 10px;border-radius:999px">${esc(status)}</span>`
        : '<span style="font-size:12px;font-weight:600;color:#0a7c41;background:rgba(19,236,109,0.10);border:1px solid rgba(19,236,109,0.32);padding:3px 10px;border-radius:999px">'
          + `<span style="display:inline-block;width:7px;height:7px;border-radius:4px;background:#13ec6d;margin-right:6px"></span>${esc(status)}</span>`)
      + '</td></tr></table>',
    `<p>${esc(intro)}</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">',
    ...rows.map((r) =>
      '<tr>'
      + (r.image
        ? `<td style="padding:0 12px 12px 0;width:72px;vertical-align:top"><a href="${esc(r.href)}">`
          + `<img src="${esc(r.image)}" width="72" height="72" alt="" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:10px;border:0;background:#f3f4f6"></a></td>`
        : '<td style="padding:0 12px 12px 0;width:72px"></td>')
      + '<td style="padding:0 0 12px;vertical-align:top">'
      + `${a(r.href, r.title, 'color:#111418;font-weight:600')}<br>`
      + `<span style="color:#5b616e">${esc(r.price)}${r.source ? ` · ${esc(r.source)}` : ''}</span>`
      + (r.verdict ? `<br><span style="color:${r.verdict.ink};font-weight:600">${esc(r.verdict.words)}</span>` : '')
      + '</td></tr>'),
    '</table>',
    overflow ? `<p style="color:#5b616e">${esc(overflow)}</p>` : '',
    `<p>${button(seeAll, t.mailSeeAll)}</p>`,
    prompt === 'ask' && links
      ? `<div style="margin-top:24px;padding:12px 16px;border-radius:12px;background:#f1f2f4">`
        + `<p style="margin:0;font-weight:600">${esc(t.mailAskQuestion)}</p>`
        + `<p style="margin:0 0 4px;color:#5b616e;font-size:14px">${esc(fill(t.mailAskWhy, { query }))}</p>`
        + `${button(links.stop, t.mailAskYes)}${button(links.keep, t.mailAskNo)}</div>`
      : '',
    prompt === 'pause' && links
      ? `<div style="margin-top:24px;padding:12px 16px;border-radius:12px;background:#f1f2f4">`
        + `<p style="margin:0 0 4px">${esc(fill(t.mailPaused, { query }))}</p>${button(links.resume, t.mailResume)}</div>`
      : '',
    `<p style="margin-top:24px;color:#5b616e;font-size:13px">${esc(fill(t.mailWhy, { query }))}<br>${a(settings, t.mailSettings, 'color:#5b616e')}</p>`,
    '</div>',
  ].join('\n')

  return { subject, text, html }
}

export async function sendNewListingsEmail({
  to,
  ...content
}: {
  to: string
  query: string
  listings: ListingSnippet[]
  seeAllUrl?: string
  mail?: MailRow
}) {
  const { subject, text, html } = buildNewListingsEmail(content)

  // PAN-72. The Resend client RESOLVES with `{ data, error }` on a rejected
  // send — it does not throw. An unchecked `await` therefore returns normally
  // when the provider refused the message, so a caller's try/catch sees a clean
  // return and treats the failure as a delivery. Half of why a sent
  // notification could not be told apart from a failed one.
  //
  // `error.name` is the provider's bounded reason code. `error.message` is
  // free text that can echo the recipient address, so it is never read here.
  const { error } = await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject,
    text,
    html,
  })

  if (error) throw new Error(`resend_rejected:${error.name}`)
}

/**
 * PAN-308: how long after an account is created its welcome mail may still be
 * sent. The trigger fires once, right after the first code; the window is what
 * makes a replayed request — or one from an old account — send nothing, and it
 * is shorter than Resend's 24 h idempotency window, so the key below covers it.
 */
export const WELCOME_WINDOW_MS = 60 * 60 * 1000

/** PAN-308: is a welcome mail still due for an account created at `createdAt`? */
export function welcomeDue(createdAt: string | undefined, nowMs: number): boolean {
  const created = createdAt ? Date.parse(createdAt) : NaN
  if (Number.isNaN(created)) return false
  const age = nowMs - created
  return age >= 0 && age <= WELCOME_WINDOW_MS
}

/**
 * PAN-308: the welcome series' frame — Klup's radar mark and name, the body,
 * and the grey footer — shared by mails 1, 2 and 3 so the three look like one
 * series. Mail clients read no CSS variables, so the colours are literal: the
 * light theme's ink, greys and line (app/globals.css `--ramp-*`). Headlines ask
 * for DM Serif Display and fall back to Georgia where a client loads no web
 * font.
 */
const MAIL_SERIF = "font-family:'DM Serif Display',Georgia,serif;font-weight:400"

function welcomeShell(appUrl: string, body: string[], footer: string): string {
  return [
    '<!doctype html><html lang="da"><head><meta charset="utf-8">',
    '<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet"></head>',
    '<body style="margin:0;padding:0;background:#f3f4f6">',
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Inter,Arial,sans-serif;font-size:16px;line-height:1.55;color:#131417;max-width:600px;margin:0 auto;background:#ffffff">',
    '<div style="padding:28px 32px 0">',
    `<img src="${appUrl}/mail/radar.png" width="30" height="30" alt="" style="vertical-align:middle;border:0">`,
    '<span style="vertical-align:middle;margin-left:10px;font-weight:600;font-size:17px">Klup.dk</span></div>',
    '<div style="padding:8px 32px 28px">',
    ...body,
    '</div>',
    `<div style="padding:18px 32px 28px;border-top:1px solid #e3e4e8;color:#5b616e;font-size:13px">${footer}</div>`,
    '</div></body></html>',
  ].join('\n')
}

type WelcomeStep = { img: string; alt: string; title: string; body: string }

/** The numbered steps: an image from `public/mail/` beside a number, a title and a line. */
function welcomeSteps(appUrl: string, steps: WelcomeStep[]): string[] {
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">',
    ...steps.map((s, i) =>
      '<tr><td style="padding:14px 16px 14px 0;border-top:1px solid #e3e4e8;width:150px;vertical-align:middle">'
      + `<img src="${appUrl}/mail/${s.img}" width="150" height="150" alt="${esc(s.alt)}" style="display:block;border:1px solid #e3e4e8;border-radius:12px"></td>`
      + '<td style="padding:14px 0;border-top:1px solid #e3e4e8;vertical-align:middle">'
      + `<div style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:13px;background:#131417;color:#ffffff;font-size:13px;font-weight:600;text-align:center">${i + 1}</div>`
      + `<div style="${MAIL_SERIF};font-size:21px;line-height:1.2;margin:6px 0 4px">${esc(s.title)}</div>`
      + `<div style="color:#5b616e;font-size:15px">${esc(s.body)}</div></td></tr>`),
    '</table>',
  ]
}

/** The series' one filled button. */
function welcomeButton(href: string, label: string): string {
  return `<p style="margin:22px 0 0"><a href="${esc(href)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#131417;color:#ffffff;font-weight:600;text-decoration:none">${esc(label)}</a></p>`
}

/**
 * PAN-308: the footer of mails 2 and 3 — the sign-off, why the mail came, and
 * "Stop dem her". `stopUrl` is the series' own opt-out (the account's stop
 * flag); it never touches the watchlist alert mails, which have their own.
 */
function welcomeStopFooter(t: typeof translations.da, why: string, stopUrl: string): string {
  return `${esc(t.mailWelcomeSignoff)}<br>${esc(why)}<br>`
    + `${esc(t.mailWelcomeStopLead)} <a href="${esc(stopUrl)}" style="color:#5b616e;text-decoration:underline">${esc(t.mailWelcomeStopLink)}</a>`
}

/**
 * PAN-308: welcome mail #1, built and not sent. One call to action: follow a
 * first piece of gear (the catalogue), or — when the new account already
 * watches something, as it does after signing up from a product's watch form —
 * see that watch. The price check rides along as a P.S., never a second button.
 *
 * The tutorial images are stills from the PAN-172 spot and Klup's own radar
 * mark, served from `public/mail/`; the frame is `welcomeShell`. Green appears
 * only inside the step-3 image, on its Aktiv badge. Danish, like the watchlist
 * mail; the copy is in both languages all the same.
 */
export function buildWelcomeEmail({ hasWatchlist }: { hasWatchlist: boolean }): { subject: string; text: string; html: string } {
  const t = translations.da
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'
  const cta = hasWatchlist
    ? { href: `${appUrl}/watchlists`, label: t.mailWelcomeCtaWatchlists }
    : { href: `${appUrl}/browse`, label: t.mailWelcomeCtaFollow }
  const priceCheck = `${appUrl}/tjek-prisen`
  const steps = [
    { img: 'welcome-step-1.jpg', alt: t.mailWelcomeStep1Alt, title: t.mailWelcomeStep1Title, body: t.mailWelcomeStep1Body },
    { img: 'welcome-step-2.jpg', alt: t.mailWelcomeStep2Alt, title: t.mailWelcomeStep2Title, body: t.mailWelcomeStep2Body },
    { img: 'welcome-step-3.jpg', alt: t.mailWelcomeStep3Alt, title: t.mailWelcomeStep3Title, body: t.mailWelcomeStep3Body },
  ]

  const text = [
    t.mailWelcomeHeading,
    '',
    t.mailWelcomeIntro,
    '',
    t.mailWelcomeStepsLead,
    ...steps.map((s, i) => `${i + 1}. ${s.title} — ${s.body}`),
    '',
    `${cta.label}: ${cta.href}`,
    '',
    `${t.mailWelcomePsst} ${priceCheck}`,
    '',
    t.mailWelcomeSignoff,
    t.mailWelcomeWhy,
  ].join('\n')

  const html = welcomeShell(appUrl, [
    `<h1 style="${MAIL_SERIF};font-size:36px;line-height:1.1;margin:20px 0 12px">${esc(t.mailWelcomeHeading)}</h1>`,
    `<p style="margin:0 0 12px">${esc(t.mailWelcomeIntro)}</p>`,
    `<p style="margin:0 0 8px">${esc(t.mailWelcomeStepsLead)}</p>`,
    ...welcomeSteps(appUrl, steps),
    welcomeButton(cta.href, cta.label),
    '<p style="margin:26px 0 0;padding:14px 18px;border:2px solid #e3e4e8;border-radius:24px;font-size:15px">'
      + `${esc(t.mailWelcomePsst)} <a href="${esc(priceCheck)}" style="color:#131417;font-weight:600">${esc(t.mailWelcomePsstLink)}</a></p>`,
  ], `${esc(t.mailWelcomeSignoff)}<br>${esc(t.mailWelcomeWhy)}`)

  return { subject: t.mailWelcomeSubject, text, html }
}

/**
 * PAN-308: welcome mail #2, day 2 — "Tjek prisen før du byder". Two steps,
 * paste a DBA link and get the answer, and one call to action: the price
 * check. Green appears only inside the step-2 image, on its `Under typisk`
 * verdict, the one place Klup's own judgement is shown.
 */
export function buildPriceTipEmail({ stopUrl }: { stopUrl: string }): { subject: string; text: string; html: string } {
  const t = translations.da
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'
  const cta = { href: `${appUrl}/tjek-prisen`, label: t.mailPriceTipCta }
  const steps = [
    { img: 'price-tip-step-1.jpg', alt: t.mailPriceTipStep1Alt, title: t.mailPriceTipStep1Title, body: t.mailPriceTipStep1Body },
    { img: 'price-tip-step-2.jpg', alt: t.mailPriceTipStep2Alt, title: t.mailPriceTipStep2Title, body: t.mailPriceTipStep2Body },
  ]

  const text = [
    t.mailPriceTipHeading,
    '',
    t.mailPriceTipIntro,
    '',
    t.mailPriceTipStepsLead,
    ...steps.map((s, i) => `${i + 1}. ${s.title} — ${s.body}`),
    '',
    `${cta.label}: ${cta.href}`,
    '',
    t.mailWelcomeSignoff,
    t.mailPriceTipWhy,
    `${t.mailWelcomeStopLead} ${t.mailWelcomeStopLink}: ${stopUrl}`,
  ].join('\n')

  const html = welcomeShell(appUrl, [
    `<h1 style="${MAIL_SERIF};font-size:36px;line-height:1.1;margin:20px 0 12px">${esc(t.mailPriceTipHeading)}</h1>`,
    `<p style="margin:0 0 12px">${esc(t.mailPriceTipIntro)}</p>`,
    `<p style="margin:0 0 8px">${esc(t.mailPriceTipStepsLead)}</p>`,
    ...welcomeSteps(appUrl, steps),
    welcomeButton(cta.href, cta.label),
  ], welcomeStopFooter(t, t.mailPriceTipWhy, stopUrl))

  return { subject: t.mailPriceTipSubject, text, html }
}

/** PAN-308: what mail #3 reports — the account's first week, as the runner counted it. */
export type FirstWeekStats = {
  /** The account's watchlists; mail #3 goes only to an account with at least one. */
  watchCount: number
  /** Listings the alert mail sent for those watchlists over the week. */
  newListings: number
  /**
   * How many of them the watched model's own page calls `under typisk`, or
   * null when no watch has a model with a band — then the mail says nothing
   * about the price, the same rule as the alert mail (PAN-297).
   */
  underCount: number | null
}

/**
 * PAN-308: welcome mail #3, day 7 — "Din første uge". Sent only to an account
 * with a watchlist; the week's numbers are the hook ("Vi så 14 nye annoncer
 * på dine 2 overvågninger – 3 under typisk"), and the one call to action is
 * the watchlists. A week with no new listing says so plainly instead of
 * showing a zero. The `under typisk` label carries the alert mail's verdict
 * ink (`VERDICT_INK.under`): it is the verdict word, Klup's judgement — the
 * number beside it stays ink.
 */
export function buildFirstWeekEmail(stats: FirstWeekStats & { stopUrl: string }): { subject: string; text: string; html: string } {
  const t = translations.da
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'
  const cta = { href: `${appUrl}/watchlists`, label: t.mailFirstWeekCta }
  const n = (v: number) => v.toLocaleString('da-DK')
  const watches = stats.watchCount === 1 ? t.mailFirstWeekWatchesOne : fill(t.mailFirstWeekWatchesMany, { n: n(stats.watchCount) })
  const listings = stats.newListings === 1 ? t.mailFirstWeekListingsOne : fill(t.mailFirstWeekListingsMany, { n: n(stats.newListings) })
  const under = stats.underCount != null && stats.underCount > 0 ? stats.underCount : null
  const quiet = stats.newListings === 0
  const line = quiet
    ? fill(t.mailFirstWeekQuiet, { watches })
    : under != null
      ? fill(t.mailFirstWeekStatsUnder, { listings, watches, n: n(under) })
      : fill(t.mailFirstWeekStats, { listings, watches })

  const text = [
    t.mailFirstWeekHeading,
    '',
    t.mailFirstWeekIntro,
    '',
    line,
    '',
    t.mailFirstWeekBody,
    '',
    `${cta.label}: ${cta.href}`,
    '',
    t.mailWelcomeSignoff,
    t.mailFirstWeekWhy,
    `${t.mailWelcomeStopLead} ${t.mailWelcomeStopLink}: ${stats.stopUrl}`,
  ].join('\n')

  const tile = (value: number, label: string, ink: string) =>
    '<td style="padding:16px 18px;border:1px solid #e3e4e8;border-radius:16px;vertical-align:top">'
    + `<div style="${MAIL_SERIF};font-size:44px;line-height:1">${esc(n(value))}</div>`
    + `<div style="margin-top:6px;font-size:14px;font-weight:600;color:${ink}">${esc(label)}</div></td>`
  const tiles = quiet ? [] : [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 0;margin:8px 0 14px"><tr>',
    tile(stats.newListings, t.mailFirstWeekTileListings, '#5b616e'),
    ...(under != null ? ['<td style="width:12px"></td>', tile(under, t.mailFirstWeekTileUnder, VERDICT_INK.under)] : []),
    '</tr></table>',
  ]

  const html = welcomeShell(appUrl, [
    `<h1 style="${MAIL_SERIF};font-size:36px;line-height:1.1;margin:20px 0 12px">${esc(t.mailFirstWeekHeading)}</h1>`,
    `<p style="margin:0 0 12px">${esc(t.mailFirstWeekIntro)}</p>`,
    ...tiles,
    `<p style="margin:0 0 12px;font-size:18px;font-weight:600">${esc(line)}</p>`,
    `<p style="margin:0 0 4px;color:#5b616e">${esc(t.mailFirstWeekBody)}</p>`,
    welcomeButton(cta.href, cta.label),
  ], welcomeStopFooter(t, t.mailFirstWeekWhy, stats.stopUrl))

  return { subject: t.mailFirstWeekSubject, text, html }
}

/**
 * PAN-308: send welcome mail #1. The idempotency key names the account, so a
 * retried or doubled request inside Resend's 24 h window sends one mail; the
 * route's `welcomeDue` window closes long before that window does.
 */
export async function sendWelcomeEmail(to: string, userId: string, content: { subject: string; text: string; html: string }) {
  const { error } = await getResend().emails.send(
    { from: process.env.RESEND_FROM_EMAIL!, to, ...content },
    { idempotencyKey: `welcome-1/${userId}` },
  )
  if (error) throw new Error(`resend_rejected:${error.name}`)
}

/**
 * PAN-251: one piece of feedback to the owner. The visitor's email rides along
 * only when they typed it, as the reply-to; the visitor's IP never does.
 */
export async function sendFeedbackEmail(
  to: string,
  f: {
    kind: string; surface: string; path: string; text: string | null; email: string | null; productSlug: string | null; state: string | null
    tipPriceDkk: number | null; tipName: string | null; listingUrl: string | null
  },
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'
  const text = [
    `Kind: ${f.kind}`,
    `Surface: ${f.surface}`,
    `Page: ${appUrl}${f.path}`,
    f.productSlug ? `Product: ${f.productSlug}` : null,
    f.state ? `Check state: ${f.state}` : null,
    f.tipPriceDkk != null ? `Tip: ${f.tipPriceDkk.toLocaleString('da-DK')} kr used` : null,
    f.tipName ? `Tip says it is: ${f.tipName}` : null,
    f.listingUrl ? `Ad: ${f.listingUrl}` : null,
    f.email ? `Reply to: ${f.email}` : 'Reply to: (not given)',
    '',
    f.text ?? '(no text)',
  ].filter((line) => line !== null).join('\n')

  const { error } = await getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    replyTo: f.email ?? undefined,
    subject: f.kind === 'price_tip'
      ? `Klup tip: ${f.tipPriceDkk?.toLocaleString('da-DK')} kr${f.tipName ? ` for ${f.tipName}` : ''}`
      : `Klup feedback: ${f.kind} (${f.surface})`,
    text,
  })
  if (error) throw new Error(`resend_rejected:${error.name}`)
}

/**
 * PAN-284: the nightly catalogue audit's report, sent only when a finding is new, changed or fixed
 * (scripts/catalogue-audit.ts decides; silence means clean). The idempotency key names the run.
 */
export async function sendCatalogueAuditEmail(to: string, report: string, ranAt: string) {
  const { error } = await getResend().emails.send(
    {
      from: process.env.RESEND_FROM_EMAIL!,
      to,
      subject: `Klup catalogue audit: ${report.split('\n')[0].replace('[catalogue-audit] ', '')}`,
      text: report,
    },
    { idempotencyKey: `catalogue-audit/${ranAt}` },
  )
  if (error) throw new Error(`resend_rejected:${error.name}`)
}

/**
 * PAN-258: the nightly scrape did not run for these sources. Sent once per
 * incident (missedNight() in scrape-freshness.ts decides); the idempotency key
 * names the incident, so a retried request inside Resend's 24 h window cannot
 * send it twice.
 */
export async function sendMissedNightEmail(
  to: string,
  stale: string[],
  latest: Record<string, string | null>,
  now: Date,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'
  const label = (source: string) => sourceForStored(source)?.label ?? source
  const hoursAgo = (at: string) => Math.floor((now.getTime() - Date.parse(at)) / 3_600_000)
  const lines = stale.map((source) => {
    const at = latest[source]
    return at
      ? `• ${label(source)}: ${at.slice(0, 16).replace('T', ' ')} UTC (${hoursAgo(at)} h ago)`
      : `• ${label(source)}: no listings at all`
  })

  const text = [
    'No new listings since:',
    ...lines,
    '',
    'The nightly scrape did not run. Panter may be off, or rebooted without PM2 (PAN-258).',
    'On panter: `which pm2`, then `pm2 ls`. Start one job with',
    '  pm2 start ecosystem.config.js --only scrape-dba',
    'Never `pm2 resurrect`.',
    '',
    `Sent once per incident. Status now: ${appUrl}/api/health/freshness`,
  ].join('\n')

  const { error } = await getResend().emails.send(
    {
      from: process.env.RESEND_FROM_EMAIL!,
      to,
      subject: `Klup: no new ${stale.map(label).join(' or ')} listings for over a day — check panter`,
      text,
    },
    { idempotencyKey: `missed-night/${stale.map((s) => `${s}@${latest[s]}`).join(',')}` },
  )
  if (error) throw new Error(`resend_rejected:${error.name}`)
}
