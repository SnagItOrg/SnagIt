import { Resend } from 'resend'

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
      return `• ${l.title} — ${price}\n  ${l.url}`
    })
    .join('\n\n')

  const overflow = listings.length > 5 ? `\n…and ${listings.length - 5} more.` : ''

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.klup.dk'

  const text = [
    `${listings.length} new listing${listings.length === 1 ? '' : 's'} for "${query}" on dba.dk:`,
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
    subject: `${listings.length} new${listings.length === 1 ? '' : ' listings'}: "${query}" on dba.dk`,
    text,
  })

  if (error) throw new Error(`resend_rejected:${error.name}`)
}
