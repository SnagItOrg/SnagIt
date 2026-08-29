'use client'

import type { ReactNode } from 'react'
import { type Locale, translations } from '@/lib/i18n'
import { NoDataState, type NoDataReason } from './NoDataState'

export type ChartFrameState = 'ready' | 'loading' | 'empty' | 'error'

/**
 * The container every chart sits in.
 *
 * It owns the surface, the heading, the legend slot and — the part that
 * matters — the provenance line. A chart that does not say where its numbers
 * came from, what period they cover and how many there were is a picture, not
 * evidence, so `source`, `period` and `sample` are first-class props rather
 * than something a caller remembers to add.
 *
 * It assumes nothing about what it wraps. A sparkline with no axes, a bar in a
 * table and a full area chart are all legitimate children.
 */
export function ChartFrame({
  title,
  description,
  legend,
  source,
  period,
  sample,
  state = 'ready',
  emptyReason = 'no-observations',
  emptyDetail,
  locale = 'da',
  headingLevel = 'h3',
  children,
  className = '',
}: {
  title: string
  description?: string
  legend?: ReactNode
  source?: string
  period?: string
  sample?: string
  state?: ChartFrameState
  /** Which absence to render when `state` is `empty`. */
  emptyReason?: NoDataReason
  emptyDetail?: string
  locale?: Locale
  headingLevel?: 'h2' | 'h3' | 'h4'
  children?: ReactNode
  className?: string
}) {
  const t = translations[locale].dataDisplay
  const Heading = headingLevel

  const footnotes: Array<[string, string]> = []
  if (source) footnotes.push([t.source, source])
  if (period) footnotes.push([t.period, period])
  if (sample) footnotes.push([t.sample, sample])

  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface-1 p-5 ${className}`}
    >
      <div className="flex flex-col gap-1">
        <Heading className="text-[0.9375rem] font-semibold leading-tight text-ink">{title}</Heading>
        {description && (
          <p className="text-[0.8125rem] leading-relaxed text-ink-secondary">{description}</p>
        )}
      </div>

      {legend}

      <div className="min-w-0">
        {state === 'loading' && (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted"
            role="status"
          >
            {t.loading}
          </p>
        )}
        {state === 'empty' && (
          <NoDataState reason={emptyReason} detail={emptyDetail} locale={locale} />
        )}
        {state === 'error' && (
          <NoDataState reason="load-failed" detail={emptyDetail} locale={locale} />
        )}
        {state === 'ready' && children}
      </div>

      {footnotes.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
          {footnotes.map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-baseline gap-1.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                {label}
              </dt>
              <dd className="m-0 text-[11px] text-ink-secondary wrap-anywhere">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
