import type { MetadataRoute } from 'next'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { cachedCatalogueTree } from '@/lib/browse-cache'
import {
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CANONICAL_VISIBILITY,
  CatalogueUnavailableError,
  isCanonical,
} from '@/lib/catalogue'
import { fetchAllPages } from '@/lib/exhaustive-fetch'
import { NAVIGATION_FAMILIES, buildFamilyView, type FamilyChildRow } from '@/lib/families'
import { BRAND_WALLS } from '@/lib/brand-walls'
import { subcategoryHref } from '@/lib/catalogue-tree'
import { EXCLUDED_ROOT_SLUGS } from '@/lib/home-categories'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * /sitemap.xml — PAN-288.
 *
 * Every URL here is one a crawler gets a 200 and a self-canonical for, decided
 * by the authority the page itself is gated by, never restated:
 *
 *   /                  the home page
 *   /browse            the catalogue index
 *   /browse/<root>     every populated root, from the catalogue tree the
 *                      sidebar is built from (`cachedCatalogueTree`)
 *   /browse/<root>/<kind>  every kind of that tree (PAN-289)
 *   /family/<slug>     a family `buildFamilyView` publishes (≥1 canonical child)
 *   /brand/<brand>     a brand with ≥1 canonical model (PAN-289)
 *   /brand/<brand>/<kind>  a reviewed brand wall with ≥1 canonical model in
 *                      its leaf — the wall's own `published` threshold
 *   /product/<slug>    a product `isCanonical()` admits
 *
 * The product rows are read the way the product layout's gate reads one slug,
 * as a set: the three `kg_product` axes plus `browse_domain` from the
 * projection, then `isCanonical` decides. The `.eq()` filters only narrow the
 * read; they never admit a row on their own.
 *
 * No `lastModified`: `kg_product` has no update timestamp, and an invented one
 * is worse than none. Dynamic, like the family route, so a publish reaches the
 * sitemap without a deploy. Unavailability throws (a 5xx a crawler retries),
 * never an empty or partial sitemap.
 */
export const dynamic = 'force-dynamic'

/** A catalogue row plus the three projection slugs the brand entries are decided from. */
type SitemapRow = FamilyChildRow & {
  brand_slug: string | null
  root_category_slug: string | null
  subcategory_slug: string | null
}

async function loadCatalogueRows(): Promise<SitemapRow[]> {
  const admin = getSupabaseAdmin()

  // Paged to exhaustion: PostgREST caps a request at 1,000 rows without
  // saying so, and a capped read here is a silently shorter sitemap.
  const products = await fetchAllPages(
    async (from, to) => {
      const res = await admin
        .from('kg_product')
        .select('slug, status, support_state, browse_visibility')
        .eq('status', CANONICAL_STATUS)
        .eq('support_state', CANONICAL_SUPPORT)
        .eq('browse_visibility', CANONICAL_VISIBILITY)
        .order('slug', { ascending: true })
        .range(from, to)
        .then((r) => r, () => {
          throw new CatalogueUnavailableError('sitemap_products_transport')
        })
      if (res.error) throw new CatalogueUnavailableError('sitemap_products_lookup')
      return (res.data ?? []) as Array<Omit<FamilyChildRow, 'browse_domain'>>
    },
    (row) => row.slug,
  )
  if (products.rows.length === 0) return []

  // The projection is narrowed by the same two axes it carries, never by a slug
  // list: `.in('slug', …)` travels in the URL, and the catalogue's own list
  // outgrew it at 820 public rows (2026-10-23, PR #279). Rows the narrowing
  // admits beyond `products` are ignored by the lookup below; `isCanonical`
  // still decides from the joined row.
  const projection = await fetchAllPages(
    async (from, to) => {
      const res = await admin
        .from('browse_product_projection')
        .select('slug, browse_domain, brand_slug, root_category_slug, subcategory_slug')
        .eq('status', CANONICAL_STATUS)
        .eq('browse_visibility', CANONICAL_VISIBILITY)
        .order('slug', { ascending: true })
        .range(from, to)
        .then((r) => r, () => {
          throw new CatalogueUnavailableError('sitemap_projection_transport')
        })
      if (res.error) throw new CatalogueUnavailableError('sitemap_projection_lookup')
      return (res.data ?? []) as Array<{
        slug: string
        browse_domain: string | null
        brand_slug: string | null
        root_category_slug: string | null
        subcategory_slug: string | null
      }>
    },
    (row) => row.slug,
  )

  const projectionBySlug = new Map(projection.rows.map((row) => [row.slug, row]))
  return products.rows.map((p) => {
    const row = projectionBySlug.get(p.slug)
    return {
      ...p,
      browse_domain: row?.browse_domain ?? null,
      brand_slug: row?.brand_slug ?? null,
      root_category_slug: row?.root_category_slug ?? null,
      subcategory_slug: row?.subcategory_slug ?? null,
    }
  })
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [rows, tree] = await Promise.all([loadCatalogueRows(), cachedCatalogueTree()])
  // The brand page's own rule (lib/browse.ts `buildBrandPageResponse`): an excluded root holds no page.
  const canonical = rows.filter((row) => isCanonical(row) && !EXCLUDED_ROOT_SLUGS.has(row.root_category_slug ?? ''))
  const brands = Array.from(new Set(canonical.flatMap((row) => (row.brand_slug ? [row.brand_slug] : [])))).sort()

  const paths = [
    '',
    '/browse',
    ...tree.categories.flatMap((root) => [
      `/browse/${root.slug}`,
      ...root.subcategories.map((kind) => subcategoryHref(root.slug, kind.slug)),
    ]),
    ...NAVIGATION_FAMILIES
      .filter((family) => buildFamilyView(family, rows).published)
      .map((family) => `/family/${family.slug}`),
    ...brands.map((brand) => `/brand/${brand}`),
    ...BRAND_WALLS
      .filter((wall) => canonical.some((row) => row.brand_slug === wall.brand && row.subcategory_slug === wall.leaf))
      .map((wall) => `/brand/${wall.brand}/${wall.kind}`),
    ...rows.filter(isCanonical).map((row) => `/product/${row.slug}`),
  ]

  return paths.map((path) => ({ url: `${SITE_URL}${path}` }))
}
