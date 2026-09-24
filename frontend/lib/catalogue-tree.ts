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
 *        construction. A visitor filters by it, so it is not a node: it lives
 *        only as a chip on `/browse/<root>` (`?sub=` unchanged), and its
 *        products belong to the root.
 *    `FACET_SUBCATEGORIES` below is the hand-maintained list. An unlisted
 *    leaf is a KIND, so a newly published leaf behaves exactly as before and
 *    nothing disappears from the navigation silently.
 *    PAN-138: some kinds are two leaves shown as one (`SUBCATEGORY_GROUPS`) —
 *    analog and digital synths are one "Synthesizere" node, because the
 *    technology split is not a line a visitor can use.
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
 * `analog-synths` / `digital-synths` used to be here. PAN-138 took them out:
 * the owner decided analog/digital is not a clear axis (modern synths are
 * hybrids, and the Juno-106 is DCO), so they are not a filter either — they
 * are one kind, displayed through `SUBCATEGORY_GROUPS` below.
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
])

/**
 * PAN-138 — leaves DISPLAYED as one kind.
 *
 * Presentation only. The data is untouched: products keep `analog-synths` /
 * `digital-synths` as their `subcategory_id`, because `is_public` requires
 * `taxonomy_state = 'classified'` and a nulled or moved leaf would unpublish
 * them. The merge happens here, on the way out, and nowhere else — the tree
 * (`buildCatalogueTree`, `currentCatalogueNode`) and the chip row on
 * `/browse/<root>` both go through `displaySubcategorySlug`, so the sidebar
 * and the chips cannot drift about which leaves are one place.
 *
 * The group slug is what `?sub=` carries (`?sub=synthesizers`). A member's own
 * slug resolves to its group, so an old `?sub=analog-synths` link lands on the
 * group rather than on an empty grid.
 *
 * `labelKey` names the copy in `lib/i18n.ts`: no `kg_category` row exists for
 * a group, so this is the one deliberate exception to PAN-107's single label
 * authority. It is a string literal rather than an import so this module stays
 * import-free; tsc still rejects a key `i18n.ts` does not have, wherever `t` is
 * indexed with it.
 *
 * A group slug must not equal a real leaf slug under the same root, or `?sub=`
 * could not tell them apart. `synthesizers` is not a Reverb leaf.
 *
 * `synthesizers` holds every Reverb leaf that is a whole synthesizer, whatever
 * its form factor: desktop, keyboard, rack, or a complete modular system. A
 * form factor is not a kind a visitor navigates by, the same reasoning that
 * merged analog and digital. Left out on purpose: `eurorack` and
 * `synth-modules` (single modules, most of which make no sound alone),
 * modular cases and accessories, MIDI controllers, vocoders, workstations.
 */
export const SUBCATEGORY_GROUPS = {
  synthesizers: {
    labelKey: 'subcategoryGroupSynthesizers',
    leaves: [
      'keyboards-and-synths/analog-synths',
      'keyboards-and-synths/digital-synths',
      'keyboards-and-synths/desktop-synths',
      'keyboards-and-synths/keyboard-synths',
      'keyboards-and-synths/rackmount-synths',
      'keyboards-and-synths/complete-modular-synth-systems',
    ],
  },
} as const

export type SubcategoryGroupSlug = keyof typeof SUBCATEGORY_GROUPS
type SubcategoryGroupLabelKey = (typeof SUBCATEGORY_GROUPS)[SubcategoryGroupSlug]['labelKey']

/** Each group's display names, resolved from i18n by a caller that may import it. */
export type SubcategoryGroupNames = Record<SubcategoryGroupSlug, { name_da: string; name_en: string }>

const GROUP_OF_LEAF: ReadonlyMap<string, SubcategoryGroupSlug> = new Map(
  (Object.keys(SUBCATEGORY_GROUPS) as SubcategoryGroupSlug[]).flatMap((group) =>
    SUBCATEGORY_GROUPS[group].leaves.map((leaf) => [leaf, group] as const),
  ),
)

export function isSubcategoryGroup(slug: string): slug is SubcategoryGroupSlug {
  return Object.prototype.hasOwnProperty.call(SUBCATEGORY_GROUPS, slug)
}

/**
 * The slug a bare leaf is displayed under on `/browse/<root>`: its group's when
 * it has one, otherwise its own. A group slug or an unknown slug passes through
 * unchanged, so this is safe to apply to whatever `?sub=` holds.
 */
export function displaySubcategorySlug(rootSlug: string, bareLeaf: string): string {
  return GROUP_OF_LEAF.get(`${rootSlug}/${bareLeaf}`) ?? bareLeaf
}

/**
 * Every group's names, read from a `translations`-shaped object. Taken as an
 * argument rather than imported so this module stays import-free; the server
 * caller passes `translations` from `lib/i18n.ts`.
 */
export function subcategoryGroupNames(
  copy: Record<'da' | 'en', Record<SubcategoryGroupLabelKey, string>>,
): SubcategoryGroupNames {
  const names = {} as SubcategoryGroupNames
  for (const group of Object.keys(SUBCATEGORY_GROUPS) as SubcategoryGroupSlug[]) {
    const key = SUBCATEGORY_GROUPS[group].labelKey
    names[group] = { name_da: copy.da[key], name_en: copy.en[key] }
  }
  return names
}

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
  /**
   * The bare leaf slug (`drum-machines`), as `/browse/<root>` reports it — or,
   * for a grouped kind, the group slug (`synthesizers`) the chip row writes.
   */
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

