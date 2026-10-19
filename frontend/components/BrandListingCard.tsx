'use client'

import Link from 'next/link'
import type { BrandWallRow } from '@/lib/brand-wall'
import { priceDkkBucket, track } from '@/lib/analytics'
import { Icon } from '@/components/Icon'
import { ListingCardBody } from '@/components/FamilyListingCard'

/**
 * The listing card on a brand wall — PAN-271.
 *
 * The same body as the family card (`ListingCardBody`), with the seller's
 * price on every row, and ONE of two destinations:
 *
 *   a model named   -> the model's page on Klup, where the price question is
 *                      answered against that model's own band (the family
 *                      card's link, with the verdict it carries);
 *   no model        -> the listing itself, off-site, because Klup has no
 *                      page to answer it on. The meta line says so in words
 *                      ("Model ikke genkendt"), and the card shows no verdict:
 *                      without a model there is no market to measure against.
 *
 * `'use client'` only for the outbound click: `listing_outbound_clicked` is
 * the core value signal (frontend/CLAUDE.md), fired with `product_slug: null`
 * because no product was involved. The price bucket is a band, never the
 * price. A model row fires nothing here — its page fires `product_viewed`.
 */
export function BrandListingCard({ row, t }: { row: BrandWallRow; t: Record<string, string> }) {
  const className = 'surface-card flex w-full gap-3 rounded-2xl p-3 transition-colors hover:border-line-strong'

  if (row.childSlug && row.childLabel) {
    return (
      <Link href={`/product/${row.childSlug}`} className={className}>
        <ListingCardBody
          imageUrl={row.imageUrl}
          title={row.title}
          price={row.priceLabel}
          verdict={row.verdict}
          meta={row.childLabel}
          source={row.source}
          t={t}
        />
      </Link>
    )
  }

  return (
    <a
      href={row.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() =>
        track('listing_outbound_clicked', {
          source: row.source ?? 'unknown',
          country: row.country,
          product_slug: null,
          price_dkk_bucket: priceDkkBucket(row.priceDkk),
        })
      }
    >
      <ListingCardBody
        imageUrl={row.imageUrl}
        title={row.title}
        price={row.priceLabel}
        verdict={null}
        meta={t.brandWallNoModel}
        source={row.source}
        t={t}
      />
      {/* The one visual cue that this card leaves Klup: an outward arrow, the
          same glyph the product page's "Se annonce" carries. */}
      <Icon
        name="open_in_new"
        className="flex-shrink-0 self-center"
        style={{ fontSize: '16px', color: 'var(--text-muted)' }}
      />
    </a>
  )
}
