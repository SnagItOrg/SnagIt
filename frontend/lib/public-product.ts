/**
 * The public product response contract.
 *
 * Stage 3 WP-1. See docs/stage-3-v1-decision-and-build-plan.md §7.2.
 *
 * WHAT THIS FIXES. `/api/product/[slug]` selected `kg_product.*` and returned
 * the row verbatim. Once /product became public that shipped all 30 columns to
 * anonymous callers, including the operator-only axes the whole lifecycle model
 * exists to keep separate — `support_state`, `browse_visibility`, `status`,
 * `cleanup_status` — plus `subcategory_confidence`, the Reverb provider ids
 * (`reverb_csp_id`, `reverb_root_slug`, `reverb_sub_slug`), unpublished price
 * fields (`price_min_dkk`, `price_max_dkk`, `msrp_dkk`), four internal UUIDs and
 * `created_at`. A visitor could read Klup's private catalogue strategy from the
 * network tab.
 *
 * TWO RULES, BOTH ENFORCED BY TESTS:
 *   1. SELECT is explicit — the public columns plus the gate axes, named.
 *   2. The response is CONSTRUCTED field by field, never "fetch the row and
 *      delete the bad keys". A stripping approach fails open: add a column to
 *      kg_product and it ships. Construction fails closed: add a column and
 *      nothing happens until someone edits this file.
 *
 * The gate axes ARE selected — eligibility needs them — but they are read by
 * lib/catalogue.ts and never copied into the response.
 */

import { sanitizeListingPrice } from './listing-price-integrity'

/** Editorial keys inside `attributes` that may reach the public. */
export const PUBLIC_ATTRIBUTE_KEYS = [
  'description',
  'specs',
  'history',
  'external_links',
  'related_products',
] as const

/**
 * Attribute keys observed in production that must NEVER be public.
 * `reverb_csp` is on 10 of the 14 canonical products and
 * `reverb_csp_candidates` on 4 — external provider identifiers and the
 * unresolved candidate list behind them.
 */
export const FORBIDDEN_ATTRIBUTE_KEYS = ['reverb_csp', 'reverb_csp_candidates', 'type'] as const

/** Exact allow-list of top-level fields in the public product object. */
export const PUBLIC_PRODUCT_FIELDS = [
  'slug',
  'canonical_name',
  'era',
  'year_released',
  'tier',
  'image_url',
  'hero_image_url',
  'thomann_price_dkk',
  'thomann_url',
  'attributes',
  'kg_brand',
] as const

export type PublicProductField = (typeof PUBLIC_PRODUCT_FIELDS)[number]

/** Fields that must never appear, asserted by the contract test. */
export const FORBIDDEN_PRODUCT_FIELDS = [
  'id',
  'brand_id',
  'category_id',
  'subcategory_id',
  'subcategory_confidence',
  'status',
  'support_state',
  'browse_visibility',
  'cleanup_status',
  'price_min_dkk',
  'price_max_dkk',
  'msrp_dkk',
  'reverb_csp_id',
  'reverb_root_slug',
  'reverb_sub_slug',
  'model_name',
  'reference_url',
  'created_at',
  'thomann_price_updated_at',
  'tags',
] as const

export type PublicSpecs = Record<string, string | boolean | number>

export type PublicAttributes = {
  description?: string
  specs?: PublicSpecs
  history?: Array<{ year: number; title: string; body: string }>
  external_links?: Array<{ label: string; url: string }>
  related_products?: Array<{ slug: string; reason: string }>
}

export type PublicBrand = { name: string; slug: string }

export type PublicProduct = {
  slug: string
  canonical_name: string
  era: string | null
  year_released: number | null
  tier: string | null
  image_url: string | null
  hero_image_url: string | null
  thomann_price_dkk: number | null
  thomann_url: string | null
  attributes: PublicAttributes | null
  kg_brand: PublicBrand | null
}

/** Minimal public shape for a related product. Never the full DTO. */
export type PublicRelatedProduct = {
  slug: string
  name: string
  image_url: string | null
}

/**
 * Explicit column list for the product query.
 *
 * The trailing axes are eligibility inputs only. They are consumed by
 * lib/catalogue.ts and are absent from `toPublicProduct`'s output.
 */
export const PUBLIC_PRODUCT_SELECT = [
  // join key — used server-side for listing and price-history joins, and, like
  // the eligibility axes below, never serialised into the response
  'id',
  'slug',
  'canonical_name',
  'era',
  'year_released',
  'tier',
  'image_url',
  'hero_image_url',
  'thomann_price_dkk',
  'thomann_url',
  'attributes',
  'kg_brand(name, slug)',
  // eligibility axes — read by the gate, never serialised
  'status',
  'support_state',
  'browse_visibility',
].join(', ')

/**
 * Related products carry their own state axes so they pass the same gate, and
 * their public shape is three fields.
 */
export const PUBLIC_RELATED_SELECT = [
  'slug',
  'canonical_name',
  'image_url',
  'status',
  'support_state',
  'browse_visibility',
].join(', ')

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Whitelist `attributes` by key.
 *
 * `specs._source` is dropped too: the client already hides it, but "hidden in
 * the UI" is not "absent from the payload".
 */
