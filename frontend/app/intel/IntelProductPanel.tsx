'use client'

import { ChartFrame, DataLegend, NoDataState, Sparkline } from '@/components/data-display'
import { formatCount, formatDateRange, formatDkk, formatSignedDkk } from '@/lib/chart-format'
import { seriesColor } from '@/lib/chart-palette'
import { bestSpread, isThinEvidence, spreadRoute } from './overview'
import { MARKETS, type IntelListing, type IntelProduct, type Market, type MarketStats } from './types'

const DKK = (value: number | null) => formatDkk(value, 'da-DK')

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'dba.dk': { bg: '#00098A', fg: '#ffffff', label: 'DBA' },
  kleinanzeigen: { bg: '#1D4B00', fg: '#ffffff', label: 'KA' },
  blocket: { bg: '#F71414', fg: '#ffffff', label: 'BLOCKET' },
  finn: { bg: '#06bffc', fg: '#000000', label: 'FINN' },
  reverb: { bg: '#EC5A2C', fg: '#ffffff', label: 'REVERB' },
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-4">
      <h3 className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </h3>
      {children}
    </div>
  )
}

function PriceBand({
  market,
  stats,
  xMin,
  xRange,
}: {
  market: Market
  stats: MarketStats
  xMin: number
  xRange: number
}) {
  if (stats.count === 0 || stats.min == null || stats.max == null) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-[10px] text-ink-muted">{market}</span>
        <NoDataState reason="no-observations" locale="en" variant="inline" />
      </div>
    )
  }

  const pct = (v: number) => ((v - xMin) / xRange) * 100
  const minPct = pct(stats.min)
  const maxPct = pct(stats.max)
  const p25Pct = stats.p25 != null ? pct(stats.p25) : minPct
  const p75Pct = stats.p75 != null ? pct(stats.p75) : maxPct
  const medPct = stats.median != null ? pct(stats.median) : (minPct + maxPct) / 2
  const color = seriesColor(market)

  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0 font-mono text-[10px] text-ink">{market}</span>
      <div className="relative h-[18px] min-w-0 flex-1">
        <span
          aria-hidden="true"
          className="absolute top-1/2 block h-px -translate-y-1/2"
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%`, background: color, opacity: 0.6 }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1 block h-[10px] rounded-[1px]"
          style={{ left: `${p25Pct}%`, right: `${100 - p75Pct}%`, background: color, opacity: 0.5 }}
        />
        <span
          aria-hidden="true"
          className="absolute top-0 block h-[18px] w-[2px]"
          style={{ left: `calc(${medPct}% - 1px)`, background: color }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ink tabular-nums">
        {DKK(stats.median)}
      </span>
      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-muted tabular-nums">
        n={stats.count}
      </span>
    </div>
  )
}

function ListingRow({ listing }: { listing: IntelListing }) {
  const badge = SOURCE_BADGE[listing.source] ?? {
    bg: 'var(--surface-3)',
    fg: 'var(--text-primary)',
    label: listing.source.toUpperCase(),
  }
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 border-b border-line py-1.5 no-underline"
    >
      <span
        className="min-w-[48px] shrink-0 rounded-[2px] px-1 py-0.5 text-center font-mono text-[8px] font-bold tracking-[0.05em]"
        style={{ background: badge.bg, color: badge.fg }}
      >
        {badge.label}
      </span>
      <span className="w-[60px] shrink-0 text-right font-mono text-[11px] text-ink tabular-nums">
        {DKK(listing.price_dkk)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-muted">
        {listing.country} · {listing.location ?? '—'}
      </span>
      <span aria-hidden="true" className="shrink-0 font-mono text-[11px] text-ink">
        ↗
      </span>
    </a>
  )
}

/**
 * Detail for one followed product.
 *
 * The trend slot used to hold a hand-written array of bar heights labelled
 * "coming soon". That is a fabricated series, so it is gone: either there are
 * real dated observations or there is a NoDataState saying which kind of
 * absence this is.
 */
export function IntelProductPanel({
  product,
  onClose,
}: {
  product: IntelProduct | null
  onClose: () => void
}) {
  if (!product) {
    return (
      <aside className="w-full shrink-0 border-t border-line bg-surface-1 p-6 xl:w-[22rem] xl:border-l xl:border-t-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
          Select a product for detail
        </p>
      </aside>
    )
  }

  const bounds: number[] = []
  for (const market of MARKETS) {
    const stats = product.markets[market]
    if (stats.min != null) bounds.push(stats.min)
    if (stats.max != null) bounds.push(stats.max)
  }
  const xMin = bounds.length > 0 ? Math.min(...bounds) : 0
  const xMax = bounds.length > 0 ? Math.max(...bounds) : 1
  const xRange = Math.max(xMax - xMin, 1)

  const spread = bestSpread(product)
  const route = spread ? spreadRoute(spread) : null
  const trend = product.trend

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-line bg-surface-1 xl:w-[22rem] xl:border-l xl:border-t-0">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold leading-snug text-ink">{product.canonical_name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="shrink-0 px-1 font-mono text-[14px] text-ink-muted hover:text-ink"
        >
          ×
        </button>
      </div>

      <Section label="Route">
        {spread && route ? (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] leading-snug text-ink">
              Buy {route.buyIn} → sell {route.sellIn}
            </p>
            <p className="font-mono text-[12px] text-ink-secondary tabular-nums">
              {formatSignedDkk(spread.amount, 'da-DK')} kr · DK n={spread.dkCount} ·{' '}
              {spread.market} n={spread.otherCount}
            </p>
            <p className="text-[11px] leading-snug text-ink-muted">
              Observed difference between median asking prices. Asking, not sold. Excludes
              shipping, fees, VAT, condition differences and whether either side would trade.
              {isThinEvidence(spread) && ' Only one listing supports a side of this comparison.'}
            </p>
          </div>
        ) : (
          <NoDataState
            reason={product.markets.DK.count === 0 ? 'no-observations' : 'insufficient-observations'}
            locale="en"
            detail={
              product.markets.DK.count === 0
                ? 'No DK listing, so there is no route to price against.'
                : 'DK has listings but no second market does, so no pair can be compared.'
            }
          />
        )}
      </Section>

      <Section label="Price bands">
        <div className="flex flex-col gap-2.5">
          {MARKETS.map((market) => (
            <PriceBand
              key={market}
              market={market}
              stats={product.markets[market]}
              xMin={xMin}
              xRange={xRange}
            />
          ))}
        </div>
      </Section>

      <div className="border-b border-line px-4 py-4">
        <ChartFrame
          title="Price history"
          description="The only dated per-product price series Klup holds."
          locale="en"
          headingLevel="h3"
          className="!border-0 !bg-transparent !p-0"
          state={trend ? 'ready' : 'empty'}
          emptyReason="source-unavailable"
          emptyDetail="market_price_daily — the layer-3 aggregate that is the correct basis for a historical market level — holds no rows, and this product has no Reverb sold comps either."
          legend={
            trend ? (
              <DataLegend
                items={[
                  {
                    key: trend.market,
                    label: `${trend.source} ${trend.priceType} · ${trend.market}`,
                    count: trend.points.length,
                  },
                ]}
              />
            ) : undefined
          }
          source={trend ? 'reverb_price_history · sold comps · DKK' : undefined}
          period={
            trend
              ? formatDateRange(
                  trend.points[0]?.at,
                  trend.points[trend.points.length - 1]?.at,
                  'en-GB',
                ) ?? undefined
              : undefined
          }
          sample={trend ? `${formatCount(trend.points.length, 'da-DK')} sold comps` : undefined}
        >
          {trend && (
            <Sparkline
              points={trend.points.map((p) => ({ at: p.at, value: p.price_dkk }))}
              seriesKey={trend.market}
              label={`Reverb sold comps, ${trend.market}`}
              periodLabel={
                formatDateRange(
                  trend.points[0]?.at,
                  trend.points[trend.points.length - 1]?.at,
                  'en-GB',
                ) ?? undefined
              }
              formatValue={(v) => `${DKK(v)} kr`}
              locale="en"
              height={44}
            />
          )}
        </ChartFrame>
        {trend && (
          <p className="mt-2 text-[11px] leading-snug text-ink-muted">
            Sold comps from one marketplace, not a DK market level. Points are ordered, not evenly
            spaced in time.
          </p>
        )}
      </div>

      <Section label={`Active listings · ${product.listings.length}`}>
        {product.listings.length === 0 ? (
          <NoDataState reason="no-observations" locale="en" variant="inline" />
        ) : (
          <div>
            {product.listings.slice(0, 10).map((listing) => (
              <ListingRow key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </Section>
    </aside>
  )
}
