/**
 * PAN-192 — browse shows families: one family card replaces its models.
 *
 * Owner decision 2026-09-30. Families are navigation concepts (CLAUDE.md §7),
 * and until this change a browse grid never showed one: El-pianoer rendered the
 * four Rhodes models as four cards, and `/family/rhodes` was reachable only from
 * search and the product breadcrumb.
 *
 * MEMBERSHIP IS NOT RESTATED HERE. `lib/families.ts` owns it and is server-only
 * (its children include unpublished identities), so the server tags each row it
 * already serves with `familyForChild()`'s answer — see `ProductFamilyRef` — and
 * this module only groups the rows it is handed. It imports nothing, so the
 * client grid and the plain-Node test harness can both load it.
 *
 * THREE RULES, ALL READ FROM THE ROWS PASSED IN:
 *
 *   1. Collapse only at `FAMILY_CARD_MIN_CHILDREN` members IN THIS SET. The set
 *      is what the grid is about to render — after `?sub=` and the attribute
 *      facets — so a family split across two subcategories collapses in each
 *      only where it has two there. One member renders as its own product card,
 *      exactly as before; none renders nothing.
 *   2. The card carries NO PRICE, EVER (PAN-94). `FamilyGridCard` has no field
 *      one could travel in. It does carry "N til salg" (owner decision
 *      2026-09-30): the SUM of the active listing counts of the members it
 *      replaces in this set, read from the rows as served. It adds no query.
 *      A listing matched to two members is counted under each, so the card can
 *      read higher than `/family/<slug>`, which de-duplicates (PAN-98). The
 *      owner accepted that when deciding for the sum.
 *   3. The image is the display image of the first member in the family's
 *      reviewed order that has one — the first canonical child's, since every
 *      row a public grid renders is canonical.
 *
 * WHY THE BROWSE ROWS ARE ENOUGH TO LINK. Every row a public grid receives has
 * passed the public catalogue predicate, so two members here are two canonical
 * children, and the family is `published` (FAMILY_MIN_CANONICAL_CHILDREN = 1)
 * and `index, follow`. A family card can therefore never link to an empty
 * family — the property WP-2's navigation guard defends.
 */

/** A product's navigation family, as the server tags it. Never a price. */
export type ProductFamilyRef = {
  slug: string
  label: string
  /** The family's own brand — a member's `kg_brand` may be an older name. */
  brand: string
  /** Position in the family's reviewed `children` order. Picks the image. */
  order: number
}

/** Two members in the rendered set, or no family card (PAN-192). */
export const FAMILY_CARD_MIN_CHILDREN = 2

/**
 * A family card. AN EXACT KEY SET, AND NOTHING PRICE-SHAPED IN IT. `modelCount`
 * is the number of cards it replaces in this grid; `activeListingCount` is the
 * sum of those cards' own counts — a count of listings, never a price.
 */
export type FamilyGridCard = {
  kind: 'family'
  slug: string
  label: string
  brand: string
  modelCount: number
  activeListingCount: number
  imageUrl: string | null
}

export type GridCard<P> = { kind: 'product'; product: P } | FamilyGridCard

type CollapsibleRow = {
  image_url: string | null
  active_listing_count: number
  family?: ProductFamilyRef | null
}

/**
 * The grid's cards, in the rows' order. A family card takes the position of its
 * highest-ranked member, so collapsing never reorders what surrounds it.
 */
export function collapseFamilies<P extends CollapsibleRow>(rows: readonly P[]): GridCard<P>[] {
  const members = new Map<string, P[]>()
  for (const row of rows) {
    if (!row.family) continue
    const list = members.get(row.family.slug) ?? []
    list.push(row)
    members.set(row.family.slug, list)
  }

  const cards: GridCard<P>[] = []
  const emitted = new Set<string>()
  for (const row of rows) {
    const family = row.family
    const group = family ? members.get(family.slug) : undefined
    if (!family || !group || group.length < FAMILY_CARD_MIN_CHILDREN) {
      cards.push({ kind: 'product', product: row })
      continue
    }
    if (emitted.has(family.slug)) continue
    emitted.add(family.slug)

    const withImage = group
      .filter((member) => member.image_url)
      .sort((a, b) => (a.family?.order ?? 0) - (b.family?.order ?? 0))
    cards.push({
      kind: 'family',
      slug: family.slug,
      label: family.label,
      brand: family.brand,
      modelCount: group.length,
      activeListingCount: group.reduce((sum, member) => sum + member.active_listing_count, 0),
      imageUrl: withImage[0]?.image_url ?? null,
    })
  }
  return cards
}
