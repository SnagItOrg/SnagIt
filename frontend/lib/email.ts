import { Resend } from 'resend'
import { sourceForStored } from './admin-match-sources'

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
}

export async function sendNewListingsEmail({
  to,
  query,
  listings,
}: {
  to: string
  query: string
  listings: ListingSnippet[]
}) {
  const preview = listings.slice(0, 5)

  const listingLines = preview
    .map((l) => {
      const price = l.price != null ? `${l.price.toLocaleString('da-DK')} ${l.currency}` : 'Price not listed'
      const source = l.source ? ` (${sourceForStored(l.source)?.label ?? l.source})` : ''
      return `• ${l.title} — ${price}${source}\n  ${l.url}`
    })
    .join('\n\n')

  const overflow = listings.length > 5 ? `\n…and ${listings.length - 5} more.` : ''

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'

  const text = [
    `${listings.length} new listing${listings.length === 1 ? '' : 's'} for "${query}":`,
    '',
    listingLines,
    overflow,
    '',
    `View all: ${appUrl}`,
  ].join('\n')

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
    subject: `${listings.length} new${listings.length === 1 ? '' : ' listings'}: "${query}"`,
    text,
  })

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
