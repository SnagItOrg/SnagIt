'use client'

import Image from 'next/image'
import type { Watchlist } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'

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
  onEdit: (id: string) => void
}

export function WatchlistBentoCard({ watchlist, onEdit }: Props) {
  const { t } = useLocale()
  const displayName = getDisplayName(watchlist.query)

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-border bg-surface"
      style={{ aspectRatio: '4/3' }}
    >
      {/* Background: image or placeholder */}
      <div className="absolute inset-0">
        {watchlist.preview_image_url ? (
          <Image
            src={watchlist.preview_image_url}
            alt={displayName}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 33vw, 100vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '48px', color: 'var(--color-text-muted)' }}
            >
              search
            </span>
          </div>
        )}
      </div>

      {/* Gradient overlay — bottom half */}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 p-3 flex flex-col gap-1.5">
        {/* Title */}
        <p className="text-sm font-semibold text-white truncate pr-12">{displayName}</p>

        {/* Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {watchlist.new_count > 0 ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary text-bg">
              {watchlist.new_count} {t.newMatches}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">
              {t.noMatches}
            </span>
          )}

          {watchlist.max_price != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">
              Max {watchlist.max_price.toLocaleString('da-DK')} kr
            </span>
          )}

          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50">
            dba.dk
          </span>
        </div>

        {/* Edit button — bottom right */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(watchlist.id) }}
          className="absolute bottom-2.5 right-2.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors"
          style={{ color: 'rgba(255,255,255,0.55)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.9)'
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          Rediger
        </button>
      </div>
    </div>
  )
}
