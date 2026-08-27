/**
 * Navigation families — reviewed code configuration, never a database entity.
 *
 * Stage 3 V1, WP-1 ships the SHAPE ONLY. WP-2 fills the six entries.
 * See docs/stage-3-v1-decision-and-build-plan.md §4.1–§4.2.
 *
 * WHY CODE AND NOT A TABLE. A new table in `public` is born world-readable and
 * world-writable until the schema-wide default-privilege P0 recorded in
 * docs/klup-foundation-handover.md is closed. Families are therefore modelled
 * the way the monitoring boundary is modelled: a reviewed file that no runtime
 * surface may mutate.
 *
 * A family NEVER aggregates listings or prices. That is structural, not a flag:
 * there is no field here that could carry a price, a listing or a count, and
 * the family route has no code path that computes one. Children's markets
 * differ by more than 3x (klup-launch-catalogue-selection.md §6.1).
 *
 * `aliases` are NAVIGATION ONLY. They are never matcher aliases and never reach
 * lib/matching/**. `Squier` never navigates to a Fender page and `Epiphone`
 * never to a Gibson page.
 */

export interface NavigationFamily {
  /** Route segment for /family/<slug>, and the legacy kg_product slug it supersedes. */
  slug: string
  label: string
  brand: string
  /** Browse root slug this family belongs under. */
  categoryRoot: string
  /**
   * kg_product slugs, from klup-launch-catalogue-selection.md §6.3.
   * A child is RENDERED only if it passes the canonical predicate in
   * lib/catalogue.ts. Non-canonical children are omitted entirely — never
   * greyed, never named, never listed as "coming soon".
   */
  children: string[]
  /** Navigation-only aliases. Never matcher aliases. */
  aliases: string[]
}

/**
 * WP-2 fills this with the six family labels that are public kg_product rows
 * today: gibson-les-paul, fender-stratocaster, fender-telecaster,
 * fender-jazz-bass, fender-precision-bass, gibson-es-335.
 *
 * While empty, every slug resolves to `not_found` in lib/catalogue.ts, so the
 * six legacy /product URLs 404 between R1 and R3. That is the safe intermediate
 * state: a 404 is correct, a 308 to a route that does not exist is not.
 */
export const NAVIGATION_FAMILIES: readonly NavigationFamily[] = []

const FAMILY_BY_SLUG = new Map<string, NavigationFamily>(
  NAVIGATION_FAMILIES.map((family) => [family.slug, family]),
)

export function isFamilySlug(slug: string): boolean {
  return FAMILY_BY_SLUG.has(slug)
}

export function getFamily(slug: string): NavigationFamily | null {
  return FAMILY_BY_SLUG.get(slug) ?? null
}

/** Every slug that is a family child, across all families. */
export function allFamilyChildSlugs(): Set<string> {
  const out = new Set<string>()
  for (const family of NAVIGATION_FAMILIES) {
    for (const child of family.children) out.add(child)
  }
  return out
}
