'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/LocaleProvider'
import { Icon } from '@/components/Icon'

interface Props {
  currentStep?: 1 | 2 | 3 | 4
  showSkip?: boolean
  showProgress?: boolean
}

export function OnboardingHeader({ currentStep, showSkip = false, showProgress = true }: Props) {
  const router = useRouter()
  const { t } = useLocale()

  // z-10: the pages that mount this header pull their <main> up over it with a
  // negative margin, which otherwise swallows clicks on the logo (PAN-67).
  return (
    <header className="relative z-10 w-full px-6 lg:px-10 pt-6 pb-4">
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        {/* Logo + skip row */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 min-h-[44px] text-primary">
            <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
              <Icon name="radar" style={{ fontSize: '20px' }} />
            </div>
            <span className="text-lg font-semibold tracking-tight">Klup.dk</span>
          </Link>

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
