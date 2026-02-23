'use client'

import Image from 'next/image'
import type { Listing } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'

function timeSince(dateStr: string, locale: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)

  if (locale === 'da') {
    if (mins  <  1) return 'Lige nu'
    if (mins  < 60) return `${mins}m siden`
    if (hours < 24) return `${hours}t siden`
    return `${days}d siden`
  }
  if (mins  <  1) return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

interface Props {
  listing:           Listing
  onCreateWatchlist: () => void
  creating:          boolean
}

export function SearchResultCard({ listing, onCreateWatchlist, creating }: Props) {
  const { locale, t } = useLocale()

  const priceFormatted = listing.price != null
    ? `${listing.price.toLocaleString('da-DK')} kr`
    : t.priceNotListed

  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-surface border border-white/10 hover:border-white/20 transition-colors">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={80}
            height={80}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--color-text-muted)' }}>
            image
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Title */}
        <p className="text-sm font-semibold text-text truncate">{listing.title}</p>

        {/* Price */}
        <p className="text-base font-black" style={{ color: 'var(--color-primary)' }}>
          {priceFormatted}
        </p>

        {/* Price context placeholder */}
        <p className="text-[11px]" style={{ color: '#475569' }}>
          Typisk pris · <span className="italic">{t.comingSoon.toLowerCase()}</span>
        </p>

        {/* Meta: platform + time */}
        <div className="flex items-center gap-1.5 text-[11px] mt-auto" style={{ color: '#64748b' }}>
          <span className="px-1.5 py-0.5 rounded bg-white/5">dba.dk</span>
          <span>·</span>
          <span>{timeSince(listing.scraped_at, locale)}</span>
          {listing.location && (
            <>
              <span>·</span>
              <span className="truncate">{listing.location}</span>
            </>
          )}
        </div>

        {/* CTAs */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={onCreateWatchlist}
            disabled={creating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add_alert</span>
            {t.createWatchlist}
          </button>
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-white/10 hover:border-white/25 transition-colors"
            style={{ color: 'rgba(255,255,255,0.7)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_new</span>
            {t.viewListing}
          </a>
        </div>
      </div>
    </div>
  )
}
