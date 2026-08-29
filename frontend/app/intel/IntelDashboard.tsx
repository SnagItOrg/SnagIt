'use client'

import { useMemo, useState } from 'react'
import { MetricTile, NoDataState } from '@/components/data-display'
import { formatCount, formatPercent, formatSignedDkk } from '@/lib/chart-format'
import { directionOf } from '@/lib/chart-palette'
import { IntelOverviewTable } from './IntelOverviewTable'
import { IntelProductPanel } from './IntelProductPanel'
import {
  DEFAULT_FILTERS,
  coverage,
  filterProducts,
  isThinEvidence,
  largestSpread,
  marketsWithData,
  sortProducts,
  spreadRoute,
  type IntelFilters,
  type SortKey,
} from './overview'
import { MARKETS, type IntelData, type IntelProduct, type Market } from './types'

/* ── controls ───────────────────────────────────────────────────────────── */

const CONTROL =
  'rounded-md border border-line bg-surface-1 px-2 py-1.5 font-mono text-[11px] text-ink'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

/**
 * Only filters that change the result set.
 *
 * Four controls are gone rather than restyled. "Legendary Only" matched every
 * row — the loader selects `tier = 'legendary'`, so the filter was a no-op on
 * a constant. "Has DE Data" is now the general market filter. There is no date
 * filter: the only date the loader carries is `listings.scraped_at`, which is
 * when a listing was last SEEN, and 43k of ~44k active rows carry the last two
 * days. Filtering on it would look like a period control and select nothing.
 */
function FilterBar({
  filters,
  onFilters,
  sort,
  onSort,
}: {
  filters: IntelFilters
  onFilters: (next: IntelFilters) => void
  sort: SortKey
  onSort: (next: SortKey) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3 md:px-6">
      <Field label="Market">
        <select
          className={CONTROL}
          value={filters.market}
          onChange={(e) => onFilters({ ...filters, market: e.target.value as Market | 'all' })}
        >
          <option value="all">All markets</option>
          {MARKETS.map((market) => (
            <option key={market} value={market}>
              Has {market} data
            </option>
          ))}
        </select>
      </Field>

      <Field label="Availability">
        <select
          className={CONTROL}
          value={filters.availability}
          onChange={(e) =>
            onFilters({ ...filters, availability: e.target.value as IntelFilters['availability'] })
          }
        >
          <option value="all">All products</option>
          <option value="with_data">With observations</option>
          <option value="without_data">Without observations</option>
        </select>
      </Field>

      <Field label="Min spread">
        <select
          className={CONTROL}
          value={String(filters.minSpread)}
          onChange={(e) => onFilters({ ...filters, minSpread: Number(e.target.value) })}
        >
          <option value="0">Any</option>
          <option value="5000">≥ 5.000 DKK</option>
          <option value="10000">≥ 10.000 DKK</option>
          <option value="20000">≥ 20.000 DKK</option>
        </select>
      </Field>

      <Field label="Sort">
        <select
          className={CONTROL}
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
        >
          <option value="spread">Widest spread</option>
          <option value="name">Alphabetical</option>
        </select>
      </Field>

      <button
        type="button"
        onClick={() => onFilters(DEFAULT_FILTERS)}
        className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-secondary hover:text-ink"
      >
        Reset
      </button>
    </div>
  )
}

/* ── summary ────────────────────────────────────────────────────────────── */

function SummaryRow({ products }: { products: IntelProduct[] }) {
  const cover = coverage(products)
  const covered = marketsWithData(products)
  const widest = largestSpread(products)
  const route = widest ? spreadRoute(widest.spread) : null

  return (
    <div className="grid-fluid-sm gap-3 px-4 py-4 md:px-6">
      <MetricTile
        label="Followed products"
        value={formatCount(products.length, 'da-DK')}
        context="Legendary tier, active status"
      />

      <MetricTile
        label="Markets with data"
        value={`${covered.length} / ${MARKETS.length}`}
        context={covered.length > 0 ? covered.join(' · ') : 'None'}
        help="A market counts once any followed product carries a usable listing price there."
      />

      <MetricTile
        label="Cell coverage"
        value={formatPercent(cover.ratio, 'da-DK') ?? '—'}
        context={`${formatCount(cover.populated, 'da-DK')} of ${formatCount(cover.possible, 'da-DK')} cells`}
        help={`Populated ÷ possible product/market cells: ${products.length} followed products × ${MARKETS.length} tracked markets. A cell is populated when it holds at least one usable listing price.`}
      />

      {widest && route ? (
        <MetricTile
          label="Largest observed spread"
          value={`${formatSignedDkk(Math.abs(widest.spread.amount), 'da-DK')?.replace('+', '') ?? '—'} kr`}
          trend={{
            direction: directionOf(widest.spread.amount),
            label: `Buy ${route.buyIn} → sell ${route.sellIn}`,
          }}
          context={`${widest.product.canonical_name} · DK n=${widest.spread.dkCount} · ${widest.spread.market} n=${widest.spread.otherCount}`}
          help={
            isThinEvidence(widest.spread)
              ? 'Observed difference between median asking prices — and only one listing supports a side of it. Asking, not sold. Excludes shipping, fees, VAT, condition and whether either side would trade.'
              : 'Observed difference between median asking prices. Asking, not sold. Excludes shipping, fees, VAT, condition differences and whether either side would trade.'
          }
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface-1 px-4 py-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            Largest observed spread
          </p>
          <NoDataState
            reason="insufficient-observations"
            locale="en"
            detail="No followed product carries observations on DK and a second market at the same time."
          />
        </div>
      )}
    </div>
  )
}

