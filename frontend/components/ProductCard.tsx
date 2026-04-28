'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

interface Props {
  slug: string
  canonicalName: string
  brandName: string
  subcategoryName: string
  activeListingCount: number
  imageUrl?: string | null
  variant?: 'grid' | 'list'
}

export function ProductCard({
  slug,
  canonicalName,
  brandName,
  subcategoryName,
  activeListingCount,
  imageUrl,
  variant = 'grid',
}: Props) {
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
            className="text-sm font-semibold truncate"
            style={{ fontFamily: 'var(--font-dm-serif, "DM Serif Display", serif)', color: 'var(--foreground)' }}
          >
            {canonicalName}
          </p>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted-foreground)' }}>
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
      className="flex flex-col rounded-xl border overflow-hidden transition-colors hover:bg-secondary"
      style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
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
        {activeListingCount > 0 && (
          <span
            className="absolute top-2 right-2 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'var(--card)', color: 'var(--foreground)' }}
          >
            {activeListingCount} til salg
          </span>
        )}
      </div>

      {/* Text area */}
      <div className="p-3 flex flex-col gap-0.5">
        <p
          className="text-sm font-semibold leading-snug"
          style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
        >
          {canonicalName}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {brandName}
        </p>
      </div>
    </Link>
  )
}
