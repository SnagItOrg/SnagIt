'use client'

/**
 * The consent surface.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.2
 * points 3 and 4.
 *
 * REJECT IS EXACTLY AS EASY AS ACCEPT. The two buttons share ONE style
 * constant. They are the same size, the same colour, the same weight, in the
 * same place, one click each, and they differ only in their label. That is not
 * a stylistic preference: it is the requirement, written so that a reviewer or
 * a test can compare two identifiers rather than judge a screenshot.
 *
 * There is no pre-ticked control, no "manage preferences" detour required in
 * order to decline, no second-step confirmation on the decline path, and no
 * greyed-out or de-emphasised decline. Dismissal is not offered as a third
 * option, because a dismissal that leaves the state `undecided` looks like a
 * decision and is not one.
 *
 * THE BANNER NEVER RETURNS AFTER AN ANSWER. It renders only while the state is
 * `undecided`. A prompt that reappears after a "no" is not a question, it is
 * pressure; the only route back is the deliberate control on /privatliv and in
 * the footer (§12.4.4).
 *
 * NOTHING IS WITHHELD WHILE IT IS OPEN. It is a bar at the bottom of the page,
 * not a modal and not an overlay: no scroll lock, no focus trap, no blur, and
 * no dimmed content behind it. Every page works while it is showing, which is
 * the same guarantee rejection carries (§12.4.3).
 */

import Link from 'next/link'

import { useConsent } from '@/components/ConsentProvider'
import { useLocale } from '@/components/LocaleProvider'

/**
 * ONE style, used by both actions. Changing the accept button changes the
 * reject button, which is the property the contract actually needs.
 */
const ACTION_CLASS =
  'flex-1 sm:flex-none sm:min-w-[9rem] rounded-xl px-5 py-2.5 text-sm font-semibold ' +
  'transition-opacity hover:opacity-90 min-h-[44px]'

const ACTION_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--primary)',
  color: 'var(--primary-foreground)',
  border: '1px solid var(--border)',
}

export function ConsentBanner() {
  const { state, hydrated, grant, reject } = useConsent()
  const { t } = useLocale()

  if (!hydrated || state !== 'undecided') return null

  return (
    <div
      role="region"
      aria-label={t.consentHeading}
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t px-4 py-4 md:px-8"
      style={{
        backgroundColor: 'var(--card)',
        borderColor: 'var(--border)',
        color: 'var(--foreground)',
      }}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t.consentHeading}</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {t.consentBody}{' '}
            <Link
              href="/privatliv"
              className="underline underline-offset-2"
              style={{ color: 'var(--foreground)' }}
            >
              {t.privacyPolicy}
            </Link>
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            data-testid="consent-reject"
            onClick={reject}
            className={ACTION_CLASS}
            style={ACTION_STYLE}
          >
            {t.consentReject}
          </button>
          <button
            type="button"
            data-testid="consent-accept"
            onClick={grant}
            className={ACTION_CLASS}
            style={ACTION_STYLE}
          >
            {t.consentAccept}
          </button>
        </div>
      </div>
    </div>
  )
}
