import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

type ListingSnippet = {
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-app.vercel.app'

  const text = [
    `${listings.length} new listing${listings.length === 1 ? '' : 's'} for "${query}" on dba.dk:`,
    '',
    listingLines,
    overflow,
    '',
    `View all: ${appUrl}`,
  ].join('\n')

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: `${listings.length} new${listings.length === 1 ? '' : ' listings'}: "${query}" on dba.dk`,
    text,
  })
}
