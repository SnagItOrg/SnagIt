/**
 * PAN-17 — the catalogue tree in the sidebar.
 *
 * Import-free, for the same reason `catalogue.ts`, `publication.ts`,
 * `home-categories.ts` and `subcategory-filter.ts` are: the rules this file
 * owns have to be exercisable from plain Node, and `SideNav` is a client
 * component that must gain no import edge to `lib/browse` or the service-role
 * client (wp4a-boundary.test).
 *
 * PAN-30's finding is the whole design: the taxonomy is missing no branches,
 * products were simply never placed in it. 320 leaves exist; the public
 * catalogue occupies 14 of them under 6 roots. So this module decides how
 * LITTLE to expose, and it does that by deriving the tree entirely from the
 * rows the public catalogue already serves.
 *
 * THOSE NUMBERS MOVE, WHICH IS WHY NONE OF THEM IS IN THE CODE. They changed
 * during this ticket: 31 products / 8 leaves / 4 roots when it was written,
 * 49 / 14 / 6 two hours later, because the operator published. Nothing here
 * enumerates a root, a leaf or a count — the tree is whatever the rows say it
 * is, so a publish widens it with no deploy and an unpublish narrows it on the
 * next request.
 *
 * FOUR RULES.
 *
 * 1. POPULATED BRANCHES ONLY, AND IT IS STRUCTURAL RATHER THAN A FILTER
 *    (D-IA-1). The tree is built FROM the product rows, so a root with no
 *    public supported product contributes nothing to build from and cannot
 *    render. There is no `product_count > 0` test to forget: eight of the
 *    fourteen renderable music roots are empty today and none of them can
 *    reach this output.
 *    That is the opposite decision from the homepage shelf, which shows all
 *    fourteen with an honest count — the homepage answers "what does Klup
 *    cover", the sidebar answers "where can I go", and an empty branch is a
 *    dead end in a navigation tree.
 *
 * 2. TWO LEVELS AT MOST, AND ONLY A KIND IS A LEVEL. Category and immediate
 *    subcategory, and nothing finer — and no products (rule 3). Generation, year
 *    and colour are filters; a family is a navigation concept owned by
 *    `lib/families.ts` and is not a taxonomy level.
 *    PAN-121 round 2 SUPERSEDES the old D-IA-2, which made form factor a
 *    filter but kept technology (`analog`/`digital`) as a level. Reverb's
 *    taxonomy mixes two kinds of leaf at one level, and they are different
 *    things to a visitor:
 *      - a KIND is what a thing is — drum machines, microphones, reverb. A
 *        visitor navigates BY it ("I want a drum machine"), so it stays a
 *        node in the tree.
 *      - a FACET is an attribute of a thing — body shape, string count,
 *        construction, synthesis technology. A visitor filters by it, so it
 *        is not a node: it lives only as a chip on `/browse/<root>` (`?sub=`
 *        unchanged), and its products belong to the root.
 *    `FACET_SUBCATEGORIES` below is the hand-maintained list. An unlisted
 *    leaf is a KIND, so a newly published leaf behaves exactly as before and
 *    nothing disappears from the navigation silently.
 *
 * 3. NO PRODUCTS ARE NODES (PAN-121 round 3). Products live on the page
 *    grid; the tree is categories and kinds. It still has to know WHICH
 *    products each node holds, because on `/product/<slug>` the sidebar marks
 *    the product's kind (or its root) and the breadcrumb names the product.
 *    So each node carries `product_slugs` — membership for that one lookup,
 *    never rendered, and without a label. This retired `LEAF_PRODUCT_LIMIT`:
 *    nothing enumerates products any more, so there is nothing to cap.
 *
 * 4. NO PRICE REACHES THIS PAYLOAD. Not a band, not a median, not a deal
 *    verdict. A node's product membership is a list of bare slugs, which has
 *    no field a price could travel in — the same structural guarantee
 *    `FamilyListing` gives in `families.ts`, asserted the same way PAN-56
 *    asserts it, by the shape of the object rather than by comparing a value.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: decide eligibility. It is handed
 * rows and places them. `isCanonical()` remains the one authority for what may
 * be listed (CLAUDE.md §5), reached through `fetchPublicBrowseRows` in
 * `lib/browse.ts` — the same call `/browse` and `/browse/<root>` make. One
 * predicate, so the tree and the browse pages cannot drift about what exists.
 */

