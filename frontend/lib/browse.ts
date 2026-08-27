import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CATALOGUE_STATE_SELECT,
  CatalogueUnavailableError,
  assertSupportedCohortIsMusic,
  loadSupportedSlugs,
} from '@/lib/catalogue'

export type BrowseProjectionRow = {
  id: string
  slug: string
  canonical_name: string
  brand_id: string | null
  brand_slug: string | null
  brand_name: string | null
  category_id: string | null
  legacy_category_slug: string | null
  subcategory_id: string | null
  subcategory_slug: string | null
  subcategory_name_da: string | null
  subcategory_name_en: string | null
  root_category_id: string | null
  root_category_slug: string | null
  root_category_name_da: string | null
  root_category_name_en: string | null
  browse_domain: string | null
  status: string
  tier: string
  tier_rank: number
  image_url: string | null
  has_image: boolean
  active_listing_count: number
  browse_visibility: 'public' | 'qa_only' | 'hidden'
  taxonomy_state: 'classified' | 'missing_subcategory' | 'missing_root_mapping'
  supply_state: 'live' | 'no_live_listings'
  is_public: boolean
}

type RootCategoryRow = {
  id: string
  slug: string
  name_da: string
  name_en: string
  image_url: string | null
}

type SubcategoryRow = {
  id: string
  slug: string
  name_da: string
  name_en: string
  parent_id: string | null
}

type MusicGearImageRow = {
  image_url: string | null
}

type CountSummary = {
  direct_catalog_count: number
  subtree_catalog_count: number
  /** Support-BLIND `is_public` from the projection: 23 today. Audit only. */
  direct_browse_eligible_support_blind_count: number
  subtree_browse_eligible_support_blind_count: number
  /** What the public catalogue actually serves: 10 today. */
  direct_canonical_public_count: number
  subtree_canonical_public_count: number
  direct_live_count: number
  subtree_live_count: number
}

type DebugProduct = {
  slug: string
  canonical_name: string
  brand_name: string
  tier: string
  status: string
  active_listing_count: number
  browse_visibility: 'public' | 'qa_only' | 'hidden'
  taxonomy_state: 'classified' | 'missing_subcategory' | 'missing_root_mapping'
  supply_state: 'live' | 'no_live_listings'
  has_image: boolean
  exclusion_reason: ExclusionReason | null
}

type BrandBreakdown = {
  brand_id: string | null
  brand_slug: string | null
  brand_name: string
  counts: {
    catalog_count: number
    public_count: number
    live_count: number
  }
}

type RootDebugNode = {
  id: string
  slug: string
  name_da: string
  name_en: string
  counts: CountSummary
  subcategories: Array<{
    id: string
    slug: string
    name_da: string
    name_en: string
    counts: CountSummary
    brand_breakdown: BrandBreakdown[]
    public_products: DebugProduct[]
    excluded_products: DebugProduct[]
  }>
}

type OrphanGroup = {
  count: number
  products: DebugProduct[]
}

export type BrowseRootResponse = {
  categories: Array<{
    id: string
    slug: string
    name_da: string
    name_en: string
    product_count: number
    image_url: string
  }>
  debug?: {
    roots: RootDebugNode[]
    orphan_summary: Record<'inactive' | 'missing_subcategory' | 'missing_root_mapping', OrphanGroup>
  }
}

export type BrowseLeafResponse = {
  category: {
    id: string
    slug: string
    name_da: string
    name_en: string
  }
  subcategories: Array<{
    id: string
    slug: string
    name_da: string
    name_en: string
  }>
  products: Array<{
    slug: string
    canonical_name: string
    image_url: string | null
    tier: string
    brand_name: string
    subcategory_name_da: string
    subcategory_name_en: string
    subcategory_slug: string
    active_listing_count: number
  }>
  page: number
  page_size: number
  total_public_products: number
  has_more: boolean
  debug?: {
    counts: CountSummary
    subcategories: Array<{
      id: string
      slug: string
      name_da: string
      name_en: string
      counts: CountSummary
      brand_breakdown: BrandBreakdown[]
      public_products: DebugProduct[]
      excluded_products: DebugProduct[]
    }>
  }
}

