/**
 * The one normalisation authority for a Kleinanzeigen price.
 *
 * WHAT HAPPENED: the Kleinanzeigen card parser read the first element whose
 * class contains "price". On a DISCOUNTED card that element is the wrapper, and
 * its text holds two prices — the current one and the struck-through former one
 * — so "1.249 EUR" followed by "1.299 EUR" was welded into the integer
 * 12491299. Rows in that shape were written before the parser was fixed and are
 * still `is_active`, with `price_dkk` scaled from the welded number.
 *
 * WHAT THAT VALUE IS. It is not corrupt and it is not one impossible price. It
 * is two real prices adjacent, in an order the markup fixes: a discounted card
 * nests the old price INSIDE the current-price element, so the current value
 * always comes first in text order.
 *
 *     <div class="aditem-main--middle--price-shipping">        <- wrapper
 *       <p class="aditem-main--middle--price-shipping--price"> <- CURRENT
 *         220 EUR
 *         <p class="...--old-price">250 EUR</p>                <- PREVIOUS
 *       </p>
 *     </div>
 *
 * So 220250 is an ad asking 220 EUR today, reduced from 250. The left half is
 * the price Klup must store and show. An earlier release read the same shape,
 * concluded the row was corrupt and blanked it — which threw away a real asking
 * price instead of protecting anyone from a false one. This module recovers it.
 *
 * WHY ONE SHARED MODULE: the parser, the scraper's write boundary, every read
 * boundary and snapshot eligibility all consult these functions. A value one
 * layer recovers must not be a value another layer discards — that divergence
 * is exactly how a welded number reached a product page in the first place.
 *
 * SCOPE — deliberately NOT a global price ceiling, and deliberately narrow
 * about what it will split. High-end gear is legitimately expensive: a Roland
 * Jupiter-8 has an observed active median of ~162,000 DKK. Recovery requires an
 * even digit count of six or more, equal halves, no leading zero, both halves
 * plausible asking prices, and the second larger than the first — an ordered
 * discount. An ordinary four- or five-figure price can never satisfy that.
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

/**
 * The most a struck-through former price may exceed the current one.
 *
 * Chosen from the 77 measured production rows, not from taste. Every confirmed
 * pair lands between 1.02 and 1.933 — a marketplace discount, which is what the
 * struck-through price means. The only rows above 2.0 were two ads whose price
 * field held the placeholder `123456`, and their titles say plainly that
 * neither has a price at all: one begins `Tausche` (a swap) and the other
 * `[Suche]` (wanted). Splitting those to 123 EUR would invent an asking price
 * for an ad that is not selling anything.
 *
 * 2.0 sits above every observed discount and far below the placeholder at
 * 3.707, so the bound separates the two populations with room on both sides
 * rather than trimming close to real data.
 *
 * The comparison is `previous <= current * RATIO`, so exactly 2.0 is allowed:
 * 100 | 200 is a halving, which is a steep but real discount. 100 | 201 is not.
 */
export const MAX_DISCOUNT_RATIO = 2.0

export type PriceRejectionReason =
  | 'above_impossible_bound'
  /**
   * Pair-shaped, but the two halves are too far apart to be a discount.
   *
   * Not a confirmed pair and not a believable single price — the value is left
   * unsplit and refused, because inventing either reading would be a claim the
   * evidence does not support.
   */
  | 'ambiguous_pair'

/**
 * Does this number carry a current price and its struck-through previous price?
 *
 * THE CORRECTION THIS FILE EXISTS FOR. An earlier release read this shape and
 * concluded the row was corrupt, discarding the value. It is not corrupt: it is
 * a DISCOUNTED AD, and both halves are real prices the marketplace published.
 * The left half is the money the seller is asking today.
 *
 * The markup says so unambiguously. A discounted card nests the old price
 * INSIDE the current-price element, so the current value always comes first in
 * text order and the struck-through one second:
 *
 *     <div class="aditem-main--middle--price-shipping">        <- wrapper
 *       <p class="aditem-main--middle--price-shipping--price"> <- CURRENT
 *         800 EUR
 *         <p class="...--old-price">900 EUR</p>                <- PREVIOUS
 *       </p>
 *     </div>
 *
 * A parser that reads the WRAPPER's text sees "800 EUR 900 EUR" and, stripping
 * non-digits, welds it into 800900. Nothing was invented and nothing was lost —
 * the two numbers are simply adjacent, in a known order.
 *
 * The signature is exact and repeats across every measured row: equal digit
 * counts, the previous price the larger.
 *
 *   220250 -> 220 | 250      235240 -> 235 | 240
 *   490600 -> 490 | 600    12491299 -> 1249 | 1299
 * 62006800 -> 6200 | 6800  41504950 -> 4150 | 4950
 *
 * Deliberately narrow, because an over-eager split would destroy real prices.
 * Only an even digit count of six or more is considered. A genuine large round
 * price survives because its second half carries a leading zero:
 * 150000 -> 150 | 000 is not a pair. An odd-length price is never touched, so
 * 16500 stays 16500, and a four-digit price like 1200 -> 12 | 00 is refused on
 * the same leading-zero rule. Six digits is the floor precisely so that an
 * ordinary four-digit asking price can never be halved.
 */
