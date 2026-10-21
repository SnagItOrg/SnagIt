/**
 * PAN-275 — the kinds a search query NAMES.
 *
 * "reverb" on Klup used to answer with eight Fender amps: every product whose
 * NAME contains the word, and nothing that IS a reverb unless it happens to be
 * called one. The catalogue already knows the kind — `Effekter & pedaler ›
 * Reverb` is a node every one of those pedals stands under — so the SERP's
 * second group is that node's public products, under their own header.
 *
 * THE RULE IS EQUALITY, NOT SEARCH. A query names a kind when its model key is
 * the model key of the kind's Danish or English name — the whole name, both
 * locales, nothing fuzzier. "reverb" is the Reverb kind; "reverb pedal" and
 * "rev" are not. A fuzzier rule would turn every search into a browse, and
 * the browse page already exists for that.
 *
 * NOTHING HERE DECIDES ELIGIBILITY. The tree is built from the public browse
 * rows, so its slugs are already public — but they are re-decided by the same
 * `filterEligibleSlugs` pass the candidates go through, and `buildKindGroups`
 * only keeps what that pass kept. A kind's product is never a product the
 * name matches already show: the groups are disjoint by construction.
 *
 * Server-side: the route calls it with the cached catalogue tree. Pure and
 * import-light so the root suite can exercise it from plain Node.
 */

import { modelKey } from './model-key'
import { subcategoryHref, type CatalogueTreeCategory } from './catalogue-tree'
import type { SearchCandidate, SearchKindGroup } from './search-contract'

/** Rows shown under the header before the "see all" row takes over. */
export const MAX_KIND_PRODUCTS = 4

/** Shorter than this and a kind name would be matched by a typo. */
const MIN_KEY_LENGTH = 3

type NodeLabel = { slug: string; name_da: string; name_en: string }

export interface KindMatch {
  category: NodeLabel
  kind: NodeLabel
  href: string
  /** Every product slug the tree lists under the kind, unfiltered. */
  productSlugs: string[]
}

/** The catalogue kinds whose name IS the query, in tree order. */
export function kindsNamedBy(rawQuery: string, categories: readonly CatalogueTreeCategory[]): KindMatch[] {
  const key = modelKey(rawQuery)
  if (key.length < MIN_KEY_LENGTH) return []
  const out: KindMatch[] = []
  for (const category of categories) {
    for (const kind of category.subcategories) {
      if (modelKey(kind.name_da) !== key && modelKey(kind.name_en) !== key) continue
      out.push({
        category: { slug: category.slug, name_da: category.name_da, name_en: category.name_en },
        kind: { slug: kind.slug, name_da: kind.name_da, name_en: kind.name_en },
        href: subcategoryHref(category.slug, kind.slug),
        productSlugs: [...kind.product_slugs],
      })
    }
  }
  return out
}

/** The projection columns a kind row renders with — the same the candidate rows use. */
export interface KindProductRow {
  slug: string
  canonical_name: string | null
  brand_name: string | null
  image_url: string | null
  active_listing_count: number | null
}

/**
 * The groups the page renders: eligible, not already shown, most listings
 * first, capped. A kind with nothing left to show is no group at all.
 */
export function buildKindGroups(
  matches: readonly KindMatch[],
  shownSlugs: ReadonlySet<string>,
  eligibleSlugs: ReadonlySet<string>,
  rows: ReadonlyMap<string, KindProductRow>,
): SearchKindGroup[] {
  const groups: SearchKindGroup[] = []
  for (const match of matches) {
    const slugs = match.productSlugs.filter((slug) => eligibleSlugs.has(slug) && !shownSlugs.has(slug))
    const products = slugs
      .map((slug) => rows.get(slug))
      .filter((row): row is KindProductRow & { canonical_name: string } => row != null && typeof row.canonical_name === 'string')
      .sort((a, b) => (b.active_listing_count ?? 0) - (a.active_listing_count ?? 0) || a.canonical_name.localeCompare(b.canonical_name))
      .slice(0, MAX_KIND_PRODUCTS)
      .map(toCandidate)
    if (products.length === 0) continue
    groups.push({ category: match.category, kind: match.kind, href: match.href, products, total: slugs.length })
  }
  // The fuller kind first: "reverb" is four effects and one Lexicon, and the
  // visitor should meet the four. Stable, so equal sizes keep tree order.
  return groups.sort((a, b) => b.total - a.total)
}

function toCandidate(row: KindProductRow & { canonical_name: string }): SearchCandidate {
  return {
    kind: 'product',
    slug: row.slug,
    label: row.canonical_name,
    brand: row.brand_name ?? '',
    href: `/product/${row.slug}`,
    imageUrl: row.image_url,
    activeListingCount: row.active_listing_count ?? 0,
  }
}