type DiscoverProduct = {
  slug: string
  canonical_name: string
  image_url: string | null
  brand_name: string
  active_listing_count: number
}

type DiscoverResponse = {
  legendary: DiscoverProduct[]
  popular: DiscoverProduct[]
}

const PROJECTION_SELECT = [
  'id',
  'slug',
  'canonical_name',
  'brand_id',
  'brand_slug',
  'brand_name',
  'category_id',
  'legacy_category_slug',
  'subcategory_id',
  'subcategory_slug',
  'subcategory_name_da',
  'subcategory_name_en',
  'root_category_id',
  'root_category_slug',
  'root_category_name_da',
  'root_category_name_en',
  'browse_domain',
  'status',
  'tier',
  'tier_rank',
  'image_url',
  'has_image',
  'active_listing_count',
  'browse_visibility',
  'taxonomy_state',
  'supply_state',
  'is_public',
].join(', ')

type ExclusionReason =
  | 'inactive'
  | 'missing_subcategory'
  | 'missing_root_mapping'
  | 'qa_only'
  | 'hidden'
  | 'unsupported'

function storageFallback(supabaseUrl: string, slug: string) {
  return `${supabaseUrl}/storage/v1/object/public/onboarding-assets/categories/${slug}.webp`
}

function compareByNameEn<T extends { name_en: string }>(a: T, b: T) {
  return a.name_en.localeCompare(b.name_en, 'en')
}

function compareProducts(a: BrowseProjectionRow, b: BrowseProjectionRow) {
  if (b.tier_rank !== a.tier_rank) return b.tier_rank - a.tier_rank
  if (b.active_listing_count !== a.active_listing_count) {
    return b.active_listing_count - a.active_listing_count
  }
  return a.canonical_name.localeCompare(b.canonical_name, 'en')
}

/**
 * Audit-only counters.
 *
 * `public_count` is the projection's SUPPORT-BLIND `is_public` — active +
 * public + classified — which is 23 today. It is NOT the number of products
 * the public catalogue serves, which is 10. Both numbers are legitimate and
 * they answer different questions, so the audit payload now reports them side
 * by side under names that say which is which. Presenting 23 as "public
 * products" is how three surfaces came to disagree in the first place.
 */
function summarizeRows(rows: BrowseProjectionRow[], supportedSlugs?: Set<string>) {
  return {
    catalog_count: rows.filter((row) => row.taxonomy_state === 'classified').length,
    browse_eligible_support_blind_count: rows.filter((row) => row.is_public).length,
    canonical_public_count: supportedSlugs
      ? rows.filter((row) => row.is_public && supportedSlugs.has(row.slug)).length
      : 0,
    live_count: rows.filter((row) => row.taxonomy_state === 'classified' && row.supply_state === 'live').length,
  }
}

function buildCountSummary(
  directRows: BrowseProjectionRow[],
  subtreeRows: BrowseProjectionRow[],
  supportedSlugs?: Set<string>,
): CountSummary {
  const direct = summarizeRows(directRows, supportedSlugs)
  const subtree = summarizeRows(subtreeRows, supportedSlugs)
  return {
    direct_catalog_count: direct.catalog_count,
    subtree_catalog_count: subtree.catalog_count,
    direct_browse_eligible_support_blind_count: direct.browse_eligible_support_blind_count,
    subtree_browse_eligible_support_blind_count: subtree.browse_eligible_support_blind_count,
    direct_canonical_public_count: direct.canonical_public_count,
    subtree_canonical_public_count: subtree.canonical_public_count,
    direct_live_count: direct.live_count,
    subtree_live_count: subtree.live_count,
  }
}