/**
 * PAN-121 round 2 — the subcategories that are FACETS, not kinds (rule 2).
 *
 * Full `<root>/<leaf>` slugs, as the projection stores them, so a leaf slug
 * reused under another root cannot be caught by accident. Hand-maintained on
 * purpose: whether a leaf is something you navigate to or something you
 * filter by is an editorial judgement, and there are 14 live leaves — a
 * database column would be machinery for a list a person reads in one glance.
 *
 * `analog-synths` / `digital-synths` are contestable (a technology, not a
 * kind — and the Juno-106 is filed under digital), which is exactly why they
 * are here: a filed-wrong product under a filter is a filter miss; under a
 * navigation node it is a signpost pointing the wrong way.
 *
 * DEFAULT IS KIND. Adding a leaf here removes it from the sidebar; forgetting
 * to add one leaves it where it always was.
 */
export const FACET_SUBCATEGORIES: ReadonlySet<string> = new Set([
  'acoustic-guitars/dreadnought',
  'acoustic-guitars/jumbo',
  'bass-guitars/4-string',
  'electric-guitars/solid-body',
  'electric-guitars/semi-hollow',
  'keyboards-and-synths/analog-synths',
  'keyboards-and-synths/digital-synths',
])

/**
 * A `browse_product_projection` row, narrowed to the seven fields the tree
 * reads. Deliberately the narrowest shape that works, so the module cannot see
 * a price column even if the projection grows one.
 */
export type CatalogueTreeRow = {
  slug: string
  canonical_name: string
  root_category_slug: string | null
  root_category_name_da: string | null
  root_category_name_en: string | null
  subcategory_slug: string | null
  subcategory_name_da: string | null
  subcategory_name_en: string | null
}

export type CatalogueTreeSubcategory = {
  /** The bare leaf slug (`analog-synths`), as `/browse/<root>` reports it. */
  slug: string
  name_da: string
  name_en: string
  product_count: number
  /** Membership only, for `currentCatalogueNode` (rule 3). Never rendered. */
  product_slugs: string[]
}

export type CatalogueTreeCategory = {
  slug: string
  name_da: string
  name_en: string
  /** Every product under the root, in its kinds and its facets alike. */
  product_count: number
  /** KINDS only (rule 2). A facet leaf never appears here. */
  subcategories: CatalogueTreeSubcategory[]
  /** Membership only — every product under the root (rule 3). Never rendered. */
  product_slugs: string[]
}

/** `subcategory_slug` is stored as `<root>/<leaf>`; the route uses the leaf. */
function bareLeafSlug(slug: string): string {
  return slug.split('/')[1] ?? slug
}

/**
 * Build the sidebar tree from the rows the public catalogue serves.
 *
 * FAIL-CLOSED PLACEMENT. A row whose root or subcategory slug cannot be read
 * is dropped rather than parked at the top level. `is_public` already requires
 * `taxonomy_state = 'classified'`, so the projection cannot hand us one today;
 * dropping it keeps the invariant that every node in this tree is a place a
 * visitor can actually stand, instead of inventing an "Other" branch the
 * taxonomy does not have.
 *
 * ORDER is populated-first by descending count, then `name_en` — the same rule
 * `buildHomeCategories` uses, so the two navigation surfaces cannot present
 * the same categories in two different orders. It is total and
 * locale-independent, so the server and the client agree about it.
 */
export function buildCatalogueTree(rows: CatalogueTreeRow[]): CatalogueTreeCategory[] {
  const byRoot = new Map<string, CatalogueTreeCategory>()
  const leaves = new Map<string, CatalogueTreeSubcategory>()

  for (const row of rows) {
    const rootSlug = row.root_category_slug
    const subSlug = row.subcategory_slug
    if (!rootSlug || !subSlug) continue

    let root = byRoot.get(rootSlug)
    if (!root) {
      root = {
        slug: rootSlug,
        name_da: row.root_category_name_da ?? rootSlug,
        name_en: row.root_category_name_en ?? rootSlug,
        product_count: 0,
        subcategories: [],
        product_slugs: [],
      }
      byRoot.set(rootSlug, root)
    }

    root.product_count += 1
    root.product_slugs.push(row.slug)

    // Rule 2: a facet is not a node, so its product belongs to the root alone.
    if (FACET_SUBCATEGORIES.has(subSlug)) continue

    const leafKey = `${rootSlug} ${subSlug}`
    let leaf = leaves.get(leafKey)
    if (!leaf) {
      const bare = bareLeafSlug(subSlug)
      leaf = {
        slug: bare,
        name_da: row.subcategory_name_da ?? bare,
        name_en: row.subcategory_name_en ?? bare,
        product_count: 0,
        product_slugs: [],
      }
      leaves.set(leafKey, leaf)
      root.subcategories.push(leaf)
    }

    leaf.product_count += 1
    leaf.product_slugs.push(row.slug)
  }

  const byCountThenName = (
    a: { product_count: number; name_en: string },
    b: { product_count: number; name_en: string },
  ) => {
    if (b.product_count !== a.product_count) return b.product_count - a.product_count
    return a.name_en.localeCompare(b.name_en, 'en')
  }

  const categories = Array.from(byRoot.values())
  for (const root of categories) {
    root.subcategories.sort(byCountThenName)
  }

  return categories.sort(byCountThenName)
}

