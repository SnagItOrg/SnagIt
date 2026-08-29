'use client'

import { seriesColor, seriesShape, type ChartSeriesShape } from '@/lib/chart-palette'

export type LegendItem = {
  /** The ENTITY key — this is what fixes the colour. Never a display index. */
  key: string
  label: string
  /** Sample size for this series, when the series is evidence rather than a category. */
  count?: number
}

function Swatch({ shape, color }: { shape: ChartSeriesShape; color: string }) {
  // Shape is the redundant channel: the legend still separates two series
  // printed in monochrome, or read by someone who cannot tell the hues apart.
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
      {shape === 'circle' && <circle cx="5" cy="5" r="4.5" fill={color} />}
      {shape === 'square' && <rect x="0.5" y="0.5" width="9" height="9" fill={color} />}
      {shape === 'triangle' && <path d="M5 0.5 L9.5 9.5 L0.5 9.5 Z" fill={color} />}
      {shape === 'diamond' && <path d="M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z" fill={color} />}
    </svg>
  )
}

/**
 * Compact legend. Wraps rather than scrolls, so it cannot create horizontal
 * overflow at 320px.
 */
export function DataLegend({
  items,
  className = '',
}: {
  items: LegendItem[]
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <ul className={`flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0 ${className}`}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <Swatch shape={seriesShape(item.key)} color={seriesColor(item.key)} />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary">
            {item.label}
          </span>
          {item.count != null && (
            <span className="font-mono text-[11px] text-ink-muted tabular-nums">
              {item.count}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
