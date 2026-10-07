import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { isFamilySlug } from '@/lib/families'
import {
  CatalogueUnavailableError,
  isAdminOnly,
  isCanonical,
  type CatalogueStateRow,
} from '@/lib/catalogue'
import { translations } from '@/lib/i18n'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * Server-side eligibility gate for the canonical product segment.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS TEMPORARY.
 *
 * app/product/[slug]/page.tsx is a client component: it fetches
 * /api/product/[slug] after mount and, on a 404, renders "Produkt ikke fundet"
 * with an HTTP status of 200. Once /product joined PUBLIC_PREFIXES that became
 * a SOFT 404 on all 3,976 ineligible slugs — no data leaks, because the API
 * gate refuses them, but a crawler would happily index 3,976 pages that claim
 * to exist. WP-1 is the package that makes /product public, so WP-1 has to be
 * the package that makes the status code true.
 *
 * A route-segment layout is the smallest correct fix that does not touch
 * page.tsx (WP-3's file): it runs on the server before the client component
 * mounts, and `notFound()` produces a real 404 with app/not-found.tsx.
 *
 * WP-3 REPLACES THIS. When page.tsx becomes a server shell with
 * `generateMetadata`, the same predicate moves into it and this file is
 * deleted. Deviation recorded against the build plan's §15.3 directory
 * exclusivity — see the WP-1 report.
 *
 * The predicate is identical to /api/product/[slug]'s, and is imported from
 * lib/catalogue.ts rather than restated, so the two can never drift.
 *
 * PAN-246: the same file also sets the page's `<title>` and canonical URL,
 * because page.tsx is a client component and cannot. One lookup serves both
 * the gate and the metadata through `cache()`, as the family page does.
 */

/** The product page renders Danish; the family page reads the same table. */
const t = translations.da

type ProductState = { canonical_name: string | null; state: CatalogueStateRow }

/**
 * The product's eligibility axes, or null when no such slug exists.
 *
 * ABSENCE IS NOT UNAVAILABILITY.
 *
 * maybeSingle() returns data:null with error:null when there is no such
 * slug, and a populated error for anything else. Calling notFound() on a
 * query error would tell a visitor, a crawler and an uptime monitor that a
 * product does not exist because the database was briefly unreachable.
 * Throwing instead routes into the Next.js server error path — a 5xx, which
 * is the honest answer and the one nothing will cache.
 */
const loadProductState = cache(async (slug: string): Promise<ProductState | null> => {
  const admin = getSupabaseAdmin()

  const [productRes, projectionRes] = await Promise.all([
    admin
      .from('kg_product')
      .select('slug, canonical_name, status, support_state, browse_visibility')
      .eq('slug', slug)
      .maybeSingle(),
    admin
      .from('browse_product_projection')
      .select('slug, browse_domain')
      .eq('slug', slug)
      .maybeSingle(),
  ]).catch(() => {
    // Transport-level failure rejects rather than returning { error }.
    throw new CatalogueUnavailableError('product_gate_transport')
  })

  if (productRes.error) throw new CatalogueUnavailableError('product_gate_lookup')
  if (projectionRes.error) throw new CatalogueUnavailableError('projection_gate_lookup')

  const product = productRes.data as {
    canonical_name?: string | null
    status?: string | null
    support_state?: string | null
    browse_visibility?: string | null
  } | null

  if (!product) return null

  return {
    canonical_name: product.canonical_name ?? null,
    state: {
      status: product.status ?? null,
      support_state: product.support_state ?? null,
      browse_visibility: product.browse_visibility ?? null,
      browse_domain:
        (projectionRes.data as { browse_domain?: string | null } | null)?.browse_domain ?? null,
    },
  }
})

/**
 * PAN-246. A canonical product names itself in the `<title>` and carries its
 * canonical URL. Everything else — a family slug on its way to the redirect, an
 * admin-only row, a missing slug — keeps the site default, so a private
 * product's name never reaches the `<title>` of its 404.
 */
export async function generateMetadata(
  ctx: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await ctx.params
  if (isFamilySlug(slug)) return {}

  const product = await loadProductState(slug)
  if (!product || !isCanonical(product.state) || !product.canonical_name) return {}

  return {
    title: product.canonical_name,
    description: `${product.canonical_name} — ${t.headline}`,
    alternates: { canonical: `${SITE_URL}/product/${slug}` },
  }
}

export default async function ProductSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Family labels resolve first: they are public-but-unsupported rows that must
  // redirect, not 404. Empty until WP-2 fills lib/families.ts.
  if (isFamilySlug(slug)) {
    permanentRedirect(`/family/${slug}`)
  }

  const product = await loadProductState(slug)

  if (!product) notFound()

  if (isCanonical(product.state)) return <>{children}</>

  // The 34 supported+private products render for a verified admin session only.
  // The session lookup happens only when it could change the outcome.
  if (isAdminOnly(product.state) && (await isCurrentUserAdmin())) return <>{children}</>

  notFound()
}
