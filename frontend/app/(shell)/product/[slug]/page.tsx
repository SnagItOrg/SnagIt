'use client'

import { Fragment, useState, useEffect, useCallback, useMemo, startTransition, ViewTransition } from 'react'
import { preload } from 'react-dom'
import { productImageTransitionName, takeHero } from '@/lib/fluid-nav'
import type { IconName } from '@/components/Icon'
import { useParams, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb'
import { SearchResultCard } from '@/components/SearchResultCard'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { WatchProductForm } from '@/components/WatchProductForm'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'
import { MonitoredPlatforms } from '@/components/MonitoredPlatforms'
// Recharts: P2 replaced the area chart with a scatter of individual sold
// observations, so the imports follow P2 rather than the pre-P2 area set.
import dynamic from 'next/dynamic'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import { ToastViewport } from '@/components/Toast'
import { useToast } from '@/lib/use-toast'
import { DanishMarketBlock, ReferencePopulationBlock } from '@/components/PriceAnswer'
import { isHomeMarket, isNonFunctioning, REVERB_SOURCE, type PopulationKey, type PopulationStats } from '@/lib/price-populations'
import { orderByVerdictRank } from '@/lib/listing-value-order'
import { ListSection } from '@/components/ListSection'
import { stripDecorativeEmoji } from '@/lib/listing-title'
import { resolveProductImage } from '@/lib/product-image-source'
import {
  ProductReviewControls,
  type MatchReviewStatus,
} from '@/components/admin/ProductReviewControls'
import { ScrapeSection } from '@/components/admin/ScrapeSection'
import { TrackView } from '@/components/TrackView'
import { track } from '@/lib/analytics'
import { FeedbackLink, PriceTipLink } from '@/components/FeedbackSheet'

/** The product API enriches each listing with a server-computed deal signal. */
type ListingWithVerdict = {
  marketVerdict?: 'under' | 'typical' | 'over' | null
  marketVerdictBasisLabel?: string | null
  marketVerdictFewN?: number | null
}
import { ChartFrame, DataLegend } from '@/components/data-display'
import { formatDateRange } from '@/lib/chart-format'
import { niceTicks } from '@/lib/chart-geometry'
import { partitionByIqr } from '@/lib/statistics'
import type { Listing } from '@/lib/supabase'
// Type-only, and it must stay that way: the route reaches lib/families.ts,
// which wp4a-boundary.test.ts forbids any client component to pull in by
// value. A `type` edge is erased at compile time, so the family CONFIGURATION
// never enters this bundle — only the canonical siblings the server filtered.
import type { FamilyContext, PricePoint } from '@/app/api/product/[slug]/route'
import type { SimilarProduct } from '@/app/api/product/[slug]/similar/route'
import { facetLine } from '@/lib/product-facet-line'
import { placeholderIcon } from '@/lib/placeholder-icon'

/** Reason chip copy per `lib/similar-gear.ts` reason (PAN-235). */
const SIMILAR_REASON_KEY = {
  clone: 'similarReasonClone',
  original: 'similarReasonOriginal',
  successor: 'similarReasonSuccessor',
  predecessor: 'similarReasonPredecessor',
  alternative: 'similarReasonAlternative',
  same_family: 'similarReasonSameFamily',
  same_type: 'similarReasonSameType',
} as const
import { subcategoryHref, type ProductPlacement } from '@/lib/catalogue-tree'
import { Icon } from '@/components/Icon'

/**
 * PAN-168. Reverb's condition vocabulary → the label a visitor reads. The raw
 * string stays the series KEY (it fixes the colour and shape); only the label
 * is translated. A condition not listed here renders as Reverb wrote it.
 */
type ConditionLabelKey =
  | 'conditionBrandNew' | 'conditionMint' | 'conditionExcellent'
  | 'conditionVeryGood' | 'conditionGood' | 'conditionFair'
  | 'conditionPoor' | 'conditionNonFunctioning' | 'conditionBStock'

const REVERB_CONDITION_LABEL: Record<string, ConditionLabelKey> = {
  'brand new': 'conditionBrandNew',
  'mint': 'conditionMint',
  'excellent': 'conditionExcellent',
  'very good': 'conditionVeryGood',
  'good': 'conditionGood',
  'fair': 'conditionFair',
  'poor': 'conditionPoor',
  'non functioning': 'conditionNonFunctioning',
  'b-stock': 'conditionBStock',
}

/**
 * PAN-263: the scatter and recharts (105 kB gzipped, a quarter of this page's
 * JavaScript) load after hydration, not before it. `ssr: false` because the
 * chart measures its container; the placeholder keeps the frame's height so
 * nothing below it moves when the code lands.
 */
const SoldPriceScatter = dynamic(
  () => import('@/components/SoldPriceScatter').then((m) => m.SoldPriceScatter),
  { ssr: false, loading: () => <div className="h-64 w-full min-w-0" aria-hidden="true" /> },
)

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
  played_by?: Array<{ artist: string; source_url: string }>
  iconic_uses?: Array<{ song: string; artist: string; year: number | null; source_url: string }>
  facets?: Record<string, string | number | boolean | string[]>
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

  // PAN-263: the two data requests this page waits on leave with the HTML
  // (`<link rel="preload" as="fetch">` in the SSR head) instead of after
  // hydration; the `fetch` calls below then join the in-flight requests. Same
  // URLs as the mount effects build. Measured on mobile: 2.8 s of a 5.6 s LCP
  // was this wait.
  preload(`/api/product/${slug}`, { as: 'fetch', crossOrigin: 'anonymous' })
  preload(`/api/product/${slug}/similar`, { as: 'fetch', crossOrigin: 'anonymous' })

  /**
   * PAN-296 (spike): what the card that opened this page was showing, taken
   * once on the first render so the hero exists in the navigation's commit —
   * the moment the shared-element morph pairs old and new. Null on a direct
   * load or a reload, which then renders the skeleton exactly as before.
   */
  const [handoff] = useState(() => takeHero(slug))

  const [product, setProduct]           = useState<Product | null>(null)
  const [listings, setListings]         = useState<Listing[]>([])
  /**
   * Presentation only. `false` is the order the API returned — score desc, id
   * asc — and it stays the default, so nothing about the existing ordering
   * changes unless the reader asks for it.
   */
  const [valueOrder, setValueOrder]     = useState(false)
  /**
   * The wall's render order, in two groups (PAN-274): the home market, then
   * everything else. `isHomeMarket` is the predicate the API already ordered
   * by (`homeMarketFirst`), so the seam the page draws between the groups is
   * the seam the data already has — nothing is reordered across it, and the
   * seam is drawn only when both groups exist. `orderByVerdictRank` then runs
   * INSIDE each group, so the seam survives the sort and a Reverb "under"
   * never outranks a Danish "typisk". It reads only the verdict the API
   * already computed — no price is compared, and a listing's population is
   * never crossed. See ./lib/listing-value-order for why that makes this a
   * presentation state rather than a price claim.
   */
  const wallGroups = useMemo(() => {
    const home: Listing[] = []
    const away: Listing[] = []
    for (const listing of listings) (isHomeMarket(listing) ? home : away).push(listing)
    const order = (group: Listing[]) => (valueOrder
      ? orderByVerdictRank(group, (l) => (l as Listing & ListingWithVerdict).marketVerdict)
      : group)
    return [
      { key: 'home' as const, listings: order(home), seam: false },
      { key: 'away' as const, listings: order(away), seam: home.length > 0 && away.length > 0 },
    ].filter((group) => group.listings.length > 0)
  }, [listings, valueOrder])
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

  /** "Lignende udstyr" (PAN-235), fetched on its own so it never holds the page back. */
  const [similar, setSimilar] = useState<SimilarProduct[]>([])

  /** Null for a product with no family — six of the seven families, and every
   *  product outside one. The breadcrumb then has no family crumb. */
  const [familyContext, setFamilyContext] = useState<FamilyContext | null>(null)
  /** The product's own category and kind (PAN-121), for the breadcrumb's
   *  catalogue crumbs. Null when it cannot be placed. */
  const [catalogueContext, setCatalogueContext] = useState<ProductPlacement | null>(null)

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
  const loadProduct = useCallback(async (fresh = false) => {
    try {
      // PAN-263: the public payload is cached for a minute. An ADMIN never
      // reads that copy: every product fetch of theirs is `?fresh=1`, so a
      // decision survives a reload and a return within the minute — the
      // contract admin-review-hotfix S6/R4 guard, kept for the people it
      // protects. `isAdmin` resolves a moment after mount; the effect below
      // re-runs this read when it does, so the first (cached) paint is
      // replaced by a fresh one. A visitor's refetch after a decision cannot
      // happen (the controls need isAdmin); `fresh` stays as the explicit
      // request the decision handlers make.
      const r = await fetch(`/api/product/${slug}${fresh || isAdmin ? '?fresh=1' : ''}`)
      if (r.status === 404) { setNotFound(true); return }
      const data = await r.json()
      if (!data) return
      // PAN-296 (spike): the skeleton-to-content swap is a React Transition,
      // so the `<ViewTransition>` wrappers below get to animate it. A plain
      // setState would swap it in one frame, as before.
      startTransition(() => {
        setProduct(data.product)
        setListings(data.listings ?? [])
        setPriceHistory(data.priceHistory ?? [])
        setPopulations(data.populations ?? null)
        setAwaitingReview(data.awaitingReview ?? 0)
        setDkAskingPrices(data.dkAskingPrices ?? [])
        setSoldCounts(data.soldCounts ?? null)
        setMonitoredSources(data.monitoredSources ?? [])
        setFamilyContext(data.familyContext ?? null)
        setCatalogueContext(data.catalogueContext ?? null)
      })
    } catch {
      setNotFound(true)
    } finally {
      // Same lane as the content, so the two cannot commit apart and show the
      // not-found branch for a frame in between.
      startTransition(() => setLoading(false))
    }
  }, [slug, isAdmin])

  // Runs on mount and again when `isAdmin` resolves to true (PAN-263: the
  // admin's uncached read replaces the cached first paint).
  useEffect(() => { void loadProduct() }, [loadProduct])

  useEffect(() => {
    fetch(`/api/product/${slug}/similar`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSimilar(data?.similar ?? []))
      .catch(() => setSimilar([]))
  }, [slug])

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
        else track('listing_saved', { source: listing.source, product_slug: slug })
      } catch {
        setSavedListingIds(prev)
      }
    }
  }

  /**
   * PAN-273. The max price the watch form opens with: the lower boundary of
   * the asking band the page itself shows — Danish first, Reverb as the
   * fallback — rounded to 100 kr. A listing under it is what the page calls
   * `under typisk`, so the prefill and the badge agree. Null without a band;
   * the field is then empty and the visitor names the price.
   */
  const suggestedMaxPrice = useMemo(() => {
    for (const key of ['dk-asking', 'reverb-asking'] as const) {
      const stats = populations?.[key]
      if (stats?.tier === 'band' && stats.widthOk && stats.q1 != null && stats.q1 > 0) {
        return Math.max(100, Math.round(stats.q1 / 100) * 100)
      }
    }
    return null
  }, [populations])

  // PAN-133: the precedence is not decided here. `hero_image_url ?? image_url`
  // used to be written inline twice in the hero below — correct, but a third
  // copy of a sentence that had already forked once (PAN-110) and once more in
  // the browse projection.
  const productImage = product ? resolveProductImage(product).url : null

  /**
   * One wall card, with its review controls. A function rather than inline
   * JSX because the wall renders it from two groups (PAN-274) and the card
   * block must stay one block. `product` is non-null wherever the wall
   * renders (the `notFound || !product` branch above returns first); the
   * guard here only satisfies the narrowing a closure cannot see.
   */
  const renderListing = (listing: Listing) => {
    if (!product) return null
    return (
      <ListingErrorBoundary key={listing.id} listingId={listing.id}>
        <div className="flex flex-col">
          <SearchResultCard
            listing={{ ...listing, title: stripDecorativeEmoji(listing.title) }}
            marketVerdict={(listing as ListingWithVerdict).marketVerdict}
            marketVerdictBasisLabel={(listing as ListingWithVerdict).marketVerdictBasisLabel}
            marketVerdictFewN={(listing as ListingWithVerdict).marketVerdictFewN}
            variant="list"
            thomannImageUrl={product.image_url}
            trackedProductSlug={product.slug}
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
                void loadProduct(true)
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
                void loadProduct(true)
                void loadMatchStatuses()
              }}
              onFailed={(message) => showToast(message, { type: 'error' })}
            />
          )}
        </div>
      </ListingErrorBoundary>
    )
  }

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
            <ViewTransition exit="vt-fade" default="none">
              <div className="shell-reading grid-hero gap-8">
                {/* PAN-296 (spike): with a handoff the hero is real from the
                    first frame — the card's image under the shared name, the
                    card's brand and name as text — and only the price block
                    and the wall are skeleton. Without one, the skeleton is
                    unchanged. */}
                {handoff ? (
                  <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted flex-shrink-0">
                    <ViewTransition name={productImageTransitionName(slug)} share="morph" default="none">
                      {handoff.imageUrl ? (
                        <Image
                          src={handoff.imageUrl}
                          alt={handoff.canonicalName}
                          fill
                          className="object-cover"
                          sizes="(max-width: 1024px) 100vw, 50vw"
                          priority
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon
                            name={handoff.placeholder as IconName}
                            style={{ fontSize: 72, color: 'var(--muted-foreground)' }}
                          />
                        </div>
                      )}
                    </ViewTransition>
                  </div>
                ) : (
                  <div className="aspect-square rounded-2xl bg-muted animate-pulse" />
                )}
                <div className="flex flex-col gap-4 pt-2">
                  {handoff ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                        {handoff.brandName}
                      </p>
                      <h1 className="type-title text-[1.75rem] md:text-[2.125rem] leading-tight">
                        {handoff.canonicalName}
                      </h1>
                    </div>
                  ) : (
                    <>
                      <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                      <div className="h-8 w-3/4 rounded-lg bg-muted animate-pulse" />
                    </>
                  )}
                  <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-12 w-2/3 rounded-lg bg-muted animate-pulse mt-4" />
                  <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-11 w-full rounded-xl bg-muted animate-pulse mt-6" />
                </div>
              </div>
            </ViewTransition>
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
              <TrackView
                viewKey={product.slug}
                event="product_viewed"
                properties={{
                  product_slug: product.slug,
                  category_root: catalogueContext?.category.slug ?? null,
                  kind: catalogueContext?.kind.slug ?? null,
                  has_price_band: populations != null &&
                    Object.values(populations).some((p) => p.tier === 'band'),
                }}
              />
              <ViewTransition enter="vt-fade" default="none">
              <div className="shell-reading flex flex-col">

                {/*
                  ── Breadcrumb (PAN-121, PAN-56, PAN-138) ───────
                  One trail: Alle kategorier / category / kind / family /
                  product. The catalogue crumbs come from the product's OWN
                  subcategory (`catalogueContext`, the sidebar tree's placement
                  rule), never from its family: PAN-52 §6, taxonomy is not
                  ancestry. A grouped leaf crumbs as its group
                  ("Synthesizere"). The family crumb is
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
                    {catalogueContext && (
                      <BreadcrumbItem
                        href={subcategoryHref(catalogueContext.category.slug, catalogueContext.kind.slug)}
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
                    {/* PAN-296 (spike): the other half of the card's shared
                        element — same name, so the morph lands here on the
                        way in and leaves from here on the way back. */}
                    <ViewTransition name={productImageTransitionName(slug)} share="morph" default="none">
                      {productImage && !imgError ? (
                        <Image
                          src={productImage}
                          alt={product.canonical_name}
                          fill
                          className="object-cover"
                          onError={() => setImgError(true)}
                          sizes="(max-width: 1024px) 100vw, 50vw"
                          // PAN-263: this is the page's LCP element, and it was
                          // `loading="lazy"` (Lighthouse `lcp-lazy-loaded`, 2.3 s
                          // of a 5.6 s mobile LCP). Eager + fetchpriority=high.
                          priority
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon
                            name={placeholderIcon(catalogueContext?.category.slug, catalogueContext?.kind.slug)}
                            style={{ fontSize: 72, color: 'var(--muted-foreground)' }}
                          />
                        </div>
                      )}
                    </ViewTransition>
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
                            {product.tier === 'legendary' ? t.tierLegendary : t.tierClassic}
                          </span>
                        )}
                      </div>
                      {product.era && (
                        <p className="text-sm text-muted-foreground">{product.era}</p>
                      )}
                      {/* PAN-236: the spec facets as one line of tokens; absent when a row has none. */}
                      {product.attributes?.facets && facetLine(product.attributes.facets).length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {facetLine(product.attributes.facets)
                            .map((item) => (item.count !== undefined ? fill(t[item.key as 'facetPatternCount'], { count: item.count }) : t[item.key as keyof typeof t]))
                            .join(' · ')}
                        </p>
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
                        {/* PAN-256: a thin Danish market is where a visitor's tip helps most. */}
                        {populations['dk-asking'].tier !== 'band' && (
                          <PriceTipLink surface="product" productSlug={product.slug} guessName={product.canonical_name} className="self-start" />
                        )}

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
                        {t.thomannNewPrice}:{' '}
                        <span className="font-semibold text-foreground">
                          {product.thomann_price_dkk.toLocaleString('da-DK')} kr
                        </span>{' '}
                        →
                      </a>
                    )}

                    {/* Listing count + the model watch (PAN-273) */}
                    <p className="text-sm text-muted-foreground pt-4 border-t border-border">
                      {listings.length === 0
                        ? t.productActiveListingsNone
                        : listings.length === 1
                          ? t.productActiveListingsOne
                          : fill(t.productActiveListings, { count: listings.length })}
                    </p>
                    <WatchProductForm
                      productSlug={product.slug}
                      productName={product.canonical_name}
                      suggestedMaxPrice={suggestedMaxPrice}
                    />
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

                  /**
                   * PAN-168 #5. Plot the population the statistics describe.
                   * `reverb-sold` drops Tukey-fence outliers before it counts
                   * `n`; drawing them anyway put 40 dots under `n = 39` and
                   * scaled the axis to the one sale the median ignores. Same
                   * function, same values as buildPopulationStats, so the
                   * dots, the axis, the period and `n` cannot disagree. The
                   * same predicate drops a Non Functioning sale first, as
                   * `reverb-sold` drops it before its fences (PAN-283).
                   */
                  const working = priceHistory.filter((pt) => !isNonFunctioning(pt.condition))
                  const { kept } = partitionByIqr(
                    working.map((pt) => pt.price).filter((p) => Number.isFinite(p) && p > 0),
                  )
                  const keptPrices = new Set(kept)
                  const counted = working.filter((pt) => keptPrices.has(pt.price))

                  const points = counted
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
                  const conditionLabel = (raw: string): string => {
                    const key = REVERB_CONDITION_LABEL[raw.trim().toLowerCase()]
                    return key ? t[key] : raw
                  }

                  const period = formatDateRange(
                    counted[0]?.sold_at,
                    counted[counted.length - 1]?.sold_at,
                  )
                  const yTicks = points.length > 0
                    ? niceTicks(
                        Math.min(...points.map((pt) => pt.price)),
                        Math.max(...points.map((pt) => pt.price)),
                      )
                    : []
                  /**
                   * PAN-242. On a time-scaled x-axis Recharts takes its ticks
                   * from the data values, so two sales at the same instant
                   * rendered two ticks with one key (240 console errors on
                   * the Juno-60). The same values, each once; the labels are
                   * still thinned by `minTickGap` below.
                   */
                  const xTicks = Array.from(new Set(points.map((pt) => pt.ts)))

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
                              label: conditionLabel(name),
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
                      <SoldPriceScatter
                        series={conditionSeries}
                        xTicks={xTicks}
                        yTicks={yTicks}
                        conditionLabel={conditionLabel}
                        locale={locale}
                      />
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

                {/*
                  ── Played by / Known from (PAN-237, PAN-238) ───
                  Sourced facts from `attributes`, each linked to the page it
                  was read from. Render only when data exists.
                */}
                {product.attributes?.played_by && product.attributes.played_by.length > 0 && (
                  <div className="flex flex-col gap-2 mb-10">
                    <p className="text-sm font-medium text-foreground">{t.playedBy}</p>
                    <p className="type-meta text-foreground max-w-[38rem]">
                      {product.attributes.played_by.map((f, i) => (
                        <span key={`${f.artist}-${i}`}>
                          {i > 0 && ' · '}
                          <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline" title={t.factSource}>
                            {f.artist}
                          </a>
                        </span>
                      ))}
                    </p>
                  </div>
                )}

                {product.attributes?.iconic_uses && product.attributes.iconic_uses.length > 0 && (
                  <div className="flex flex-col gap-2 mb-10">
                    <p className="text-sm font-medium text-foreground">{t.knownFrom}</p>
                    <ul className="type-meta text-foreground flex flex-col gap-1">
                      {product.attributes.iconic_uses.map((f, i) => (
                        <li key={`${f.song}-${i}`}>
                          <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline" title={t.factSource}>
                            “{f.song}” — {f.artist}{f.year ? ` (${f.year})` : ''}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

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
                  ── Similar gear (PAN-235) ──────────────────────

                  Explicit kg_relation rows, family siblings and same-type
                  rows, ranked in lib/similar-gear.ts and read from
                  /api/product/[slug]/similar, which gates every card with
                  isCanonical(): never a private product, never a family
                  label. It absorbs the authored `related_products` shelf
                  that stood here (as "alternative").

                  TWO IS THE SMALLEST NUMBER THAT IS A SHELF. `grid-fluid-sm`
                  lays out auto-fill columns of min 9.5rem, so a single card
                  sits in the first of eight columns above an empty row — a
                  heading promising gear above a grid that looks broken.
                */}
                {similar.length > 1 && (
                  <div className="flex flex-col gap-3 mb-10">
                    <p className="text-sm font-medium text-foreground">{t.similarGear}</p>
                    <div className="grid-fluid-sm gap-3">
                      {similar.map((rel) => (
                        <a
                          key={rel.slug}
                          href={`/product/${rel.slug}`}
                          className="flex flex-col gap-2 rounded-xl border border-border overflow-hidden hover:border-foreground/30 transition-colors"
                        >
                          <div className="aspect-square bg-muted relative">
                            <div className="absolute inset-0 flex items-center justify-center">
                              {/* The page's own kind stands in for the card's: the
                                  similar route carries no leaf, and its rows are
                                  the same type bar the named few (PAN-281). */}
                              <Icon
                                name={placeholderIcon(catalogueContext?.category.slug, catalogueContext?.kind.slug)}
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
                          <div className="flex flex-col gap-1 px-3 pb-3">
                            <span
                              className="self-start text-[11px] font-medium px-2 py-0.5 rounded-full"
                              style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
                            >
                              {t[SIMILAR_REASON_KEY[rel.reason]]}
                            </span>
                            <p className="type-meta text-foreground wrap-anywhere">{rel.name}</p>
                            {rel.active_listing_count > 0 && (
                              <p className="type-meta text-muted-foreground">
                                {rel.active_listing_count === 1
                                  ? t.productListingsOne
                                  : fill(t.productListings, { count: rel.active_listing_count })}
                              </p>
                            )}
                          </div>
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
                        void loadProduct(true)
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
                        {listings.length === 1
                          ? t.productListingsOne
                          : fill(t.productListings, { count: listings.length })}
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
                    {wallGroups.map((group) => (
                      <Fragment key={group.key}>
                        {/*
                          PAN-274: the market changes here, and the page says
                          so once — in words, with the tint as a second cue.
                          The note names Reverb only when every listing below
                          is Reverb; a Kleinanzeigen row is measured against
                          German asking prices, and the line must not say
                          Reverb then.
                        */}
                        {group.seam ? (
                          <ListSection
                            label={t.wallSeamLabel}
                            note={group.listings.every((l) => l.source === REVERB_SOURCE)
                              ? t.wallSeamReverb
                              : t.wallSeamOwnMarket}
                            muted
                          >
                            <div className="grid-wall grid-wall-lg">
                              {group.listings.map(renderListing)}
                            </div>
                          </ListSection>
                        ) : (
                          <div className="grid-wall grid-wall-lg">
                              {group.listings.map(renderListing)}
                          </div>
                        )}
                      </Fragment>
                    ))}
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
                {/* PAN-251: the user loop, closed from here too. */}
                <FeedbackLink surface="product" productSlug={product.slug} className="self-start" />
              </div>
              </ViewTransition>
            </>
          )}
        </div>
      </main>


      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