/**
 * The one node in the tree that is the current page, or `null`.
 *
 * PAN-121 marked the current node by computing a fresh predicate at each of the
 * three levels while rendering them. That produced the right answer, but "only
 * one node is ever marked" was an emergent property of three independent
 * booleans rather than a guarantee — and it left the caller no way to ask the
 * question it actually needed answered: *did the tree mark anything at all?*
 *
 * It needs that answer because the tree is not always on screen. Collapsed to
 * 72px the tree does not render, so on `/browse/<root>` nothing in the sidebar
 * said where the visitor was — measured on production: `aria-current` is absent
 * on `/browse/[root]`, on `?sub=`, and on `/product/[slug]` in the collapsed
 * default, which is the state every first-time visitor gets. The sidebar falls
 * back to marking the section when this returns `null`, and it can only know to
 * do that if one function owns the decision.
 *
 * Returning a value rather than a boolean keeps the renderer honest: each node
 * compares itself against the single answer, so two nodes cannot both believe
 * they are current.
 *
 * FAIL-CLOSED. A path that looks like a catalogue URL but names nothing in the
 * tree — an unpopulated root, a product the tree does not carry — returns
 * `null` rather than a guess. The caller then marks the section, which is true
 * at a coarser resolution, instead of marking a node that is not there.
 *
 * EVERY VARIANT CARRIES `categorySlug` (PAN-132): the branch that holds the
 * mark must open, so the renderer needs the containing category and must not
 * derive it a second time. Since round 3 there is no product variant — a
 * product page answers with the kind or the root that holds the product.
 */
export type CurrentCatalogueNode =
  | { kind: 'branch'; categorySlug: string }
  | { kind: 'subcategory'; categorySlug: string; subcategorySlug: string }
  | null

export function currentCatalogueNode(
  categories: CatalogueTreeCategory[],
  pathname: string,
  activeSub: string | null,
): CurrentCatalogueNode {
  // PAN-121 round 3: a product is not a node, so a product page marks the
  // node that holds it — its kind if it has one, otherwise its root. The
  // breadcrumb is what names the product itself.
  const productMatch = /^\/product\/([^/]+)\/?$/.exec(pathname)
  if (productMatch) {
    const slug = decodeURIComponent(productMatch[1])
    const holder = categories.find((category) => category.product_slugs.includes(slug))
    if (!holder) return null
    const kind = holder.subcategories.find((sub) => sub.product_slugs.includes(slug))
    return kind
      ? { kind: 'subcategory', categorySlug: holder.slug, subcategorySlug: kind.slug }
      : { kind: 'branch', categorySlug: holder.slug }
  }

  const browseMatch = /^\/browse\/([^/]+)\/?$/.exec(pathname)
  if (!browseMatch) return null

  const categorySlug = decodeURIComponent(browseMatch[1])
  const category = categories.find((c) => c.slug === categorySlug)
  if (!category) return null

  // A KIND narrows the answer: the subcategory is where the visitor is, and
  // the branch stops claiming to be. Exactly one, never both.
  if (activeSub && category.subcategories.some((sub) => sub.slug === activeSub)) {
    return { kind: 'subcategory', categorySlug, subcategorySlug: activeSub }
  }

  // A FACET `?sub=` (rule 2) has no node, so the root is where the visitor
  // stands — the facet chip on the page says what is narrowing it. An
  // unrecognised `?sub=` falls back the same way rather than marking nothing.
  return { kind: 'branch', categorySlug }
}
