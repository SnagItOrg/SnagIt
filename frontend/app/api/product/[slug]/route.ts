import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { hasPlausibleListingPrice, sanitizeListingPrice } from '@/lib/listing-price-integrity'
import { median as t7Median, partitionByIqr } from '@/lib/statistics'
import { fetchAllPages } from '@/lib/exhaustive-fetch'
import {
  buildPopulationStats,
  classifyListing,
  groupByPopulation,
  verdictBasisLabelKey,
  verdictFor,
  type PopulationKey,
  type PopulationStats,
} from '@/lib/price-populations'
import { isFamilySlug } from '@/lib/families'
import {
  CatalogueUnavailableError,
  isAdminOnly,
  isCanonical,
  isCatalogueUnavailable,
  resolveSlugRole,
  type CatalogueStateRow,
} from '@/lib/catalogue'
import {
  PUBLIC_LISTING_SELECT,
  PUBLIC_PRODUCT_SELECT,
  PUBLIC_RELATED_SELECT,
  toPublicListing,
  toPublicProduct,
  toPublicRelatedProduct,
  type PublicProduct,
  type PublicRelatedProduct,
} from '@/lib/public-product'

/**
 * Freshness. The same contract /api/search/resolve and /api/discover already
 * declare, and which this route was missing.
 *
 * TWO INDEPENDENT FAILURES ARRIVED AT THE SAME THREE EXPORTS, and both are
 * worth keeping on the record:
 *
 *   - Prices. Next's Data Cache stores the Supabase reads, so the page can
 *     serve prices from before the last scraper run. Observed 2026-09-01: two
 *     products kept returning pre-fix populations until
 *     `.next/cache/fetch-cache` was deleted. Price statistics must not be
 *     cached behind an ingestion run.
 *   - Curation. The same cache re-served a listing an operator had just
 *     rejected, which was the half of the "rejected card lingers" bug that
 *     survived a refresh; the other half was local state.
 *
 * One contract, two reasons. Removing it breaks both.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/** How many listings the wall renders. Not a statistical bound. */
const DISPLAY_LISTING_LIMIT = 50

export type PricePoint = {
  sold_at:   string
  price:     number
  condition: string | null
  source:    'reverb' | 'auctionet'
}

export type PriceRange = {
  low:    number
  high:   number
  median: number
  count:  number
}

/** Public shape of a related product. Re-exported for the client. */
export type RelatedProduct = PublicRelatedProduct

/**
 * Explicit embed. `listings(*)` shipped watchlist_id, ingestion_batch_id,
 * coverage_scope_hash and source_query to anonymous callers.
 *
 * Typed as `string` deliberately: the Supabase client parses select() string
 * LITERALS to type the result, and an interpolated literal defeats that parser.
 * The shape is asserted by the contract test instead.
 */
const MATCH_WITH_LISTING_SELECT: string = `id, score, is_valid, listings(${PUBLIC_LISTING_SELECT})`

/**
 * Quartiles moved to lib/statistics.ts (Type 7), owner decision C1.
 *
 * The estimator that used to live here indexed at `floor(n * p)`, which on
 * [1000,1200,1500,1800,2000,5000] returns Q1=1200 / Q3=2000 where Type 7 —
 * and `app/intel`, `api/price-observations` and Postgres `percentile_cont` —
 * return 1275 / 1950. This route is what the public price answer is built on,
 * so it was the one that had to move.
 */

/**
 * Identical 404 for every ineligible outcome.
 *
 * The body must not distinguish "no such slug" from "exists but is not
 * published": an unpublished product's existence is catalogue state, and the
 * public has no business learning it from a status body.
 */
