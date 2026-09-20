/**
 * Navigation families — reviewed code configuration, never a database entity.
 *
 * Stage 3 V1. WP-1 shipped the shape; WP-2 fills the six entries and the
 * pure child-selection rule the family route renders from.
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

import { isCanonical, type CatalogueStateRow } from './catalogue'

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
 * The six navigation families of V1 — exactly the six public `kg_product` rows
 * that behave as priced products today — plus `rhodes` (PAN-85), which is the
 * first family that is ONLY a navigation concept: it has no `kg_product` row,
 * and it must never be given one. Children come verbatim from
 * docs/klup-launch-catalogue-selection.md §6.3 and were verified present in
 * `kg_product` (SELECT, 2026-08-28; the four Rhodes children 2026-09-20).
 *
 * MEASURED 2026-09-20 (PAN-85): every child of the six GUITAR families is
 * still `supported` + `qa_only`, so those six render ZERO children and stay
 * `noindex` and unlisted (§4.2). That remains the expected V1 state, not a
 * defect. `rhodes` is the exception, and the reason this paragraph changed:
 * its four children are `supported` + `public` + music, so it is the first
 * family that renders anything at all.
 *
 * `aliases` are NAVIGATION ONLY. A bare model number is never an alias —
 * migration 054 removed `335` as an identifier for exactly this reason — and
 * neither `Squier` nor `Epiphone` ever appears, because a sub-brand never
 * navigates up to its parent's family (§4.3).
 */
