'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/LocaleProvider'

interface Props {
  currentStep?: 1 | 2 | 3 | 4
  showSkip?: boolean
  showProgress?: boolean
}

export function OnboardingHeader({ currentStep, showSkip = false, showProgress = true }: Props) {
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
              className="border border-border rounded-lg px-4 py-2 text-sm font-bold hover:border-border/80 transition-colors"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Spring over
            </button>
          )}
        </div>

        {/* Progress bar + step label */}
        {showProgress && currentStep && (
          <div className="flex items-center gap-4">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(currentStep / 4) * 100}%`,
                  backgroundColor: 'var(--primary)',
                }}
              />
            </div>
            <span
              className="text-xs font-bold uppercase tracking-widest whitespace-nowrap"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Trin {currentStep} {t.stepOf} 4
            </span>
          </div>
        )}
      </div>
    </header>
  )
}
