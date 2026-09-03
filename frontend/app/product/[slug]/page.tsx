'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { SearchResultCard } from '@/components/SearchResultCard'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { CreateWatchlistModal } from '@/components/CreateWatchlistModal'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'
// Recharts: P2 replaced the area chart with a scatter of individual sold
// observations, so the imports follow P2 rather than the pre-P2 area set.
import { ResponsiveContainer, ScatterChart, Scatter, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import { useLocale } from '@/components/LocaleProvider'
import { Toast } from '@/components/Toast'
import { useToast } from '@/lib/use-toast'
import { DanishMarketBlock, ReferencePopulationBlock } from '@/components/PriceAnswer'
import type { PopulationKey, PopulationStats } from '@/lib/price-populations'
import {
  ProductReviewControls,
  type MatchReviewStatus,
} from '@/components/admin/ProductReviewControls'
import { ScrapeSection } from '@/components/admin/ScrapeSection'

/** The product API enriches each listing with a server-computed deal signal. */
type ListingWithVerdict = {
  marketVerdict?: 'under' | 'typical' | 'over' | null
  marketVerdictBasisLabel?: string | null
}
import { ChartFrame, DataLegend } from '@/components/data-display'
import { formatCompact, formatDateRange, formatDkkAmount } from '@/lib/chart-format'
import { seriesColor } from '@/lib/chart-palette'
import type { Listing } from '@/lib/supabase'
import type { PricePoint, RelatedProduct } from '@/app/api/product/[slug]/route'

/**
 * The entity key for the sold-price series.
 *
 * One combined line, so one legend entry. The contributing marketplaces are
 * named in the frame's source line instead of being split into series we do
 * not actually draw separately.
 */
function fillTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

type ProductAttributes = {
  description?:     string
  specs?:           Record<string, string | boolean | number>
  history?:         Array<{ year: number; title: string; body: string }>
  external_links?:  Array<{ label: string; url: string }>
  related_products?: Array<{ slug: string; reason: string }>
}

type Product = {
  id: string
  slug: string
  canonical_name: string
  era: string | null
  tier: 'standard' | 'classic' | 'legendary'
  year_released: number | null
  thomann_price_dkk: number | null
  thomann_url: string | null
  image_url: string | null
  hero_image_url: string | null
  kg_brand: { name: string; slug: string } | null
  attributes: ProductAttributes | null
}

export default function ProductPage() {
  const params = useParams()
  const slug = params.slug as string
  const { t, locale } = useLocale()

  const [product, setProduct]           = useState<Product | null>(null)
  const [listings, setListings]         = useState<Listing[]>([])
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [populations, setPopulations]   = useState<Record<PopulationKey, PopulationStats> | null>(null)
  const [soldCounts, setSoldCounts]     = useState<{ raw: number; filtered: number; excludedOutliers: number } | null>(null)
  const [loading, setLoading]           = useState(true)
  const [notFound, setNotFound]         = useState(false)
  const [imgError, setImgError]         = useState(false)

  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([])

  const [showModal,  setShowModal]  = useState(false)
  const [modalQuery, setModalQuery] = useState('')
  const [creating,   setCreating]   = useState(false)

  const [savedListingIds, setSavedListingIds] = useState<Set<string>>(new Set())

  /**
   * ADMIN REVIEW MODE.
   *
   * Two independent conditions, and only one of them is authorisation.
   * `?review=1` (or the existing `?debug=1`) is a view preference anyone can
   * type; `isAdmin` comes from /api/admin/me, which reads the session on the
   * server. The controls need both, and every route they call re-checks admin
   * for itself — the query parameter can never grant anything.
   */
  const searchParams = useSearchParams()
  const reviewRequested = searchParams.get('review') === '1' || searchParams.get('debug') === '1'
  const [isAdmin, setIsAdmin] = useState(false)
  const [matchStatuses, setMatchStatuses] = useState<Record<string, MatchReviewStatus>>({})
  /**
   * The same toast /admin/match uses. It lives here, at page level, rather
   * than on the card: a rejected or moved card unmounts, and a message that
   * unmounts with it cannot report what happened to it.
   */
  const [toast, showToast] = useToast()
  const reviewMode = isAdmin && reviewRequested

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/me')
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((d: { isAdmin?: boolean }) => { if (!cancelled && d.isAdmin) setIsAdmin(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const loadMatchStatuses = useCallback(async () => {
    if (!reviewMode) return
    const res = await fetch(`/api/admin/product/${slug}/match-review`)
    if (!res.ok) return
    const body = (await res.json()) as {
      matches?: Array<{ listing_id: string; status: MatchReviewStatus }>
    }
    setMatchStatuses(
      Object.fromEntries((body.matches ?? []).map((m) => [m.listing_id, m.status])),
    )
  }, [reviewMode, slug])

  useEffect(() => { void loadMatchStatuses() }, [loadMatchStatuses])

  /**
   * Extracted from the mount effect so a review decision can re-read it.
   * Refetching is what makes a rejected listing leave the wall and the counts
   * follow, without a full page reload.
   *
   * INTEGRATION NOTE. P2 fetched this inline on mount; the review flow needs to
   * call it again after a decision, so the callable shape is kept and P2's
   * payload is read inside it. `populations` and `soldCounts` replace the old
   * `priceRange`, so a decision refreshes the price evidence too — rejecting a
   * listing changes the population it was counted in.
   */
  const loadProduct = useCallback(async () => {
    try {
      const r = await fetch(`/api/product/${slug}`)
      if (r.status === 404) { setNotFound(true); return }
      const data = await r.json()
      if (!data) return
      setProduct(data.product)
      setListings(data.listings ?? [])
      setPriceHistory(data.priceHistory ?? [])
      setPopulations(data.populations ?? null)
      setSoldCounts(data.soldCounts ?? null)
      setRelatedProducts(data.relatedProducts ?? [])
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => { void loadProduct() }, [loadProduct])

  useEffect(() => {
    fetch('/api/saved-listings')
      .then((r) => r.ok ? r.json() : [])
      .then((rows: { listing_id: string }[]) => {
        setSavedListingIds(new Set(rows.map((r) => r.listing_id)))
      })
      .catch(() => {})
  }, [])

  async function handleToggleSave(listing: Listing) {
    const alreadySaved = savedListingIds.has(listing.id)
    const prev = new Set(savedListingIds)

    if (alreadySaved) {
      setSavedListingIds(new Set(Array.from(savedListingIds).filter((id) => id !== listing.id)))
      const res = await fetch('/api/saved-listings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listing.id }),
      })
      if (!res.ok) setSavedListingIds(prev)
    } else {
      setSavedListingIds(new Set(Array.from(savedListingIds).concat(listing.id)))
      try {
        const res = await fetch('/api/saved-listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listing_id: listing.id, listing_data: listing }),
        })
        if (!res.ok) setSavedListingIds(prev)
      } catch {
        setSavedListingIds(prev)
      }
    }
  }

  function handleCreateWatchlist(listingTitle?: string) {
    const q = listingTitle
      ? (listingTitle.length > 60
          ? listingTitle.slice(0, listingTitle.lastIndexOf(' ', 60) || 60)
          : listingTitle)
      : product?.canonical_name ?? ''
    setModalQuery(q)
    setShowModal(true)
  }

  const handleModalConfirm = useCallback(async (query: string, maxPrice?: number) => {
    setCreating(true)
    const body: Record<string, unknown> = { query }
    if (maxPrice != null && maxPrice > 0) body.max_price = maxPrice
    await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setShowModal(false)
    setCreating(false)
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <SideNav active="soeg" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col pb-24 md:pb-10">
        <MobileSearchBar />

        <div className="flex flex-col pt-4 md:pt-8 w-full">

          {/* ── Loading skeleton ──────────────────────────────── */}
          {loading ? (
            <div className="shell-reading grid-hero gap-8">
              <div className="aspect-square rounded-2xl bg-muted animate-pulse" />
              <div className="flex flex-col gap-4 pt-2">
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                <div className="h-8 w-3/4 rounded-lg bg-muted animate-pulse" />
                <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                <div className="h-12 w-2/3 rounded-lg bg-muted animate-pulse mt-4" />
                <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                <div className="h-11 w-full rounded-xl bg-muted animate-pulse mt-6" />
              </div>
            </div>
          ) : notFound || !product ? (

            /* ── Not found ──────────────────────────────────── */
            <div className="shell-reading flex flex-col items-center justify-center py-24 gap-3 text-center">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)' }}
              >
                search_off
              </span>
              <p className="text-muted-foreground">Produkt ikke fundet</p>
            </div>
          ) : (
            <>
              <div className="shell-reading flex flex-col">
                {/* ── Hero: image + info ────────────────────────── */}
                <div className="grid-hero gap-8 mb-10">

                  {/* Left — product image */}
                  <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted flex-shrink-0">
                    {(product.hero_image_url ?? product.image_url) && !imgError ? (
                      <Image
                        src={(product.hero_image_url ?? product.image_url)!}
                        alt={product.canonical_name}
                        fill
                        className="object-cover"
                        onError={() => setImgError(true)}
                        sizes="(max-width: 1024px) 100vw, 50vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 72, color: 'var(--muted-foreground)' }}
                        >
                          piano
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right — product info */}
                  <div className="flex flex-col gap-5 self-start max-w-[38rem]">

                    {/* Brand + name + era */}
                    <div className="flex flex-col gap-1">
                      {product.kg_brand && (
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          {product.kg_brand.name}
                        </p>
                      )}
                      <div className="flex items-start gap-2 flex-wrap">
                        <h1 className="type-title text-[1.75rem] md:text-[2.125rem] leading-tight">
                          {product.canonical_name}
                        </h1>
                        {product.tier && product.tier !== 'standard' && (
                          <span
                            className="mt-1 shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                            style={{ background: 'var(--foreground)', color: 'var(--background)' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>workspace_premium</span>
                            {product.tier === 'legendary' ? 'Legendary' : 'Classic'}
                          </span>
                        )}
                      </div>
                      {product.era && (
                        <p className="text-sm text-muted-foreground">{product.era}</p>
                      )}
                    </div>

                    {/* THE PRICE ANSWER.
                        Danish market first, at whatever tier its data supports,
                        then Reverb as clearly separate reference populations.
                        The old headline was a min-max over international SOLD
                        prices labelled "Typisk brugtpris" — a 5.2x range on
                        Juno-60 — which answered no question and named no
                        population. Owner decision C2, 2026-09-01. */}
                    {populations && (
                      <div className="flex flex-col gap-5">
                        <DanishMarketBlock stats={populations['dk-asking']} />

                        {(populations['reverb-sold'].tier === 'band' ||
                          populations['reverb-asking'].tier === 'band') && (
                          <div className="flex flex-col gap-3">
                            <ReferencePopulationBlock
                              stats={populations['reverb-sold']}
                              heading={t.reverbSoldHeading}
                            />
                            <ReferencePopulationBlock
                              stats={populations['reverb-asking']}
                              heading={t.reverbAskingHeading}
                              note={t.reverbAskingNote}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Thomann new price reference */}
                    {product.thomann_price_dkk != null && product.thomann_url && (
                      <a
                        href={product.thomann_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Ny fra Thomann:{' '}
                        <span className="font-semibold text-foreground">
                          {product.thomann_price_dkk.toLocaleString('da-DK')} kr
                        </span>{' '}
                        →
                      </a>
                    )}

                    {/* Listing count + watchlist CTA */}
                    <div className="flex flex-col gap-2 pt-4 border-t border-border">
                      <p className="text-sm text-muted-foreground">
                        {listings.length === 0
                          ? 'Ingen aktive annoncer'
                          : `${listings.length} ${listings.length === 1 ? 'aktiv annonce' : 'aktive annoncer'} til salg`}
                      </p>
                      <button
                        onClick={() => handleCreateWatchlist()}
                        className="w-full px-5 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
                        style={{ background: 'var(--foreground)', color: 'var(--background)' }}
                      >
                        + Tilføj til watchlist
                      </button>
                      <p className="text-xs text-muted-foreground text-center">
                        Få besked når nye annoncer dukker op
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── Price history ─────────────────────────────── */}
                {(() => {
                  /**
                   * Sold prices only, on a real time axis.
                   *
                   * Three things changed. The x-axis was `dataKey="sold_at"`
                   * with no `type`, so Recharts defaulted to a CATEGORY scale
                   * and the chart plotted sale INDEX, not time — evenly spacing
                   * sales that happened years apart. The y-axis was hidden, so
                   * the shape had no magnitude. And `condition`, carried from
                   * the database through the API and into this component, was
                   * never read.
                   *
                   * Asking prices are deliberately NOT plotted here. Placing
                   * them on the sold distribution is a cross-population
                   * comparison, which owner decision C2 defers.
                   */
                  const sold = populations?.['reverb-sold'] ?? null
                  const enough = sold?.tier === 'band'

                  const points = priceHistory
                    .map((pt) => ({
                      ts: new Date(pt.sold_at).getTime(),
                      price: pt.price,
                      condition: pt.condition && pt.condition.trim() !== ''
                        ? pt.condition
                        : t.conditionUnknown,
                    }))
                    .filter((pt) => Number.isFinite(pt.ts) && pt.price > 0)

                  const byCondition = new Map<string, typeof points>()
                  for (const pt of points) {
                    const list = byCondition.get(pt.condition) ?? []
                    list.push(pt)
                    byCondition.set(pt.condition, list)
                  }
                  const conditionSeries = Array.from(byCondition.entries())
                    .sort((a, b) => b[1].length - a[1].length)

                  const period = formatDateRange(
                    priceHistory[0]?.sold_at,
                    priceHistory[priceHistory.length - 1]?.sold_at,
                  )

                  return (
                    <ChartFrame
                      className="mb-10"
                      title={t.priceHistoryTitle}
                      description={t.reverbSoldHeading}
                      locale={locale}
                      headingLevel="h2"
                      state={enough ? 'ready' : 'empty'}
                      emptyReason={
                        priceHistory.length === 0 ? 'no-observations' : 'insufficient-observations'
                      }
                      emptyDetail={
                        // A truncated read must not report a partial count as
                        // if it were the whole sold history.
                        sold?.tier === 'unavailable'
                          ? t.priceDataUnavailable
                          : priceHistory.length === 0
                            ? undefined
                            : fillTemplate(t.priceBandTooFew, { count: priceHistory.length })
                      }
                      legend={
                        enough ? (
                          <DataLegend
                            items={conditionSeries.map(([name, list]) => ({
                              key: name,
                              label: name,
                              count: list.length,
                            }))}
                          />
                        ) : undefined
                      }
                      source={soldCounts
                        ? fillTemplate(t.soldCountsReconciled, {
                            filtered: soldCounts.filtered,
                            raw: soldCounts.raw,
                            excluded: soldCounts.excludedOutliers,
                          })
                        : undefined}
                      period={period ?? undefined}
                      sample={sold ? `n = ${sold.nFiltered}` : undefined}
                    >
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
                              minTickGap={28}
                            />
                            {/* Kroner, visible. */}
                            <YAxis
                              type="number"
                              dataKey="price"
                              domain={['auto', 'auto']}
                              width={64}
                              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v: number) => formatCompact(v, 'da-DK') ?? ''}
                              label={undefined}
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
                                formatDkkAmount(Number(v)) ?? '\u2014',
                                String(name),
                              ]}
                              labelFormatter={(l: unknown) =>
                                new Date(Number(l)).toLocaleDateString('da-DK', {
                                  day: 'numeric', month: 'short', year: 'numeric',
                                })
                              }
                            />
                            {conditionSeries.map(([name, list]) => (
                              <Scatter
                                key={name}
                                name={name}
                                data={list}
                                fill={seriesColor(name)}
                                fillOpacity={0.75}
                              />
                            ))}
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-3 type-meta">{t.chartAxisPriceDkk}</p>
                    </ChartFrame>
                  )
                })()}

                {/* ── Description ───────────────────────────────── */}
                {product.attributes?.description && (
                  <p className="type-body type-measure text-foreground/80 mb-10">
                    {product.attributes.description}
                  </p>
                )}

                {/* ── Specs + History — 2-col on desktop ────────── */}
                {(() => {
                  const hasSpecs = !!(product.attributes?.specs &&
                    Object.keys(product.attributes.specs).filter((k) => k !== '_source').length > 0)
                  const hasHistory = !!(product.attributes?.history && product.attributes.history.length > 0)
                  if (!hasSpecs && !hasHistory) return null
                  return (
                    <div className="grid-bento gap-6 mb-10 items-start">

                      {/* Specs card */}
                      {hasSpecs && (
                        <div className="rounded-2xl border border-border p-6">
                          <p className="text-sm font-semibold text-foreground mb-4">Specifications</p>
                          <dl className="divide-y divide-border">
                            {Object.entries(product.attributes!.specs!)
                              .filter(([k, v]) => k !== '_source' && v !== '' && v !== null && v !== undefined)
                              .map(([key, value]) => (
                                <div key={key} className="flex justify-between gap-4 py-2.5 min-w-0">
                                  <dt className="text-sm text-muted-foreground capitalize min-w-0">{key.replace(/_/g, ' ')}</dt>
                                  <dd className="text-sm text-foreground text-right min-w-0 wrap-anywhere">
                                    {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        </div>
                      )}

                      {/* History card */}
                      {hasHistory && (
                        <div className="rounded-2xl border border-border p-6">
                          <p className="text-sm font-semibold text-foreground mb-4">Product History</p>
                          <div className="flex flex-col">
                            {product.attributes!.history!.map((milestone, i) => (
                              <div key={i} className="flex gap-4">
                                <div className="flex flex-col items-center">
                                  <div
                                    className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center font-bold"
                                    style={{ background: 'var(--foreground)', color: 'var(--background)', fontSize: 11 }}
                                  >
                                    {milestone.year}
                                  </div>
                                  {i < product.attributes!.history!.length - 1 && (
                                    <div className="w-px flex-1 bg-border my-1" />
                                  )}
                                </div>
                                <div className="pb-5 pt-1.5 min-w-0">
                                  <p className="text-sm font-semibold text-foreground leading-tight wrap-anywhere">{milestone.title}</p>
                                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed wrap-anywhere">{milestone.body}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  )
                })()}

                {/* ── External links ────────────────────────────── */}
                {product.attributes?.external_links && product.attributes.external_links.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-10">
                    {product.attributes.external_links.map((link) => (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14 }}
                        >
                          open_in_new
                        </span>
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}

                {/* ── Related products ──────────────────────────── */}
                {relatedProducts.length > 0 && (
                  <div className="flex flex-col gap-3 mb-10">
                    <p className="text-sm font-medium text-foreground">Related gear</p>
                    <div className="grid-fluid-sm gap-3">
                      {relatedProducts.map((rel) => (
                        <a
                          key={rel.slug}
                          href={`/product/${rel.slug}`}
                          className="flex flex-col gap-2 rounded-xl border border-border overflow-hidden hover:border-foreground/30 transition-colors"
                        >
                          <div className="aspect-square bg-muted relative">
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 32, color: 'var(--muted-foreground)' }}
                              >
                                piano
                              </span>
                            </div>
                            {rel.image_url && (
                              <Image
                                src={rel.image_url}
                                alt={rel.name}
                                fill
                                className="object-cover"
                                sizes="(max-width: 640px) 50vw, 200px"
                                onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                              />
                            )}
                          </div>
                          <p className="type-meta text-foreground wrap-anywhere px-3 pb-3">{rel.name}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="shell-wall flex flex-col">
                {/*
                  ── Live search (PAN-31) ─────────────────────────
                  It sits ABOVE the listing wall and OUTSIDE the
                  `listings.length > 0` guard on purpose: a product with no
                  matched listings is exactly the one an operator opens review
                  mode to fix, and hiding the search there would hide it when
                  it is most needed. Searching writes nothing; attaching a
                  result and saving the query as a search term are two
                  separate, explicitly clicked actions.
                */}
                {/*
                  REVIEW MODE MUST NEVER FAIL SILENTLY.

                  `reviewMode` is `isAdmin && reviewRequested`, and `isAdmin`
                  comes from /api/admin/me — a per-origin session. On a preview
                  deployment that is a DIFFERENT origin from production, so a
                  signed-in operator arrives here signed out and the whole
                  review surface rendered nothing, with no explanation. That is
                  indistinguishable from the feature being missing, and it is
                  exactly how the first two PAN-31 previews were read.
                */}
                {reviewRequested && !isAdmin && (
                  <div className="mb-6 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-ink-secondary">
                    {t.adminReview.signedOutNotice}{' '}
                    <a href="/login" className="font-semibold underline text-ink">
                      {t.adminReview.signIn}
                    </a>
                  </div>
                )}

                {/*
                  The entry point used to live inside the `listings.length > 0`
                  block below, so a product with no matched listings offered an
                  admin no way into review mode — the one case where the live
                  search is most needed.
                */}
                {isAdmin && (
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <a
                      href={reviewRequested ? `/product/${slug}` : `/product/${slug}?review=1`}
                      className="w-fit rounded-lg border border-line bg-surface-2 px-3 py-1 text-xs font-semibold text-ink-secondary transition-colors hover:bg-surface-3"
                    >
                      {reviewRequested ? 'Afslut gennemgang' : 'Gennemgå matches'}
                    </a>
                  </div>
                )}

                {reviewMode && product && (
                  <div className="mb-6">
                    <ScrapeSection
                      slug={slug}
                      defaultQuery={product.canonical_name}
                      productId={product.id}
                      onSaved={() => {
                        void loadProduct()
                        void loadMatchStatuses()
                      }}
                      onMoved={(productName) =>
                        showToast(`Annoncen er flyttet til ${productName}.`)
                      }
                      onStatus={showToast}
                    />
                  </div>
                )}

                {/* ── Active listings ───────────────────────────── */}
                {listings.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {listings.length} {listings.length === 1 ? 'annonce' : 'annoncer'}
                    </p>
                    <div className="grid-wall grid-wall-lg">
                    {listings.map((listing) => (
                      <ListingErrorBoundary key={listing.id} listingId={listing.id}>
                        <div className="flex flex-col">
                          <SearchResultCard
                            listing={listing}
                            marketVerdict={(listing as ListingWithVerdict).marketVerdict}
                            marketVerdictBasisLabel={(listing as ListingWithVerdict).marketVerdictBasisLabel}
                            onCreateWatchlist={handleCreateWatchlist}
                            creating={creating}
                            variant="list"
                            thomannImageUrl={product.image_url}
                            isSaved={savedListingIds.has(listing.id)}
                            onToggleSave={handleToggleSave}
                          />
                          {reviewMode && (
                            <ProductReviewControls
                              slug={slug}
                              listingId={listing.id}
                              status={matchStatuses[listing.id] ?? 'unresolved'}
                              onDecided={(id, next) => {
                                setMatchStatuses((prev) => ({ ...prev, [id]: next }))
                                const title = listings.find((l) => l.id === id)?.title ?? ''
                                showToast(
                                  (next === 'rejected'
                                    ? t.adminReview.successRejected
                                    : t.adminReview.successApproved)
                                    .replace('{listing}', title)
                                    .replace('{product}', product.canonical_name),
                                )
                                /**
                                 * A REJECTED CARD LEAVES THE WALL NOW.
                                 *
                                 * This used to rely on `loadProduct()` alone, so
                                 * the rejected listing sat there — unchanged and
                                 * still offering the same buttons — until a
                                 * refetch the Data Cache was answering from cache
                                 * anyway. The operator's most common reading was
                                 * "it didn't work", and the usual response was to
                                 * click reject again.
                                 *
                                 * Nielsen #1: the response to a decision has to be
                                 * immediate and visible. Both listing counts on
                                 * this page derive from `listings.length`, so
                                 * removing the row updates them without a second
                                 * source of truth. The refetch below still runs
                                 * and remains authoritative; this removes the wait,
                                 * not the verification.
                                 */
                                if (next === 'rejected') {
                                  setListings((prev) => prev.filter((l) => l.id !== id))
                                }
                                void loadProduct()
                                void loadMatchStatuses()
                              }}
                              onReassigned={(id, productName) => {
                                const title = listings.find((l) => l.id === id)?.title ?? ''
                                showToast(
                                  t.adminReview.successMoved
                                    .replace('{listing}', title)
                                    .replace('{product}', productName),
                                )
                                // A moved listing belongs to another product now,
                                // so it leaves this wall for the same reason.
                                setListings((prev) => prev.filter((l) => l.id !== id))
                                void loadProduct()
                                void loadMatchStatuses()
                              }}
                              onFailed={(message) => showToast(message)}
                            />
                          )}
                        </div>
                      </ListingErrorBoundary>
                    ))}
                    </div>
                  </div>
                )}

                {listings.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground py-4">
                    Ingen aktive annoncer for dette produkt.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <BottomNav />

      <CreateWatchlistModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleModalConfirm}
        initialQuery={modalQuery}
        creating={creating}
      />
      {toast && <Toast message={toast} />}
    </div>
  )
}
