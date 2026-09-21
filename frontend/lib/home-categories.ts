/**
 * PAN-86 — the category shelf on the logged-out homepage.
 *
 * Import-free, for the same reason `catalogue.ts` and `publication.ts` are: the
 * two rules this file owns have to be exercisable from plain Node, without
 * React, Next or a Supabase client in scope.
 *
 * TWO RULES, AND THEY ARE THE WHOLE FILE.
 *
 * 1. SCOPE IS THE DOMAIN AXIS, NOT A SLUG LIST. `kg_category` holds 20 roots;
 *    five of them (`danish-modern`, `design-objects`, `cycling`, `photography`,
 *    `tech`) are out-of-scope verticals whose rows stay inactive (CLAUDE.md
 *    preamble). They are excluded by `domain !== 'music'`, which is exact-match
 *    and fail-closed — a row whose domain cannot be read is dropped, so a new
 *    vertical arriving with a domain nobody has taught this function about
 *    renders nothing rather than renders by default. A hardcoded deny-list
 *    would have the opposite failure mode.
 *
 * 2. THE COUNT IS THE ROWS THE NEXT PAGE WILL SERVE, DERIVED FROM THOSE ROWS.
 *    A card may never print a number its own destination cannot honour — the
 *    defect that motivated the ticket was a tile advertising 268 listings in
 *    front of a page that followed nothing. So `product_count` is not queried
 *    separately and not computed from a different predicate: it counts the
 *    SAME public, supported projection rows that `/browse/<slug>` reports as
 *    `total_public_products`. One derivation, so the two cannot drift.
 *
 * Note what is deliberately NOT here: `active_listing_count`. A root's listing
 * total (862 for keyboards-and-synths today) is a much larger and more
 * flattering number than its product total (19), and it is the number that
 * caused the defect. The card counts products, because a product is what the
 * destination page lists.
 */

/** The one in-scope domain. Exact match — see rule 1. */
export const HOME_CATEGORY_DOMAIN = 'music'

/** A `kg_category` row, as much of it as the shelf needs. */
export type HomeCategoryRow = {
  id: string
  slug: string
  name_da: string | null
  name_en: string | null
  domain: string | null
  parent_id: string | null
  image_url: string | null
}

export type HomeCategory = {
  id: string
  slug: string
  name_da: string
  name_en: string
  image_url: string | null
  product_count: number
}

/**
 * Build the homepage category shelf.
 *
 * `publicRootCategoryIds` is one entry per public, supported product — the
 * `root_category_id` of each row the catalogue actually serves. Passing the
 * ids rather than a precomputed tally is what keeps rule 2 true: the caller
 * cannot hand this function a count from somewhere else.
 *
 * ORDER: populated roots first, by descending count, then by `name_en`. The
 * four roots that have something behind them lead, and the order is total and
 * locale-independent, so the server and the client cannot disagree about it.
 *
 * Every in-scope root is returned, INCLUDING the empty ones. That is the
 * product decision (PAN-86 option 3): emptiness is made visible before the
 * click rather than discovered after it. `/browse` takes the other option and
 * hides empty roots; the two surfaces answer different questions and are
 * allowed to differ, but only one of them is honest about coverage.
 */
export function buildHomeCategories(
  roots: HomeCategoryRow[],
  publicRootCategoryIds: Array<string | null>,
): HomeCategory[] {
  const counts = new Map<string, number>()
  for (const id of publicRootCategoryIds) {
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return roots
    .filter((row) => row.domain === HOME_CATEGORY_DOMAIN && row.parent_id === null)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name_da: row.name_da ?? row.slug,
      name_en: row.name_en ?? row.slug,
      image_url: row.image_url,
      product_count: counts.get(row.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.product_count !== a.product_count) return b.product_count - a.product_count
      return a.name_en.localeCompare(b.name_en, 'en')
    })
}
