/**
 * "Genudgivelse af Neumann U 47" (PAN-302, owner's option a): a reissue and the
 * original it recreates, read from `kg_relation` rows of type `reissue_of`. A
 * row reads "`from` is a reissue of `to`", so the reissue's page links its
 * original and the original's page links its reissues.
 *
 * NAVIGATION ONLY, like a family (CLAUDE.md §7). A link is `{ slug, label }`
 * and has no field a median, a band, a listing count or a verdict could travel
 * in; the route builds it after every price figure is computed, and a vintage
 * U 47 and an Elektroakustik U47 never share a price.
 *
 * Import-free, like `lib/catalogue.ts`. Eligibility is NOT decided here: the
 * route passes only the rows `isCanonical()` admitted, so a hidden product is
 * never linked.
 */

export const REISSUE_OF = 'reissue_of'

export interface ReissueLink {
  slug: string
  label: string
}

export interface ReissueContext {
  /** The originals this product reissues — usually one. */
  of: ReissueLink[]
  /** The reissues of this product. */
  by: ReissueLink[]
}

export interface RelationRow {
  type: string
  from_product_id: string
  to_product_id: string
}

/** Null when the product has no reissue relation to an eligible product. */
export function reissueContext(
  selfId: string,
  relations: readonly RelationRow[],
  linkById: ReadonlyMap<string, ReissueLink>,
): ReissueContext | null {
  const of = new Map<string, ReissueLink>()
  const by = new Map<string, ReissueLink>()
  for (const r of relations) {
    if (r.type !== REISSUE_OF || r.from_product_id === r.to_product_id) continue
    if (r.from_product_id === selfId) {
      const link = linkById.get(r.to_product_id)
      if (link) of.set(link.slug, link)
    } else if (r.to_product_id === selfId) {
      const link = linkById.get(r.from_product_id)
      if (link) by.set(link.slug, link)
    }
  }
  if (of.size === 0 && by.size === 0) return null
  const sorted = (m: Map<string, ReissueLink>) => [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
  return { of: sorted(of), by: sorted(by) }
}
