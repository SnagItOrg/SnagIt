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
 * Below this, a Kleinanzeigen asking price is accepted unconditionally.
 *
 * Chosen from the live distribution, not from taste. Measured 2026-08-30 on the
 * 2,041 priced active rows: everything below EUR 25,000 is genuine gear —
 * a EUR 17,934 Wurlitzer 207, a EUR 16,500 Kraftwerk-provenance Korg MS-20,
 * and a long tail of Custom Shop and vintage guitars from EUR 8,000 up. Only 83
 * rows sit above it and 77 of those are above EUR 100,000, which is not a price
 * distribution for a used-goods classifieds site — it is the concatenation
 * defect. The floor exists so no legitimate vintage instrument is ever judged
 * by the heuristic below.
 */
export const KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR = 25_000

/** The least a real ad ever asks; below this a "half" is not a price. */
const MIN_PLAUSIBLE_HALF_EUR = 20

export type PriceRejectionReason =
  | 'concatenated_pair'
  | 'above_impossible_bound'

/**
 * Does this number look like two asking prices welded together?
 *
 * The defect's signature is exact and repeats across every bad row measured:
 * a current price immediately followed by the struck-through old price, both
 * with the same digit count, the old one the larger.
 *
 *   220250 -> 220 | 250      235240 -> 235 | 240
 *   490600 -> 490 | 600    12491299 -> 1249 | 1299
 * 62006800 -> 6200 | 6800  41504950 -> 4150 | 4950
 *
 * Only an even digit count of six or more is considered, split down the middle.
 * A genuine large round price survives because its second half is all zeros and
 * therefore carries a leading zero: 150000 -> 150 | 000 is not a pair of
 * prices. This is deliberately narrow — it is a shape test, not a ceiling, so
 * it cannot reject an odd-length or round-numbered legitimate price.
 */
export function looksLikeConcatenatedPair(
  value: number,
): { suspect: boolean; parts?: [number, number] } {
  if (!Number.isInteger(value) || value <= 0) return { suspect: false }
  const digits = String(value)
  if (digits.length < 6 || digits.length % 2 !== 0) return { suspect: false }

  const half = digits.length / 2
  const left = digits.slice(0, half)
  const right = digits.slice(half)
  // A leading zero means it was never a standalone price.
  if (left.startsWith('0') || right.startsWith('0')) return { suspect: false }

  const current = Number(left)
  const previous = Number(right)
  if (current < MIN_PLAUSIBLE_HALF_EUR || previous < MIN_PLAUSIBLE_HALF_EUR) {
    return { suspect: false }
  }
  if (current > KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR) return { suspect: false }
  if (previous > KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR) return { suspect: false }
  // A discount: the struck-through price is the higher one.
  if (previous < current) return { suspect: false }

  return { suspect: true, parts: [current, previous] }
}

/**
 * Source-specific plausibility, with the reason for a rejection.
 *
 * Applied by the parser before a value is returned, by the scraper before a row
 * is upserted, and by every reader. One authority, so a value the writer would
 * refuse cannot be trusted by a reader that happens to be more lenient — which
 * is exactly how 220250 reached the admin queue and the product page.
 */
export function classifyKleinanzeigenPrice(
  value: number,
): { ok: boolean; reason?: PriceRejectionReason } {
  if (value <= KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR) return { ok: true }
  if (looksLikeConcatenatedPair(value).suspect) {
    return { ok: false, reason: 'concatenated_pair' }
  }
  if (value > KLEINANZEIGEN_MAX_PRICE_EUR) {
    return { ok: false, reason: 'above_impossible_bound' }
  }
  return { ok: true }
}

/**
 * False for a Kleinanzeigen row whose raw price cannot be believed.
 *
 * Previously this was only the 500,000 EUR bound, which is far too high to
 * catch the common case: two three-digit prices concatenate to a six-digit
 * number, and 220250 and 235240 both sailed through it into the admin queue,
 * the product page and the price band. Every other row — a null price, or an
 * expensive row from any other source — still passes untouched.
 */
export function hasPlausibleListingPrice(listing: PriceIntegrityInput): boolean {
  if (listing.source !== KLEINANZEIGEN_SOURCE) return true
  if (listing.price == null) return true
  const raw = typeof listing.price === 'string' ? Number(listing.price) : listing.price
  if (!Number.isFinite(raw)) return true
  return classifyKleinanzeigenPrice(raw).ok
}

/**
 * Neutralise an implausible price at a READ boundary, keeping the listing.
 *
 * Some readers must not drop the row. `/admin/match` is the clearest case: an
 * operator still has to see the ad in order to approve or reject the match, and
 * hiding it would remove the only surface where the bad row can be dealt with.
 * What must not survive is the NUMBER — 235240 rendered as "235.240 EUR" is a
 * claim the page is making, and it is false.
 *
 * Readers that legitimately drop the whole row — the public product page's
 * price band, `/intel` — keep using `hasPlausibleListingPrice` and are
 * unaffected by this.
 *
 * Returns `price` and `price_dkk` together, because nulling one without the
 * other leaves a converted DKK figure with no source price behind it, which is
 * how a million-krone number would survive the fix that was meant to remove it.
 */
export function sanitizeListingPrice(listing: {
  source?: string | null
  price?: number | string | null
  price_dkk?: number | string | null
}): { price: number | null; price_dkk: number | null } {
  const rawPrice = listing.price == null ? null
    : typeof listing.price === 'string' ? Number(listing.price) : listing.price
  const rawDkk = listing.price_dkk == null ? null
    : typeof listing.price_dkk === 'string' ? Number(listing.price_dkk) : listing.price_dkk

  const price = rawPrice != null && Number.isFinite(rawPrice) ? rawPrice : null
  const priceDkk = rawDkk != null && Number.isFinite(rawDkk) ? rawDkk : null

  if (!hasPlausibleListingPrice({ source: listing.source, price: listing.price })) {
    return { price: null, price_dkk: null }
  }
  return { price, price_dkk: priceDkk }
}
