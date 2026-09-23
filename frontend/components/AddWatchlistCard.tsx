'use client'

import { useLocale } from '@/components/LocaleProvider'
import { Icon } from '@/components/Icon'

interface Props {
  onOpen: () => void
}

export function AddWatchlistCard({ onOpen }: Props) {
  const { t } = useLocale()

  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 border border-dashed border-line hover:border-line-strong active:border-line-strong text-center p-6 opacity-70 hover:opacity-100 transition-all duration-fast cursor-pointer"
      style={{ aspectRatio: '4/3' }}
    >
      <Icon name="add_circle" style={{ fontSize: '40px', color: 'var(--muted-foreground)' }} />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{t.addWatchlist}</span>
        <span className="text-xs text-muted-foreground">{t.startTracking}</span>
      </div>
    </button>
  )
}
