'use client'

/**
 * The price answer — one block per population, never a blended number.
 *
 * Product-owner decision C2, 2026-09-01. The Danish market is the primary,
 * user-facing population and is shown even when it is thin, because a thin
 * Danish market is information rather than a defect to paper over with an
 * international aggregate. Reverb sold and Reverb asking appear only as
 * clearly separate reference blocks, and only when their own `n >= 8` gate
 * holds.
 *
 * Every number here carries the population it came from and its `n`. The
 * component cannot mix markets: it receives already-separated `PopulationStats`
 * and renders one block per key.
 *
 * `PopulationStats` is redacted upstream — a median that may not be shown
 * arrives as `null` — so this file does not re-implement the display ladder.
 */

import { useLocale } from '@/components/LocaleProvider'
import type { PopulationStats } from '@/lib/price-populations'

function kr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('da-DK')} kr`
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

function Headline({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="type-label">{label}</p>
      <p className="text-[clamp(1.75rem,1.2rem+2.2vw,2.5rem)] font-semibold tracking-tight text-foreground tabular-nums wrap-anywhere">
        {kr(value)}
      </p>
    </div>
  )
}

/** The Danish market. Always rendered, at whatever tier the data supports. */
export function DanishMarketBlock({ stats }: { stats: PopulationStats }) {
  const { t } = useLocale()

  if (stats.tier === 'unavailable') {
    return (
      <div className="flex flex-col gap-1">
        <p className="type-label">{t.dkMarketHeading}</p>
        <p className="type-body-secondary">{t.priceDataUnavailable}</p>
      </div>
    )
  }

  if (stats.tier === 'none') {
    return (
      <div className="flex flex-col gap-1">
        <p className="type-label">{t.dkMarketHeading}</p>
        <p className="type-body-secondary">{t.dkMarketNone}</p>
      </div>
    )
  }

  const countLine = fill(
    stats.nFiltered === 1 ? t.dkMarketCount : t.dkMarketCountPlural,
    { count: stats.nFiltered },
  )

  if (stats.tier === 'listings-only') {
    return (
      <div className="flex flex-col gap-1">
        <p className="type-label">{t.dkMarketHeading}</p>
        <p className="type-body">{countLine}</p>
        <p className="type-meta">{t.dkMarketThinNote}</p>
      </div>
    )
  }

  if (stats.tier === 'median-only') {
    return (
      <div className="flex flex-col gap-1">
        <Headline
          label={t.dkMarketHeading}
          value={stats.median}
        />
        <p className="type-meta">
          {fill(t.dkMarketMedianDescriptive, { count: stats.nFiltered })}
        </p>
        <p className="type-meta">{t.dkMarketThinNote}</p>
      </div>
    )
  }

  // tier === 'band'
  return (
    <div className="flex flex-col gap-1">
      <Headline label={t.dkMarketTypical} value={stats.median} />
      {stats.q1 != null && stats.q3 != null ? (
        <p className="type-body-secondary tabular-nums">
          {kr(stats.q1)} <span className="text-muted-foreground">–</span> {kr(stats.q3)}
          <span className="type-meta ml-2">{t.priceBandRange}</span>
        </p>
      ) : (
        <p className="type-meta">{t.priceBandTooWide}</p>
      )}
      {stats.low != null && stats.high != null && (
        <p className="type-meta tabular-nums">
          {fill(t.fullRange, {
            low: Math.round(stats.low).toLocaleString('da-DK'),
            high: Math.round(stats.high).toLocaleString('da-DK'),
          })}
        </p>
      )}
      <p className="type-meta">
        {fill(stats.nFiltered === 1 ? t.reviewedBasis : t.reviewedBasisPlural, { count: stats.nFiltered })}
      </p>
    </div>
  )
}

/**
 * A reference population. Rendered only at `tier === 'band'`, so a thin Reverb
 * sample never appears as a second opinion the user cannot weigh.
 */
export function ReferencePopulationBlock({
  stats,
  heading,
  note,
}: {
  stats: PopulationStats
  heading: string
  note?: string
}) {
  const { t } = useLocale()
  if (stats.tier !== 'band' || stats.median == null) return null

  return (
    <div className="surface-nested rounded-xl p-4 flex flex-col gap-1">
      <p className="type-label">{heading}</p>
      <p className="text-lg font-semibold text-foreground tabular-nums">{kr(stats.median)}</p>
      {stats.q1 != null && stats.q3 != null ? (
        <p className="type-meta tabular-nums">
          {kr(stats.q1)} – {kr(stats.q3)} · {t.priceBandRange}
        </p>
      ) : (
        <p className="type-meta">{t.priceBandTooWide}</p>
      )}
      <p className="type-meta">{fill(t.populationReviewedBasis, { count: stats.nFiltered })}</p>
      {note && <p className="type-meta">{note}</p>}
    </div>
  )
}
