import { cache } from 'react'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CATALOGUE_REVALIDATE_SECONDS } from '@/lib/browse-cache'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb'
import { PositionSignal } from '@/components/PositionSignal'
import { BrandListingCard } from '@/components/BrandListingCard'
import { Icon } from '@/components/Icon'
import { buildPositionSignal } from '@/lib/position-signal'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getBrandWall } from '@/lib/brand-walls'
import { loadBrandWallView, type BrandWallView } from '@/lib/brand-wall'
import { translations, fill } from '@/lib/i18n'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * Brand-wall route — PAN-271.
 *
 * WHAT THIS PAGE IS. One brand's active listings in one kind of instrument,
 * including the half that name no model ("Yamaha trompet"), which no product
 * page can hold. It mirrors the family route: the same chrome, the breadcrumb,
 * the eyebrow and title, the position signal, "Vælg model" over the canonical
 * models, and a wall of small cards — because a visitor who has learnt one
 * directory page has learnt this one.
 *
 * A BRAND NEVER HAS A PRICE (CLAUDE.md §7). This file imports no price module
 * and computes no band, median or verdict. A card shows the seller's own
 * asking price — the marketplace's number, as every listing card does — and a
 * verdict ONLY when the listing is matched to a canonical model with a band of
 * its own, computed per model in lib/listing-verdicts.ts (PAN-272). A card
 * with no model shows none, and says so.
 *
 * THE PAIR IS A REVIEWED LIST. `getBrandWall` answers from lib/brand-walls.ts;
 * anything else is 404 — no wall is derived from a URL. Membership is derived
 * in lib/brand-wall.ts, whose rules are the matcher's own.
 *
 * SERVER COMPONENT, for the family route's reasons: the robots directive is
 * data (one canonical model lifts `noindex`), so it must be in the document a
 * crawler receives; Danish from `translations.da` because `useLocale()` is a
 * client hook. Absence is 404; unavailability throws to error.tsx, so an
 * outage never renders as "no listings".
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

const t = translations.da

async function readBrandWall(brand: string, kind: string): Promise<BrandWallView | null> {
  const wall = getBrandWall(brand, kind)
  if (!wall) return null
  return loadBrandWallView(getSupabaseAdmin(), wall)
}

/** The family route's cache shape: one minute per pair, deduped within a request. */
const cachedBrandWall = unstable_cache(readBrandWall, ['brand-wall'], {
  revalidate: CATALOGUE_REVALIDATE_SECONDS,
})
const loadBrandWall = cache(cachedBrandWall)

function pageTitle(view: BrandWallView): string {
  return `${view.brand.name} ${view.kind.label.toLowerCase()}`
}

export async function generateMetadata(
  ctx: { params: Promise<{ brand: string; kind: string }> },
): Promise<Metadata> {
  const params = await ctx.params
  const view = await loadBrandWall(params.brand, params.kind)
  if (!view) return { title: t.notFoundHeading, robots: { index: false, follow: false } }
  return {
    title: pageTitle(view),
    description: fill(t.brandWallThesis, { kind: view.kind.label.toLowerCase() }),
    alternates: { canonical: `${SITE_URL}/brand/${view.wall.brand}/${view.wall.kind}` },
    // One threshold, the family's: indexable once a model on this wall is canonical.
    robots: { index: view.published, follow: true },
  }
}

export default async function BrandWallPage(ctx: { params: Promise<{ brand: string; kind: string }> }) {
  const params = await ctx.params
  const view = await loadBrandWall(params.brand, params.kind)
  if (!view) notFound()

  const { models, rows, root } = view
  const title = pageTitle(view)
  // Both numbers come from the array mapped into cards below, never a separate count (PAN-94).
  const matched = rows.filter((r) => r.childSlug !== null).length
  const unmatched = rows.length - matched
  const tt = t as unknown as Record<string, string>

  return (
    <main id="main-content" className="flex-1 min-w-0 shell-offset pb-24 md:pb-8">
      <MobileSearchBar />
      <div className="cq-pane shell-reading flex flex-col pt-6 pb-10 md:pt-10">
        {/* Alle kategorier / the kind's browse root / this wall — the wall is the current crumb. */}
        <Breadcrumb className="mb-4">
          <BreadcrumbItem href="/browse">{t.browseAllCategories}</BreadcrumbItem>
          {root && <BreadcrumbItem href={`/browse/${root.slug}`}>{root.label}</BreadcrumbItem>}
          <BreadcrumbItem>{title}</BreadcrumbItem>
        </Breadcrumb>

        <p className="type-label">{view.brand.name}</p>

        <h1 className="type-title mt-2">{title}</h1>

        {/* The listings are the page, so the signal counts them — rendered rows, nothing else. */}
        <PositionSignal signal={buildPositionSignal({ renderedRows: rows, countKind: 'results' })} />

        <p className="type-measure mt-6 text-base leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
          {fill(t.brandWallThesis, { kind: view.kind.label.toLowerCase() })}
        </p>

        {/* Canonical models only — the family rule: absent, never greyed, until the owner's public step. */}
        {models.length > 0 && (
          <section className="mt-10 flex flex-col gap-3">
            <h2 className="type-label">{t.familyChooseModel}</h2>
            <div className="grid-family-models">
              {models.map((model) => (
                <Link
                  key={model.slug}
                  href={`/product/${model.slug}`}
                  className="surface-interactive group flex items-center justify-between gap-4 rounded-2xl px-5 py-5 transition-colors"
                >
                  <span className="type-card-title wrap-anywhere">{model.label}</span>
                  <Icon
                    name="arrow_forward"
                    className="flex-shrink-0 transition-transform group-hover:translate-x-0.5"
                    style={{ fontSize: '20px', color: 'var(--text-muted)' }}
                  />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-12 flex flex-col gap-3">
          <p className="type-label" style={{ color: 'var(--muted-foreground)' }}>
            {rows.length > 0
              ? `${fill(t.brandWallCount, { count: rows.length, matched, unmatched })} · ${t.brandWallNewestFirst}`
              : t.brandWallEmpty}
          </p>

          {rows.length > 0 && (
            <>
              <ul className="grid-family-listings">
                {rows.map((row) => (
                  <li key={row.id} className="flex">
                    <BrandListingCard row={row} t={tt} />
                  </li>
                ))}
              </ul>
              <p className="type-meta mt-2">{t.brandWallLegend}</p>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
