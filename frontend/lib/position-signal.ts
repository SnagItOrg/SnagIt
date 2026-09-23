/**
 * PAN-121 — the one position signal.
 *
 * Klup has no breadcrumb on `/browse`, `/search` or `/family/[slug]`, and the
 * sidebar tree — the only wayfinding aid present on every route — is about to
 * be collapsed by default (PAN-120). What replaces it is not a path through a
 * tree, because the public surface is not a tree a visitor walks: it is a
 * catalogue plus a filter state. The honest answer to "where am I" is what is
 * currently narrowing the result set, and that answer has a property a
 * breadcrumb lacks — it is removable.
 *
 * THE COUNT IS A PRODUCT CLAIM, AND THIS MODULE IS WHY IT CANNOT LIE.
 *
 * PAN-98 is the ticket that exists because nobody asserted: `fender-telecaster`
 * advertised 187 and rendered 75, because the number came from a projection
 * column and the rows came from a narrower predicate. The fix is not a rule
 * that callers must remember. It is the signature below.
 *
 * `buildPositionSignal` takes `renderedRows` — the very array the caller maps
 * over — and never a number. `count` is that array's `.length`. There is no
 * numeric field on the input a projection total could travel in, so a caller
 * who wanted to advertise 187 over 75 rendered rows would have to fabricate an
 * array of 187 elements and render it. The prohibition is structural rather
 * than a flag, in the same way `FamilyListing` carries no field a price could
 * travel in.
 *
 * This module deliberately imports nothing. It restates no filter predicate —
 * `lib/browse.ts` owns which rows a state yields, and this module only counts
 * the rows it is handed. It resolves no label: `kg_category.name_da` is the
 * single authority since PAN-107, so callers pass the already-resolved,
 * already-localised string.
 */

/**
 * What kind of narrowing a chip represents.
 *
 * `subcategory` is `/browse/[root]`'s chip row; `query` is `/search`'s term.
 * A category or family is the *scope*, not a filter — it is where you are
 * rather than something you added, and removing it would mean leaving the
 * page rather than widening the set.
 */
export type PositionFilterKind = 'subcategory' | 'query'

export type PositionFilter = {
  /** Stable identity, for the React key and for the remove callback. */
  id: string
  kind: PositionFilterKind
  /** Already resolved and already localised by the caller. */
  label: string
}

/**
 * What the number counts. Two values because there are two real callers:
 * `/browse` renders category tiles, the other three render result rows.
 */
export type PositionCountKind = 'results' | 'categories'

export type PositionSignal = {
  /**
   * The category, family or catalogue root in force. Already localised.
   *
   * OPTIONAL, AND THE SCREENSHOTS ARE WHY. On `/browse/[root]` the category
   * name is already the `<h1>` *and* already the last crumb of the breadcrumb
   * above it; on `/family/[slug]` it is already the `<h1>`. Rendering it again
   * here put the same six words on screen three times in a vertical stack, and
   * a visitor reading three position statements is in the failure mode a single
   * signal exists to prevent — they have to work out which one to trust.
   *
   * So the caller passes a scope only where it says something the page does not
   * already say: `/browse` and `/search`, whose headings are generic page
   * titles ("Gennemse", "Søg") rather than the scope itself. Where the heading
   * IS the scope, the heading is the position line and this is omitted.
   */
  scope?: string
  filters: PositionFilter[]
  /** Always `renderedRows.length`. See the module comment. */
  count: number
  countKind: PositionCountKind
  /**
   * Nothing is narrowing the set. The surface says so rather than rendering an
   * empty bar — an acceptance criterion, not a cosmetic hint.
   */
  unfiltered: boolean
}

export function buildPositionSignal<Row>(input: {
  /** Omit where the page's own `<h1>` already states it. See the type above. */
  scope?: string
  /**
   * THE RENDERED ROWS THEMSELVES, not a count of them and never a projection
   * total. Pass the same array the JSX maps over.
   */
  renderedRows: readonly Row[]
  filters?: readonly PositionFilter[]
  countKind?: PositionCountKind
}): PositionSignal {
  const filters = [...(input.filters ?? [])]

  return {
    scope: input.scope,
    filters,
    count: input.renderedRows.length,
    countKind: input.countKind ?? 'results',
    unfiltered: filters.length === 0,
  }
}
