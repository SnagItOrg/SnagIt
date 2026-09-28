/**
 * The navigation-family slugs — the ONE list (PAN-146).
 *
 * Three modules need these strings, and before PAN-146 each held its own copy,
 * kept equal only by a drift test:
 *
 *   lib/families.ts    — the family configuration, keyed by these slugs;
 *   lib/catalogue.ts   — the family-label deny-list (never a canonical product,
 *                        never a match target);
 *   lib/publication.ts — the refusal to publish a family label.
 *
 * None of them can own the list for the others. `families.ts` imports
 * `catalogue.ts` (for `isCanonical`), so `catalogue.ts` importing it back would
 * be a cycle. `publication.ts` is client-safe, while `families.ts` and
 * `catalogue.ts` are on the SERVER_ONLY list in scripts/lib/wp4a-boundary.test.ts.
 *
 * WHY THIS FILE HAS NO IMPORTS. It is the leaf all three depend on, so it must
 * carry nothing a client bundle or the plain-Node test harness cannot load —
 * the same reason `catalogue.ts` and `publication.ts` were written import-free.
 * It holds slugs only, never children: the children include unpublished
 * identities, which is why `families.ts` is server-only. Each slug here is
 * already a public `/family/<slug>` route.
 */
export const FAMILY_SLUGS = [
  'gibson-les-paul',
  'fender-stratocaster',
  'fender-telecaster',
  'gibson-es-335',
  'fender-jazz-bass',
  'fender-precision-bass',
  // PAN-85. `rhodes` has NO `kg_product` row and must never be given one, so
  // unlike the six above it does not guard a row that exists today. It is here
  // because the guard is structural rather than reactive: if a `rhodes` row is
  // ever created, it is refused as a priced page and as a match target at
  // creation, instead of after someone notices a single band averaging a Stage
  // against a Suitcase.
  'rhodes',
  // PAN-141. The Boss lines are the same case as `rhodes`: no row today.
  'boss-ce-chorus',
  'boss-dm-delay',
  // PAN-154. The same case as `rhodes`: no row today. `moog-minimoog` is NOT
  // this slug — it stays the priced page for the vintage original, a member.
  'minimoog',
] as const

export type FamilySlug = (typeof FAMILY_SLUGS)[number]