function getExclusionReason(
  row: BrowseProjectionRow,
  supportedSlugs?: Set<string>,
): ExclusionReason | null {
  if (row.status !== 'active') return 'inactive'
  if (row.taxonomy_state === 'missing_subcategory') return 'missing_subcategory'
  if (row.taxonomy_state === 'missing_root_mapping') return 'missing_root_mapping'
  if (row.browse_visibility === 'qa_only') return 'qa_only'
  if (row.browse_visibility === 'hidden') return 'hidden'
  // Public, active and classified, but outside the supported cohort: the
  // matcher can never add a listing to it, so it leaves the public catalogue.
  // The audit payload names it rather than silently dropping it.
  if (supportedSlugs && !supportedSlugs.has(row.slug)) return 'unsupported'
  return null
}

function toDebugProduct(row: BrowseProjectionRow, supportedSlugs?: Set<string>): DebugProduct {
  return {
    slug: row.slug,
    canonical_name: row.canonical_name,
    brand_name: row.brand_name ?? '',
    tier: row.tier,
    status: row.status,
    active_listing_count: row.active_listing_count,
    browse_visibility: row.browse_visibility,
    taxonomy_state: row.taxonomy_state,
    supply_state: row.supply_state,
    has_image: row.has_image,
    exclusion_reason: getExclusionReason(row, supportedSlugs),
  }
}

function buildBrandBreakdown(rows: BrowseProjectionRow[]): BrandBreakdown[] {
  const brandMap = new Map<string, BrandBreakdown>()

  for (const row of rows) {
    const key = row.brand_id ?? `unknown:${row.brand_name ?? ''}`
    const existing = brandMap.get(key) ?? {
      brand_id: row.brand_id,
      brand_slug: row.brand_slug,
      brand_name: row.brand_name ?? 'Unknown',
      counts: {
        catalog_count: 0,
        public_count: 0,
        live_count: 0,
      },
    }

    if (row.taxonomy_state === 'classified') existing.counts.catalog_count += 1
    if (row.is_public) existing.counts.public_count += 1
    if (row.taxonomy_state === 'classified' && row.supply_state === 'live') {
      existing.counts.live_count += 1
    }

    brandMap.set(key, existing)
  }

  return Array.from(brandMap.values()).sort((a, b) => {
    if (b.counts.catalog_count !== a.counts.catalog_count) {
      return b.counts.catalog_count - a.counts.catalog_count
    }
    return a.brand_name.localeCompare(b.brand_name, 'en')
  })
}

async function fetchMusicTaxonomy(admin: SupabaseClient) {
  const [rootsRes, subcategoriesRes, musicGearRes] = await Promise.all([
    admin
      .from('kg_category')
      .select('id, slug, name_da, name_en, image_url')
      .eq('domain', 'music')
      .is('parent_id', null)
      .neq('slug', 'music-gear')
      .order('name_en'),
    admin
      .from('kg_category')
      .select('id, slug, name_da, name_en, parent_id')
      .eq('domain', 'music')
      .not('parent_id', 'is', null)
      .order('name_en'),
    admin
      .from('kg_category')
      .select('image_url')
      .eq('slug', 'music-gear')
      .single(),
  ]).catch(() => {
    throw new CatalogueUnavailableError('browse_taxonomy_transport')
  })

  if (rootsRes.error || subcategoriesRes.error) {
    throw new CatalogueUnavailableError('browse_taxonomy')
  }

  return {
    roots: (rootsRes.data ?? []) as RootCategoryRow[],
    subcategories: (subcategoriesRes.data ?? []) as SubcategoryRow[],
    musicGearImageUrl: ((musicGearRes.data ?? null) as MusicGearImageRow | null)?.image_url ?? null,
  }
}

/**
 * The 48 matcher-eligible slugs (active + supported).
 *
 * `browse_product_projection` has NO support axis — `is_public` is
 * `status='active' AND browse_visibility='public' AND taxonomy_state='classified'`
 * (migration 036) — so support has to come from `kg_product` and be intersected
 * here. Without it, browse would keep listing the 13 public-but-unsupported
 * rows whose matches froze on activation day, and every one of their cards
 * would link to a page that now 404s.
 */
