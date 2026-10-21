import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { ListSection } from '@/components/ListSection'
import { Button } from '@/components/Button'
import { NotificationListingCard, type NotificationListing } from '@/components/NotificationListingCard'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCanonical } from '@/lib/catalogue'
import { formatOriginalPrice } from '@/lib/currency'
import { translations, fill } from '@/lib/i18n'
import { MAIL_TOKEN } from '@/lib/watchlist-mail'

/**
 * `/w/<token>` — one watchlist mail, PAN-276.
 *
 * THE PAGE IS THE MAIL. It lists exactly the listings that mail listed, in
 * the mail's order, read from the mail's own `watchlist_mail` row (migration
 * 070) — not a search for the watchlist's words, which is how "Gibson Custom
 * Shop Les Paul" landed on a family page asking which model was meant.
 * Listings sold or removed since sit under one ListSection header after the
 * live ones, so the count the mail promised is still accounted for.
 *
 * THE TOKEN IS THE CREDENTIAL. 12 random base62 characters, the same kind of
 * capability a magic link is: no session is asked for, because the mail is
 * mostly opened on a phone that is not signed in. The service role reads one
 * row by that token and nothing else; the page shows the mail's listings and
 * the watchlist's own words, never an address. noindex, and no Referer to the
 * marketplaces the cards link to, so the token does not leak in a header.
 * Analytics sees `/w/[token]` only (lib/analytics.ts).
 *
 * A VISIT IS A CLICK (PAN-278). The first render stamps `clicked_at`, server
 * side, so the runner's unclicked count resets — whichever link was used.
 *
 * STOP AND RESUME ARE POSTS. The mail's "Ja, stop dem" lands here with
 * `?svar=stop` and asks once more with a button; only the form changes the
 * watchlist. Outlook Safe Links and other scanners fetch every link in a mail,
 * and a GET that paused a watchlist would let them answer for the user.
 *
 * The banner is Astryx's `Banner` header, read not imported
 * (packages/core/src/Banner/Banner.tsx:235-299, clone 3f837b3): title at label
 * size and semibold, one supporting line in the secondary colour, actions in an
 * end area that wraps under the text, 12/16 padding on the container radius.
 * Its `info` fill is Astryx's accent; ours is the neutral `--surface-2`,
 * because Klup's accent is green and green is Klup's judgement only.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

type MailRow = { watchlist_id: string; listing_ids: string[]; sent_at: string; clicked_at: string | null }
type ListingRow = {
  id: string; title: string; url: string; source: string | null; country: string | null; image_url: string | null
  price: number | null; currency: string | null; price_dkk: number | null; is_active: boolean | null
}

export default async function WatchlistMailPage(ctx: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ svar?: string }>
}) {
  const { token } = await ctx.params
  const { svar } = await ctx.searchParams
  if (!MAIL_TOKEN.test(token)) notFound()

  const db = getSupabaseAdmin()
  const { data: mail } = await db
    .from('watchlist_mail')
    .select('watchlist_id, listing_ids, sent_at, clicked_at')
    .eq('token', token)
    .maybeSingle<MailRow>()
  if (!mail) notFound()
  if (!mail.clicked_at) {
    await db.from('watchlist_mail').update({ clicked_at: new Date().toISOString() }).eq('token', token).is('clicked_at', null)
  }

  const [{ data: watchlist }, { data: listingRows }] = await Promise.all([
    db.from('watchlists').select('query, active, product_id').eq('id', mail.watchlist_id)
      .maybeSingle<{ query: string; active: boolean; product_id: string | null }>(),
    db.from('listings')
      .select('id, title, url, source, country, image_url, price, currency, price_dkk, is_active')
      .in('id', mail.listing_ids),
  ])
  if (!watchlist) notFound()

  // The model's page, only while it is canonical — the same gate the runner
  // applies before it mails (isCanonical() is the one authority).
  let productSlug: string | null = null
  if (watchlist.product_id) {
    const [{ data: product }, { data: projection }] = await Promise.all([
      db.from('kg_product').select('id, slug, status, support_state, browse_visibility').eq('id', watchlist.product_id).maybeSingle(),
      db.from('browse_product_projection').select('browse_domain').eq('id', watchlist.product_id).maybeSingle(),
    ])
    if (product && isCanonical({ ...product, browse_domain: projection?.browse_domain ?? null })) productSlug = product.slug as string
  }

  const t = translations.da
  const tt = t as unknown as Record<string, string>
  const byId = new Map(((listingRows ?? []) as ListingRow[]).map((l) => [l.id, l]))
  const inMailOrder = mail.listing_ids.map((id) => byId.get(id)).filter((l): l is ListingRow => !!l)
  const live = inMailOrder.filter((l) => l.is_active !== false).map(toCard)
  const gone = inMailOrder.filter((l) => l.is_active === false).map(toCard)
  const sentOn = new Date(mail.sent_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', timeZone: 'Europe/Copenhagen' })

  return (
    <main id="main-content" className="flex-1 min-w-0 shell-offset pb-24 md:pb-8">
      <MobileSearchBar />
      <div className="cq-pane shell-reading flex flex-col gap-6 pt-6 pb-10 md:pt-10">
        <div className="flex flex-col gap-2">
          <h1 className="type-title">{watchlist.query}</h1>
          <p className="type-meta">{fill(t.notificationSent, { date: sentOn })}</p>
          {!watchlist.product_id && (
            <p className="type-measure text-sm text-ink-secondary">{fill(t.notificationLegacyNote, { query: watchlist.query })}</p>
          )}
        </div>

        <MailSettingsBanner token={token} active={watchlist.active} svar={svar} t={tt} />

        <section className="flex flex-col gap-3">
          {live.length === 0 && gone.length === 0 && <p className="text-sm text-ink-secondary">{t.notificationNoneLeft}</p>}
          {live.map((l) => <NotificationListingCard key={l.id} listing={l} productSlug={productSlug} t={tt} />)}
          {gone.length > 0 && (
            <ListSection label={t.notificationGone} muted>
              <div className="flex flex-col gap-3">
                {gone.map((l) => <NotificationListingCard key={l.id} listing={l} productSlug={productSlug} t={tt} />)}
              </div>
            </ListSection>
          )}
        </section>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {productSlug && (
            <Link href={`/product/${productSlug}`} className="underline underline-offset-4">
              {fill(t.notificationSeeProduct, { name: watchlist.query })}
            </Link>
          )}
          <Link href="/watchlists" className="underline underline-offset-4">{t.notificationMyWatchlists}</Link>
        </nav>
      </div>
    </main>
  )
}

function toCard(l: ListingRow): NotificationListing {
  return {
    id: l.id,
    title: l.title,
    url: l.url,
    source: l.source,
    country: l.country,
    imageUrl: l.image_url && l.image_url.trim().length > 0 ? l.image_url : null,
    priceLabel: l.price != null && l.currency ? formatOriginalPrice(l.price, l.currency) : null,
    priceDkk: l.price_dkk,
  }
}

/**
 * The watchlist's mail setting, when there is something to say: paused (with
 * a way back), the stop question the mail's "Ja" link asked, or the answer to
 * its "Nej". Otherwise nothing — a plain visit is not asked anything.
 */
