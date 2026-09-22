'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import { useLocale } from '@/components/LocaleProvider'

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
            <span className="material-symbols-outlined" style={{ fontSize: 36, color: 'var(--muted-foreground)', opacity: 0.4 }}>
              piano
            </span>
          </div>
        )}
        {/* Tier badge */}
        {tier && tier !== 'standard' && (
          <span
            className="absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
            style={{ background: 'var(--foreground)', color: 'var(--background)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 11 }}>workspace_premium</span>
            {tier === 'legendary' ? t.tierLegendary : t.tierClassic}
          </span>
        )}
        {/* Opposite edge of the media box, not the opposite corner of the same row:
            at 320-430px a shelf card is 152-163px wide and the two pills need
            ~168px side by side, so any top row makes one of them clip or
            ellipsize. aspect-[4/3] guarantees the height this relies on. */}
        {activeListingCount > 0 && (
          <span
            className="absolute bottom-2 right-2 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'var(--card)', color: 'var(--foreground)' }}
          >
            {activeListingCount} til salg
          </span>
        )}
      </div>

      {/* Text area */}
      <div className="p-3 flex flex-col gap-0.5">
        <p
          className="type-card-title"
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
