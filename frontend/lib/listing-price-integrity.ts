/**
 * Read-side defence against the legacy Kleinanzeigen price-parser defect.
 *
 * WHAT HAPPENED: the Kleinanzeigen card parser reads the first element whose
 * class contains "price". On some cards that element yielded two prices
 * concatenated — "1.249 €" followed by "1.299 €" became the integer 12491299.
 * Thirteen such rows were written between 2026-05-03 and 2026-05-06 and are
 * still `is_active`, with `price_dkk` values up to 197,445,488 DKK. They
 * corrupt any statistic computed over Kleinanzeigen rows: the p75 for Korg
 * MS-20, Rhodes Mark I Stage 73 and Rhodes Mark II Stage 73 all read in the
 * tens of millions.
 *
 * WHY A READ-SIDE PREDICATE: `parsePrice` in `lib/scrapers/kleinanzeigen.ts`
 * already rejects values above KLEINANZEIGEN_MAX_PRICE_EUR, so no NEW bad row
 * can be written — that guard was added in commit fe65a84, after these rows
 * landed. The stored rows predate it. Cleaning them is a data migration and is
 * deliberately out of scope here; until then every reader must apply the same
 * bound the writer already applies.
 *
 * SCOPE — deliberately NOT a global price ceiling. High-end gear is
 * legitimately expensive: a Roland Jupiter-8 has an observed active median of
 * ~162,000 DKK, and vintage instruments run higher still. This predicate
 * therefore only reproduces the Kleinanzeigen parser's own impossible-value
 * bound, on Kleinanzeigen rows, against the RAW EUR `price` the parser
 * produced — never against `price_dkk`, and never against another source.
 */

/**
 * Upper bound on a plausible raw Kleinanzeigen asking price, in EUR.
 * Single source of truth: `lib/scrapers/kleinanzeigen.ts` imports this for its
 * write-side guard, so the writer and every reader cannot drift apart.
 */
export const KLEINANZEIGEN_MAX_PRICE_EUR = 500_000

export const KLEINANZEIGEN_SOURCE = 'kleinanzeigen'

export interface PriceIntegrityInput {
  source: string | null | undefined
  /** Raw source-currency price as stored in `listings.price`. */
  price: number | string | null | undefined
}

/**
 * False only for a Kleinanzeigen row whose raw price exceeds the parser's own
 * impossible-value bound. Every other row — including rows with a null price,
 * and expensive rows from any source — passes untouched.
 */
export function hasPlausibleListingPrice(listing: PriceIntegrityInput): boolean {
  if (listing.source !== KLEINANZEIGEN_SOURCE) return true
  if (listing.price == null) return true
  const raw = typeof listing.price === 'string' ? Number(listing.price) : listing.price
  if (!Number.isFinite(raw)) return true
  return raw <= KLEINANZEIGEN_MAX_PRICE_EUR
}