function MailSettingsBanner({ token, active, svar, t }: {
  token: string; active: boolean; svar: string | undefined; t: Record<string, string>
}) {
  const form = (action: 'stop' | 'resume', label: string) => (
    <form method="post" action={`/api/watchlist-mail/${token}`}>
      <input type="hidden" name="action" value={action} />
      <Button type="submit" variant="primary" className="rounded-xl px-4 py-2 text-sm font-semibold">{label}</Button>
    </form>
  )
  let title: string
  let body: string | null = null
  let actions: ReactNode = null
  if (!active) {
    title = t.notificationPausedTitle
    body = t.notificationPausedBody
    actions = form('resume', t.mailResume)
  } else if (svar === 'stop') {
    title = t.mailAskQuestion
    actions = (
      <>
        {form('stop', t.notificationStopNow)}
        <Link href={`/w/${token}?svar=fortsaet`} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">
          {t.mailAskNo}
        </Link>
      </>
    )
  } else if (svar === 'fortsaet') {
    title = t.notificationKept
  } else {
    return null
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl bg-surface-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-32 flex-col">
        <p className="text-sm font-semibold text-ink wrap-anywhere">{title}</p>
        {body && <p className="text-xs text-ink-secondary wrap-anywhere">{body}</p>}
      </div>
      {actions && <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
