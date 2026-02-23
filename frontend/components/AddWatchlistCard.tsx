'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/LocaleProvider'

export function AddWatchlistCard() {
  const router = useRouter()
  const { t } = useLocale()

  return (
    <button
      onClick={() => router.push('/onboarding/step3')}
      className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface border border-dashed border-white/20 text-center p-6 transition-colors hover:border-white/40 hover:bg-white/5 active:scale-[0.98]"
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
