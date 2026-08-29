import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { hasPlausibleListingPrice } from '@/lib/listing-price-integrity'
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
const MATCH_WITH_LISTING_SELECT: string = `score, listings(${PUBLIC_LISTING_SELECT})`

function iqrFilter(prices: number[]): number[] {
  if (prices.length < 4) return prices
  const sorted = [...prices].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const iqr = q3 - q1
  const lo  = q1 - 1.5 * iqr
  const hi  = q3 + 1.5 * iqr
  return sorted.filter((p) => p >= lo && p <= hi)
}

function median(prices: number[]): number {
  const s = [...prices].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

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

  const [matchesRes, reverbRes, auctionetRes, relatedRes, relatedDomainRes] = await Promise.all([
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
    admin
      .from('listing_product_match')
      .select(MATCH_WITH_LISTING_SELECT)
      .eq('product_id', productId)
      .not('is_valid', 'is', false)
      .order('score', { ascending: false })
      .limit(50),
    // Reverb price history: deterministic FK join (mig 031 added the column,
    // mig 034 backfills it). Replaces the prior ilike on canonical_name which
    // pulled in parts and accessories — see CLAUDE.md "parts pollution".
    admin
      .from('reverb_price_history')
      .select('price, sold_at, condition')
      .eq('kg_product_id', productId)
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: true })
      .limit(500),
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

  if (matchesRes.error) throw new CatalogueUnavailableError('listing_lookup')

  type ListingRow = Record<string, unknown>
  // The typed select() parser cannot see through an interpolated select
  // string, so the row shape is asserted here and covered by the contract test.
  const matchRows = (matchesRes.data ?? []) as unknown as Array<{
    score: number | null
    listings: ListingRow | null
  }>

  const listings = matchRows
    .map((m) => ({ score: m.score ?? 0, listing: m.listings }))
    .filter(({ listing }) => listing != null && listing.is_active !== false)
    // Drop legacy Kleinanzeigen rows whose raw price violates the scraper's own
    // impossible-value bound — they would render prices in the tens of millions
    // of DKK on the product page. See lib/listing-price-integrity.ts.
    .filter(({ listing }) => hasPlausibleListingPrice({
      source: listing!.source as string | null,
      price:  listing!.price as number | string | null,
    }))
    .sort((a, b) => {
      const ta = new Date((a.listing?.scraped_at as string) ?? 0).getTime()
      const tb = new Date((b.listing?.scraped_at as string) ?? 0).getTime()
      return tb - ta
    })
    .map(({ listing }) => toPublicListing(listing))
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .slice(0, 50)

  // Build price history time-series
  const priceHistory: PricePoint[] = [
    ...(reverbRes.data ?? []).map((r) => ({
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

  // IQR-filtered price range
  const rawPrices = priceHistory.map((p) => p.price).filter((p) => p > 0)
  const filtered  = iqrFilter(rawPrices)
  const priceRange: PriceRange | null = filtered.length >= 3
    ? { low: Math.min(...filtered), high: Math.max(...filtered), median: Math.round(median(filtered)), count: filtered.length }
    : null

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
    { product, listings, priceHistory, priceRange, relatedProducts, adminPreview },
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
