'use client'

import type { ReactNode } from 'react'
import { DIRECTION_GLYPH, type Direction, directionTone } from '@/lib/chart-palette'

/**
 * A single summary number.
 *
 * Quiet by construction: the label is small mono uppercase, the value is large
 * and weight-400. Size carries the emphasis, so nothing here needs to be bold
 * and nothing needs an icon to be findable.
 *
 * No width is set. The tile fills whatever track its parent grid gives it and
 * cannot push a narrow viewport into overflow.
 */
export function MetricTile({
  label,
  value,
  context,
  trend,
  help,
  className = '',
}: {
  label: string
  value: ReactNode
  /** One short line under the value — a unit, a qualifier, a sample size. */
  context?: ReactNode
  /** Direction is carried by the glyph and the text, tinted by the tone. */
  trend?: { direction: Direction; label: string }
  /** The definition behind the number. Rendered, not hidden in a tooltip. */
  help?: string
  className?: string
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface-1 px-4 py-4 ${className}`}
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </p>
      <p className="text-[clamp(1.5rem,1.2rem+1vw,2.125rem)] font-normal leading-tight tracking-tight text-ink tabular-nums wrap-anywhere">
        {value}
      </p>
      {trend && (
        <p
          className="font-mono text-[11px] tabular-nums"
          style={{ color: directionTone(trend.direction) }}
        >
          <span aria-hidden="true">{DIRECTION_GLYPH[trend.direction]} </span>
          {trend.label}
        </p>
      )}
      {context && <p className="text-[0.8125rem] leading-snug text-ink-secondary">{context}</p>}
      {help && <p className="mt-1 text-[11px] leading-snug text-ink-muted">{help}</p>}
    </div>
  )
}
