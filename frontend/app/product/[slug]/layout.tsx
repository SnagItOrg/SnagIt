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
 */
export default async function ProductSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { slug: string }
}) {
  // Family labels resolve first: they are public-but-unsupported rows that must
  // redirect, not 404. Empty until WP-2 fills lib/families.ts.
  if (isFamilySlug(params.slug)) {
    permanentRedirect(`/family/${params.slug}`)
  }

  const admin = getSupabaseAdmin()

  const [productRes, projectionRes] = await Promise.all([
    admin
      .from('kg_product')
      .select('slug, status, support_state, browse_visibility')
      .eq('slug', params.slug)
      .maybeSingle(),
    admin
      .from('browse_product_projection')
      .select('slug, browse_domain')
      .eq('slug', params.slug)
      .maybeSingle(),
  ]).catch(() => {
    // Transport-level failure rejects rather than returning { error }.
    throw new CatalogueUnavailableError('product_gate_transport')
  })

  // ABSENCE IS NOT UNAVAILABILITY.
  //
  // maybeSingle() returns data:null with error:null when there is no such
  // slug, and a populated error for anything else. Calling notFound() on a
  // query error would tell a visitor, a crawler and an uptime monitor that a
  // product does not exist because the database was briefly unreachable.
  // Throwing instead routes into the Next.js server error path — a 5xx, which
  // is the honest answer and the one nothing will cache.
  if (productRes.error) throw new CatalogueUnavailableError('product_gate_lookup')
  if (projectionRes.error) throw new CatalogueUnavailableError('projection_gate_lookup')

  const product = productRes.data as {
    status?: string | null
    support_state?: string | null
    browse_visibility?: string | null
  } | null

  if (!product) notFound()

  const state: CatalogueStateRow = {
    status: product.status ?? null,
    support_state: product.support_state ?? null,
    browse_visibility: product.browse_visibility ?? null,
    browse_domain:
      (projectionRes.data as { browse_domain?: string | null } | null)?.browse_domain ?? null,
  }

  if (isCanonical(state)) return <>{children}</>

  // The 34 supported+private products render for a verified admin session only.
  // The session lookup happens only when it could change the outcome.
  if (isAdminOnly(state) && (await isCurrentUserAdmin())) return <>{children}</>

  notFound()
}
