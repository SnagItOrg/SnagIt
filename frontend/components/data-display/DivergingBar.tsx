'use client'

import { DIRECTION_GLYPH, directionOf, directionTone } from '@/lib/chart-palette'
import { divergingBarGeometry } from '@/lib/chart-geometry'
import { NoDataState, type NoDataReason } from './NoDataState'
import type { Locale } from '@/lib/i18n'

/**
 * A signed difference between two named markets, drawn zero-centred.
 *
 * The sign is carried four times over, and never by hue alone:
 *   - the printed `+` or `−` in the value;
 *   - the arrow glyph;
 *   - which side of the centre line the bar grows towards;
 *   - the route sentence, written out.
 * The tint is the fifth channel and the only one a reader can lose without
 * losing the meaning.
 *
 * `Δ DK–DE` does not tell anyone whether to buy in DK or in DE, so this
 * component refuses to take a delta on its own: the caller must name the
 * origin, the destination and the route in words.
 */
export function DivergingBar({
  value,
  max,
  routeLabel,
  originLabel,
  destinationLabel,
  originCount,
  destinationCount,
  formatSigned,
  noDataReason = 'no-observations',
  locale = 'da',
  className = '',
}: {
  /** Signed difference. Positive and negative must mean what `routeLabel` says. */
  value: number | null
  /** Largest absolute value in the comparison group — the scale reference. */
  max: number
  /** The route in words, e.g. "Buy DE → sell DK". Never inferred from the sign. */
  routeLabel: string | null
  originLabel: string
  destinationLabel: string
  originCount: number
  destinationCount: number
  formatSigned: (value: number) => string | null
  noDataReason?: NoDataReason
  locale?: Locale
  className?: string
}) {
  const geometry = divergingBarGeometry(value, max)
  const direction = directionOf(value)
  const signed = value == null ? null : formatSigned(value)

  if (value == null || signed == null) {
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
        <NoDataState reason={noDataReason} locale={locale} variant="inline" />
        <span className="font-mono text-[10px] text-ink-muted">
          {originLabel} {originCount} · {destinationLabel} {destinationCount}
        </span>
      </div>
    )
  }

  const tone = directionTone(direction)

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12px] tabular-nums" style={{ color: tone }}>
          <span aria-hidden="true">{DIRECTION_GLYPH[direction]} </span>
          {signed}
          {geometry.clamped && <span aria-hidden="true"> ▸</span>}
        </span>
        <span className="font-mono text-[10px] text-ink-muted tabular-nums">
          {originLabel} {originCount} · {destinationLabel} {destinationCount}
        </span>
      </div>

      <div
        className="relative h-2 w-full min-w-0 overflow-hidden rounded-sm bg-surface-2"
        role="img"
        aria-label={`${routeLabel ?? `${originLabel} / ${destinationLabel}`}: ${signed}. ${originLabel} n=${originCount}, ${destinationLabel} n=${destinationCount}.`}
      >
        {/* The zero line. The bar's meaning is its side of this. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong"
        />
        {geometry.side !== 'none' && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 block rounded-sm"
            style={{
              width: `${geometry.fraction * 50}%`,
              background: tone,
              ...(geometry.side === 'right' ? { left: '50%' } : { right: '50%' }),
            }}
          />
        )}
      </div>

      {routeLabel && (
        <span className="text-[11px] leading-snug text-ink-secondary">{routeLabel}</span>
      )}
    </div>
  )
}
