'use client'

import { type Locale, translations } from '@/lib/i18n'

/**
 * Why there is nothing to show.
 *
 * Four causes, deliberately not collapsed into one em dash. "We have never
 * observed this", "we have observed it twice", "the source exists but is
 * empty" and "the request failed" lead an operator to four different actions,
 * and a single grey dash tells them which one to take: none.
 */
export type NoDataReason =
  | 'no-observations'
  | 'insufficient-observations'
  | 'source-unavailable'
  | 'load-failed'

// `translations` is `as const`, so each locale's values are distinct literal
// types. Widen to the shared shape — the keys are the contract, not the words.
type Copy = { [K in keyof (typeof translations)['da']['dataDisplay']]: string }

function copyFor(reason: NoDataReason, t: Copy): { title: string; detail: string } {
  switch (reason) {
    case 'insufficient-observations':
      return { title: t.insufficientObservations, detail: t.insufficientObservationsDetail }
    case 'source-unavailable':
      return { title: t.sourceUnavailable, detail: t.sourceUnavailableDetail }
    case 'load-failed':
      return { title: t.loadFailed, detail: t.loadFailedDetail }
    case 'no-observations':
    default:
      return { title: t.noObservations, detail: t.noObservationsDetail }
  }
}

export function NoDataState({
  reason,
  locale = 'da',
  detail,
  variant = 'block',
  className = '',
}: {
  reason: NoDataReason
  locale?: Locale
  /** Replaces the generic explanation with a specific one. */
  detail?: string
  /** `inline` is for a table cell, where a paragraph will not fit. */
  variant?: 'block' | 'inline'
  className?: string
}) {
  const t = translations[locale].dataDisplay
  const { title, detail: fallbackDetail } = copyFor(reason, t)
  const text = detail ?? fallbackDetail

  if (variant === 'inline') {
    // Still not a bare dash: the cell carries the cause as its accessible
    // name, so a screen reader and a hovering operator both get the reason.
    return (
      <span
        className={`font-mono text-[11px] text-ink-muted ${className}`}
        title={`${title} — ${text}`}
      >
        {t.noData}
      </span>
    )
  }

  return (
    <div
      className={`flex flex-col items-start gap-1 rounded-xl border border-dashed border-line px-4 py-5 ${className}`}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">{title}</p>
      <p className="text-[0.8125rem] leading-relaxed text-ink-secondary">{text}</p>
    </div>
  )
}
