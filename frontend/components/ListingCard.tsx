'use client'

import Image from 'next/image'
import type { Listing } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'

export function ListingCard({ listing }: { listing: Listing }) {
  const { t } = useLocale()

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="surface-card flex gap-3 rounded-2xl p-3 transition-colors hover:border-line-strong active:scale-[0.99]"
    >
      <div className="w-[clamp(3.5rem,17vw,5.5rem)] aspect-square flex-shrink-0 rounded-xl bg-muted overflow-hidden">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={96}
            height={96}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--border)"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex flex-col justify-center min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 wrap-anywhere">
          {listing.title}
        </p>
        {listing.price != null ? (
          <p className="text-sm font-semibold text-primary mt-1 tabular-nums">
            {listing.price.toLocaleString('da-DK')} {listing.currency}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">{t.priceNotListed}</p>
        )}
        {listing.location && (
          <p className="type-meta mt-0.5 wrap-anywhere">{listing.location}</p>
        )}
      </div>
    </a>
  )
}
