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
 *   /family/<slug>     a family `buildFamilyView` publishes (≥1 canonical child)
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

async function loadCatalogueRows(): Promise<FamilyChildRow[]> {
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

  const slugs = products.rows.map((p) => p.slug)
  const projection = await fetchAllPages(
    async (from, to) => {
      const res = await admin
        .from('browse_product_projection')
        .select('slug, browse_domain')
        .in('slug', slugs)
        .order('slug', { ascending: true })
        .range(from, to)
        .then((r) => r, () => {
          throw new CatalogueUnavailableError('sitemap_projection_transport')
        })
      if (res.error) throw new CatalogueUnavailableError('sitemap_projection_lookup')
      return (res.data ?? []) as Array<{ slug: string; browse_domain: string | null }>
    },
    (row) => row.slug,
  )

  const domainBySlug = new Map(projection.rows.map((row) => [row.slug, row.browse_domain]))
  return products.rows.map((p) => ({ ...p, browse_domain: domainBySlug.get(p.slug) ?? null }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [rows, tree] = await Promise.all([loadCatalogueRows(), cachedCatalogueTree()])

  const paths = [
    '',
    '/browse',
    ...tree.categories.map((root) => `/browse/${root.slug}`),
    ...NAVIGATION_FAMILIES
      .filter((family) => buildFamilyView(family, rows).published)
      .map((family) => `/family/${family.slug}`),
    ...rows.filter(isCanonical).map((row) => `/product/${row.slug}`),
  ]

  return paths.map((path) => ({ url: `${SITE_URL}${path}` }))
}