function notFound() {
  return NextResponse.json(
    { error: 'not_found' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Eligibility could not be ESTABLISHED — as distinct from "the row is absent".
 *
 * Collapsing both into 404 told a monitor, a crawler and an operator that a
 * product does not exist when the database was merely unreachable, and invited
 * that 404 to be cached. Absence is 404; unavailability is 503 and never
 * cached. Carries no database detail: the query error is logged server-side on
 * the operational channel and never serialised.
 */
function catalogueUnavailable() {
  return NextResponse.json(
    { error: 'catalogue_unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
  )
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    return await handle(req, params.slug)
  } catch (error) {
    if (isCatalogueUnavailable(error)) {
      console.error('[operational] product eligibility unavailable', {
        route: '/api/product/[slug]',
        stage: error.stage,
      })
      return catalogueUnavailable()
    }
    throw error
  }
}

async function handle(req: NextRequest, slug: string) {
  const admin = getSupabaseAdmin()

  // -------------------------------------------------------------------
  // ELIGIBILITY GATE — Stage 3 WP-1.
  //
  // This runs BEFORE any product data is assembled and is the reason
  // /product and /api/product could be added to PUBLIC_PREFIXES in the same
  // commit. Without it, all 4,004 kg_product slugs render a canonical page —
  // including 307 inactive non-music rows (a MacBook, a Wegner chair, a
  // mountain bike) and 3,669 known/reserve rows that were never meant to have
  // a page. See docs/stage-3-v1-decision-and-build-plan.md §3.1.
  //
  // Family labels resolve FIRST: they are public-but-unsupported rows that
  // must redirect, not 404. WP-2 fills lib/families.ts; until then the list is
  // empty and those six slugs correctly 404.
  // -------------------------------------------------------------------
  if (isFamilySlug(slug)) {
    return NextResponse.redirect(new URL(`/family/${slug}`, req.url), 308)
  }

  // A transport-level throw (DNS failure, connection refused, TLS error) never
  // reaches the `{ data, error }` shape at all — it rejects. Both failure modes
  // must land on 503, so the await itself is wrapped.
  const [productRes, projectionRes] = await Promise.all([
    admin
      .from('kg_product')
      .select(PUBLIC_PRODUCT_SELECT)
      .eq('slug', slug)
      .maybeSingle(),
    // The music axis lives on the projection, not on kg_product. The four
    // supported rows with no subcategory still resolve browse_domain='music'
    // via the view's COALESCE, so this guard costs no canonical product.
    admin
      .from('browse_product_projection')
      .select('slug, browse_domain')
      .eq('slug', slug)
      .maybeSingle(),
  ]).catch(() => {
    throw new CatalogueUnavailableError('product_transport')
  })

  // A query ERROR is not an absent row. maybeSingle() gives data:null with
  // error:null for "no such slug", and a populated error for anything else.
  if (productRes.error) throw new CatalogueUnavailableError('product_lookup')
  if (projectionRes.error) throw new CatalogueUnavailableError('projection_lookup')

  const productRow = productRes.data as Record<string, unknown> | null
  if (!productRow) return notFound()

  const state: CatalogueStateRow = {
    status: productRow.status as string | null,
    support_state: productRow.support_state as string | null,
    browse_visibility: productRow.browse_visibility as string | null,
    browse_domain:
      (projectionRes.data as { browse_domain?: string | null } | null)?.browse_domain ?? null,
  }

  // Admin state is resolved server-side from user_preferences.is_admin, and
  // only when it could change the outcome — an anonymous request for a
  // canonical product must not pay for a session lookup.
  const canonical = isCanonical(state)
  const isAdmin = canonical ? false : isAdminOnly(state) ? await isCurrentUserAdmin() : false

  const role = resolveSlugRole({ row: state, isFamilySlug: false, isAdmin })
  if (role !== 'canonical' && role !== 'admin_only') {
    return notFound()
  }

  const adminPreview = role === 'admin_only'

  // THE PUBLIC DTO. Constructed field by field from an explicit SELECT; the
  // eligibility axes and the internal id above are inputs and stop here.
  const product: PublicProduct | null = toPublicProduct(productRow)
  if (!product) throw new CatalogueUnavailableError('product_shape')

  const canonicalName = product.canonical_name
  /** Join key only — never a response field. */
  const productId = productRow.id as string

  const relatedSlugs: string[] = (product.attributes?.related_products ?? [])
    .map((r) => r.slug)
    .slice(0, 6)

  /**
   * One page of matched listings, ordered deterministically.
   *
   // A REJECTED MATCH IS NOT EVIDENCE. `is_valid = false` is an explicit
   // verdict — written by the matcher's hard brand-collision branch, by the
   // AI validation pass, or by an admin through /admin/product/[slug] — and
   // this query discarded it, so every adjudicated wrong match still rendered
   // on the public page.
   //
   // Measured 2026-08-29 across the 14 canonical products: 87 of the 309
   // rendered rows (28.2%) were already marked `is_valid = false`, on 10 of
   // the 14 products, peaking at 68.6% on `roland-jupiter-8`. They are slider
   // caps, potentiometers, benders, EPROMs, service schematics and Voyager
   // variants — each carrying a written `rejected_reason` explaining why it is
   // not this product, sitting in the price evidence for it.
   //
   // `.not('is_valid','is',false)` keeps NULL and true, and drops only the
   // explicit rejection. NULL must stay: it is the normal state of an
   // automatic match, and the matcher's contract treats it as trusted.

   */
  const fetchMatchPage = async (from: number, to: number) => {
    const res = await admin
      .from('listing_product_match')
      .select(MATCH_WITH_LISTING_SELECT)
      .eq('product_id', productId)
      .not('is_valid', 'is', false)
      // `id` is the unique tie-breaker. Without it, equal scores can reorder
      // between requests and rows are silently dropped or duplicated across a
      // page boundary.
      .order('score', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
    if (res.error) throw new CatalogueUnavailableError('listing_lookup')
    return (res.data ?? []) as unknown as Array<{ id: string; score: number | null; is_valid: boolean | null; listings: Record<string, unknown> | null }>
  }

  const [matchesAll, reverbAll, auctionetRes, relatedRes, relatedDomainRes] = await Promise.all([
    // Read to exhaustion. No maximum population size is stated anywhere.
    fetchAllPages(fetchMatchPage, (row) => row.id),

    // Reverb price history: deterministic FK join (mig 031 added the column,
    // mig 034 backfills it). Replaces the prior ilike on canonical_name which
    // pulled in parts and accessories — see CLAUDE.md "parts pollution".
    /**
     * Sold history is a statistical population too, so it is read to
     * exhaustion for the same reason the asking side is: a `.limit()` here
     * would be a completeness guarantee that nobody re-checks. `sold_at` is
     * not unique, so `id` is the tie-breaker that makes paging deterministic.
     * The widest product today is 89 rows — one page.
     */
    fetchAllPages(
      async (from, to) => {
        const res = await admin
          .from('reverb_price_history')
          .select('id, price, sold_at, condition')
          .eq('kg_product_id', productId)
          .not('sold_at', 'is', null)
          .order('sold_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (res.error) throw new CatalogueUnavailableError('sold_history_lookup')
        return (res.data ?? []) as Array<Record<string, unknown>>
      },
      (row) => String(row.id),
    ),
    // Auctionet still uses ilike — auctionet_price_history has no kg_product_id
    // column yet. Migrating it is a separate, scoped change.
    admin
      .from('auctionet_price_history')
      .select('price, sold_at, condition')
      .ilike('query', `%${canonicalName}%`)
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: true })
      .limit(500),
    // Related products are resolved through the SAME eligibility predicate as
    // the page itself. Measured on production 2026-08-27: 10 of the 15 related
    // links authored on canonical pages point at products that are not
    // canonical (roland-alpha-juno-1, roland-jp-8, sequential-prophet-6,
    // oberheim-dmx, roland-jp-6). Rendering them once /product is public would
    // put links to guaranteed 404s on the three best pages Klup has.
    relatedSlugs.length > 0
      ? admin.from('kg_product').select(PUBLIC_RELATED_SELECT).in('slug', relatedSlugs)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    // ...and the FOURTH axis, browse_domain, from the projection for the same
    // slugs. Without this the related gate would be three axes plus an
    // assumption while claiming to be the four-axis contract.
    relatedSlugs.length > 0
      ? admin
          .from('browse_product_projection')
          .select('slug, browse_domain')
          .in('slug', relatedSlugs)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]).catch(() => {
    throw new CatalogueUnavailableError('detail_transport')
  })

  if (relatedRes.error || relatedDomainRes.error) {
    throw new CatalogueUnavailableError('related_lookup')
  }


  type ListingRow = Record<string, unknown>
  // The typed select() parser cannot see through an interpolated select
  // string, so the row shape is asserted here and covered by the contract test.
  const matchRows = matchesAll.rows as unknown as Array<{
    score: number | null
    is_valid: boolean | null
    listings: ListingRow | null
  }>

  const allMatched = matchRows
    .map((m) => ({ score: m.score ?? 0, isVerified: m.is_valid === true, listing: m.listings }))
    .filter(({ listing }) => listing != null && listing.is_active !== false)
    // Normalise a legacy Kleinanzeigen discount pair before anything renders
    // it. 235240 is 235 EUR now, down from 240 — two real prices welded by an
    // old parser, not a corrupt number — so the current price is recovered and
    // its DKK figure rescaled to match. See lib/listing-price-integrity.ts.
    // Only a value that is still beyond belief AFTER recovery is dropped; the
    // recovery itself happens in `toPublicListing`, the one place the public
    // price is built.
    .filter(({ listing }) => hasPlausibleListingPrice({
      source: (listing as { source?: string | null } | null)?.source ?? null,
      price:  sanitizeListingPrice({
        source: (listing as { source?: string | null } | null)?.source ?? null,
        price:  (listing as { price?: number | string | null } | null)?.price ?? null,
      }).price,
    }))
    .sort((a, b) => {
      const ta = new Date((a.listing?.scraped_at as string) ?? 0).getTime()
      const tb = new Date((b.listing?.scraped_at as string) ?? 0).getTime()
      return tb - ta
    })
    .map(({ isVerified, listing }) => ({ isVerified, listing: toPublicListing(listing) }))
    .filter((m): m is { isVerified: boolean; listing: NonNullable<typeof m.listing> } => m.listing !== null)

  /**
   * TWO ELIGIBILITY CONTRACTS, deliberately different. Owner decision,
   * 2026-09-01.
   *
   *   WALL        is_valid IS NOT FALSE   — hides adjudicated rejections,
   *                                          still shows unreviewed matches
   *   STATISTICS  is_valid = true         — only explicitly verified matches
   *
   * The wall is a place to look; a median is a claim. An unreviewed automatic
   * match is fine to show a person who can judge it themselves, and not fine
   * to average. Measured 2026-09-01: DX7's asking population was dominated by
   * unreviewed `score=70, method=MODEL` rows that are ROM cartridges, manuals
   * and wood side panels; MS-20's by replacement keys and a power adapter;
   * Minimoog's extreme by a Voyager; Jupiter-8's by a two-instrument bundle.
   * Every one of them is `is_valid IS NULL`.
   *
   * Sold history is unaffected: it does not come through
   * `listing_product_match` and has its own contract.
   */
  const allListings = allMatched.map((m) => m.listing)
  const verifiedListings = allMatched.filter((m) => m.isVerified).map((m) => m.listing)

  /**
   * The wall shows a page of the wall population; statistics use the whole
   * verified population. A median over "the 50 newest listings" is a different
   * statistic from a median over the product's verified listings.
   */
  const listings = allListings.slice(0, DISPLAY_LISTING_LIMIT)

  // Build price history time-series
  const priceHistory: PricePoint[] = [
    ...reverbAll.rows.map((r) => ({
      sold_at:   r.sold_at as string,
      price:     Number(r.price),
      condition: r.condition as string | null,
      source:    'reverb' as const,
    })),
    ...(auctionetRes.data ?? []).map((r) => ({
      sold_at:   r.sold_at as string,
      price:     Number(r.price),
      condition: r.condition as string | null,
      source:    'auctionet' as const,
    })),
  ].sort((a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime())

  // Legacy sold range. Retained so nothing downstream breaks, now computed
  // through the shared Type 7 contract. The page no longer renders it as the
  // headline — see `populations` below.
  const rawPrices = priceHistory.map((p) => p.price).filter((p) => p > 0)
  const filtered  = partitionByIqr(rawPrices).kept
  const filteredMedian = t7Median(filtered)
  const priceRange: PriceRange | null = filtered.length >= 3 && filteredMedian != null
    ? { low: Math.min(...filtered), high: Math.max(...filtered), median: Math.round(filteredMedian), count: filtered.length }
    : null

  /**
   * Six populations, never blended.
   *
   * Asking rows are grouped by platform/market; sold rows are their own
   * population and are the only ones that may be called sales. Everything the
   * page renders — median, band, verdict, counts — is derived from exactly one
   * of these, which is why the page cannot accidentally mix markets.
   */
  const grouped = groupByPopulation(verifiedListings)
  // A truncated read is an incomplete population, and an incomplete
  // population produces no statistics at all — see BuildOptions.incomplete.
  const askingIncomplete = { incomplete: matchesAll.truncated }
  const soldIncomplete = { incomplete: reverbAll.truncated }
  const populations = {
    'dk-asking':     buildPopulationStats('dk-asking',     grouped.byPopulation['dk-asking'], askingIncomplete),
    'de-asking':     buildPopulationStats('de-asking',     grouped.byPopulation['de-asking'], askingIncomplete),
    'se-asking':     buildPopulationStats('se-asking',     grouped.byPopulation['se-asking'], askingIncomplete),
    'no-asking':     buildPopulationStats('no-asking',     grouped.byPopulation['no-asking'], askingIncomplete),
    'reverb-asking': buildPopulationStats('reverb-asking', grouped.byPopulation['reverb-asking'], askingIncomplete),
    'reverb-sold':   buildPopulationStats('reverb-sold', priceHistory.map((p) => ({
      price: p.price,
      price_dkk: p.price,
      source: p.source,
      country: null,
      condition: p.condition,
    })), soldIncomplete),
  } satisfies Record<PopulationKey, PopulationStats>

  /**
   * One reconciled explanation of the two sold counts the page used to show.
   * Null when the sold read was truncated — a partial raw count reads exactly
   * like a real one.
   */
  const soldCounts = reverbAll.truncated ? null : {
    raw: rawPrices.length,
    filtered: populations['reverb-sold'].nFiltered,
    excludedOutliers: populations['reverb-sold'].excluded.iqr_outlier,
  }

  /**
   * How the wall population narrows to the statistical one. Every step is
   * named so the difference between "shown" and "counted" is auditable:
   *
   *   wallRawN
   *     − excludedUnverifiedN   (is_valid IS NULL — shown, never counted)
   *   = verifiedStatisticalN
   *     − unresolvedN           (no market could be established)
   *     − excludedPriceN        (no price, or no comparable DKK)
   *   = priceEligibleN
   *     − excludedOutlierN      (Tukey fences)
   *   = filteredN               (what every published statistic is built on)
   */
  const ASKING_KEYS = ['dk-asking', 'de-asking', 'se-asking', 'no-asking', 'reverb-asking'] as const
  const sumOver = (pick: (p: PopulationStats) => number) =>
    ASKING_KEYS.reduce((total, key) => total + pick(populations[key]), 0)

  const eligibility = matchesAll.truncated ? null : {
    wallRawN: allListings.length,
    verifiedStatisticalN: verifiedListings.length,
    excludedUnverifiedN: allListings.length - verifiedListings.length,
    unresolvedN: grouped.unresolved.length,
    priceEligibleN: sumOver((p) => p.nEligible),
    excludedPriceN: sumOver((p) => p.excluded.price_not_listed + p.excluded.no_comparable_dkk),
    filteredN: sumOver((p) => p.nFiltered),
    excludedOutlierN: sumOver((p) => p.excluded.iqr_outlier),
  }

  /**
   * The deal signal, computed SERVER-SIDE against the listing's OWN population.
   *
   * The client never re-derives quartiles or boundaries — it renders a label.
   * `verdictFor` refuses anything that is not a complete, banded, width-passing
   * population whose key equals the listing's own, so every gate (unreviewed,
   * missing price_dkk, unknown population, n < 8, median-only, listings-only,
   * none, truncated, too wide, population mismatch) resolves to null here
   * rather than in a template.
   *
   * Only asking populations can ever produce one: `reverb-sold` is not a
   * classification any listing receives, so a card verdict can never be
   * measured against sold prices.
   */
  const verifiedIds = new Set(verifiedListings.map((l) => l.id))
  const listingsWithVerdict = listings.map((listing) => {
    const population = verifiedIds.has(listing.id)
      ? classifyListing(listing).population
      : null
    const stats = population ? populations[population] : null
    const outcome = stats
      ? verdictFor(listing.price_dkk, population, stats)
      : { verdict: null, against: null }
    return {
      ...listing,
      marketVerdict: outcome.verdict,
      marketVerdictPopulation: outcome.against,
      marketVerdictBasisLabel: verdictBasisLabelKey(outcome.against),
    }
  })

  /** Listings whose market could not be established are named, never guessed. */
  const unresolvedListings = grouped.unresolved.length

  /** Retrieval evidence: how many requests the population cost, and whether
   *  the page loop ever hit its safety bound. `truncated: true` would mean a
   *  statistic is incomplete and must not be trusted. */
  const retrieval = {
    matchPages: matchesAll.pages,
    matchRows: matchesAll.rows.length,
    soldPages: reverbAll.pages,
    soldRows: reverbAll.rows.length,
    truncated: matchesAll.truncated || reverbAll.truncated,
  }

  const relatedDomains = new Map<string, string | null>(
    ((relatedDomainRes.data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => typeof r.slug === 'string')
      .map((r) => [r.slug as string, (r.browse_domain as string | null) ?? null]),
  )

  const relatedProducts: RelatedProduct[] = ((relatedRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((r) =>
      isCanonical({
        status: r.status as string | null,
        support_state: r.support_state as string | null,
        browse_visibility: r.browse_visibility as string | null,
        browse_domain: relatedDomains.get(r.slug as string) ?? null,
      }),
    )
    .map((r) => toPublicRelatedProduct(r))
    .filter((r): r is RelatedProduct => r !== null)

  return NextResponse.json(
    { product, listings: listingsWithVerdict, priceHistory, priceRange, populations, soldCounts, eligibility, unresolvedListings, retrieval, relatedProducts, adminPreview },
    {
      headers: adminPreview
        // An unpublished product must never enter a shared cache.
        ? { 'Cache-Control': 'private, no-store' }
        // Eligibility is a correctness boundary, so a canonical response is not
        // handed to a shared cache either: a 60-second s-maxage meant a
        // depublished product could still be served from the CDN after the
        // origin had started refusing it. Same reasoning as /api/discover.
        : { 'Cache-Control': 'no-store' },
    },
  )
}