export function toPublicAttributes(raw: unknown): PublicAttributes | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out: PublicAttributes = {}

  if (typeof src.description === 'string') out.description = src.description

  if (src.specs && typeof src.specs === 'object' && !Array.isArray(src.specs)) {
    const specs: PublicSpecs = {}
    for (const [key, value] of Object.entries(src.specs as Record<string, unknown>)) {
      if (key === '_source') continue
      if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
        specs[key] = value
      }
    }
    if (Object.keys(specs).length > 0) out.specs = specs
  }

  if (Array.isArray(src.history)) {
    const history = src.history
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map((m) => ({
        year: asNumber(m.year) ?? 0,
        title: asString(m.title) ?? '',
        body: asString(m.body) ?? '',
      }))
    if (history.length > 0) out.history = history
  }

  if (Array.isArray(src.external_links)) {
    const links = src.external_links
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .map((l) => ({ label: asString(l.label) ?? '', url: asString(l.url) ?? '' }))
      .filter((l) => l.url !== '')
    if (links.length > 0) out.external_links = links
  }

  if (Array.isArray(src.related_products)) {
    const related = src.related_products
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({ slug: asString(r.slug) ?? '', reason: asString(r.reason) ?? '' }))
      .filter((r) => r.slug !== '')
    if (related.length > 0) out.related_products = related
  }

  return Object.keys(out).length > 0 ? out : null
}

/** Build the public product object field by field. Never spread the row. */
export function toPublicProduct(raw: unknown): PublicProduct | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>

  const slug = asString(row.slug)
  const canonicalName = asString(row.canonical_name)
  if (!slug || !canonicalName) return null

  // `kg_brand` arrives as an object or a single-element array depending on how
  // PostgREST resolves the embed.
  const brandRaw = Array.isArray(row.kg_brand) ? row.kg_brand[0] : row.kg_brand
  let kgBrand: PublicBrand | null = null
  if (brandRaw && typeof brandRaw === 'object') {
    const b = brandRaw as Record<string, unknown>
    const name = asString(b.name)
    const brandSlug = asString(b.slug)
    if (name) kgBrand = { name, slug: brandSlug ?? '' }
  }

  return {
    slug,
    canonical_name: canonicalName,
    era: asString(row.era),
    year_released: asNumber(row.year_released),
    tier: asString(row.tier),
    image_url: asString(row.image_url),
    hero_image_url: asString(row.hero_image_url),
    thomann_price_dkk: asNumber(row.thomann_price_dkk),
    thomann_url: asString(row.thomann_url),
    attributes: toPublicAttributes(row.attributes),
    kg_brand: kgBrand,
  }
}

/** Build the minimal related-product shape. Three fields, constructed. */
export function toPublicRelatedProduct(raw: unknown): PublicRelatedProduct | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const slug = asString(row.slug)
  const name = asString(row.canonical_name)
  if (!slug || !name) return null
  return { slug, name, image_url: asString(row.image_url) }
}

/* ------------------------------------------------------------------ *
 * Public listing shape
 * ------------------------------------------------------------------ */

/**
 * `listings(*)` had the same defect as `kg_product.*`: it shipped all 28
 * columns to anonymous callers, including `watchlist_id` (which links a listing
 * to a specific user's watchlist), `ingestion_batch_id`, `ingested_at`,
 * `coverage_scope_hash`, `source_query`, `last_miss_run_id`,
 * `consecutive_misses`, `normalized_text`, `notified_at` and `brand_id` —
 * Klup's ingestion and monitoring internals, on a public endpoint.
 */
export const PUBLIC_LISTING_FIELDS = [
  'id',
  'title',
  'price',
  'currency',
  'price_dkk',
  'url',
  'image_url',
  'location',
  'country',
  'source',
  'platform',
  'condition',
  'is_active',
  'scraped_at',
  'first_seen_at',
  'last_seen_at',
] as const

export const FORBIDDEN_LISTING_FIELDS = [
  'watchlist_id',
  'ingestion_batch_id',
  'ingested_at',
  'coverage_scope_hash',
  'source_query',
  'last_miss_run_id',
  'consecutive_misses',
  'normalized_text',
  'notified_at',
  'delisted_at',
  'brand_id',
  'external_id',
] as const

export type PublicListing = {
  id: string
  title: string
  price: number | null
  currency: string | null
  price_dkk: number | null
  url: string
  image_url: string | null
  location: string | null
  country: string | null
  source: string | null
  platform: string | null
  condition: string | null
  is_active: boolean | null
  scraped_at: string | null
  first_seen_at: string | null
  last_seen_at: string | null
}

/** Explicit embed selection for `listing_product_match -> listings`. */
export const PUBLIC_LISTING_SELECT = PUBLIC_LISTING_FIELDS.join(', ')

export function toPublicListing(raw: unknown): PublicListing | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = asString(row.id)
  const title = asString(row.title)
  const url = asString(row.url)
  if (!id || !title || !url) return null

  /**
   * Normalise a legacy Kleinanzeigen discount pair before it is published.
   *
   * 235240 is 235 EUR now, down from 240 — two real prices welded together by
   * an old parser reading the wrapper element, not a corrupt value. The current
   * price is recovered and `price_dkk` rescaled by the same ratio, so the two
   * never disagree on the page.
   */
  const safe = sanitizeListingPrice({
    source:    asString(row.source),
    price:     asNumber(row.price),
    price_dkk: asNumber(row.price_dkk),
  })

  return {
    id,
    title,
    price: safe.price,
    currency: asString(row.currency),
    price_dkk: safe.price_dkk,
    url,
    image_url: asString(row.image_url),
    location: asString(row.location),
    country: asString(row.country),
    source: asString(row.source),
    platform: asString(row.platform),
    condition: asString(row.condition),
    is_active: typeof row.is_active === 'boolean' ? row.is_active : null,
    scraped_at: asString(row.scraped_at),
    first_seen_at: asString(row.first_seen_at),
    last_seen_at: asString(row.last_seen_at),
  }
}
