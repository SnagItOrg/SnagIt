'use client'

import Link from 'next/link'

interface Props {
  slug: string
  canonicalName: string
  brandName: string
  subcategoryName: string
  activeListingCount: number
  variant?: 'grid' | 'list'
}

export function ProductCard({
  slug,
  canonicalName,
  brandName,
  subcategoryName,
  activeListingCount,
  variant = 'grid',
}: Props) {
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
      className="flex flex-col gap-2 p-4 rounded-xl border transition-colors hover:bg-secondary"
      style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        {activeListingCount > 0 && (
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ml-auto"
            style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
          >
            {activeListingCount} til salg
          </span>
        )}
      </div>
      <p
        className="text-sm font-semibold leading-snug"
        style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
      >
        {canonicalName}
      </p>
      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {brandName}
      </p>
    </Link>
  )
}
