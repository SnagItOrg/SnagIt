/**
 * A brand's page, `/brand/<brand>` — PAN-289.
 *
 * The brand's canonical models, grouped by the kind they stand under in the
 * catalogue (the sidebar's kinds, through `placeInCatalogue`, so a grouped leaf
 * such as the synthesizers is one kind here too). A kind that has a brand wall
 * (`lib/brand-walls.ts`) links on to it.
 *
 * A BRAND NEVER HAS A PRICE (CLAUDE.md §7). The rows this groups are the public
 * browse rows, which carry no price; nothing here could hold one. Pure, and
 * import-light, so the root suite exercises it from plain Node.
 */

import { BRAND_WALLS } from './brand-walls'
import {
  placeInCatalogue,
  subcategoryHref,
  type CatalogueTreeRow,
  type SubcategoryGroupNames,
} from './catalogue-tree'

export interface BrandPageKind<P> {
  root: { slug: string; name_da: string }
  kind: { slug: string; name_da: string }
  /** The kind's own page, every brand. */
  href: string
  /** `/brand/<brand>/<kind>`, where a reviewed wall exists for this kind. */
  wall: string | null
  /** In the caller's order. */
  products: P[]
}

type PlacedRow = Omit<CatalogueTreeRow, 'slug' | 'canonical_name'>

/**
 * Group the brand's rows by kind: most models first, then the Danish label.
 * A row the catalogue cannot place is dropped, as the sidebar drops it.
 */
export function groupBrandRows<P>(
  brandSlug: string,
  rows: ReadonlyArray<{ placement: PlacedRow; product: P }>,
  groupNames: SubcategoryGroupNames,
): BrandPageKind<P>[] {
  const kinds = new Map<string, BrandPageKind<P>>()
  for (const { placement, product } of rows) {
    const place = placeInCatalogue(placement, groupNames)
    if (!place) continue
    const key = `${place.category.slug}/${place.kind.slug}`
    let kind = kinds.get(key)
    if (!kind) {
      kind = {
        root: { slug: place.category.slug, name_da: place.category.name_da },
        kind: { slug: place.kind.slug, name_da: place.kind.name_da },
        href: subcategoryHref(place.category.slug, place.kind.slug),
        wall: null,
        products: [],
      }
      kinds.set(key, kind)
    }
    const wall = BRAND_WALLS.find((w) => w.brand === brandSlug && w.leaf === placement.subcategory_slug)
    if (wall) kind.wall = `/brand/${wall.brand}/${wall.kind}`
    kind.products.push(product)
  }
  return Array.from(kinds.values()).sort(
    (a, b) => b.products.length - a.products.length || a.kind.name_da.localeCompare(b.kind.name_da, 'da'),
  )
}
