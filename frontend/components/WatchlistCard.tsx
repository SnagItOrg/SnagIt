'use client'

import { useRef, useEffect, useState } from 'react'
import Image from 'next/image'
import type { Watchlist } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'

// If the stored query is a URL (e.g. a search URL pasted by the user),
// extract a human-readable label from it.
function getDisplayName(query: string): string {
  if (!query.startsWith('http')) return query
  try {
    const url = new URL(query)
    const param = url.searchParams.get('q')
    if (param) return param
  } catch {
    // not a valid URL — fall through
  }
  return query
}

interface Props {
  watchlist: Watchlist
  onDelete: (id: string) => void
}

export function WatchlistCard({ watchlist, onDelete }: Props) {
  const { t } = useLocale()
  const displayName = getDisplayName(watchlist.query)

  const containerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const [marqueeOffset, setMarqueeOffset] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const title = titleRef.current
    if (container && title) {
      const overflow = title.scrollWidth - container.clientWidth
      setMarqueeOffset(overflow > 0 ? overflow : 0)
    }
  }, [displayName])

  return (
    <div className="relative flex items-center gap-3 rounded-2xl bg-surface border border-white/10 px-4 py-3">
      {/* New-listings badge — top right */}
      <div className="absolute top-2.5 right-12">
        {watchlist.new_count > 0 ? (
          <span className="text-xs font-semibold text-bg bg-primary rounded-full px-2 py-0.5">
            {watchlist.new_count} {t.newListings}
          </span>
        ) : (
          <span className="text-xs font-medium text-text-muted bg-white/5 rounded-full px-2 py-0.5">
            {t.updated}
          </span>
        )}
      </div>

      {/* Thumbnail or placeholder */}
      <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
        {watchlist.preview_image_url ? (
          <Image
            src={watchlist.preview_image_url}
            alt={displayName}
            width={48}
            height={48}
            className="w-full h-full object-cover"
          />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0 pr-2">
        {/* Title — marquee scroll when text overflows the container */}
        <div ref={containerRef} className="overflow-hidden">
          <span
            ref={titleRef}
            className={`text-sm font-semibold text-text whitespace-nowrap inline-block${marqueeOffset > 0 ? ' animate-marquee' : ''}`}
            style={
              marqueeOffset > 0
                ? ({ '--marquee-offset': `-${marqueeOffset}px` } as React.CSSProperties)
                : undefined
            }
          >
            {displayName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-xs text-text-muted">
            {new Date(watchlist.created_at).toLocaleDateString('da-DK')}
          </span>
          {watchlist.active && (
            <span className="text-xs font-medium text-primary bg-primary/10 rounded-full px-2 py-px">
              {t.activeLabel}
            </span>
          )}
          <span className="text-xs font-medium text-sky-400 bg-sky-400/10 rounded-full px-2 py-px">
            {watchlist.type === 'listing' ? t.listingLabel : t.queryLabel}
          </span>
        </div>
      </div>

      <button
        onClick={() => onDelete(watchlist.id)}
        className="flex items-center justify-center min-w-[40px] min-h-[40px] p-2 rounded-xl text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
        aria-label={t.removeWatch}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        </svg>
      </button>
    </div>
  )
}
