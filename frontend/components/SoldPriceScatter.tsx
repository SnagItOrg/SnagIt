'use client'

import { ResponsiveContainer, ScatterChart, Scatter, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import { formatDkkAmount } from '@/lib/chart-format'
import { seriesColor } from '@/lib/chart-palette'
import type { Locale } from '@/lib/i18n'

export type SoldPoint = { ts: number; price: number; condition: string }

type Props = {
  /** One series per Reverb condition, most populous first; the key is the raw condition. */
  series: Array<[string, SoldPoint[]]>
  /** Distinct sale instants, so a time-scaled axis never emits two ticks for one key (PAN-242). */
  xTicks: number[]
  /** `niceTicks` over the plotted prices; the domain is pinned to its ends. */
  yTicks: number[]
  conditionLabel: (raw: string) => string
  locale: Locale
}

/**
 * The sold-price scatter of the product page, in its own module.
 *
 * PAN-263: recharts is 105 kB gzipped — a quarter of the product page's
 * 419 kB of JavaScript — and it was in the chunk the page needs before it can
 * hydrate. The page now loads this component with `next/dynamic`, so the
 * chart's code arrives after the price answer and the wall are interactive.
 * The markup is the page's as it was; only the home of the code moved.
 */
export function SoldPriceScatter({ series, xTicks, yTicks, conditionLabel, locale }: Props) {
  return (
    <div className="h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
          {/* A real time domain, not a category index. */}
          <XAxis
            type="number"
            dataKey="ts"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-subtle)' }}
            tickFormatter={(v: number) =>
              new Date(v).toLocaleDateString('da-DK', { month: 'short', year: '2-digit' })
            }
            ticks={xTicks.length > 0 ? xTicks : undefined}
            minTickGap={28}
          />
          {/* Kroner, visible — the unit rides on every tick (PAN-168 #5), not
              on a caption under the plot. */}
          <YAxis
            type="number"
            dataKey="price"
            domain={yTicks.length > 1 ? [yTicks[0], yTicks[yTicks.length - 1]] : ['auto', 'auto']}
            ticks={yTicks.length > 1 ? yTicks : undefined}
            width={84}
            tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) =>
              formatDkkAmount(v, locale === 'en' ? 'en-GB' : 'da-DK') ?? ''
            }
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '2 4' }}
            contentStyle={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            formatter={(v: unknown, name: unknown) => [
              formatDkkAmount(Number(v)) ?? '—',
              String(name),
            ]}
            labelFormatter={(l: unknown) =>
              new Date(Number(l)).toLocaleDateString('da-DK', {
                day: 'numeric', month: 'short', year: 'numeric',
              })
            }
          />
          {series.map(([name, list]) => (
            <Scatter
              key={name}
              name={conditionLabel(name)}
              data={list}
              fill={seriesColor(name)}
              fillOpacity={0.75}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
