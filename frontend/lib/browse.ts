import type { SupabaseClient } from '@supabase/supabase-js'

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
  direct_public_count: number
  subtree_public_count: number
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

function summarizeRows(rows: BrowseProjectionRow[]) {
  return {
    catalog_count: rows.filter((row) => row.taxonomy_state === 'classified').length,
    public_count: rows.filter((row) => row.is_public).length,
    live_count: rows.filter((row) => row.taxonomy_state === 'classified' && row.supply_state === 'live').length,
  }
}

function buildCountSummary(directRows: BrowseProjectionRow[], subtreeRows: BrowseProjectionRow[]): CountSummary {
  const direct = summarizeRows(directRows)
  const subtree = summarizeRows(subtreeRows)
  return {
    direct_catalog_count: direct.catalog_count,
    subtree_catalog_count: subtree.catalog_count,
    direct_public_count: direct.public_count,
    subtree_public_count: subtree.public_count,
    direct_live_count: direct.live_count,
    subtree_live_count: subtree.live_count,
  }
}

function getExclusionReason(row: BrowseProjectionRow): ExclusionReason | null {
  if (row.status !== 'active') return 'inactive'
  if (row.taxonomy_state === 'missing_subcategory') return 'missing_subcategory'
  if (row.taxonomy_state === 'missing_root_mapping') return 'missing_root_mapping'
  if (row.browse_visibility === 'qa_only') return 'qa_only'
  if (row.browse_visibility === 'hidden') return 'hidden'
  return null
}

function toDebugProduct(row: BrowseProjectionRow): DebugProduct {
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
    exclusion_reason: getExclusionReason(row),
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
  ])

  if (rootsRes.error || subcategoriesRes.error) {
    throw new Error('Failed to load browse taxonomy.')
  }

  return {
    roots: (rootsRes.data ?? []) as RootCategoryRow[],
    subcategories: (subcategoriesRes.data ?? []) as SubcategoryRow[],
    musicGearImageUrl: ((musicGearRes.data ?? null) as MusicGearImageRow | null)?.image_url ?? null,
  }
}

async function fetchBrowseRows(admin: SupabaseClient, rootCategoryId?: string) {
  let query = admin
    .from('browse_product_projection')
    .select(PROJECTION_SELECT)
    .eq('browse_domain', 'music')

  if (rootCategoryId) {
    query = query.eq('root_category_id', rootCategoryId)
  }

  const { data, error } = await query
  if (error) throw new Error('Failed to load browse projection.')
  return (data ?? []) as unknown as BrowseProjectionRow[]
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

function buildRootDebugNodes(roots: RootCategoryRow[], subcategories: SubcategoryRow[], rows: BrowseProjectionRow[]) {
  return roots.map((root) => {
    const rootRows = rows.filter((row) => row.root_category_id === root.id)
    const rootSubcategories = subcategories
      .filter((sub) => sub.parent_id === root.id)
      .map((sub) => {
        const subRows = rootRows.filter((row) => row.subcategory_id === sub.id)
        const publicProducts = subRows
          .filter((row) => row.is_public)
          .sort(compareProducts)
          .map(toDebugProduct)
        const excludedProducts = subRows
          .filter((row) => !row.is_public)
          .sort(compareProducts)
          .map(toDebugProduct)

        return {
          id: sub.id,
          slug: sub.slug,
          name_da: sub.name_da,
          name_en: sub.name_en,
          counts: buildCountSummary(subRows, subRows),
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
      counts: buildCountSummary([], rootRows),
      subcategories: rootSubcategories,
    }
  })
}

function buildOrphanSummary(rows: BrowseProjectionRow[]) {
  const groups: Record<'inactive' | 'missing_subcategory' | 'missing_root_mapping', DebugProduct[]> = {
    inactive: [],
    missing_subcategory: [],
    missing_root_mapping: [],
  }

  for (const row of rows) {
    const reason = getExclusionReason(row)
    if (!reason) continue
    if (reason === 'inactive' || reason === 'missing_subcategory' || reason === 'missing_root_mapping') {
      groups[reason].push(toDebugProduct(row))
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
  const [{ roots, subcategories, musicGearImageUrl }, rows] = await Promise.all([
    fetchMusicTaxonomy(admin),
    fetchBrowseRows(admin),
  ])

  const categories = roots
    .map((root) => {
      const rootRows = rows.filter((row) => row.root_category_id === root.id)
      const counts = buildCountSummary([], rootRows)
      const imageUrl =
        root.slug === 'keyboards-and-synths' && musicGearImageUrl
          ? musicGearImageUrl
          : root.image_url ?? storageFallback(supabaseUrl, root.slug)

      return {
        id: root.id,
        slug: root.slug,
        name_da: root.name_da,
        name_en: root.name_en,
        product_count: counts.subtree_public_count,
        image_url: imageUrl,
      }
    })
    .filter((root) => root.product_count > 0)
    .sort(compareByNameEn)

  if (!includeDebug) {
    return { categories }
  }

  return {
    categories,
    debug: {
      roots: buildRootDebugNodes(roots, subcategories, rows),
      orphan_summary: buildOrphanSummary(rows),
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
    .single()

  if (rootErr || !rootCat) return null

  const { data: subcatsRaw, error: subErr } = await admin
    .from('kg_category')
    .select('id, slug, name_da, name_en, parent_id')
    .eq('parent_id', rootCat.id)
    .order('name_en')

  if (subErr) {
    throw new Error('Failed to load browse subcategories.')
  }

  const subcategories = (subcatsRaw ?? []) as SubcategoryRow[]
  const rows = await fetchBrowseRows(admin, rootCat.id)
  const publicRows = rows.filter((row) => row.is_public).sort(compareProducts)
  const start = (page - 1) * pageSize
  const pagedRows = publicRows.slice(start, start + pageSize)
  const counts = buildCountSummary([], rows)

  const response: BrowseLeafResponse = {
    category: rootCat,
    subcategories: subcategories
      .filter((sub) => {
        const subRows = rows.filter((row) => row.subcategory_id === sub.id)
        return buildCountSummary(subRows, subRows).direct_public_count > 0
      })
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

  response.debug = {
    counts,
    subcategories: subcategories
      .map((sub) => {
        const subRows = rows.filter((row) => row.subcategory_id === sub.id)
        return {
          id: sub.id,
          slug: sub.slug,
          name_da: sub.name_da,
          name_en: sub.name_en,
          counts: buildCountSummary(subRows, subRows),
          brand_breakdown: buildBrandBreakdown(subRows),
          public_products: subRows
            .filter((row) => row.is_public)
            .sort(compareProducts)
            .map(toDebugProduct),
          excluded_products: subRows
            .filter((row) => !row.is_public)
            .sort(compareProducts)
            .map(toDebugProduct),
        }
      })
      .sort(compareByNameEn),
  }

  return response
}

export async function buildDiscoverResponse(admin: SupabaseClient): Promise<DiscoverResponse> {
  const { data, error } = await admin
    .from('browse_product_projection')
    .select(PROJECTION_SELECT)
    .eq('browse_domain', 'music')
    .eq('is_public', true)

  if (error) {
    throw new Error('Failed to load discover projection.')
  }

  const publicRows = ((data ?? []) as BrowseProjectionRow[]).sort(compareProducts)

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
