'use client'

import { DivergingBar, NoDataState } from '@/components/data-display'
import { formatDkk, formatSignedDkk } from '@/lib/chart-format'
import {
  bestSpread,
  isThinEvidence,
  partitionByEvidence,
  spreadRoute,
  spreadScale,
  type Spread,
} from './overview'
import { MARKETS, type IntelProduct, type Market, type MarketStats } from './types'

const DKK = (value: number | null) => formatDkk(value, 'da-DK')
const SIGNED = (value: number) => formatSignedDkk(value, 'da-DK')

/**
 * The route, in words.
 *
 * This is the sentence the whole spread column exists to produce. A signed
 * delta and a hue tell an operator that two markets differ; only this tells
 * them which one to buy in.
 */
function routeLabel(spread: Spread): string | null {
  const route = spreadRoute(spread)
  if (!route) return null
  return `Buy ${route.buyIn} → sell ${route.sellIn}`
}

function MarketCell({ stats }: { stats: MarketStats }) {
  if (stats.count === 0 || stats.median == null) {
    return (
      <td className="px-3 py-3 text-right align-middle">
        <NoDataState reason="no-observations" locale="en" variant="inline" />
      </td>
    )
  }
  return (
    <td className="px-3 py-3 text-right align-middle">
      {/* Two tiers, always: the level, and the evidence under it. */}
      <div className="font-mono text-[12px] text-ink tabular-nums">{DKK(stats.median)}</div>
      <div className="font-mono text-[10px] text-ink-muted tabular-nums">n={stats.count}</div>
    </td>
  )
}

function SpreadCell({ product, scale }: { product: IntelProduct; scale: number }) {
  const spread = bestSpread(product)

  if (!spread) {
    const dkCount = product.markets.DK.count
    return (
      <td className="px-3 py-3 align-middle">
        <NoDataState
          reason={dkCount === 0 ? 'no-observations' : 'insufficient-observations'}
          locale="en"
          variant="inline"
        />
      </td>
    )
  }

  return (
    <td className="px-3 py-3 align-middle">
      <DivergingBar
        value={spread.amount}
        max={scale}
        routeLabel={routeLabel(spread)}
        originLabel="DK"
        destinationLabel={spread.market}
        originCount={spread.dkCount}
        destinationCount={spread.otherCount}
        formatSigned={SIGNED}
        locale="en"
      />
      {isThinEvidence(spread) && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
          thin evidence · one listing on a side
        </p>
      )}
    </td>
  )
}

function ProductRow({
  product,
  scale,
  selected,
  onSelect,
  subordinate,
}: {
  product: IntelProduct
  scale: number
  selected: boolean
  onSelect: (id: string) => void
  subordinate?: boolean
}) {
  return (
    <tr className={selected ? 'bg-surface-2' : undefined}>
      <th scope="row" className="px-3 py-3 text-left align-middle font-normal">
        <button
          type="button"
          onClick={() => onSelect(product.id)}
          aria-pressed={selected}
          className={`w-full text-left text-[13px] leading-snug hover:underline ${
            subordinate ? 'text-ink-secondary' : 'text-ink'
          }`}
        >
          {product.canonical_name}
        </button>
      </th>
      {subordinate ? (
        <td className="px-3 py-3 align-middle">
          <NoDataState reason="no-observations" locale="en" variant="inline" />
        </td>
      ) : (
        <SpreadCell product={product} scale={scale} />
      )}
      {MARKETS.map((market: Market) => (
        <MarketCell key={market} stats={product.markets[market]} />
      ))}
    </tr>
  )
}

/**
 * The market table.
 *
 * Semantic `<table>`, not a grid of buttons: the header cells label the
 * columns for a screen reader, and the product name is the row header. The
 * table has a real minimum width and scrolls INSIDE its own container, so a
 * 320px viewport scrolls the table rather than the document.
 */
export function IntelOverviewTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: IntelProduct[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { covered, uncovered } = partitionByEvidence(rows)
  // The bar scale comes from the rows on screen, so filtering rescales the
  // comparison rather than leaving every bar pinned to an absent outlier.
  const scale = spreadScale(covered)

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 md:px-6">
        <NoDataState
          reason="no-observations"
          locale="en"
          detail="No followed product matches the current filters."
        />
      </div>
    )
  }

  return (
    <div className="w-full max-w-full overflow-x-auto">
      <table className="w-full min-w-[54rem] border-collapse">
        <caption className="sr-only">
          Followed products by market. Median asking price and observation count per market, with
          the widest DK-anchored spread and its route.
        </caption>
        <thead>
          <tr className="sticky top-0 z-10 bg-canvas">
            <th
              scope="col"
              className="border-b border-line px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
            >
              Product
            </th>
            <th
              scope="col"
              className="border-b border-line px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
            >
              Widest spread · route
            </th>
            {MARKETS.map((market) => (
              <th
                key={market}
                scope="col"
                className="border-b border-line px-3 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
              >
                {market}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-line">
          {covered.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              scale={scale}
              selected={product.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </tbody>

        {uncovered.length > 0 && (
          <tbody className="divide-y divide-line">
            {/* Subordinate, but present and still selectable — a followed
                product with no evidence is a monitoring gap, which is itself
                something an operator needs to see. */}
            <tr>
              <th
                scope="colgroup"
                colSpan={2 + MARKETS.length}
                className="border-t border-line bg-surface-1 px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
              >
                No usable evidence · {uncovered.length} followed
              </th>
            </tr>
            {uncovered.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                scale={scale}
                selected={product.id === selectedId}
                onSelect={onSelect}
                subordinate
              />
            ))}
          </tbody>
        )}
      </table>
    </div>
  )
}
