/**
 * PAN-97 — narrowing and labelling for the admin subcategory picker.
 *
 * Import-free, like `catalogue.ts` and `publication.ts`, so the two rules the
 * picker must not restate stay exercisable from plain Node without React.
 *
 * Neither function ranks. `kg_category` holds no signal about which leaf a
 * given product probably is, so ordering stays the server's alphabetical
 * order and the operator decides. A match is a match.
 */

/** The row shape served by `GET /api/admin/product/subcategories`. */
export type SubcategoryOption = {
  id: string
  name: string
  parent_name: string | null
  classifies: boolean
}

/**
 * The parent is part of the identity, not decoration.
 *
 * 13 leaf names occur under more than one root in production — `Baritone` and
 * `Left-Handed` under three each, `Archtop`, `Reverb`, `Mixers`, `Turntables`
 * and nine more under two. An unlabelled `Baritone` is not a choice anyone can
 * make correctly.
 *
 * `parent_name` is null only if the parent row could not be resolved, which is
 * a broken hierarchy rather than a root; the bare name is then all there is.
 */
export function subcategoryLabel(option: SubcategoryOption): string {
  return option.parent_name ? `${option.parent_name} › ${option.name}` : option.name
}

/**
 * Every whitespace-separated term must appear somewhere in the parent-and-leaf
 * text, so `solid` and `guitars solid` both reach `Electric Guitars › Solid
 * Body` and word order does not matter. Substring, not prefix: `hollow` has to
 * find `Semi-Hollow`.
 *
 * An empty query returns the list unchanged — the full 320 are still reachable
 * by scrolling, and hiding them behind a mandatory search would be a worse
 * control than the one being replaced.
 */
export function filterSubcategories(
  options: SubcategoryOption[],
  query: string,
): SubcategoryOption[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return options
  return options.filter((option) => {
    const haystack = subcategoryLabel(option).toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
