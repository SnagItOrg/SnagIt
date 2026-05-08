'use client'

import { useMemo, useState } from 'react'
import {
  MARKETS,
  type IntelData,
  type IntelListing,
  type IntelProduct,
  type Market,
  type MarketStats,
} from './types'

type Filter = 'all' | 'legendary' | 'has_de' | 'delta_10k'

const COLORS = {
  bg: '#0a0a0a',
  surface: '#111111',
  border: '#1f1f1f',
  text: '#f5f5f5',
  muted: '#707070',
  label: '#8a8a8a',
  accent: '#13ec6d',
  negative: '#ef4444',
  yellow: '#f5c542',
}

const MONO = 'ui-monospace, Menlo, Monaco, Consolas, monospace'
const SANS = 'Inter, ui-sans-serif, system-ui, sans-serif'

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'dba.dk':         { bg: '#00098A', fg: '#ffffff', label: 'DBA' },
  'kleinanzeigen':  { bg: '#1D4B00', fg: '#ffffff', label: 'KA' },
  'blocket':        { bg: '#F71414', fg: '#ffffff', label: 'BLOCKET' },
  'finn':           { bg: '#06bffc', fg: '#000000', label: 'FINN' },
  'reverb':         { bg: '#EC5A2C', fg: '#ffffff', label: 'REVERB' },
}

function fmtDkk(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('da-DK').format(Math.round(n))
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function flagFor(country: string): string {
  const code = country.toUpperCase()
  if (code.length !== 2) return ''
  return (
    String.fromCodePoint(0x1f1e6 - 65 + code.charCodeAt(0)) +
    String.fromCodePoint(0x1f1e6 - 65 + code.charCodeAt(1))
  )
}

export function IntelDashboard({ data }: { data: IntelData }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const selected = useMemo(
    () => data.products.find((p) => p.id === selectedId) ?? null,
    [selectedId, data.products],
  )

  const filtered = useMemo(() => {
    switch (filter) {
      case 'has_de':
        return data.products.filter((p) => p.markets.DE.count > 0)
      case 'delta_10k':
        return data.products.filter(
          (p) => p.delta_dk_de != null && Math.abs(p.delta_dk_de) > 10000,
        )
      default:
        return data.products
    }
  }, [data.products, filter])

  const renderedAt = useMemo(() => fmtTime(new Date().toISOString()), [])

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: SANS,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftSidebar
          products={data.products}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <MainPanel
          data={data}
          rows={filtered}
          renderedAt={renderedAt}
          filter={filter}
          onFilter={setFilter}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <RightPanel product={selected} onClose={() => setSelectedId(null)} />
      </div>
      <StatusBar lastScrape={data.lastScrape} />
    </main>
  )
}

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar() {
  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.surface,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 28,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.14em',
        }}
      >
        KLUP INTEL
      </div>
      <nav style={{ display: 'flex', gap: 16 }}>
        <NavTab label="OVERVIEW" active />
        <NavTab label="MARKETS" />
        <NavTab label="ROUTES" />
        <NavTab label="LISTINGS" />
      </nav>
    </header>
  )
}

function NavTab({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: '0.1em',
        color: active ? COLORS.text : COLORS.muted,
        borderBottom: active ? `2px solid ${COLORS.accent}` : '2px solid transparent',
        padding: '4px 2px',
      }}
    >
      {label}
    </span>
  )
}