async function fetchSupportedSlugs(admin: SupabaseClient): Promise<Set<string>> {
  return loadSupportedSlugs(async () => {
    // A transport rejection here is turned into the { data, error } shape the
    // loader understands; the loader raises CatalogueUnavailableError either way.
    const res = await admin
      .from('kg_product')
      .select(CATALOGUE_STATE_SELECT)
      .eq('status', CANONICAL_STATUS)
      .eq('support_state', CANONICAL_SUPPORT)
      .then((r) => r, (err) => ({ data: null, error: err ?? new Error('transport') }))
    return { data: res.data, error: res.error }
  })
}

/** PostgREST refuses to return more than this in one unbounded request. */
const PROJECTION_PAGE_SIZE = 1000
/** 4,004 music rows today; the cap is a runaway guard, not a business limit. */
const PROJECTION_MAX_PAGES = 20

/**
 * Fetch projection rows with an EXPLICIT bound and a total order.
 *
 * The previous implementation issued an unbounded `.select()` with no
 * `.order()`. `browse_product_projection` holds 4,004 music rows and PostgREST
 * caps an unbounded request at 1,000, so the function received an arbitrary
 * prefix in physical heap order and then did all filtering, counting and
 * pagination in JavaScript over that prefix. Ground truth was 23 browse-
 * eligible products; production reported 19 on the root tiles and 22 summed
 * across the leaves. `linn-electronics-linndrum` was fully public and
 * unreachable. It was stable only because the heap order happened to be
 * stable — a VACUUM FULL or bulk UPDATE would have changed the public
 * catalogue with no deploy.
 *
 * `.order('slug')` makes paging total and deterministic; `slug` is unique, so
 * no row can be duplicated or skipped across a page boundary.
 */
async function fetchProjectionPages(
  admin: SupabaseClient,
  build: (
    q: ReturnType<ReturnType<SupabaseClient['from']>['select']>,
  ) => ReturnType<ReturnType<SupabaseClient['from']>['select']>,
): Promise<BrowseProjectionRow[]> {
  const out: BrowseProjectionRow[] = []

  for (let page = 0; page < PROJECTION_MAX_PAGES; page += 1) {
    const from = page * PROJECTION_PAGE_SIZE
    const to = from + PROJECTION_PAGE_SIZE - 1

    const { data, error } = await build(
      admin.from('browse_product_projection').select(PROJECTION_SELECT),
    )
      .order('slug', { ascending: true })
      .range(from, to)
      .then((r) => r, () => {
        throw new CatalogueUnavailableError('browse_projection_transport')
      })

    // A query error is unavailability, not an empty catalogue. Returning []
    // here would render "Klup follows nothing" as though it were true.
    if (error) throw new CatalogueUnavailableError('browse_projection')

    const rows = (data ?? []) as unknown as BrowseProjectionRow[]
    out.push(...rows)
    if (rows.length < PROJECTION_PAGE_SIZE) return out
  }

  throw new Error('Browse projection exceeded the maximum page count.')
}

/**
 * Rows eligible for the PUBLIC catalogue: music domain, `is_public`, and in the
 * supported cohort. Bounded by construction — at most 48 slugs can match.
 */
async function fetchPublicBrowseRows(
  admin: SupabaseClient,
  rootCategoryId?: string,
): Promise<BrowseProjectionRow[]> {
  const supported = await fetchSupportedSlugs(admin)
  if (supported.size === 0) return []

  const slugs = Array.from(supported)

  // THE FOURTH AXIS, ASSERTED RATHER THAN ASSUMED.
  //
  // kg_product has no domain column, so the set-based path can only read three
  // axes. Filtering the row query by browse_domain='music' would hide a
  // violation instead of reporting it — a non-music supported product would
  // simply vanish from the result and nobody would learn of it. So the domain
  // is read for the WHOLE supported cohort first, unfiltered, and asserted.
  // 48 rows on an indexed predicate; the build plan is explicit that
  // performance is not a concern at this size.
  const domainRes = await admin
    .from('browse_product_projection')
    .select('slug, browse_domain')
    .in('slug', slugs)
    .then((r) => r, () => {
      throw new CatalogueUnavailableError('supported_domain_transport')
    })
  if (domainRes.error) throw new CatalogueUnavailableError('supported_domain_probe')
  assertSupportedCohortIsMusic(
    supported,
    (domainRes.data ?? []) as Array<{ slug?: string | null; browse_domain?: string | null }>,
  )

  return fetchProjectionPages(admin, (q) => {
    let query = q
      .eq('browse_domain', 'music')
      .eq('is_public', true)
      .in('slug', slugs)
    if (rootCategoryId) {
      query = query.eq('root_category_id', rootCategoryId)
    }
    return query
  })
}