/* ── followed-product navigation ────────────────────────────────────────── */

/**
 * The `LGDY` badge is gone. Every row the loader returns is
 * `tier = 'legendary'`, so the badge was printed 28 times to say nothing. Tier
 * returns to this list the day the followed set contains more than one.
 */
function FollowedSidebar({
  products,
  selectedId,
  onSelect,
}: {
  products: IntelProduct[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <nav
      aria-label="Followed products"
      className="hidden w-[13rem] shrink-0 flex-col border-r border-line xl:flex"
    >
      <p className="border-b border-line px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        Followed · {products.length}
      </p>
      <ul className="m-0 max-h-[calc(100vh-9rem)] list-none overflow-y-auto p-0">
        {products.map((product) => {
          const active = product.id === selectedId
          return (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onSelect(product.id)}
                aria-current={active ? 'true' : undefined}
                className={`w-full border-b border-line px-2.5 py-2 text-left text-[12px] leading-snug ${
                  active ? 'bg-surface-2 text-ink' : 'text-ink-secondary hover:text-ink'
                }`}
                style={{ borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}` }}
              >
                {product.canonical_name}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Below the sidebar breakpoint the same navigation collapses to one control. */
function FollowedSelect({
  products,
  selectedId,
  onSelect,
}: {
  products: IntelProduct[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="border-b border-line px-4 py-3 md:px-6 xl:hidden">
      <Field label={`Followed · ${products.length}`}>
        <select
          className={`${CONTROL} w-full max-w-full`}
          value={selectedId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">Select a product for detail…</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.canonical_name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

/* ── shell ──────────────────────────────────────────────────────────────── */

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * The Intel Overview.
 *
 * `dark` is pinned on the root: this is an operator surface that is dark-only
 * by design, and it must not follow the visitor's theme preference. Everything
 * below reads the same semantic tokens as the public product, so the shared
 * primitives behave identically here and on a light public page.
 *
 * The old shell was `position: fixed; inset: 0; overflow: hidden`, which hid
 * every overflow bug rather than fixing one. The document scrolls normally now
 * and the only clipped box is the table's own scroll container.
 */
export function IntelDashboard({ data }: { data: IntelData }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<IntelFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>('spread')

  const selected = useMemo(
    () => data.products.find((p) => p.id === selectedId) ?? null,
    [selectedId, data.products],
  )

  const rows = useMemo(
    () => sortProducts(filterProducts(data.products, filters), sort),
    [data.products, filters, sort],
  )

  const renderedAt = useMemo(
    () =>
      new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [],
  )

  return (
    <div className="dark flex min-h-screen flex-col bg-canvas text-ink">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface-1 px-4 py-3 md:px-6">
        <span className="font-mono text-[13px] font-bold tracking-[0.14em] text-ink">
          KLUP INTEL
        </span>
        <span
          className="font-mono text-[11px] tracking-[0.1em] text-ink"
          style={{ borderBottom: '2px solid var(--accent)' }}
        >
          OVERVIEW
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <FollowedSidebar
          products={data.products}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-4 md:px-6">
            <h1 className="m-0 text-[1.25rem] font-semibold tracking-tight text-ink">
              Intel Overview
            </h1>
            <p className="m-0 font-mono text-[11px] text-ink-muted">
              Rendered {renderedAt} · last scrape {fmtDateTime(data.lastScrape)}
            </p>
          </div>

          <SummaryRow products={data.products} />
          <FollowedSelect
            products={data.products}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id === '' ? null : id)}
          />
          <FilterBar filters={filters} onFilters={setFilters} sort={sort} onSort={setSort} />

          <IntelOverviewTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} />

          <p className="px-4 py-4 text-[11px] leading-relaxed text-ink-muted md:px-6">
            Medians are of active asking prices per market, not sales. Counts are the listings each
            median rests on. Spreads are observed differences, not realisable margin.
          </p>
        </main>

        <IntelProductPanel product={selected} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  )
}
