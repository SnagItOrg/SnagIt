'use client'

import { priceDkkBucket, track } from '@/lib/analytics'
import { Icon } from '@/components/Icon'
import { ListingCardBody } from '@/components/FamilyListingCard'

/**
 * A listing on a watchlist mail's page, `/w/[token]` — PAN-276.
 *
 * The brand wall's off-site card (BrandListingCard's no-model branch) with the
 * mail's own facts: the shared `ListingCardBody`, the seller's price, a link
 * to the ad itself. The page lists exactly what the mail listed, so there is
 * no model page to send it to first. `'use client'` only for the outbound
 * click: `listing_outbound_clicked`, the core value signal, with the watched
 * model's slug when the watchlist has one, and a price band, never the price.
 */
export type NotificationListing = {
  id: string
  title: string
  url: string
  source: string | null
  country: string | null
  imageUrl: string | null
  priceLabel: string | null
  priceDkk: number | null
}

export function NotificationListingCard({
  listing,
  productSlug,
  t,
}: {
  listing: NotificationListing
  productSlug: string | null
  t: Record<string, string>
}) {
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="surface-card flex w-full gap-3 rounded-2xl p-3 transition-colors hover:border-line-strong"
      onClick={() =>
        track('listing_outbound_clicked', {
          source: listing.source ?? 'unknown',
          country: listing.country,
          product_slug: productSlug,
          price_dkk_bucket: priceDkkBucket(listing.priceDkk),
        })
      }
    >
      <ListingCardBody
        imageUrl={listing.imageUrl}
        title={listing.title}
        price={listing.priceLabel}
        verdict={null}
        meta=""
        source={listing.source}
        t={t}
      />
      <Icon
        name="open_in_new"
        className="flex-shrink-0 self-center"
        style={{ fontSize: '16px', color: 'var(--text-muted)' }}
      />
    </a>
  )
}
