'use client'

import { useLocale } from '@/components/LocaleProvider'
import { ProductCard } from '@/components/ProductCard'
import { FamilyCard } from '@/components/FamilyCard'
import { Carousel } from '@/components/Carousel'
import type { DiscoverProduct } from '@/app/api/discover/route'
import { collapseFamilies } from '@/lib/family-cards'

/**
 * The two homepage shelves, rendered from data the SERVER already has.
 *
 * Before PAN-68 this markup lived in app/page.tsx and its data arrived from a
 * fetch('/api/discover') in a useEffect, so the shelves could not exist until
 * 186 KB of JavaScript had downloaded, parsed and hydrated — a measured 1.9 s
 * before the request was even sent. Taking the rows as props instead means
 * this component server-renders into the first HTML response with the cards in
 * it.
 *
 * It is still 'use client' — the headings come from useLocale() and ProductCard
 * has its own image-error state. That is not a contradiction: 'use client'
 * marks where hydration begins, not where rendering happens. The shelf is
 * server-rendered into the HTML either way.
 *
 * The DiscoverProduct import is deliberately `import type`. A value import
 * would give this client module an edge to lib/browse and the service-role
 * Supabase client, which wp4a-boundary.test.ts fails on.
 */
export function DiscoverShelves({
  legendary,
  popular,
}: {
  legendary: DiscoverProduct[]
  popular: DiscoverProduct[]
}) {
  const { t } = useLocale()
  // PAN-192 — a shelf is a browse grid laid out in a row, so a family with two
  // members on it collapses the same way, over the cards the shelf renders.
  const legendaryCards = collapseFamilies(legendary)
  const popularCards = collapseFamilies(popular)

  return (
    <>
      {/* Legendary gear carousel */}
      {legendary.length > 0 && (
        <section className="mb-10">
          <div className="px-6 mb-4 flex items-baseline gap-3">
            <h2 className="type-card-title text-xl">
              {t.discoverLegendaryHeading}
            </h2>
            <span className="type-meta">
              {t.discoverLegendarySubtext}
            </span>
          </div>
          <Carousel ariaLabel={t.discoverLegendaryHeading}>
            {legendaryCards.map((card) => card.kind === 'family' ? (
              <FamilyCard key={`family:${card.slug}`} card={card} />
            ) : (
              <ProductCard
                key={card.product.slug}
                slug={card.product.slug}
                canonicalName={card.product.canonical_name}
                brandName={card.product.brand_name}
                subcategoryName=""
                activeListingCount={card.product.active_listing_count}
                imageUrl={card.product.image_url}
                // No tier badge: this shelf is legendary by construction, so
                // its cards never mix tiers and the heading already says it
                // (PAN-168 #9).
              />
            ))}
          </Carousel>
        </section>
      )}

      {/* Popular right now carousel */}
      {popular.length > 0 && (
        <section className="mb-10">
          <div className="px-6 mb-4 flex items-baseline gap-3">
            <h2 className="type-card-title text-xl">
              {t.discoverPopularHeading}
            </h2>
            <span className="type-meta">
              {t.discoverPopularSubtext}
            </span>
          </div>
          <Carousel ariaLabel={t.discoverPopularHeading}>
            {popularCards.map((card) => card.kind === 'family' ? (
              <FamilyCard key={`family:${card.slug}`} card={card} />
            ) : (
              <ProductCard
                key={card.product.slug}
                slug={card.product.slug}
                canonicalName={card.product.canonical_name}
                brandName={card.product.brand_name}
                subcategoryName=""
                activeListingCount={card.product.active_listing_count}
                imageUrl={card.product.image_url}
              />
            ))}
          </Carousel>
        </section>
      )}
    </>
  )
}
