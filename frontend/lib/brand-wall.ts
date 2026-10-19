/**
 * A brand wall's membership and its read — PAN-271.
 *
 * `/brand/<brand>/<kind>` lists every active listing of one brand in one
 * kind, with or without a model. Two reads feed it: the matches of the
 * brand's products in the kind (a match IS brand and kind evidence), and the
 * active listings whose title names the kind and whose brand Klup can see —
 * the DBA brand net's `source_query`, or the brand's own word in the title.
 * `selectBrandWallRows` is the pure merge of the two, exercised from plain
 * Node in scripts/lib/pan271-brand-wall.test.ts.
 *
 * A BRAND NEVER GETS A BAND (CLAUDE.md §7). Nothing here pools prices: a row
 * carries the SELLER'S asking price (the marketplace's own number, as every
 * listing card shows it) and, only when the listing is matched to a canonical
 * model with a band of its own, that model's `CardVerdict` — computed by
 * lib/listing-verdicts.ts per product, never across products. A listing with
 * no model, or a model with no band, carries `verdict: null`. There is no
 * field here a band edge or a median could travel in.
 *
 * WHAT A ROW MAY NAME. A model is named only when it is canonical
 * (`isCanonical`, the same predicate the product route 404s on), so no link
 * here resolves to a 404 and no private catalogue state reaches the page. A
 * listing matched to a hidden or QA model is still a listing of this brand in
 * this kind — it stays on the wall, with no model named and no verdict.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandWall } from './brand-walls'
import { CatalogueUnavailableError, isCanonical } from './catalogue'
import { formatOriginalPrice } from './currency'
import { fetchAllPages } from './exhaustive-fetch'
import { cardVerdictsByProduct, type CardVerdict, type MatchWithListing } from './listing-verdicts'
import { containsBrandToken } from './matching/brand-guard'
import { earliestInclusionMarker } from './matching/listing-intent'
import { BRASS_ACCESSORIES, cue } from './matching/match-listings'
import { PUBLIC_LISTING_SELECT, toPublicListing } from './public-product'

/** A product of the brand in the kind: a match target, named on a row only when canonical. */
export interface BrandWallProduct {
  id: string
  slug: string
  label: string
  canonical: boolean
}

/** A `listing_product_match` row as the wall reads it. */
export interface BrandWallMatchRow extends MatchWithListing {
  id: string
  product_id: string | null
}

/** An active listing whose title names the kind, with the one ingestion field the selection reads. */
export interface BrandWallCueRow {
  listing: Record<string, unknown> | null
  /** The DBA brand net's query (PAN-254): the only stored brand signal. Read here, never rendered. */
  source_query?: string | null
}

/**
 * One rendered row. The exact key set is pinned by the test: a seller's price
 * and the listing's own link are here — a wall row is a MARKETPLACE row for a
 * listing Klup cannot answer, and a navigation row for one it can — and
 * nothing a brand-level band, median or verdict could ride in.
 */
export interface BrandWallRow {
  id: string
  title: string
  source: string | null
  imageUrl: string | null
  /** The seller's asking price as written, formatted; null when the ad names none. */
  priceLabel: string | null
  /** The stored DKK figure, for the outbound event's bucket only. */
  priceDkk: number | null
  country: string | null
  /** The listing's own page. The card uses it only when no model is named. */
  url: string
  /** The canonical model this listing is matched to, or null. */
  childSlug: string | null
  childLabel: string | null
  /** PAN-272: the matched model's verdict for this listing, or null. */
  verdict: CardVerdict | null
  firstSeenAt: string | null
}

export interface BrandWallView {
  wall: BrandWall
  brand: { slug: string; name: string }
  kind: { label: string }
  root: { slug: string; label: string } | null
  /** The canonical models of the brand in the kind, in label order. Possibly empty. */
  models: ReadonlyArray<{ slug: string; label: string }>
  /** Newest first. THE DISPLAYED COUNTS ARE DERIVED FROM THIS ARRAY and nothing else. */
  rows: readonly BrandWallRow[]
  /** True once at least one model is canonical: the family threshold, so the robots rule is one rule. */
  published: boolean
}

