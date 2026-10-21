import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { MAIL_TOKEN } from '@/lib/watchlist-mail'

/**
 * `/w/<token>/<n>` — PAN-276/278. A listing link in a watchlist mail: the
 * n-th listing of that mail (1-based, the mail's order). It records the click
 * on the mail, server side, and redirects to the ad. Without it, a recipient
 * who went straight from the mail to the ad would count as one who ignored it.
 *
 * The destination is the stored `listings.url` of a listing that mail listed,
 * never a parameter, so this is not an open redirect. Anything that does not
 * resolve answers 404.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await ctx.params
  const index = /^[1-9][0-9]?$/.test(n) ? Number(n) - 1 : -1
  if (!MAIL_TOKEN.test(token) || index < 0) return notFound()

  const db = getSupabaseAdmin()
  const { data: mail } = await db
    .from('watchlist_mail')
    .select('listing_ids, clicked_at')
    .eq('token', token)
    .maybeSingle<{ listing_ids: string[]; clicked_at: string | null }>()
  const listingId = mail?.listing_ids[index]
  if (!listingId) return notFound()

  const { data: listing } = await db.from('listings').select('url').eq('id', listingId).maybeSingle<{ url: string }>()
  if (!listing || !/^https?:\/\//.test(listing.url)) return notFound()

  if (!mail.clicked_at) {
    await db.from('watchlist_mail').update({ clicked_at: new Date().toISOString() }).eq('token', token).is('clicked_at', null)
  }
  const res = NextResponse.redirect(listing.url, 302)
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}

function notFound() {
  return new NextResponse(null, { status: 404 })
}
