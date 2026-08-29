'use client'

import { seriesColor, DIRECTION_GLYPH, directionOf, directionTone } from '@/lib/chart-palette'
import { sparklineGeometry } from '@/lib/chart-geometry'
import { type Locale, translations } from '@/lib/i18n'

export type SparklinePoint = { at: string; value: number }

const VIEW_W = 240
const VIEW_H = 40

/**
 * An inline series, drawn from real observations only.
 *
 * There is no interpolation and no smoothing: every vertex is an observation
 * that happened. Points are evenly spaced along x because the observations are
 * ordered, not because they are equally spaced in time — which is why the
 * caller must state the period, and why this never claims a cadence.
 *
 * Geometry is stable at any width: the path scales to fill, the stroke does
 * not (`vector-effect`), and the endpoint marker is positioned in CSS so it
 * stays a circle rather than stretching into an ellipse.
 *
 * With no observations it renders nothing — the caller shows a NoDataState,
 * because "we have no data" is a different statement from a flat line.
 */
export function Sparkline({
  points,
  seriesKey,
  label,
  periodLabel,
  formatValue,
  locale = 'da',
  height = 40,
  className = '',
}: {
  points: SparklinePoint[]
  /** The entity the series belongs to. Fixes the colour; never the index. */
  seriesKey: string
  /** What the series is, in words. Used to build the accessible summary. */
  label: string
  periodLabel?: string
  formatValue: (value: number) => string
  locale?: Locale
  height?: number
  className?: string
}) {
  const t = translations[locale].dataDisplay
  const geometry = sparklineGeometry(
    points.map((p) => p.value),
    VIEW_W,
    VIEW_H,
  )
  if (!geometry) return null

  const color = seriesColor(seriesKey)
  const single = geometry.points.length === 1
  const direction = single ? 'flat' : directionOf(geometry.change)
  const directionWord =
    direction === 'up' ? t.rising : direction === 'down' ? t.falling : t.flat

  const summaryParts = [
    label,
    periodLabel,
    directionWord,
    `${t.currentValue} ${formatValue(geometry.current)}`,
    `${points.length} ${points.length === 1 ? t.observation : t.observations}`,
  ].filter(Boolean)
  const summary = summaryParts.join(' · ')

  const path = geometry.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  return (
    <figure className={`m-0 flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="relative min-w-0" style={{ height }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
          className="block"
        >
          {!single && (
            <polyline
              points={path}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Positioned in CSS, not in the stretched viewBox, so it stays round. */}
        <span
          aria-hidden="true"
          className="absolute block rounded-full"
          style={{
            left: '100%',
            top: `${geometry.lastYPercent}%`,
            transform: 'translate(-100%, -50%)',
            width: 6,
            height: 6,
            background: color,
          }}
        />
      </div>
      <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: directionTone(direction) }}
        >
          <span aria-hidden="true">{DIRECTION_GLYPH[direction]} </span>
          {formatValue(geometry.current)}
        </span>
        {periodLabel && (
          <span className="font-mono text-[10px] text-ink-muted">{periodLabel}</span>
        )}
        <span className="font-mono text-[10px] text-ink-muted tabular-nums">
          n={points.length}
        </span>
      </figcaption>
    </figure>
  )
}