/**
 * The ADMIN AUDIT row set: every music row, unfiltered, fully paged.
 *
 * Deliberately a separate query from the public one rather than the same query
 * with a conditional filter — the debug payload needs the excluded rows and
 * their exclusion reasons, and conflating the two is how the truncation bug
 * stayed invisible.
 */
async function fetchAuditBrowseRows(
  admin: SupabaseClient,
  rootCategoryId?: string,
): Promise<BrowseProjectionRow[]> {
  return fetchProjectionPages(admin, (q) => {
    let query = q.eq('browse_domain', 'music')
    if (rootCategoryId) {
      query = query.eq('root_category_id', rootCategoryId)
    }
    return query
  })
}

function shapeLeafProduct(row: BrowseProjectionRow) {
  const bareSlug = row.subcategory_slug?.split('/')[1] ?? row.subcategory_slug ?? ''
  return {
    slug: row.slug,
    canonical_name: row.canonical_name,
    image_url: row.image_url ?? null,
    tier: row.tier,
    brand_name: row.brand_name ?? '',
    subcategory_name_da: row.subcategory_name_da ?? '',
    subcategory_name_en: row.subcategory_name_en ?? '',
    subcategory_slug: bareSlug,
    active_listing_count: row.active_listing_count,
  }
}

function buildRootDebugNodes(
  roots: RootCategoryRow[],
  subcategories: SubcategoryRow[],
  rows: BrowseProjectionRow[],
  supportedSlugs: Set<string>,
) {
  return roots.map((root) => {
    const rootRows = rows.filter((row) => row.root_category_id === root.id)
    const rootSubcategories = subcategories
      .filter((sub) => sub.parent_id === root.id)
      .map((sub) => {
        const subRows = rootRows.filter((row) => row.subcategory_id === sub.id)
        const publicProducts = subRows
          .filter((row) => row.is_public && supportedSlugs.has(row.slug))
          .sort(compareProducts)
          .map((row) => toDebugProduct(row, supportedSlugs))
        const excludedProducts = subRows
          .filter((row) => !(row.is_public && supportedSlugs.has(row.slug)))
          .sort(compareProducts)
          .map((row) => toDebugProduct(row, supportedSlugs))

        return {
          id: sub.id,
          slug: sub.slug,
          name_da: sub.name_da,
          name_en: sub.name_en,
          counts: buildCountSummary(subRows, subRows, supportedSlugs),
          brand_breakdown: buildBrandBreakdown(subRows),
          public_products: publicProducts,
          excluded_products: excludedProducts,
        }
      })
      .sort(compareByNameEn)

    return {
      id: root.id,
      slug: root.slug,
      name_da: root.name_da,
      name_en: root.name_en,
      counts: buildCountSummary([], rootRows, supportedSlugs),
      subcategories: rootSubcategories,
    }
  })
}

