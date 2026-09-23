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
import { fill } from '@/lib/i18n'
import { EmptyState } from '@/components/EmptyState'
import type { PopulationStats } from '@/lib/price-populations'

function kr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('da-DK')} kr`
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

/**
 * The Danish market. Always rendered, at whatever tier the data supports.
 *
 * `awaitingReview` counts the Danish listings on the wall that are not yet
 * adjudicated, and it changes nothing but the `none` branch. An empty
 * statistical population has two causes a reader must not have conflated:
 * there is nothing to show, or there is something and Klup has not reviewed it
 * yet. The second is the state most of the published catalogue is in, and
 * saying "no Danish listings" above a wall of Danish listings is false. PAN-93.
 */
export function DanishMarketBlock({
  stats,
  awaitingReview = 0,
  askingPrices = [],
}: {
  stats: PopulationStats
  awaitingReview?: number
  /**
   * The adjudicated Danish asking prices themselves, ascending — PAN-119.
   *
   * Used ONLY by the `listings-only` tier, where there is no statistic to
   * show but there is still a real price the visitor came for. These are
   * observations, never a statistic: the block renders them verbatim and
   * derives nothing from them, so no median or range can appear below
   * `MIN_DESCRIPTIVE_MEDIAN_N` by way of this prop.
   */
  askingPrices?: readonly number[]
}) {
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
    // PAN-93. Both branches are empty; only one of them is a failure. An
    // unreviewed wall means Klup IS watching and has not finished looking, so
    // it renders as `monitoring` — an open eye at full ink — while a genuinely
    // empty Danish market renders as `blank`. Before EmptyState the two were
    // the same muted sentence and a visitor could not tell them apart.
    return (
      <div className="flex flex-col gap-1">
        <p className="type-label">{t.dkMarketHeading}</p>
        <EmptyState
          kind={awaitingReview > 0 ? 'monitoring' : 'blank'}
          layout="inline"
          title={awaitingReview > 0 ? t.dkMarketAwaitingReview : t.dkMarketNone}
        />
      </div>
    )
  }

  const countLine = fill(
    stats.nFiltered === 1 ? t.dkMarketCount : t.dkMarketCountPlural,
    { count: stats.nFiltered },
  )

  if (stats.tier === 'listings-only') {
    /**
     * PAN-119. The local price is the one the visitor is most interested in,
     * so at this tier it is the headline — as the OBSERVED prices, not as a
     * statistic derived from them. Previously this branch described the
     * listings in prose while the international median rendered in bold
     * beside it, which made the only number on the page the foreign one.
     *
     * Falls back to the old count-only form when the prices are unavailable,
     * so a caller that does not pass them still renders something true.
     */
    const observed = askingPrices.filter((p) => Number.isFinite(p) && p > 0)
    if (observed.length === 0) {
      return (
        <div className="flex flex-col gap-1">
          <p className="type-label">{t.dkMarketHeading}</p>
          <p className="type-body">{countLine}</p>
          <p className="type-meta">{t.dkMarketThinNote}</p>
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-1">
        <p className="type-label">{t.dkMarketAskingNow}</p>
        <p className="text-[clamp(1.75rem,1.2rem+2.2vw,2.5rem)] font-semibold tracking-tight text-foreground tabular-nums wrap-anywhere">
          {observed.map((p) => kr(p)).join(' · ')}
        </p>
        <p className="type-meta">
          {observed.length === 1 ? t.dkMarketAskingNowNote : t.dkMarketAskingNowNotePlural}
        </p>
        <p className="type-meta">{countLine}</p>
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
