/**
 * The two sites Klup's maker also runs, linked from the persistent footer.
 *
 * Each link carries UTM tags so the receiving site can tell a visit came from
 * Klup. Nothing about the visitor crosses over: no id, no consent state. Klup
 * itself records no event for these clicks; the destination counts the arrival.
 *
 * Import-free, like catalogue.ts, so it stays trivially testable.
 */

export const SISTER_SITES: readonly { label: string; href: string }[] = [
  { label: 'Tue Sander', href: 'https://tuesander.com' },
  { label: 'Panter Media', href: 'https://www.panter.media' },
]

export function sisterLink(href: string, placement: string): string {
  const url = new URL(href)
  url.searchParams.set('utm_source', 'klup.dk')
  url.searchParams.set('utm_medium', 'referral')
  url.searchParams.set('utm_campaign', 'product')
  url.searchParams.set('utm_content', placement)
  return url.toString()
}
