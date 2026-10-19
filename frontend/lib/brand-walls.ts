/**
 * The brand walls — the ONE list (PAN-271).
 *
 * A brand wall is `/brand/<brand>/<kind>`: every active listing of one brand
 * in one kind of instrument, WITH OR WITHOUT a model number. It exists because
 * the best trumpet deals are ads that say "Yamaha trompet" and nothing more
 * (owner, PAN-271), and such an ad has no product page to live on.
 *
 * WHY A REVIEWED CODE LIST. A listing carries no brand axis and no kind axis
 * Klup could read: `listings.brand_id` is NULL on every active row (SELECT,
 * 2026-10-19) and the table has no category column. The only stored brand
 * signal is the DBA brand net's `source_query`. So a wall has to DERIVE its
 * membership, and the derivation — which words in a title name the kind — is
 * a measured vocabulary, like IDENTITY_PHRASES and FAMILY_SLUGS: the KG cannot
 * supply it. An unknown (brand, kind) pair is a 404, fail-closed; adding one
 * is a reviewed edit with a measured cue list behind it.
 *
 * WHY THIS FILE HAS NO IMPORTS. Like `family-slugs.ts`, it is a leaf the
 * server route and the plain-Node tests both load; it carries slugs and words
 * only. `kind` is the URL segment as the owner wrote it ("trompeter"); `leaf`
 * is the `kg_category` slug that gives the page its label (`name_da`), its
 * breadcrumb root and the products it may name.
 */
export interface BrandWall {
  /** `kg_brand.slug`, and the first URL segment. */
  brand: string
  /** The second URL segment. Danish, as a visitor would type it. */
  kind: string
  /** The `kg_category` leaf whose products belong on this wall. */
  leaf: string
  /**
   * Word stems that name the kind in a seller's title, across the markets Klup
   * reads (da/no/se/de/en). Matched at a word start, so "trompeten",
   * "Trompeter" and "trompetkasse" all count; what is sold FOR the horn is
   * refused afterwards by the brass accessory list in lib/matching.
   */
  cues: readonly string[]
}

export const BRAND_WALLS: readonly BrandWall[] = [
  // PAN-271, trumpets first. Cornets and flugelhorns share the trumpets leaf
  // because Reverb's tree, which the leaves mirror, has no finer kind.
  {
    brand: 'yamaha',
    kind: 'trompeter',
    leaf: 'band-and-orchestra/trumpets',
    cues: ['trompet', 'trumpet', 'trompete', 'kornet', 'cornet', 'flygelhorn', 'flugelhorn'],
  },
]

export function getBrandWall(brand: string, kind: string): BrandWall | null {
  return BRAND_WALLS.find((w) => w.brand === brand && w.kind === kind) ?? null
}
