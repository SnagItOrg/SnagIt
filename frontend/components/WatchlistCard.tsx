'use client'

import type { Watchlist } from '@/lib/supabase'
import { useLocale } from '@/components/LocaleProvider'

interface Props {
  watchlist: Watchlist
  onDelete: (id: string) => void
}

export function WatchlistCard({ watchlist, onDelete }: Props) {
  const { t } = useLocale()

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface border border-white/10 px-4 py-3">
      {/* Status dot */}
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: watchlist.active ? 'var(--color-primary)' : 'rgba(255,255,255,0.2)' }}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text truncate">{watchlist.query}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-xs text-text-muted">
            {new Date(watchlist.created_at).toLocaleDateString('da-DK')}
          </span>
          {watchlist.active && (
            <span className="text-xs font-medium text-primary bg-primary/10 rounded-full px-2 py-px">
              {t.activeLabel}
            </span>
          )}
          {watchlist.type === 'listing' && (
            <span className="text-xs font-medium text-sky-400 bg-sky-400/10 rounded-full px-2 py-px">
              {t.listingLabel}
            </span>
          )}
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
