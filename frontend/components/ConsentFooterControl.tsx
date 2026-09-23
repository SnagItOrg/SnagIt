'use client'

/**
 * The persistent consent control, in the footer of every public page.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.4.
 *
 * WITHDRAWAL HAS TO BE FINDABLE WITHOUT LOOKING FOR IT. A control that exists
 * only on the privacy page is a control most people never learn about, so the
 * same action sits at the foot of every public page, states the current
 * position in a sentence, and takes one click. Granting after a rejection is
 * equally available and equally close.
 *
 * WHILE THE STATE IS `undecided` THIS RENDERS THE PRIVACY LINK ONLY. The
 * banner is the decision surface and it presents accept and reject with
 * identical cost; a one-sided "give consent" button down here would quietly
 * reintroduce the asymmetry §12.4.2 point 4 forbids.
 *
 * ADMIN SURFACES ARE EXCLUDED. `/admin` and `/intel` are operator tools with
 * their own chrome, are not public pages, and emit no product events (§12.2).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useConsent } from '@/components/ConsentProvider'
import { useLocale } from '@/components/LocaleProvider'
import { isSuppressedSurface } from '@/lib/analytics'

const CONTROL_CLASS =
  'shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ' +
  'transition-opacity hover:opacity-90 min-h-[44px]'

const CONTROL_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--secondary)',
  color: 'var(--secondary-foreground)',
  border: '1px solid var(--border)',
}

export function ConsentFooterControl() {
  const { state, hydrated, grant, withdraw } = useConsent()
  const { t } = useLocale()
  const pathname = usePathname() ?? '/'

  if (isSuppressedSurface(pathname)) return null

  const decided = hydrated && state !== 'undecided'
  const granted = state === 'granted'

  return (
    <footer
      data-testid="consent-footer"
      className="border-t px-4 pb-24 pt-5 text-sm md:px-8 md:pb-8"
      style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
    >
      {/*
        ONE ALIGNMENT, AND IT IS CENTRED. This row used to be
        `sm:justify-between` inside a centred max-w-4xl block, so on a 1440px
        viewport the privacy link began at x=272 — neither centred nor aligned
        to anything else on the page. On `/` the landing footer sits directly
        above it with its single line centred at x≈692, which put two
        different alignments within 100px of each other.

        Centring this row is the smaller of the two corrections: it settles
        every public page at once, and it holds in all three consent states
        rather than only the one with no button.
      */}
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-4">
        <p className="min-w-0">
          {decided && (
            <span data-testid="consent-status">
              {granted ? t.consentStatusGranted : t.consentStatusRejected}{' '}
            </span>
          )}
          <Link
            href="/privatliv"
            className="underline underline-offset-2"
            style={{ color: 'var(--foreground)' }}
          >
            {t.privacyPolicy}
          </Link>
        </p>

        {decided && granted && (
          <button
            type="button"
            data-testid="consent-withdraw"
            onClick={withdraw}
            className={CONTROL_CLASS}
            style={CONTROL_STYLE}
          >
            {t.consentWithdraw}
          </button>
        )}

        {decided && !granted && (
          <button
            type="button"
            data-testid="consent-grant"
            onClick={grant}
            className={CONTROL_CLASS}
            style={CONTROL_STYLE}
          >
            {t.consentGrantLater}
          </button>
        )}
      </div>
    </footer>
  )
}
