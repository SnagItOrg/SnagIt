'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import { useLocale } from '@/components/LocaleProvider'
import { Icon } from '@/components/Icon'

interface Props {
  slug: string
  canonicalName: string
  brandName: string
  subcategoryName: string
  activeListingCount: number
  imageUrl?: string | null
  tier?: 'standard' | 'classic' | 'legendary'
  variant?: 'grid' | 'list'
}

export function ProductCard({
  slug,
  canonicalName,
  brandName,
  subcategoryName,
  activeListingCount,
  imageUrl,
  tier,
  variant = 'grid',
}: Props) {
  const { t } = useLocale()
  const [imgError, setImgError] = useState(false)

  if (variant === 'list') {
    return (
      <Link
        href={`/product/${slug}`}
        className="flex items-center justify-between gap-4 px-4 py-3 border-b transition-colors hover:bg-secondary"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="min-w-0">
          <p
            className="type-card-title truncate"
          >
            {canonicalName}
          </p>
          <p className="type-meta mt-0.5 truncate">
            {subcategoryName}
          </p>
        </div>
        {activeListingCount > 0 && (
          <span
            className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
          >
            {activeListingCount}
          </span>
        )}
      </Link>
    )
  }

  return (
    <Link
      href={`/product/${slug}`}
      className="surface-interactive flex flex-col rounded-xl overflow-hidden"
    >
      {/* Image area */}
      <div className="relative w-full aspect-[4/3] overflow-hidden" style={{ background: 'var(--secondary)' }}>
        {imageUrl && !imgError ? (
          <Image
            src={imageUrl}
            alt={canonicalName}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 50vw, 25vw"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon
              name="piano"
              style={{ fontSize: 36, color: 'var(--muted-foreground)', opacity: 0.4 }}
            />
          </div>
        )}
        {/* Tier badge */}
        {tier && tier !== 'standard' && (
          <span
            className="absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
            style={{ background: 'var(--foreground)', color: 'var(--background)' }}
          >
            <Icon name="workspace_premium" style={{ fontSize: 11 }} />
            {tier === 'legendary' ? t.tierLegendary : t.tierClassic}
          </span>
        )}
        {/* Opposite edge of the media box, not the opposite corner of the same row:
            at 320-430px a shelf card is 152-163px wide and the two pills need
            ~168px side by side, so any top row makes one of them clip or
            ellipsize. aspect-[4/3] guarantees the height this relies on.
            PAN-168 #9: most product photos are cut-outs on white, where a
            --card chip had no edge at all in light mode; --border-subtle is
            the edge every card already wears. */}
        <ForSaleChip count={activeListingCount} />
      </div>

      {/* Text area */}
      <div className="p-3 flex flex-col gap-0.5">
        {/* Two lines, always: line-clamp-2 caps a long name and the matching
            min-height keeps a one-line name occupying the same box, so every
            card in a row ends on the same baseline. 2.48em is two lines of
            .type-card-title (line-height 1.24) and is expressed in em so it
            tracks that rule's fluid clamp() font-size instead of drifting
            from it. */}
        <p
          className="type-card-title line-clamp-2 min-h-[2.48em]"
        >
          {canonicalName}
        </p>
        <p className="type-meta">
          {brandName}
        </p>
      </div>
    </Link>
  )
}

/**
 * The "N til salg" chip on a card's media box. PAN-192: `FamilyCard` wears the
 * same one (owner decision 2026-09-30), so the two cards cannot drift apart.
 */
export function ForSaleChip({ count }: { count: number }) {
  const { t } = useLocale()
  if (count <= 0) return null
  return (
    <span
      className="absolute bottom-2 right-2 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{
        background: 'var(--card)',
        color: 'var(--foreground)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {count} {t.discoverForSale}
    </span>
  )
}