export const NAVIGATION_FAMILIES: readonly NavigationFamily[] = [
  {
    slug: 'gibson-les-paul',
    label: 'Gibson Les Paul',
    brand: 'Gibson',
    categoryRoot: 'electric-guitars',
    children: [
      'gibson-les-paul-custom',
      'gibson-les-paul-standard-50s',
      'gibson-les-paul-standard-60s',
      'gibson-les-paul-studio',
      'gibson-les-paul-special',
    ],
    aliases: ['les paul', 'lespaul', 'gibson les paul'],
  },
  {
    slug: 'fender-stratocaster',
    label: 'Fender Stratocaster',
    brand: 'Fender',
    categoryRoot: 'electric-guitars',
    children: ['fender-american-professional-ii-stratocaster'],
    aliases: ['stratocaster', 'strat', 'fender stratocaster', 'fender strat'],
  },
  {
    slug: 'fender-telecaster',
    label: 'Fender Telecaster',
    brand: 'Fender',
    categoryRoot: 'electric-guitars',
    children: [
      'fender-telecaster-thinline',
      'fender-telecaster-custom',
      'fender-american-vintage-52-telecaster',
    ],
    aliases: ['telecaster', 'tele', 'fender telecaster', 'fender tele'],
  },
  {
    slug: 'gibson-es-335',
    label: 'Gibson ES-335',
    brand: 'Gibson',
    categoryRoot: 'electric-guitars',
    children: ['gibson-es-335-dot'],
    aliases: ['es-335', 'es335', 'gibson es-335'],
  },
  {
    slug: 'fender-jazz-bass',
    label: 'Fender Jazz Bass',
    brand: 'Fender',
    categoryRoot: 'bass-guitars',
    children: [],
    aliases: ['jazz bass', 'j-bass', 'fender jazz bass'],
  },
  {
    slug: 'fender-precision-bass',
    label: 'Fender Precision Bass',
    brand: 'Fender',
    categoryRoot: 'bass-guitars',
    children: [],
    aliases: ['precision bass', 'p-bass', 'fender precision bass'],
  },
  {
    slug: 'rhodes',
    /*
     * LABEL IS `Rhodes Electric Piano`, NOT bare `Rhodes`, for two measured
     * reasons rather than taste.
     *
     * 1. `rhodes` is a DANGEROUS_TERM_KEY (lib/search-index.ts), so the query
     *    "rhodes" renders a disambiguation SET instead of navigating. This
     *    family is the first whose own slug is a dangerous term, so it is the
     *    first to appear in such a set — beside `Rhodes Mark I Stage 73` and
     *    its siblings. A candidate labelled just "Rhodes" is not choosable
     *    against those; wp4-search.test.ts asserts exactly that property.
     * 2. The route renders `brand` above `label`, which for a bare label would
     *    print "Rhodes" directly above "Rhodes".
     *
     * `Electric Piano` is taken from the catalogue's own taxonomy — all four
     * children are classified `keyboards-and-synths/electric-pianos` — so this
     * is a descriptive family name, not an evocative editorial facet of the
     * kind CLAUDE.md §7 forbids as a taxonomy replacement. The other six
     * families are brand + model; the Rhodes line has no model word to use.
     */
    label: 'Rhodes Electric Piano',
    /*
     * BRAND IS `Rhodes`, NOT `Fender Rhodes` — measured, not chosen by taste.
     * All four children carry `kg_brand.name = 'Rhodes'` (SELECT, 2026-09-20).
     *
     * The line was sold as Fender Rhodes while Fender owned the company and as
     * Rhodes before and after, so NO single brand string is true of the whole
     * production run. The one that is true of the ROWS is the one that keeps
     * this file and `kg_product` from disagreeing — and `brand` here feeds the
     * brand-affinity term in lib/search-resolver.ts, which compares against a
     * single query TOKEN, so `Fender Rhodes` would simply never match one.
     * The Fender era is carried by an alias instead, which is where a
     * historical trading name belongs: navigation, never identity.
     */
    brand: 'Rhodes',
    categoryRoot: 'keyboards-and-synths',
    children: [
      'rhodes-mark-i-stage-73',
      'rhodes-mark-i-suitcase-73',
      'rhodes-mark-ii-stage-73',
      'rhodes-mark-i-stage-88',
    ],
    /*
     * `fender rhodes` is measured, not assumed: 155 of the 395 listing titles
     * containing "Rhodes" say "Fender Rhodes" (SELECT, 2026-09-20).
     *
     * THE COLLISION, AND WHY IT DOES NOT BITE. Ten of those 155 are the
     * `Fender Rhodes Chroma Polaris` — a polyphonic ANALOG SYNTHESIZER, not an
     * electric piano, and it holds its own `kg_product` rows
     * (`fender-rhodes-chroma-polaris`, `rhodes-chroma-polaris`, both qa_only).
     * Navigation auto-resolves on an EXACT alias key only (`exactMatches` in
     * lib/search-resolver.ts; `relatedMatches` is documented there as never
     * used to navigate). `fender rhodes chroma polaris` is not that key, so a
     * Chroma query cannot be captured by this family — it can only surface as
     * a suggestion, which is the right outcome for a term Klup does not
     * support.
     *
     * `rhodes` is deliberately NOT listed: the label and the slug already
     * produce that key. No bare model number appears — `73`, `88` and `mark i`
     * name a CHILD rather than this family, and migration 054 removed `335`
     * for exactly that reason.
     */
    aliases: ['fender rhodes'],
  },
]

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

const FAMILY_BY_CHILD_SLUG = new Map<string, NavigationFamily>(
  NAVIGATION_FAMILIES.flatMap((family) =>
    family.children.map((child) => [child, family] as [string, NavigationFamily]),
  ),
)

/**
 * The family a product slug belongs to, or null — the reverse of `children[]`.
 *
 * This is the WHOLE of the hierarchy a product can see. PAN-52 ratified D5(a),
 * `Family -> Terminal` with no intermediate level, so there is nothing above
 * the family to walk to and no recursion to write. Category and subcategory are
 * browse taxonomy and are explicitly NOT family ancestry (PAN-52 §6), so they
 * are not consulted here and this never returns a browse root.
 *
 * It returns the CONFIGURATION, never a rendering decision: the family it hands
 * back still lists non-canonical children. Every consumer must put those rows
 * through `buildFamilyView` before a single slug reaches a public surface.
 */