function buildOrphanSummary(rows: BrowseProjectionRow[], supportedSlugs: Set<string>) {
  const groups: Record<'inactive' | 'missing_subcategory' | 'missing_root_mapping', DebugProduct[]> = {
    inactive: [],
    missing_subcategory: [],
    missing_root_mapping: [],
  }

  for (const row of rows) {
    const reason = getExclusionReason(row, supportedSlugs)
    if (!reason) continue
    if (reason === 'inactive' || reason === 'missing_subcategory' || reason === 'missing_root_mapping') {
      groups[reason].push(toDebugProduct(row, supportedSlugs))
    }
  }

  return {
    inactive: {
      count: groups.inactive.length,
      products: groups.inactive.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, 'en')),
    },
    missing_subcategory: {
      count: groups.missing_subcategory.length,
      products: groups.missing_subcategory.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, 'en')),
    },
    missing_root_mapping: {
      count: groups.missing_root_mapping.length,
      products: groups.missing_root_mapping.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, 'en')),
    },
  }
}

export async function buildBrowseRootResponse(args: {
  admin: SupabaseClient
  supabaseUrl: string
  includeDebug: boolean
}): Promise<BrowseRootResponse> {
  const { admin, supabaseUrl, includeDebug } = args
  const [{ roots, subcategories, musicGearImageUrl }, publicRows] = await Promise.all([
    fetchMusicTaxonomy(admin),
    fetchPublicBrowseRows(admin),
  ])

  // The tile count is the count of the rows actually served. One number, one
  // source: the root tile, the leaf page and the database can no longer
  // disagree, because they are all derived from this same bounded set.
  const categories = roots
    .map((root) => {
      const rootRows = publicRows.filter((row) => row.root_category_id === root.id)
      const imageUrl =
        root.slug === 'keyboards-and-synths' && musicGearImageUrl
          ? musicGearImageUrl
          : root.image_url ?? storageFallback(supabaseUrl, root.slug)

      return {
        id: root.id,
        slug: root.slug,
        name_da: root.name_da,
        name_en: root.name_en,
        product_count: rootRows.length,
        image_url: imageUrl,
      }
    })
    .filter((root) => root.product_count > 0)
    .sort(compareByNameEn)

  if (!includeDebug) {
    return { categories }
  }

  const [auditRows, supportedSlugs] = await Promise.all([
    fetchAuditBrowseRows(admin),
    fetchSupportedSlugs(admin),
  ])

  return {
    categories,
    debug: {
      roots: buildRootDebugNodes(roots, subcategories, auditRows, supportedSlugs),
      orphan_summary: buildOrphanSummary(auditRows, supportedSlugs),
    },
  }
}