export function looksLikeConcatenatedPair(
  value: number,
): { suspect: boolean; parts?: [number, number]; ambiguous?: boolean } {
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

  /**
   * Too far apart to be a discount.
   *
   * The structure still looks like a pair, so this is NOT reported as "no pair
   * here" — that would let the raw value through as an ordinary price and a
   * placeholder `123456` would render as 123,456 EUR. It is reported as
   * ambiguous, which fails closed.
   */
  if (previous > current * MAX_DISCOUNT_RATIO) {
    return { suspect: false, ambiguous: true }
  }

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
  const shape = looksLikeConcatenatedPair(value)
  // A confirmed discount pair is recoverable data, not a rejection. Callers
  // normalise it through `recoverKleinanzeigenPrice`; nothing is discarded.
  if (shape.suspect) return { ok: true }
  // Pair-shaped but outside the discount bound. Neither reading is supported by
  // the evidence, so the value is refused rather than guessed at.
  if (shape.ambiguous) return { ok: false, reason: 'ambiguous_pair' }
  if (value > KLEINANZEIGEN_MAX_PRICE_EUR) {
    return { ok: false, reason: 'above_impossible_bound' }
  }
  return { ok: true }
}

/**
 * THE ONE NORMALISATION AUTHORITY for a Kleinanzeigen price.
 *
 * Applied identically by the parser, the scraper before it writes, every read
 * boundary and snapshot eligibility. A single function so a value one layer
 * recovers cannot be a value another layer discards — divergence between those
 * two answers is what put 235240 on a product page in the first place.
 *
 * `previous` is returned for callers that can use it and ignored by those that
 * cannot. No schema field is invented for it in this hotfix.
 */
export type RecoveredPrice = {
  /** The price to store and display. */
  value: number
  /** The struck-through former price, when the shape evidenced one. */
  previous: number | null
  /** True when a current+previous pair was separated. */
  recovered: boolean
}

export function recoverKleinanzeigenPrice(value: number): RecoveredPrice {
  const pair = looksLikeConcatenatedPair(value)
  if (pair.suspect && pair.parts) {
    const [current, previous] = pair.parts
    return { value: current, previous, recovered: true }
  }
  return { value, previous: null, recovered: false }
}

/**
 * Rescale a stored `price_dkk` onto a recovered price.
 *
 * `price_dkk` was computed from the welded number, so it is wrong by exactly
 * the ratio between the welded value and the recovered one. Rescaling preserves
 * whatever conversion rate was actually applied at write time, which re-deriving
 * from today's rate would silently change.
 */
export function rescalePriceDkk(
  storedDkk: number | string | null | undefined,
  storedPrice: number,
  recoveredPrice: number,
): number | null {
  if (storedDkk == null) return null
  const dkk = typeof storedDkk === 'string' ? Number(storedDkk) : storedDkk
  if (!Number.isFinite(dkk) || storedPrice <= 0) return null
  if (recoveredPrice === storedPrice) return dkk
  return Math.round((dkk * recoveredPrice) / storedPrice)
}

/**
 * False for a Kleinanzeigen row whose raw price cannot be believed even after
 * recovery.
 *
 * A welded discount pair IS believable — it carries a real current price — so
 * this returns true for 220250 and 235240 and the caller normalises them. What
 * still fails is a value that is beyond the impossible bound and shows no pair
 * shape. Every other row — a null price, or an expensive row from any other
 * source — passes untouched.
 */
export function hasPlausibleListingPrice(listing: PriceIntegrityInput): boolean {
  if (listing.source !== KLEINANZEIGEN_SOURCE) return true
  if (listing.price == null) return true
  const raw = typeof listing.price === 'string' ? Number(listing.price) : listing.price
  if (!Number.isFinite(raw)) return true
  return classifyKleinanzeigenPrice(raw).ok
}

/**
 * Normalise a stored price at a READ boundary, keeping the listing.
 *
 * THE CORRECTION. This previously returned `{null, null}` for a discount pair,
 * on the belief that 235240 was a corrupt number that must not be rendered. It
 * is not corrupt — it is 235 EUR now, down from 240 — and blanking it threw
 * away a real asking price the operator and the page both need.
 *
 * So the number is recovered rather than removed, and `price_dkk` is rescaled
 * to match. The two travel together because a converted DKK figure that no
 * longer corresponds to its source price is the same false claim in another
 * currency — which is how a million-krone number would otherwise survive.
 *
 * A value that is genuinely beyond belief and shows no pair shape is still
 * nulled: `hasPlausibleListingPrice` remains the authority for that.
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

  // Only Kleinanzeigen carries this shape; every other source passes through.
  if (listing.source !== KLEINANZEIGEN_SOURCE || price == null) {
    return { price, price_dkk: priceDkk }
  }

  const recovered = recoverKleinanzeigenPrice(price)
  if (recovered.recovered) {
    return {
      price: recovered.value,
      price_dkk: rescalePriceDkk(priceDkk, price, recovered.value),
    }
  }

  if (!hasPlausibleListingPrice({ source: listing.source, price })) {
    return { price: null, price_dkk: null }
  }
  return { price, price_dkk: priceDkk }
}
