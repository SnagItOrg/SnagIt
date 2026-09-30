import { isSupportedMusicProduct, type CatalogueStateRow } from '../../lib/catalogue'

/**
 * PAN-189 — the products /intel may put a median on.
 *
 * /intel used to select `tier = 'legendary'`. Tier is editorial (CLAUDE.md §5),
 * and six of those rows were the navigation-family labels — Gibson Les Paul,
 * Fender Telecaster and the rest — so every variant of a line was pooled into
 * one median. Families may aggregate listings but never prices (PAN-94).
 *
 * The set is decided by `isSupportedMusicProduct`, the predicate `isCanonical`
 * and `isAdminOnly` are both built on: an active, supported music identity.
 * Visibility is left out on purpose — it is a publication decision, /intel is
 * admin-only, and the product page already prices `qa_only` rows for an admin.
 * The predicate refuses family labels (PAN-84), so no second list lives here.
 * Families are omitted, not shown as navigation; their priced children are
 * rows of their own.
 *
 * `browse_domain` is not a column on `kg_product`, so the caller reads it from
 * `browse_product_projection` and passes it by product id.
 */
export function pricedIntelProducts<T extends CatalogueStateRow & { id: string }>(
  rows: readonly T[],
  domainById: ReadonlyMap<string, string | null>,
): T[] {
  return rows.filter((row) =>
    isSupportedMusicProduct({ ...row, browse_domain: domainById.get(row.id) ?? null }),
  )
}