export function familyForChild(slug: string): NavigationFamily | null {
  return FAMILY_BY_CHILD_SLUG.get(slug) ?? null
}

/* ------------------------------------------------------------------ *
 * The legacy 308 map
 * ------------------------------------------------------------------ */

/**
 * `/product/<family-slug>` -> `/family/<family-slug>`, or null.
 *
 * Derived from NAVIGATION_FAMILIES rather than written out as a second literal
 * list, so the redirect map and the family routes cannot drift into two
 * descriptions that disagree. Middleware calls this; so does the test.
 *
 * WHY 308 AND NOT 302. The move is permanent: `gibson-les-paul` is a family
 * label and will never again be a priced product page, so the old URL should
 * transfer its authority rather than borrow it. A 308 also preserves the
 * method, which a 301 does not guarantee.
 *
 * The same decision is enforced a second time, independently, in
 * app/product/[slug]/layout.tsx via `isFamilySlug()`. Both read THIS module, so
 * the duplication is defence in depth with one source of truth, never two
 * opinions (build plan §14.2: the posture is not the only control).
 */
export function familyRedirectTarget(pathname: string): string | null {
  const PREFIX = '/product/'
  if (!pathname.startsWith(PREFIX)) return null
  const slug = pathname.slice(PREFIX.length)
  if (slug.length === 0 || slug.includes('/')) return null
  return FAMILY_BY_SLUG.has(slug) ? `/family/${slug}` : null
}

/* ------------------------------------------------------------------ *
 * Child selection — the binding rule of §4.2
 * ------------------------------------------------------------------ */

/** A child row as the family route loads it: the four axes plus a display name. */
export interface FamilyChildRow extends CatalogueStateRow {
  slug: string
  canonical_name?: string | null
}

/** A child the family route is allowed to render. Never carries a price. */
export interface RenderableChild {
  slug: string
  label: string
}

export interface FamilyView {
  family: NavigationFamily
  /** Canonical-eligible children only, in reviewed order. Possibly empty. */
  children: readonly RenderableChild[]
  /** True once at least one child is canonical: indexable AND navigable. */
  published: boolean
}

/**
 * A family becomes indexable and navigable at one canonical child.
 *
 * ONE THRESHOLD, NOT TWO. `noindex`, sitemap membership, navigation listing and
 * search-index membership all turn on the same number, so they can never
 * disagree — a family cannot be crawlable while unlisted, or listed while
 * uncrawlable. Q-D5 may raise this value; it may never split it in two.
 */
export const FAMILY_MIN_CANONICAL_CHILDREN = 1

/**
 * THE BINDING RULE. A family renders links to canonical-eligible children only,
 * and renders NOTHING AT ALL for any other child — not a greyed card, not a
 * disabled card, not a name in a list presented as catalogue depth.
 *
 * Rendering an unpublished product would advertise a URL that 404s (the gate in
 * lib/catalogue.ts refuses it) and would leak private catalogue state onto a
 * public page. Filtering happens HERE, on the four-axis predicate imported from
 * lib/catalogue.ts, so the family route cannot express a weaker rule than the
 * product route enforces.
 *
 * Rows may arrive in any order and may be missing entirely; a child with no row
 * is simply not canonical. Fail-closed throughout.
 */
export function buildFamilyView(
  family: NavigationFamily,
  rows: readonly FamilyChildRow[],
): FamilyView {
  const bySlug = new Map<string, FamilyChildRow>()
  for (const row of rows) {
    if (row && typeof row.slug === 'string' && row.slug.length > 0) bySlug.set(row.slug, row)
  }

  const children: RenderableChild[] = []
  for (const slug of family.children) {
    const row = bySlug.get(slug)
    if (!row) continue
    if (!isCanonical(row)) continue
    const name = typeof row.canonical_name === 'string' ? row.canonical_name.trim() : ''
    children.push({ slug, label: name.length > 0 ? name : slug })
  }

  return {
    family,
    children,
    published: children.length >= FAMILY_MIN_CANONICAL_CHILDREN,
  }
}
