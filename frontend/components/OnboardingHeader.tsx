'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/LocaleProvider'

interface Props {
  currentStep: 1 | 2 | 3 | 4
  showSkip?: boolean
}

export function OnboardingHeader({ currentStep, showSkip = false }: Props) {
  const router = useRouter()
  const { t } = useLocale()

  return (
    <header className="w-full px-6 lg:px-10 pt-6 pb-4">
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        {/* Logo + skip row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-primary">
            <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
            </div>
            <span className="text-xl font-black tracking-tight">Klup.dk</span>
          </div>

          {showSkip && (
            <button
              onClick={() => router.push('/login')}
              className="border border-white/20 rounded-lg px-4 py-2 text-sm font-bold hover:border-white/40 transition-colors"
              style={{ color: '#64748b' }}
            >
              Spring over
            </button>
          )}
        </div>

        {/* Progress bar + step label */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-surface">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(currentStep / 4) * 100}%`,
                backgroundColor: '#13ec6d',
                boxShadow: '0 0 10px rgba(19,236,109,0.4)',
              }}
            />
          </div>
          <span
            className="text-xs font-bold uppercase tracking-widest whitespace-nowrap"
            style={{ color: '#64748b' }}
          >
            Trin {currentStep} {t.stepOf} 4
          </span>
        </div>
      </div>
    </header>
  )
}
