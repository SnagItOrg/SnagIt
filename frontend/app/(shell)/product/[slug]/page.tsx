'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb'
import { SearchResultCard } from '@/components/SearchResultCard'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { CreateWatchlistModal } from '@/components/CreateWatchlistModal'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'
import { MonitoredPlatforms } from '@/components/MonitoredPlatforms'
// Recharts: P2 replaced the area chart with a scatter of individual sold
// observations, so the imports follow P2 rather than the pre-P2 area set.
import { ResponsiveContainer, ScatterChart, Scatter, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import { ToastViewport } from '@/components/Toast'
import { useToast } from '@/lib/use-toast'
import { DanishMarketBlock, ReferencePopulationBlock } from '@/components/PriceAnswer'
import type { PopulationKey, PopulationStats } from '@/lib/price-populations'
import { orderByVerdictRank } from '@/lib/listing-value-order'
import { stripDecorativeEmoji } from '@/lib/listing-title'
import { resolveProductImage } from '@/lib/product-image-source'
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
// Type-only, and it must stay that way: the route reaches lib/families.ts,
// which wp4a-boundary.test.ts forbids any client component to pull in by
// value. A `type` edge is erased at compile time, so the family CONFIGURATION
// never enters this bundle — only the canonical siblings the server filtered.
import type { FamilyContext, PricePoint, RelatedProduct } from '@/app/api/product/[slug]/route'
import type { ProductPlacement } from '@/lib/catalogue-tree'
import { Icon } from '@/components/Icon'

/**
 * The entity key for the sold-price series.
 *
 * One combined line, so one legend entry. The contributing marketplaces are
 * named in the frame's source line instead of being split into series we do
 * not actually draw separately.
 */
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
  /**
   * Presentation only. `false` is the order the API returned — score desc, id
   * asc — and it stays the default, so nothing about the existing ordering
   * changes unless the reader asks for it.
   */
  const [valueOrder, setValueOrder]     = useState(false)
  /**
   * The wall's render order. `orderByVerdictRank` reads only the verdict the
   * API already computed — no price is compared, and a listing's population is
   * never crossed. See ./lib/listing-value-order for why that makes this a
   * presentation state rather than a price claim.
   */
  const orderedListings = useMemo(
    () => (valueOrder
      ? orderByVerdictRank(listings, (l) => (l as Listing & ListingWithVerdict).marketVerdict)
      : listings),
    [listings, valueOrder],
  )
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [populations, setPopulations]   = useState<Record<PopulationKey, PopulationStats> | null>(null)
  /** Danish wall listings still awaiting adjudication — see DanishMarketBlock. */
  const [awaitingReview, setAwaitingReview] = useState(0)
  /** Adjudicated Danish asking prices, ascending — see DanishMarketBlock. */
  const [dkAskingPrices, setDkAskingPrices] = useState<number[]>([])
  const [soldCounts, setSoldCounts]     = useState<{ raw: number; filtered: number; excludedOutliers: number } | null>(null)
  const [loading, setLoading]           = useState(true)
  const [notFound, setNotFound]         = useState(false)
  const [imgError, setImgError]         = useState(false)

  /** Marketplaces watching THIS product, resolved by the API from the
   *  monitoring registry. Empty until the fetch lands, which is what keeps the
   *  platform row from flashing an all-inactive state while loading. */
  const [monitoredSources, setMonitoredSources] = useState<string[]>([])

  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([])

  /** Null for a product with no family — six of the seven families, and every
   *  product outside one. The breadcrumb then has no family crumb. */
  const [familyContext, setFamilyContext] = useState<FamilyContext | null>(null)
  /** The product's own category and kind (PAN-121), for the breadcrumb's
   *  catalogue crumbs. Null when it cannot be placed. */
  const [catalogueContext, setCatalogueContext] = useState<ProductPlacement | null>(null)

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
  const { toasts, showToast, dismissToast } = useToast()
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
      setAwaitingReview(data.awaitingReview ?? 0)
      setDkAskingPrices(data.dkAskingPrices ?? [])
      setSoldCounts(data.soldCounts ?? null)
      setRelatedProducts(data.relatedProducts ?? [])
      setMonitoredSources(data.monitoredSources ?? [])
      setFamilyContext(data.familyContext ?? null)
      setCatalogueContext(data.catalogueContext ?? null)
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

  // PAN-133: the precedence is not decided here. `hero_image_url ?? image_url`
  // used to be written inline twice in the hero below — correct, but a third
  // copy of a sentence that had already forked once (PAN-110) and once more in
  // the browse projection.
  const productImage = product ? resolveProductImage(product).url : null

  return (
    <>
      {/*
        pb-10, not pb-24. The mobile pb-24 was clearance for the fixed
        BottomNav, but <main> is not the last thing on the page — the consent
        footer follows it and carries its own pb-24 for exactly that reason.
        So the clearance was being paid twice, and the second payment landed
        between the last card and the privacy link: measured 116px at 390x844
        against 60px at 1440x900. Both are 60px now.
      */}
      <main id="main-content" className="flex-1 shell-offset-pad flex flex-col pb-10">
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
              <Icon
                name="search_off"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)' }}
              />
              <p className="text-muted-foreground">Produkt ikke fundet</p>
            </div>
          ) : (
            <>
              <div className="shell-reading flex flex-col">

                {/*
                  ── Breadcrumb (PAN-121, PAN-56, PAN-138) ───────
                  One trail: Alle kategorier / category / kind / family /
                  product. The catalogue crumbs come from the product's OWN
                  subcategory (`catalogueContext`, the sidebar tree's placement
                  rule), never from its family: PAN-52 §6, taxonomy is not
                  ancestry. A facet leaf adds no kind crumb; a grouped leaf
                  crumbs as its group ("Synthesizere"). The family crumb is
                  gated on `familyContext`, which the API emits only for a
                  published family. The product is the last crumb and not a
                  link. Each crumb is a direct child: `Breadcrumb` places its
                  separators between children, so a Fragment would lose them.
                */}
                {(catalogueContext || familyContext) && (
                  <Breadcrumb className="mb-4">
                    {catalogueContext && (
                      <BreadcrumbItem href="/browse">{t.browseAllCategories}</BreadcrumbItem>
                    )}
                    {catalogueContext && (
                      <BreadcrumbItem href={`/browse/${catalogueContext.category.slug}`}>
                        {locale === 'da' ? catalogueContext.category.name_da : catalogueContext.category.name_en}
                      </BreadcrumbItem>
                    )}
                    {catalogueContext?.kind && (
                      <BreadcrumbItem
                        href={`/browse/${catalogueContext.category.slug}?sub=${encodeURIComponent(catalogueContext.kind.slug)}`}
                      >
                        {locale === 'da' ? catalogueContext.kind.name_da : catalogueContext.kind.name_en}
                      </BreadcrumbItem>
                    )}
                    {familyContext && (
                      <BreadcrumbItem href={`/family/${familyContext.slug}`}>
                        {familyContext.label}
                      </BreadcrumbItem>
                    )}
                    <BreadcrumbItem>{product.canonical_name}</BreadcrumbItem>
                  </Breadcrumb>
                )}

                {/* ── Hero: image + info ────────────────────────── */}
                <div className="grid-hero gap-8 mb-10">

                  {/* Left — product image */}
                  <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted flex-shrink-0">
                    {productImage && !imgError ? (
                      <Image
                        src={productImage}
                        alt={product.canonical_name}
                        fill
                        className="object-cover"
                        onError={() => setImgError(true)}
                        sizes="(max-width: 1024px) 100vw, 50vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Icon
                          name="piano"
                          style={{ fontSize: 72, color: 'var(--muted-foreground)' }}
                        />
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
                            <Icon name="workspace_premium" style={{ fontSize: 12 }} />
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
                        <DanishMarketBlock
                          stats={populations['dk-asking']}
                          awaitingReview={awaitingReview}
                          askingPrices={dkAskingPrices}
                        />

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
                            : fill(t.priceBandTooFew, { count: priceHistory.length })
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
                        ? fill(t.soldCountsReconciled, {
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
                          <p className="text-sm font-semibold text-foreground mb-4">{t.specifications}</p>
                          <dl className="divide-y divide-border">
                            {Object.entries(product.attributes!.specs!)
                              .filter(([k, v]) => k !== '_source' && v !== '' && v !== null && v !== undefined)
                              .map(([key, value]) => {
                                /*
                                  The jsonb key is an identifier, so the label
                                  comes from the map rather than from the data.
                                  An unmapped key keeps exactly today's
                                  rendering — humanised and `capitalize`d — so
                                  a spec key nobody has translated yet still
                                  reads, and never renders blank.
                                */
                                const label = (t.specLabels as Record<string, string | undefined>)[key]
                                return (
                                  <div key={key} className="flex justify-between gap-4 py-2.5 min-w-0">
                                    <dt className={`text-sm text-muted-foreground min-w-0${label ? '' : ' capitalize'}`}>
                                      {label ?? key.replace(/_/g, ' ')}
                                    </dt>
                                    <dd className="text-sm text-foreground text-right min-w-0 wrap-anywhere">
                                      {typeof value === 'boolean' ? (value ? t.specYes : t.specNo) : String(value)}
                                    </dd>
                                  </div>
                                )
                              })}
                          </dl>
                        </div>
                      )}

                      {/* History card */}
                      {hasHistory && (
                        <div className="rounded-2xl border border-border p-6">
                          <p className="text-sm font-semibold text-foreground mb-4">{t.productHistory}</p>
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
                        <Icon name="open_in_new" style={{ fontSize: 14 }} />
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}

                {/*
                  ── Family siblings (PAN-56) ────────────────────
                  A LINK LIST, NOT A COMPARISON. There is deliberately no
                  price, no band, no verdict and no listing count beside a
                  sibling — `FamilyContext.siblings` is `{slug,label}` and has
                  no field one could be put in. `familyWhyNotOnePrice` is the
                  existing copy that says why: these markets are too far apart
                  to combine, so the user is asked to pick the exact model
                  rather than shown a number that spans all of them.
                */}
                {familyContext && familyContext.siblings.length > 0 && (
                  <div className="flex flex-col gap-3 mb-10">
                    <p className="text-sm font-medium text-foreground">{t.familyOtherModels}</p>
                    <p className="type-meta text-muted-foreground max-w-[38rem]">
                      {t.familyWhyNotOnePrice}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {familyContext.siblings.map((sibling) => (
                        <a
                          key={sibling.slug}
                          href={`/product/${sibling.slug}`}
                          className="rounded-xl border border-border px-4 py-2 type-meta text-foreground wrap-anywhere hover:border-foreground/30 transition-colors"
                        >
                          {sibling.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/*
                  ── Related products ────────────────────────────

                  TWO IS THE SMALLEST NUMBER THAT IS A SHELF. `grid-fluid-sm`
                  lays out auto-fill columns of min 9.5rem, so at 1440px a
                  single survivor sits in the first of eight columns with the
                  rest of the row empty — a heading promising related gear
                  above what reads as a grid that failed to load.

                  This is the normal case, not an edge case, because related
                  links are resolved through isCanonical() and most authored
                  targets are qa_only. Measured on production 2026-09-23 over
                  the seven products that author related_products at all:
                  four resolve to 0 canonical targets (fender-stratocaster,
                  fender-telecaster, gibson-es-335, gibson-les-paul) and
                  already render nothing; roland-juno-106 and roland-juno-60
                  resolve to exactly 1; only roland-jupiter-8 resolves to 2.

                  So the shelf is suppressed below two rather than restyled:
                  the single-item layout would be a new visual case built for
                  two pages, and the threshold is self-healing — when a target
                  becomes canonical the shelf returns on its own, with no data
                  change and no flag. The cost is two links on two pages.
                */}
                {relatedProducts.length > 1 && (
                  <div className="flex flex-col gap-3 mb-10">
                    <p className="text-sm font-medium text-foreground">{t.relatedGear}</p>
                    <div className="grid-fluid-sm gap-3">
                      {relatedProducts.map((rel) => (
                        <a
                          key={rel.slug}
                          href={`/product/${rel.slug}`}
                          className="flex flex-col gap-2 rounded-xl border border-border overflow-hidden hover:border-foreground/30 transition-colors"
                        >
                          <div className="aspect-square bg-muted relative">
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Icon
                                name="piano"
                                style={{ fontSize: 32, color: 'var(--muted-foreground)' }}
                              />
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
                      {reviewRequested ? t.adminReview.exitReview : t.adminReview.enterReview}
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

                {/*
                  Source coverage, ABOVE the wall and OUTSIDE its
                  `listings.length > 0` guard: a product with nothing is
                  exactly the one whose visitor needs to know which
                  marketplaces are being watched on its behalf.
                */}
                <MonitoredPlatforms monitoredSources={monitoredSources} listings={listings} />

                {/* ── Active listings ───────────────────────────── */}
                {listings.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {listings.length} {listings.length === 1 ? 'annonce' : 'annoncer'}
                      </p>
                      {/*
                        Two states, not a filtering framework. Nothing is hidden
                        and nothing is recomputed: the same listings are shown
                        in one of two orders, and the default is the one the API
                        already returned.
                      */}
                      <div className="flex flex-wrap gap-1" role="group" aria-label={t.sortGroupLabel}>
                        {([false, true] as const).map((mode) => (
                          <button
                            key={String(mode)}
                            type="button"
                            onClick={() => setValueOrder(mode)}
                            aria-pressed={valueOrder === mode}
                            aria-describedby={mode && valueOrder ? 'sort-value-hint' : undefined}
                            title={mode ? t.sortByValueHint : undefined}
                            className="px-3 py-1.5 min-h-[44px] rounded-xl text-xs font-semibold transition-colors"
                            style={valueOrder === mode
                              ? { backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }
                              : { backgroundColor: 'transparent', border: '1px solid transparent', color: 'var(--muted-foreground)' }}
                          >
                            {mode ? t.sortByValue : t.sortDefault}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/*
                      The caveat cannot live in title= alone: a tooltip never
                      fires on touch and never for keyboard users, and 360px is
                      this wall's primary viewport. Same string, now readable.
                    */}
                    {valueOrder && (
                      <p id="sort-value-hint" className="text-xs text-muted-foreground">
                        {t.sortByValueHint}
                      </p>
                    )}
                    <div className="grid-wall grid-wall-lg">
                    {orderedListings.map((listing) => (
                      <ListingErrorBoundary key={listing.id} listingId={listing.id}>
                        <div className="flex flex-col">
                          <SearchResultCard
                            listing={{ ...listing, title: stripDecorativeEmoji(listing.title) }}
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
                              onFailed={(message) => showToast(message, { type: 'error' })}
                            />
                          )}
                        </div>
                      </ListingErrorBoundary>
                    ))}
                    </div>
                  </div>
                )}

                {/*
                  The bare "Ingen aktive annoncer for dette produkt." that used
                  to sit here is gone, not relocated. It was the third of three
                  ways this page said "nothing" to the same visitor, and it was
                  the least informative: the platform row above now says which
                  marketplaces are watched and which of them are empty, which is
                  the same fact with the coverage attached. Deleting it removes
                  a repetition, not a statement.
                */}
              </div>
            </>
          )}
        </div>
      </main>


      <CreateWatchlistModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleModalConfirm}
        initialQuery={modalQuery}
        creating={creating}
      />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