type CatalogueNodeLabel = { slug: string; name_da: string; name_en: string }

/**
 * Where one product stands in the catalogue: its category, and its kind when
 * it has one — `null` for a facet leaf (rule 2), the group for a grouped leaf
 * (PAN-138). Derived from the product's OWN subcategory and nothing else;
 * PAN-52 §6 forbids reaching a category through a family.
 */
export type ProductPlacement = { category: CatalogueNodeLabel; kind: CatalogueNodeLabel | null }

/**
 * The one placement rule, shared by the sidebar tree and the product-page
 * breadcrumb (PAN-121) so the node the sidebar marks and the crumbs the page
 * prints cannot disagree. `null` when the row cannot be placed — the same
 * fail-closed answer the tree gives by dropping it.
 */
export function placeInCatalogue(
  row: Omit<CatalogueTreeRow, 'slug' | 'canonical_name'>,
  groupNames: SubcategoryGroupNames,
): ProductPlacement | null {
  const rootSlug = row.root_category_slug
  const subSlug = row.subcategory_slug
  if (!rootSlug || !subSlug) return null

  const category = {
    slug: rootSlug,
    name_da: row.root_category_name_da ?? rootSlug,
    name_en: row.root_category_name_en ?? rootSlug,
  }
  if (FACET_SUBCATEGORIES.has(subSlug)) return { category, kind: null }

  // PAN-138: a grouped leaf stands in its group, so two leaves are one kind.
  const group = GROUP_OF_LEAF.get(subSlug)
  const kindSlug = group ?? bareLeafSlug(subSlug)
  return {
    category,
    kind: {
      slug: kindSlug,
      name_da: group ? groupNames[group].name_da : row.subcategory_name_da ?? kindSlug,
      name_en: group ? groupNames[group].name_en : row.subcategory_name_en ?? kindSlug,
    },
  }
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
 * CATEGORY ORDER is populated-first by descending count, then `name_en` — the
 * same rule `buildHomeCategories` uses, so the two navigation surfaces cannot
 * present the same categories in two different orders. It is total and
 * locale-independent, so the server and the client agree about it.
 *
 * KINDS ARE NOT ORDERED HERE (PAN-141). Their order is by the label the
 * visitor reads, which depends on the locale, so it is applied where the
 * label is: `sortKindsByLabel`, at render.
 */
export function buildCatalogueTree(
  rows: CatalogueTreeRow[],
  groupNames: SubcategoryGroupNames,
): CatalogueTreeCategory[] {
  const byRoot = new Map<string, CatalogueTreeCategory>()
  const leaves = new Map<string, CatalogueTreeSubcategory>()

  for (const row of rows) {
    const place = placeInCatalogue(row, groupNames)
    if (!place) continue

    let root = byRoot.get(place.category.slug)
    if (!root) {
      root = { ...place.category, product_count: 0, subcategories: [], product_slugs: [] }
      byRoot.set(root.slug, root)
    }

    root.product_count += 1
    root.product_slugs.push(row.slug)

    // Rule 2: a facet is not a node, so its product belongs to the root alone.
    if (!place.kind) continue

    const leafKey = `${root.slug}/${place.kind.slug}`
    let leaf = leaves.get(leafKey)
    if (!leaf) {
      leaf = { ...place.kind, product_count: 0, product_slugs: [] }
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

  return Array.from(byRoot.values()).sort(byCountThenName)
}

/**
 * PAN-141 — the one order a category's kinds are listed in, in the sidebar and
 * in the chip row on `/browse/<root>`: alphabetical by the label the visitor
 * reads. The two used to disagree on one page (the sidebar by product count,
 * the chips by English leaf name), so both call this and neither states an
 * order of its own.
 *
 * By the DISPLAYED label, so it takes the locale: a grouped kind (PAN-138)
 * sorts under its group's label, and Danish sorts with Danish collation.
 * Count is deliberately not a key, so the order stays put as products are
 * published. The chip row's "Alle" is not a kind and stays first.
 */
export function sortKindsByLabel<T>(
  kinds: readonly T[],
  labelOf: (kind: T) => string,
  locale: 'da' | 'en',
): T[] {
  return [...kinds].sort((a, b) => labelOf(a).localeCompare(labelOf(b), locale))
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
  // the branch stops claiming to be. Exactly one, never both. A grouped leaf
  // (`?sub=analog-synths`, an old link) resolves to its group first (PAN-138).
  const sub = activeSub ? displaySubcategorySlug(categorySlug, activeSub) : null
  if (sub && category.subcategories.some((node) => node.slug === sub)) {
    return { kind: 'subcategory', categorySlug, subcategorySlug: sub }
  }

  // A FACET `?sub=` (rule 2) has no node, so the root is where the visitor
  // stands — the facet chip on the page says what is narrowing it. An
  // unrecognised `?sub=` falls back the same way rather than marking nothing.
  return { kind: 'branch', categorySlug }
}
