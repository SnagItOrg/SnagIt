import { cache } from 'react'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { NextRequest } from 'next/server'
import { notFound, permanentRedirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { CATALOGUE_REVALIDATE_SECONDS } from '@/lib/browse-cache'
import { isCurrentUserAdmin } from '@/lib/admin-auth'
import { isFamilySlug } from '@/lib/families'
import {
  CatalogueUnavailableError,
  isAdminOnly,
  isCanonical,
  type CatalogueStateRow,
} from '@/lib/catalogue'
import { fill, translations } from '@/lib/i18n'
import { isHomeMarket, type PopulationStats } from '@/lib/price-populations'
import { SITE_URL, siteMetadata } from '@/lib/site-metadata'
import { GET as getProduct } from '@/app/api/product/[slug]/route'

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
async function readProductState(slug: string): Promise<ProductState | null> {
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
}

/**
 * PAN-263: the gate's two reads ran on every product request — 0.25–0.66 s of
 * the page's HTML TTFB on production — and decide nothing the catalogue cache
 * does not already hold for a minute. Same window, same trade (a depublish or
 * a publish reaches this gate within `CATALOGUE_REVALIDATE_SECONDS`), recorded
 * in lib/browse-cache.ts. `cache()` still dedupes generateMetadata and the
 * layout within one request. The admin session lookup below stays outside the
 * cache: it is per visitor.
 */
const cachedProductState = unstable_cache(readProductState, ['product-state'], {
  revalidate: CATALOGUE_REVALIDATE_SECONDS,
})
const loadProductState = cache(cachedProductState)

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

  const title = fill(t.metaProductTitle, { name: product.canonical_name })
  const description =
    (await priceDescription(slug)) ?? `${product.canonical_name} — ${t.headline}`
  const url = `${SITE_URL}/product/${slug}`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...siteMetadata.openGraph, title, description, url },
    twitter: { ...siteMetadata.twitter, title, description },
  }
}

/** The price block's own number format (components/PriceAnswer.tsx `kr`). */
function kr(value: number): string {
  return `${Math.round(value).toLocaleString('da-DK')} kr`
}

/**
 * PAN-288. The description states what the page's price block states, in the
 * page's own words, or null for the old text.
 *
 * Read from the product route's own payload — the in-process call tjek-prisen
 * makes, served from the same one-minute `cachedCanonicalProduct` entry the
 * page's fetch fills — so the snippet can never state a number the page does
 * not. Local first (CLAUDE.md §7): a Danish number always wins, tier by tier
 * as `DanishMarketBlock` renders it:
 *
 *   band           "Typisk 12.500 kr brugt · 3 annoncer i Danmark nu" — the one
 *                  tier the page calls "typisk"; {count} is the page's own
 *                  Danish split of the wall (`isHomeMarket`)
 *   median-only    the median under the block's heading and its PAN-265 line
 *   listings-only  the observed Danish asking prices under "Udbudt i Danmark nu"
 *
 * Only with no Danish number at all does a Reverb band speak, under the heading
 * its `ReferencePopulationBlock` carries — which names it international — and
 * in the page's order, sold before asking. It can never read as a Danish price.
 */
async function priceDescription(slug: string): Promise<string | null> {
  const res = await getProduct(new NextRequest(new URL(`/api/product/${slug}`, SITE_URL)), {
    params: Promise.resolve({ slug }),
  })
  if (!res.ok) return null
  const page = (await res.json()) as {
    listings: Array<{ source?: string | null; country?: string | null }>
    populations: Record<'dk-asking' | 'reverb-sold' | 'reverb-asking', PopulationStats>
    dkAskingPrices: number[]
  }

  const dk = page.populations['dk-asking']
  if (dk.tier === 'band' && dk.median != null) {
    const typical = fill(t.metaProductTypical, { price: kr(dk.median) })
    const count = page.listings.filter(isHomeMarket).length
    if (count === 0) return typical
    return `${typical} · ${count === 1 ? t.metaProductListingsOne : fill(t.metaProductListings, { count })}`
  }
  if (dk.tier === 'median-only' && dk.median != null) {
    return `${t.dkMarketHeading}: ${kr(dk.median)} · ${fill(t.dkMarketMedianDescriptive, { count: dk.nFiltered })}`
  }
  const observed = (page.dkAskingPrices ?? []).filter((p) => Number.isFinite(p) && p > 0)
  if (dk.tier === 'listings-only' && observed.length > 0) {
    return `${t.dkMarketAskingNow}: ${observed.map(kr).join(' · ')}`
  }

  for (const [key, heading] of [
    ['reverb-sold', t.reverbSoldHeading],
    ['reverb-asking', t.reverbAskingHeading],
  ] as const) {
    const stats = page.populations[key]
    if (stats.tier === 'band' && stats.median != null) return `${heading}: ${kr(stats.median)}`
  }
  return null
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