/** A cue at a word start, prefix allowed: "trompeten", "Trompeter", "trompetkasse". */
function kindCueRegex(cues: readonly string[]): RegExp {
  const escaped = cues.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(?<![\\w-])(?:${escaped.join('|')})`, 'i')
}

/**
 * True when the title sells something FOR the horn: a brass accessory noun
 * with no inclusion marker before it — the rule `lineBoundaryRefusal` applies
 * on the rows, so the wall refuses exactly what the rows refuse.
 */
export function namesBrassAccessory(title: string): boolean {
  const markerAt = earliestInclusionMarker(title.toLowerCase())
  for (const noun of BRASS_ACCESSORIES) {
    const m = cue(noun).exec(title)
    if (m && !(markerAt !== -1 && markerAt < m.index)) return true
  }
  return false
}

export function selectBrandWallRows(input: {
  brandName: string
  cues: readonly string[]
  products: readonly BrandWallProduct[]
  matchRows: readonly BrandWallMatchRow[]
  cueRows: readonly BrandWallCueRow[]
  verdicts: ReadonlyMap<string, ReadonlyMap<string, CardVerdict>>
}): BrandWallRow[] {
  const productById = new Map(input.products.map((p) => [p.id, p]))
  const brandLower = input.brandName.trim().toLowerCase()
  const kindRe = kindCueRegex(input.cues)

  type Picked = { listing: ReturnType<typeof toPublicListing> & object; product: BrandWallProduct | null; score: number }
  const picked = new Map<string, Picked>()

  // 1. Matched listings: the product is the evidence. A listing matched to
  //    several products of the brand is shown under the canonical one, then
  //    the best-scoring, then the first slug — deterministic and independent
  //    of row order.
  for (const row of input.matchRows) {
    if (row.is_valid === false) continue
    const product = typeof row.product_id === 'string' ? productById.get(row.product_id) : undefined
    if (!product) continue
    const listing = toPublicListing(row.listings)
    if (!listing || listing.is_active === false) continue
    const score = typeof row.score === 'number' ? row.score : 0
    const prev = picked.get(listing.id)
    if (!prev || better(product, score, prev)) picked.set(listing.id, { listing, product, score })
  }

  // 2. Unmatched listings: the title names the kind, Klup can see the brand,
  //    and the ad is not an accessory for the horn.
  for (const raw of input.cueRows) {
    const listing = toPublicListing(raw.listing)
    if (!listing || listing.is_active === false || picked.has(listing.id)) continue
    const viaNet = (raw.source_query ?? '').trim().toLowerCase() === brandLower
    if (!viaNet && !containsBrandToken(listing.title, input.brandName)) continue
    if (!kindRe.test(listing.title)) continue
    if (namesBrassAccessory(listing.title)) continue
    picked.set(listing.id, { listing, product: null, score: 0 })
  }

  const rows: BrandWallRow[] = []
  for (const { listing, product } of picked.values()) {
    const named = product && product.canonical ? product : null
    rows.push({
      id: listing.id,
      title: listing.title,
      source: listing.source,
      imageUrl: listing.image_url && listing.image_url.trim().length > 0 ? listing.image_url : null,
      priceLabel: listing.price != null && listing.currency ? formatOriginalPrice(listing.price, listing.currency) : null,
      priceDkk: listing.price_dkk,
      country: listing.country,
      url: listing.url,
      childSlug: named ? named.slug : null,
      childLabel: named ? named.label : null,
      verdict: named ? (input.verdicts.get(named.id)?.get(listing.id) ?? null) : null,
      firstSeenAt: listing.first_seen_at,
    })
  }
  // Newest first; a row with no date goes last; ties by id, so two reads of
  // the same data render the same order.
  rows.sort((a, b) => {
    if (a.firstSeenAt !== b.firstSeenAt) {
      if (a.firstSeenAt == null) return 1
      if (b.firstSeenAt == null) return -1
      return a.firstSeenAt < b.firstSeenAt ? 1 : -1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return rows
}

function better(product: BrandWallProduct, score: number, prev: { product: BrandWallProduct | null; score: number }): boolean {
  if (!prev.product) return true
  if (product.canonical !== prev.product.canonical) return product.canonical
  if (score !== prev.score) return score > prev.score
  return product.slug < prev.product.slug
}

/** The music catalogue's brand category: a wall never names a brand outside it. */
const MUSIC_CATEGORY_SLUG = 'music-gear'

/**
 * Read a wall. Absence is `null` (an unknown brand or leaf is not a wall);
 * unavailability is a throw, never an empty wall — the family route's failure
 * model (§7.2), for the same reason: "no listings" must be true when said.
 */
export async function loadBrandWallView(admin: SupabaseClient, wall: BrandWall): Promise<BrandWallView | null> {
  const unavailable = (stage: string) => () => {
    throw new CatalogueUnavailableError(stage)
  }

  const [brandRes, leafRes] = await Promise.all([
    admin
      .from('kg_brand')
      .select('id, slug, name, kg_category!inner(slug)')
      .eq('slug', wall.brand)
      .eq('kg_category.slug', MUSIC_CATEGORY_SLUG)
      .maybeSingle()
      .then((r) => r, unavailable('brand_wall_brand_transport')),
    admin
      .from('kg_category')
      .select('id, slug, name_da, parent_id')
      .eq('slug', wall.leaf)
      .maybeSingle()
      .then((r) => r, unavailable('brand_wall_leaf_transport')),
  ])
  if (brandRes.error) throw new CatalogueUnavailableError('brand_wall_brand_lookup')
  if (leafRes.error) throw new CatalogueUnavailableError('brand_wall_leaf_lookup')
  const brand = brandRes.data as { id: string; slug: string; name: string } | null
  const leaf = leafRes.data as { id: string; slug: string; name_da: string | null; parent_id: string | null } | null
  if (!brand || !leaf || !leaf.name_da) return null

  const [rootRes, productsRes] = await Promise.all([
    leaf.parent_id
      ? admin
          .from('kg_category')
          .select('slug, name_da')
          .eq('id', leaf.parent_id)
          .maybeSingle()
          .then((r) => r, unavailable('brand_wall_root_transport'))
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('kg_product')
      .select('id, slug, canonical_name, status, support_state, browse_visibility')
      .eq('brand_id', brand.id)
      .eq('subcategory_id', leaf.id)
      .eq('status', 'active')
      .then((r) => r, unavailable('brand_wall_products_transport')),
  ])
  if (rootRes.error) throw new CatalogueUnavailableError('brand_wall_root_lookup')
  if (productsRes.error) throw new CatalogueUnavailableError('brand_wall_products_lookup')
  const rootRow = rootRes.data as { slug: string; name_da: string | null } | null
  const root = rootRow?.name_da ? { slug: rootRow.slug, label: rootRow.name_da } : null

  const productRows = (productsRes.data ?? []) as Array<{
    id: string; slug: string; canonical_name: string | null; status: string | null; support_state: string | null; browse_visibility: string | null
  }>
  // The four-axis predicate needs the projection's domain, as the family route reads it.
  const domainBySlug = new Map<string, string | null>()
  if (productRows.length > 0) {
    const projRes = await admin
      .from('browse_product_projection')
      .select('slug, browse_domain')
      .in('slug', productRows.map((p) => p.slug))
      .then((r) => r, unavailable('brand_wall_projection_transport'))
    if (projRes.error) throw new CatalogueUnavailableError('brand_wall_projection_lookup')
    for (const raw of (projRes.data ?? []) as Array<{ slug: string; browse_domain: string | null }>) {
      domainBySlug.set(raw.slug, raw.browse_domain ?? null)
    }
  }
  const products: BrandWallProduct[] = productRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    label: (p.canonical_name ?? '').trim() || p.slug,
    canonical: isCanonical({ ...p, browse_domain: domainBySlug.get(p.slug) ?? null }),
  }))

  const [matches, cueRows] = await Promise.all([
    products.length === 0
      ? Promise.resolve({ rows: [] as BrandWallMatchRow[], truncated: false })
      : fetchAllPages(
          async (from, to) => {
            const res = await admin
              .from('listing_product_match')
              .select(`id, product_id, score, is_valid, listings(${PUBLIC_LISTING_SELECT})`)
              .in('product_id', products.map((p) => p.id))
              .not('is_valid', 'is', false)
              .order('id', { ascending: true })
              .range(from, to)
              .then((r) => r, unavailable('brand_wall_matches_transport'))
            if (res.error) throw new CatalogueUnavailableError('brand_wall_matches_lookup')
            return (res.data ?? []) as unknown as BrandWallMatchRow[]
          },
          (row) => row.id,
        ),
    fetchAllPages(
      async (from, to) => {
        const res = await admin
          .from('listings')
          .select(`${PUBLIC_LISTING_SELECT}, source_query`)
          .eq('is_active', true)
          .or(`source_query.eq.${brand.name},title.ilike.%${brand.name}%`)
          .or(wall.cues.map((c) => `title.ilike.%${c}%`).join(','))
          .order('id', { ascending: true })
          .range(from, to)
          .then((r) => r, unavailable('brand_wall_listings_transport'))
        if (res.error) throw new CatalogueUnavailableError('brand_wall_listings_lookup')
        // `source_query` is not a public listing field, so the select string's type is widened by hand.
        return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map((raw) => ({
          listing: raw,
          source_query: typeof raw.source_query === 'string' ? raw.source_query : null,
        })) as Array<BrandWallCueRow & { listing: { id: string } }>
      },
      (row) => row.listing.id,
    ),
  ])

  // Verdicts per CANONICAL product, from that product's rows alone (PAN-272).
  const canonicalIds = new Set(products.filter((p) => p.canonical).map((p) => p.id))
  const verdicts = cardVerdictsByProduct(
    matches.rows.filter((r) => typeof r.product_id === 'string' && canonicalIds.has(r.product_id)) as Array<BrandWallMatchRow & { product_id: string }>,
    { incomplete: matches.truncated },
  )

  const rows = selectBrandWallRows({
    brandName: brand.name,
    cues: wall.cues,
    products,
    matchRows: matches.rows,
    cueRows: cueRows.rows,
    verdicts,
  })
  const models = products
    .filter((p) => p.canonical)
    .map((p) => ({ slug: p.slug, label: p.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'da'))

  return {
    wall,
    brand: { slug: brand.slug, name: brand.name },
    kind: { label: leaf.name_da },
    root,
    models,
    rows,
    published: models.length >= 1,
  }
}
