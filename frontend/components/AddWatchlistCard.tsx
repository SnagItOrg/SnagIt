'use client'

import { useLocale } from '@/components/LocaleProvider'

interface Props {
  onOpen: () => void
}

export function AddWatchlistCard({ onOpen }: Props) {
  const { t } = useLocale()

  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface border border-dashed border-border/60 hover:border-primary/50 active:border-primary text-center p-6 opacity-60 hover:opacity-90 active:opacity-100 transition-all duration-200 cursor-pointer"
      style={{ aspectRatio: '4/3' }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: '40px', color: 'var(--color-text-muted)' }}
      >
        add_circle
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-text">{t.addWatchlist}</span>
        <span className="text-xs text-text-muted">{t.startTracking}</span>
      </div>
    </button>
  )
}