export async function buildBrowseLeafResponse(args: {
  admin: SupabaseClient
  rootSlug: string
  page: number
  pageSize: number
  includeDebug: boolean
}): Promise<BrowseLeafResponse | null> {
  const { admin, rootSlug, page, pageSize, includeDebug } = args

  const { data: rootCat, error: rootErr } = await admin
    .from('kg_category')
    .select('id, slug, name_da, name_en')
    .eq('slug', rootSlug)
    .eq('domain', 'music')
    .is('parent_id', null)
    .maybeSingle()
    .then((r) => r, () => {
      throw new CatalogueUnavailableError('root_category_transport')
    })

  // A DATABASE FAILURE IS NOT A MISSING CATEGORY. Returning null here made the
  // route answer 404 "Category not found" whenever Supabase was unreachable —
  // telling a visitor and a crawler that a category had been removed because
  // the database was down. Absence still returns null (a real 404); failure
  // now raises.
  if (rootErr) throw new CatalogueUnavailableError('root_category_lookup')
  if (!rootCat) return null

  const { data: subcatsRaw, error: subErr } = await admin
    .from('kg_category')
    .select('id, slug, name_da, name_en, parent_id')
    .eq('parent_id', rootCat.id)
    .order('name_en')
    .then((r) => r, () => {
      throw new CatalogueUnavailableError('subcategory_transport')
    })

  if (subErr) throw new CatalogueUnavailableError('subcategory_lookup')

  const subcategories = (subcatsRaw ?? []) as SubcategoryRow[]

  // `compareProducts` is (tier_rank DESC, active_listing_count DESC,
  // canonical_name ASC). The set is bounded at 48 rows and every row is
  // present, so slicing it is exact — this is a page over a complete ordered
  // set, not a page over an arbitrary prefix.
  const publicRows = (await fetchPublicBrowseRows(admin, rootCat.id)).sort(compareProducts)
  const start = (page - 1) * pageSize
  const pagedRows = publicRows.slice(start, start + pageSize)

  const response: BrowseLeafResponse = {
    category: rootCat,
    subcategories: subcategories
      .filter((sub) => publicRows.some((row) => row.subcategory_id === sub.id))
      .sort(compareByNameEn)
      .map((sub) => ({
        id: sub.id,
        slug: sub.slug.split('/')[1] ?? sub.slug,
        name_da: sub.name_da,
        name_en: sub.name_en,
      })),
    products: pagedRows.map(shapeLeafProduct),
    page,
    page_size: pageSize,
    total_public_products: publicRows.length,
    has_more: start + pageSize < publicRows.length,
  }

  if (!includeDebug) {
    return response
  }

  const [auditRows, supportedSlugs] = await Promise.all([
    fetchAuditBrowseRows(admin, rootCat.id),
    fetchSupportedSlugs(admin),
  ])

  response.debug = {
    counts: buildCountSummary([], auditRows, supportedSlugs),
    subcategories: subcategories
      .map((sub) => {
        const subRows = auditRows.filter((row) => row.subcategory_id === sub.id)
        return {
          id: sub.id,
          slug: sub.slug,
          name_da: sub.name_da,
          name_en: sub.name_en,
          counts: buildCountSummary(subRows, subRows, supportedSlugs),
          brand_breakdown: buildBrandBreakdown(subRows),
          public_products: subRows
            .filter((row) => row.is_public && supportedSlugs.has(row.slug))
            .sort(compareProducts)
            .map((row) => toDebugProduct(row, supportedSlugs)),
          excluded_products: subRows
            .filter((row) => !(row.is_public && supportedSlugs.has(row.slug)))
            .sort(compareProducts)
            .map((row) => toDebugProduct(row, supportedSlugs)),
        }
      })
      .sort(compareByNameEn),
  }

  return response
}

/**
 * Homepage shelves.
 *
 * SELECTION IS ON SUPPORT, NOT ON TIER. `is_public` alone would put
 * `arp-2600`, `oberheim-ob-x`, `sequential-prophet-5` and `gibson-les-paul` on
 * the homepage — legendary-tier rows the matcher can never update again. Tier
 * is an EDITORIAL axis (CLAUDE.md §2): it may order a shelf, it may never
 * select one. This was the last place the tier/monitoring decoupling of Prompt
 * 04B was still leaking into the UI.
 *
 * Consequence worth stating: all 14 canonical products are tier `legendary`
 * today, so the `popular` shelf is empty and the homepage renders one shelf.
 * The existing page gates each shelf on `length > 0`, so that degrades
 * cleanly. WP-3 replaces both shelves with "Fulgt lige nu" and "Nye annoncer".
 */
export async function buildDiscoverResponse(admin: SupabaseClient): Promise<DiscoverResponse> {
  const publicRows = (await fetchPublicBrowseRows(admin)).sort(compareProducts)

  const legendary = publicRows
    .filter((row) => row.tier === 'legendary')
    .slice(0, 24)
    .map((row) => ({
      slug: row.slug,
      canonical_name: row.canonical_name,
      image_url: row.image_url,
      brand_name: row.brand_name ?? '',
      active_listing_count: row.active_listing_count,
    }))

  const popular = publicRows
    .filter((row) => row.tier !== 'legendary')
    .sort((a, b) => {
      if (b.active_listing_count !== a.active_listing_count) {
        return b.active_listing_count - a.active_listing_count
      }
      return compareProducts(a, b)
    })
    .slice(0, 20)
    .map((row) => ({
      slug: row.slug,
      canonical_name: row.canonical_name,
      image_url: row.image_url,
      brand_name: row.brand_name ?? '',
      active_listing_count: row.active_listing_count,
    }))

  return { legendary, popular }
}
