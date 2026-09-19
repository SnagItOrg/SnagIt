'use client'

import { useLocale } from '@/components/LocaleProvider'
import { ProductCard } from '@/components/ProductCard'
import type { DiscoverProduct } from '@/app/api/discover/route'

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
          <div className="flex gap-3 overflow-x-auto px-6 pb-2 scrollbar-none">
            {legendary.map((p) => (
              <div key={p.slug} className="flex-shrink-0 w-[clamp(9.5rem,38vw,12rem)]">
                <ProductCard
                  slug={p.slug}
                  canonicalName={p.canonical_name}
                  brandName={p.brand_name}
                  subcategoryName=""
                  activeListingCount={p.active_listing_count}
                  imageUrl={p.image_url}
                  tier="legendary"
                />
              </div>
            ))}
          </div>
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
          <div className="flex gap-3 overflow-x-auto px-6 pb-2 scrollbar-none">
            {popular.map((p) => (
              <div key={p.slug} className="flex-shrink-0 w-[clamp(9.5rem,38vw,12rem)]">
                <ProductCard
                  slug={p.slug}
                  canonicalName={p.canonical_name}
                  brandName={p.brand_name}
                  subcategoryName=""
                  activeListingCount={p.active_listing_count}
                  imageUrl={p.image_url}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