// ─── Left sidebar — followed products ────────────────────────────────────────
function LeftSidebar({
  products,
  selectedId,
  onSelect,
}: {
  products: IntelProduct[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <aside
      style={{
        width: 180,
        flexShrink: 0,
        borderRight: `1px solid ${COLORS.border}`,
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 12px 8px',
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.12em',
          color: COLORS.label,
          fontWeight: 700,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        FOLLOWED · {products.length}
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {products.map((p) => {
          const active = p.id === selectedId
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '8px 10px',
                border: 'none',
                borderLeft: active ? `2px solid ${COLORS.accent}` : '2px solid transparent',
                borderBottom: `1px solid ${COLORS.border}`,
                background: active ? COLORS.surface : 'transparent',
                color: COLORS.text,
                cursor: 'pointer',
                fontFamily: SANS,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: COLORS.text,
                  width: '100%',
                }}
              >
                {p.canonical_name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: '#000',
                    background: COLORS.yellow,
                    padding: '1px 4px',
                    borderRadius: 2,
                  }}
                >
                  LGDY
                </span>
                <DeltaArrow value={p.best_delta} />
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function DeltaArrow({ value }: { value: number | null }) {
  if (value == null) {
    return <span style={{ fontFamily: MONO, fontSize: 9, color: COLORS.muted }}>—</span>
  }
  if (value > 0) {
    return (
      <span style={{ fontFamily: MONO, fontSize: 9, color: COLORS.accent }}>
        ↑ {fmtDkk(value)}
      </span>
    )
  }
  return (
    <span style={{ fontFamily: MONO, fontSize: 9, color: COLORS.negative }}>
      ↓ {fmtDkk(Math.abs(value))}
    </span>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────
function MainPanel({
  data,
  rows,
  renderedAt,
  filter,
  onFilter,
  selectedId,
  onSelect,
}: {
  data: IntelData
  rows: IntelProduct[]
  renderedAt: string
  filter: Filter
  onFilter: (f: Filter) => void
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <section
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: COLORS.bg,
        minWidth: 0,
      }}
    >
      <div
        style={{
          padding: '20px 24px 14px',
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 16,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontFamily: SANS,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            Intel Overview
          </h1>
          <span style={{ fontFamily: MONO, fontSize: 11, color: COLORS.muted }}>
            Last refreshed: {renderedAt}
          </span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: MONO,
            fontSize: 11,
            color: COLORS.label,
          }}
        >
          {data.products.length} legendary products · {data.marketsTracked} markets tracked
        </div>
      </div>

      <FilterStrip filter={filter} onFilter={onFilter} />

      <div style={{ flex: 1, overflow: 'auto' }}>
        <IntelTable rows={rows} selectedId={selectedId} onSelect={onSelect} />
      </div>
    </section>
  )
}

function FilterStrip({
  filter,
  onFilter,
}: {
  filter: Filter
  onFilter: (f: Filter) => void
}) {
  const opts: { v: Filter; label: string }[] = [
    { v: 'all', label: 'All' },
    { v: 'legendary', label: 'Legendary Only' },
    { v: 'has_de', label: 'Has DE Data' },
    { v: 'delta_10k', label: 'Delta > 10.000 DKK' },
  ]
  return (
    <div
      style={{
        padding: '10px 24px',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {opts.map((o) => {
        const active = filter === o.v
        return (
          <button
            key={o.v}
            onClick={() => onFilter(o.v)}
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.05em',
              padding: '5px 10px',
              borderRadius: 2,
              border: `1px solid ${active ? COLORS.text : COLORS.border}`,
              background: active ? COLORS.text : 'transparent',
              color: active ? '#000' : COLORS.muted,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const TABLE_COLS = '2.2fr repeat(5, 1fr) repeat(3, 1.05fr)'
const TABLE_HEADERS = ['Product', 'DK', 'DE', 'SE', 'NO', 'US', 'Δ DK–DE', 'Δ DK–NO', 'Δ DK–SE']

function IntelTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: IntelProduct[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.delta_dk_de == null && b.delta_dk_de == null) {
        return a.canonical_name.localeCompare(b.canonical_name, 'en')
      }
      if (a.delta_dk_de == null) return 1
      if (b.delta_dk_de == null) return -1
      if (b.delta_dk_de !== a.delta_dk_de) return b.delta_dk_de - a.delta_dk_de
      return a.canonical_name.localeCompare(b.canonical_name, 'en')
    })
  }, [rows])

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: TABLE_COLS,
          gap: 12,
          padding: '8px 24px',
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.bg,
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        {TABLE_HEADERS.map((h, i) => (
          <span
            key={h}
            style={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.1em',
              color: COLORS.label,
              fontWeight: 700,
              textAlign: i === 0 ? 'left' : 'right',
            }}
          >
            {h}
          </span>
        ))}
      </div>
      {sorted.length === 0 ? (
        <div
          style={{
            padding: '24px',
            fontFamily: MONO,
            fontSize: 11,
            color: COLORS.muted,
          }}
        >
          No products match the current filter.
        </div>
      ) : (
        sorted.map((p) => {
          const active = p.id === selectedId
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: TABLE_COLS,
                gap: 12,
                padding: '10px 24px',
                cursor: 'pointer',
                border: 'none',
                borderBottom: `1px solid ${COLORS.border}`,
                background: active ? COLORS.surface : 'transparent',
                width: '100%',
                boxSizing: 'border-box',
                textAlign: 'left',
                color: COLORS.text,
                font: 'inherit',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 13,
                  color: COLORS.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {p.canonical_name}
              </span>
              {(['DK', 'DE', 'SE', 'NO', 'US'] as Market[]).map((m) => (
                <MarketCell key={m} stats={p.markets[m]} />
              ))}
              <DeltaCell value={p.delta_dk_de} />
              <DeltaCell value={p.delta_dk_no} />
              <DeltaCell value={p.delta_dk_se} />
            </button>
          )
        })
      )}
    </div>
  )
}

function MarketCell({ stats }: { stats: MarketStats }) {
  if (stats.count === 0 || stats.median == null) {
    return (
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12,
          color: COLORS.muted,
          textAlign: 'right',
        }}
      >
        —
      </span>
    )
  }
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: MONO, fontSize: 12, color: COLORS.text }}>
        {fmtDkk(stats.median)}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: COLORS.muted }}>{stats.count}</div>
    </div>
  )
}

function DeltaCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12,
          color: COLORS.muted,
          textAlign: 'right',
        }}
      >
        —
      </span>
    )
  }
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: value > 0 ? 700 : 400,
        color: value > 0 ? COLORS.accent : COLORS.negative,
        textAlign: 'right',
      }}
    >
      {value > 0 ? '+' : ''}
      {fmtDkk(value)}
    </span>
  )
}

// ─── Right panel — product detail ────────────────────────────────────────────
function RightPanel({
  product,
  onClose,
}: {
  product: IntelProduct | null
  onClose: () => void
}) {
  if (!product) {
    return (
      <aside
        style={{
          width: 320,
          flexShrink: 0,
          borderLeft: `1px solid ${COLORS.border}`,
          background: COLORS.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: COLORS.muted,
            textAlign: 'center',
            lineHeight: 1.7,
            letterSpacing: '0.1em',
          }}
        >
          SELECT A PRODUCT
          <br />
          FOR DETAIL
        </span>
      </aside>
    )
  }

  const bestDeal = product.listings[0] ?? null

  // Find market with the lowest median (accent in price-band chart)
  let lowestMarket: Market | null = null
  let lowestMedian = Number.POSITIVE_INFINITY
  for (const m of MARKETS) {
    const med = product.markets[m].median
    if (med != null && med < lowestMedian) {
      lowestMedian = med
      lowestMarket = m
    }
  }

  // Shared x-axis for price bands across markets with data
  const allValues: number[] = []
  for (const m of MARKETS) {
    const s = product.markets[m]
    if (s.min != null) allValues.push(s.min)
    if (s.max != null) allValues.push(s.max)
  }
  const xMin = allValues.length > 0 ? Math.min(...allValues) : 0
  const xMax = allValues.length > 0 ? Math.max(...allValues) : 1
  const xRange = Math.max(xMax - xMin, 1)

  const bestDealLocation = bestDeal
    ? `${bestDeal.country} · ${SOURCE_BADGE[bestDeal.source]?.label ?? bestDeal.source}`
    : null

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: `1px solid ${COLORS.border}`,
        background: COLORS.surface,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: `1px solid ${COLORS.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontFamily: SANS, fontSize: 14, color: COLORS.text, fontWeight: 600, lineHeight: 1.3 }}>
            {product.canonical_name}
          </span>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: COLORS.muted,
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 14,
              padding: '0 4px',
            }}
            aria-label="Close detail"
          >
            ×
          </button>
        </div>
        <div>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: '#000',
              background: COLORS.yellow,
              padding: '2px 6px',
              borderRadius: 2,
            }}
          >
            LEGENDARY
          </span>
        </div>
      </div>

      <Section label="PRICE BANDS">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MARKETS.map((m) => (
            <PriceBand
              key={m}
              market={m}
              stats={product.markets[m]}
              xMin={xMin}
              xMax={xMax}
              xRange={xRange}
              accent={lowestMarket === m}
            />
          ))}
        </div>
      </Section>

      <Section label="DELTAS">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <DeltaCard title="Δ DK–DE" value={product.delta_dk_de} />
          <DeltaCard title="Δ DK–US" value={product.delta_dk_us} />
          <DeltaCard
            title="Best deal"
            value={bestDeal?.price_dkk ?? null}
            subtitle={bestDealLocation}
            neutral
          />
        </div>
      </Section>

      <Section label="ACTIVE LISTINGS">
        {product.listings.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 11, color: COLORS.muted }}>
            No active listings
          </div>
        ) : (
          <div>
            {product.listings.slice(0, 10).map((l) => (
              <ListingRow key={l.id} listing={l} />
            ))}
          </div>
        )}
      </Section>

      <Section label="PRICE HISTORY — coming soon">
        <SparklinePlaceholder />
      </Section>
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: COLORS.label,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function PriceBand({
  market,
  stats,
  xMin,
  xRange,
  accent,
}: {
  market: Market
  stats: MarketStats
  xMin: number
  xMax: number
  xRange: number
  accent: boolean
}) {
  const hasData = stats.count > 0 && stats.min != null && stats.max != null

  if (!hasData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 18 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.muted, width: 24 }}>
          {market}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.muted, flex: 1 }}>
          · · · no data
        </span>
      </div>
    )
  }

  const minPct = ((stats.min! - xMin) / xRange) * 100
  const maxPct = ((stats.max! - xMin) / xRange) * 100
  const p25Pct = stats.p25 != null ? ((stats.p25 - xMin) / xRange) * 100 : minPct
  const p75Pct = stats.p75 != null ? ((stats.p75 - xMin) / xRange) * 100 : maxPct
  const medPct =
    stats.median != null ? ((stats.median - xMin) / xRange) * 100 : (minPct + maxPct) / 2

  const lineCol = accent ? COLORS.accent : COLORS.muted
  const barCol = accent ? COLORS.accent : COLORS.text

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.text, width: 24 }}>
        {market}
      </span>
      <div style={{ flex: 1, position: 'relative', height: 18 }}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${minPct}%`,
            right: `${100 - maxPct}%`,
            height: 1,
            background: lineCol,
            transform: 'translateY(-50%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: `${p25Pct}%`,
            right: `${100 - p75Pct}%`,
            height: 10,
            background: barCol,
            opacity: accent ? 0.85 : 0.5,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 1,
            left: `calc(${medPct}% - 1px)`,
            width: 2,
            height: 16,
            background: COLORS.text,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: COLORS.text,
          width: 56,
          textAlign: 'right',
        }}
      >
        {fmtDkk(stats.median)}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9,
          color: COLORS.muted,
          width: 18,
          textAlign: 'right',
        }}
      >
        {stats.count}
      </span>
    </div>
  )
}

