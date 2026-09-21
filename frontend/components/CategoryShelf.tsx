'use client'

import Image from 'next/image'
import Link from 'next/link'
import { categoryLabel } from '@/lib/category-labels'
import { categoryImage } from '@/lib/category-images'
import { useLocale } from '@/components/LocaleProvider'
import type { HomeCategory } from '@/lib/home-categories'

/**
 * PAN-86 — the category shelf on the logged-out homepage.
 *
 * WHY EVERY ROOT IS HERE, INCLUDING THE ELEVEN EMPTY ONES. PAN-86 offered
 * three models; this is option 3, and it is a product decision rather than a
 * layout one. Four of the fifteen music roots have public products today, so
 * showing only those would render a four-card homepage that quietly implies
 * Klup's taxonomy IS those four. Showing all fifteen with an honest count
 * makes coverage legible before the click — and the click still lands
 * somewhere that explains itself.
 *
 * THE COUNT IS PRODUCTS, AND IT IS THE DESTINATION'S OWN NUMBER. `/browse/
 * <slug>` reports the same figure as `total_public_products`, from the same
 * rows, because `buildHomeCategories` derives both from one row set. The
 * defect that motivated the ticket was a tile advertising 268 — a LISTING
 * total — in front of a page that listed nothing. A listing count is not
 * available on this component's props on purpose.
 *
 * 'use client' marks where hydration begins, not where rendering happens: the
 * labels need `useLocale()`, but this shelf still server-renders into the
 * first HTML response along with the product shelves above it. `HomeCategory`
 * is an `import type` and `category-images` / `category-labels` are both
 * import-free, so this module gains no edge to lib/browse or the service-role
 * client — which `wp4a-boundary.test.ts` fails on.
 */
export function CategoryShelf({ categories }: { categories: HomeCategory[] }) {
  const { t, locale } = useLocale()

  if (categories.length === 0) return null

  return (
    <section className="mb-10 px-6">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="type-card-title text-xl">{t.homeCategoriesHeading}</h2>
        <span className="type-meta">{t.homeCategoriesSubtext}</span>
      </div>

      {/* `px-6` and not `.shell-wall`, because the homepage's rhythm is the
          shelves above and they are px-6 at every width; the wall container's
          stepped gutter put this heading 16px, 32px and 40px from the edge
          against their constant 24px, which reads as a misaligned section.

          The card floor is FLUID rather than the wall's fixed 14rem. One fixed
          floor cannot serve both ends: 14rem gives a single 328px column at
          360px — fifteen of them, a 6,362px page — and a floor small enough to
          fit two across 360px leaves nine cramped columns at 1440px. The clamp
          is the idiom the product shelves already use for their own card width,
          and it resolves to 2-up on a phone and 5-up at 1440 with no media
          query and no device guess. */}
      <div
        className="grid-wall"
        style={{ '--wall-card-min': 'clamp(9rem, 18vw, 16rem)' } as React.CSSProperties}
      >
        {categories.map((category) => {
          const label = categoryLabel(
            category.slug,
            locale,
            locale === 'da' ? category.name_da : category.name_en,
          )
          const src = categoryImage(category.slug, category.image_url)
          const followed = category.product_count > 0
          const count =
            category.product_count === 1
              ? t.homeCategoryCountOne
              : t.homeCategoryCount.replace('{count}', String(category.product_count))

          return (
            <Link
              key={category.id}
              href={`/browse/${category.slug}`}
              className="surface-interactive flex flex-col rounded-xl overflow-hidden"
            >
              <div
                className="relative w-full aspect-[4/3] overflow-hidden"
                style={{ background: 'var(--surface-2)' }}
              >
                {src && (
                  <Image
                    src={src}
                    alt=""
                    fill
                    className="object-cover"
                    /* Measured track widths, not a device guess: 150px inside
                       360 (2-up), ~177px at 768 (4-up), ~264px at 1440 (5-up)
                       and ~262px at 1920 (7-up). 17rem covers the widest track
                       the clamp can produce. */
                    sizes="(max-width: 30rem) 45vw, (max-width: 48rem) 25vw, 17rem"
                    /* An empty category is dimmed rather than badged: the card
                       still has to read as a photograph, and the line below
                       carries the words. */
                    style={{ opacity: followed ? 1 : 0.55 }}
                  />
                )}
              </div>

              <div className="p-3 flex flex-col gap-0.5">
                <p className="type-card-title">{label}</p>
                <p className="type-meta">{followed ? count : t.homeCategoryEmpty}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
