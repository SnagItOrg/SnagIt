import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cachedBrandPage } from '@/lib/browse-cache'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb'
import { PositionSignal } from '@/components/PositionSignal'
import { ListSection } from '@/components/ListSection'
import { ProductCard } from '@/components/ProductCard'
import { FamilyCard } from '@/components/FamilyCard'
import { Icon } from '@/components/Icon'
import { buildPositionSignal } from '@/lib/position-signal'
import { collapseFamilies } from '@/lib/family-cards'
import { placeholderIcon } from '@/lib/placeholder-icon'
import type { BrandPageResponse } from '@/lib/browse'
import { translations, fill } from '@/lib/i18n'
import { SITE_URL } from '@/lib/site-metadata'

/**
 * Brand route — PAN-289. `/brand/roland` was a 404; only the reviewed brand
 * walls existed beneath it.
 *
 * WHAT THIS PAGE IS. The brand's canonical models, grouped by the kind they
 * stand under in the catalogue, as the cards `/browse/<root>` shows (a family
 * collapses where two of its members are on the page, PAN-192). A kind with a
 * brand wall links on to it. The chrome is the brand wall's: breadcrumb,
 * eyebrow, title, position signal. Each kind is a `ListSection` group — the
 * Astryx `CommandPaletteGroup` heading that component records (clone
 * caf5673d; re-read at 085e145): a short left-aligned name per group, nothing
 * else.
 *
 * A BRAND NEVER HAS A PRICE (CLAUDE.md §7). The rows are the public browse
 * rows, which carry none, and this file imports no price module.
 *
 * SERVER COMPONENT, for the brand wall's reasons: the 404 must be a status, and
 * Danish comes from `translations.da`. A brand with no canonical model is a
 * 404, so every page that answers 200 is indexable and in the sitemap.
 * Unavailability throws to the error boundary, never an empty page.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

const t = translations.da

const loadBrandPage = cache(cachedBrandPage)

function modelCount(page: BrandPageResponse): number {
  return page.kinds.reduce((n, k) => n + k.products.length, 0)
}

export async function generateMetadata(
  ctx: { params: Promise<{ brand: string }> },
): Promise<Metadata> {
  const { brand } = await ctx.params
  const page = await loadBrandPage(brand)
  if (!page) return { title: t.notFoundHeading, robots: { index: false, follow: false } }
  return {
    title: fill(t.metaBrandTitle, { brand: page.brand.name }),
    description: fill(t.metaBrandDescription, {
      brand: page.brand.name,
      count: modelCount(page),
      kinds: page.kinds.map((k) => k.kind.name_da.toLowerCase()).join(', '),
    }),
    alternates: { canonical: `${SITE_URL}/brand/${page.brand.slug}` },
  }
}

export default async function BrandPage(ctx: { params: Promise<{ brand: string }> }) {
  const { brand } = await ctx.params
  const page = await loadBrandPage(brand)
  if (!page) notFound()

  // The signal counts the models rendered below, nothing else (PAN-94).
  const products = page.kinds.flatMap((k) => k.products)

  return (
    <main id="main-content" className="flex-1 min-w-0 shell-offset pb-24 md:pb-8">
      <MobileSearchBar />
      <div className="shell-wall pb-10">
        <Breadcrumb className="pt-4">
          <BreadcrumbItem href="/browse">{t.browseAllCategories}</BreadcrumbItem>
          <BreadcrumbItem>{page.brand.name}</BreadcrumbItem>
        </Breadcrumb>

        <p className="type-label pt-3">{t.brandPageEyebrow}</p>
        <h1 className="type-title mt-2">{page.brand.name}</h1>

        <PositionSignal signal={buildPositionSignal({ renderedRows: products, countKind: 'models' })} />

        <div className="mt-6 flex flex-col gap-8">
          {page.kinds.map((group) => (
            <ListSection key={`${group.root.slug}/${group.kind.slug}`} label={group.kind.name_da}>
              <div className="grid-wall grid-wall-pair">
                {collapseFamilies(group.products).map((card) => card.kind === 'family' ? (
                  <FamilyCard key={`family:${card.slug}`} card={card} />
                ) : (
                  <ProductCard
                    key={card.product.slug}
                    slug={card.product.slug}
                    canonicalName={card.product.canonical_name}
                    brandName={card.product.brand_name}
                    subcategoryName={group.kind.name_da}
                    placeholder={placeholderIcon(group.root.slug, card.product.subcategory_slug)}
                    activeListingCount={card.product.active_listing_count}
                    imageUrl={card.product.image_url}
                  />
                ))}
              </div>
              {group.wall && (
                <Link
                  href={group.wall}
                  className="type-meta mt-2 inline-flex items-center gap-1 self-start hover:underline"
                >
                  {fill(t.brandPageWallLink, { title: `${page.brand.name} ${group.kind.name_da.toLowerCase()}` })}
                  <Icon name="arrow_forward" style={{ fontSize: '16px' }} />
                </Link>
              )}
            </ListSection>
          ))}
        </div>
      </div>
    </main>
  )
}