function DeltaCard({
  title,
  value,
  subtitle,
  neutral,
}: {
  title: string
  value: number | null
  subtitle?: string | null
  neutral?: boolean
}) {
  let color = COLORS.muted
  if (value != null) {
    if (neutral) color = COLORS.text
    else color = value > 0 ? COLORS.accent : COLORS.negative
  }
  const display =
    value == null ? '—' : neutral ? fmtDkk(value) : (value > 0 ? '+' : '') + fmtDkk(value)
  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        borderRadius: 4,
        padding: 8,
        background: COLORS.bg,
        minHeight: 56,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 9,
          color: COLORS.label,
          letterSpacing: '0.08em',
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 600,
          color,
        }}
      >
        {display}
      </div>
      {subtitle && (
        <div style={{ marginTop: 2, fontFamily: MONO, fontSize: 9, color: COLORS.muted }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

function ListingRow({ listing }: { listing: IntelListing }) {
  const badge =
    SOURCE_BADGE[listing.source] ?? {
      bg: COLORS.border,
      fg: COLORS.text,
      label: listing.source.toUpperCase(),
    }
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: `1px solid ${COLORS.border}`,
        textDecoration: 'none',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: badge.fg,
          background: badge.bg,
          padding: '2px 4px',
          borderRadius: 2,
          minWidth: 48,
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {badge.label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: COLORS.text,
          width: 60,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {fmtDkk(listing.price_dkk)}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: COLORS.muted,
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {flagFor(listing.country)} {listing.location ?? listing.country}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: COLORS.text, flexShrink: 0 }}>↗</span>
    </a>
  )
}

function SparklinePlaceholder() {
  const heights = [12, 18, 14, 22, 28, 24, 30, 26, 32, 28, 34, 30, 36, 32, 38]
  return (
    <div
      style={{
        height: 48,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: h,
            background: COLORS.border,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  )
}

// ─── Status bar ──────────────────────────────────────────────────────────────
function StatusBar({ lastScrape }: { lastScrape: string | null }) {
  return (
    <footer
      style={{
        height: 24,
        flexShrink: 0,
        borderTop: `1px solid ${COLORS.border}`,
        background: COLORS.surface,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        fontFamily: MONO,
        fontSize: 10,
        color: COLORS.muted,
        letterSpacing: '0.06em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: COLORS.accent,
            display: 'inline-block',
          }}
        />
        SYSTEM: OPERATIONAL
      </div>
      <div>LAST SCRAPE: {fmtDateTime(lastScrape)}</div>
    </footer>
  )
}
