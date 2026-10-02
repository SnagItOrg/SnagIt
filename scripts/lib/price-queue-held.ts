/**
 * Which fetched sales a product already holds, and which old rows to link
 * (PAN-231). Import-free, so it is testable without the worker's environment.
 *
 * A sale is held when a row for its listing_url exists for the product: linked
 * to it, or unlinked under the product's slug (written before PAN-210). An
 * unlinked row is linked in place instead of getting a linked row beside it —
 * unless the sale already has a linked row, which would then count it twice.
 */
export interface HeldRow {
  id: string
  listing_url: string | null
  kg_product_id: string | null
}

export function partitionHeld<T extends { listing_url: string | null }>(
  rows: T[],
  held: HeldRow[],
): { fresh: T[]; toLink: HeldRow[] } {
  const heldUrls = new Set(held.map(h => h.listing_url))
  const linkedUrls = new Set(held.filter(h => h.kg_product_id !== null).map(h => h.listing_url))
  return {
    fresh: rows.filter(r => !heldUrls.has(r.listing_url)),
    toLink: held.filter(h => h.kg_product_id === null && !linkedUrls.has(h.listing_url)),
  }
}
