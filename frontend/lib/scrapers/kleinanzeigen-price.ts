/**
 * Kleinanzeigen price extraction — the shared, dependency-free contract.
 *
 * THE DEFECT THIS EXISTS TO FIX (measured on live markup, 2026-08-29).
 *
 * A search-result card renders a discounted ad like this — note that the
 * struck-through old price is nested INSIDE the current price, which is invalid
 * HTML that every parser recovers from differently:
 *
 *     <div class="aditem-main--middle--price-shipping">
 *       <p class="aditem-main--middle--price-shipping--price">
 *         800 €
 *         <p class="aditem-main--middle--price-shipping--old-price">900 €</p>
 *       </p>
 *     </div>
 *
 * Both scrapers selected "the first element whose class contains `price`",
 * which is the WRAPPER, and read all of its text. `800 €` and `900 €` were
 * welded into `800900`, which the impossible-value bound in
 * `listing-price-integrity.ts` then turned into NULL. A real ad asking 800 EUR
 * arrived with no price at all.
 *
 * That bound was added in 2026-05 after thirteen such rows landed; its own
 * docstring names `12491299` (1249 + 1299). The diagnosis was right and the
 * write-side guard was correct, but the PARSER was never fixed — so the bug
 * changed shape rather than going away:
 *
 *   - concatenation over the bound  -> NULL price   (12.7% of active rows)
 *   - concatenation under the bound -> WRONG price, stored and trusted
 *
 * WHY THIS MODULE IS SHARED AND PURE. There were two independent copies of the
 * parser: `frontend/lib/scrapers/kleinanzeigen.ts` (cheerio) and
 * `scripts/scrape-kleinanzeigen.ts` (regex on raw HTML). The PM2 job runs the
 * second one, so fixing only the first would not have changed a single stored
 * row. Both now call this module, it has no dependencies, and it is therefore
 * testable from the root runner where `cheerio` is not resolvable.
 */

import {
  KLEINANZEIGEN_MAX_PRICE_EUR,
  classifyKleinanzeigenPrice,
  recoverKleinanzeigenPrice,
  type PriceRejectionReason,
} from '../listing-price-integrity'

/** Why a price was refused. Static codes — never free text, never markup. */
export type PriceReason = PriceRejectionReason | 'no_price_stated' | 'shipping_only' | 'no_number'

export type PriceOutcome = {
  value: number | null
  reason: PriceReason | null
  /**
   * The struck-through former price, when a discount pair was separated.
   *
   * Exposed for callers that can use it; no schema field is added for it in
   * this hotfix, so writers that have nowhere to put it simply ignore it.
   */
  previous?: number | null
}

/**
 * A price element that states only a shipping surcharge.
 *
 * `+ Versand ab 5,49 €` is a delivery cost, not an asking price, and reading
 * its first number would post a 5 EUR vintage synth. Checked before any digit,
 * and only when the text leads with the shipping wording — an ad that says
 * `450 € · Versand möglich` still yields 450.
 */
const SHIPPING_ONLY_PATTERN = /^[+\s]*(?:versand|zzgl\.?\s*versand|lieferung)\b/i

/**
 * Text that states there is no asking price.
 *
 * Consulted AFTER the number, so a stated amount is no longer lost to a phrase
 * elsewhere in the same text — but a text carrying one of these phrases must
 * state a CURRENCY-MARKED amount, because several of them sit next to
 * unrelated numbers. "Preis auf Anfrage, 2 Stück" is absence, not an ad asking
 * 2 EUR. The marker may sit on either side of the number: `800 €` and
 * `EUR 800` are both supported input forms.
 *
 * `Zu verschenken` ("to give away") is genuinely free and is still mapped to
 * null rather than 0. `listings.price` cannot distinguish "free" from
 * "unknown", and a 0 would enter the asking-price band as a real observation —
 * making a giveaway look like the market rate for the product. Declining to
 * claim a price is the honest answer the schema can express.
 */
const NO_PRICE_PATTERNS: readonly RegExp[] = [
  /zu\s+verschenken/i,
  /verschenken/i,
  /preis\s+auf\s+anfrage/i,
  /auf\s+anfrage/i,
  /gegen\s+gebot/i,
]

/**
 * Is this number written as money?
 *
 * Only asked when the text ALSO states there is no price, where the number has
 * to prove it is an amount rather than a quantity. The marker may lead or
 * follow: `800 €` and `EUR 800` are both supported forms, and the suite pins
 * both — a rule that only read a trailing marker would drop the stated price
 * from `EUR 800, Rest zu verschenken`, which is the loss this ticket exists to
 * stop.
 */
function isCurrencyMarked(text: string, match: RegExpMatchArray): boolean {
  const start = match.index ?? 0
  const follows = text.slice(start + match[0].length)
  const leads = text.slice(0, start)
  return /^\s*(?:€|eur\b)/i.test(follows) || /(?:€|\beur)\s*$/i.test(leads)
}

/**
 * Parse a German marketplace price into whole EUR, or null.
 *
 * German number format: `.` groups thousands and `,` separates decimals, so
 * `1.200,50 €` is 1200.50 — not 120050. The previous implementation stripped
 * `.` and then every non-digit, which multiplied any grouped price by a
 * thousand and welded adjacent prices together.
 *
 * `VB` (Verhandlungsbasis, "or near offer") is a suffix on a REAL asking price:
 * `800 € VB` is an ad asking 800 EUR, and the number is kept. `VB` with no
 * number is absence.
 *
 * Only the FIRST number-shaped token is read. Anything after it — a
 * struck-through old price, a shipping surcharge — is a different claim and
 * must never be concatenated into this one.
 */
export function parseGermanPrice(raw: string | null | undefined): number | null {
  return parseGermanPriceOutcome(raw).value
}

/**
 * The reasoned form. Same parse, plus WHY a value was refused, so the caller can
 * emit one static operational event instead of silently writing a null.
 */
export function parseGermanPriceOutcome(raw: string | null | undefined): PriceOutcome {
  if (!raw) return { value: null, reason: 'no_number' }
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return { value: null, reason: 'no_number' }

  if (SHIPPING_ONLY_PATTERN.test(text)) return { value: null, reason: 'shipping_only' }

  /**
   * ORDER MATTERS, AND IT USED TO BE WRONG.
   *
   * The NO_PRICE check ran BEFORE the number was read, so any price element
   * whose text merely contained one of these words lost a stated amount. The
   * patterns are unanchored — `/verschenken/i` matches anywhere — so a card
   * reading `450 € ... Rest zu verschenken` was stored with no price at all.
   *
   * SCOPE, MEASURED — NOT the whole null rate. PAN-24 read an empty error log
   * as "no refusals were logged" and concluded that all of the 66.5% missing
   * prices arrived through `no_price_stated`. The actual PM2 log contradicts
   * that. The PM2 error log holds 8,455 logged refusals across its retained
   * runs: 8,443 `no_number`, 12 `ambiguous_pair`, and NO `no_price_stated`.
   * (The log carries no run separator, so it is read as a total, not per run.)
   *
   * This ordering bug is real and loses real asking prices, but it is not the
   * documented main cause. `no_number` — a price element carrying no numeric
   * token at all — is, and that is a separate defect this change does not
   * address. It is PAN-46.
   *
   * An explicit number now wins — but only a CURRENCY-MARKED one. Inverting
   * the order alone trades one fabrication for another: `Preis auf Anfrage,
   * 2 Stück` would be stored as an ad asking 2 EUR, and nothing downstream
   * catches it, because the write bound refuses implausibly HIGH values and
   * has no lower bound at all. A fabricated 2 EUR enters the asking-price band
   * as a real observation, which is the corruption this ticket exists to stop.
   *
   * `no_price_stated` therefore keeps its meaning: the text states no amount,
   * or states no amount in money.
   */
  const match = text.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/)
  const statesNoPrice = NO_PRICE_PATTERNS.some((pattern) => pattern.test(text))
  if (!match) return { value: null, reason: statesNoPrice ? 'no_price_stated' : 'no_number' }
  if (statesNoPrice && !isCurrencyMarked(text, match)) {
    return { value: null, reason: 'no_price_stated' }
  }

  const token = match[0]
  const hasDot = token.includes('.')
  const hasComma = token.includes(',')

  let normalised: string
  if (hasDot && hasComma) {
    // `1.200,00` — dots group, comma decimates.
    normalised = token.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    // `1200,50` — a lone comma is the de-DE decimal separator.
    normalised = token.replace(',', '.')
  } else if (hasDot) {
    // `1.200` is grouped; `1200.50` is not. A group is exactly three digits.
    normalised = /^\d{1,3}(?:\.\d{3})+$/.test(token) ? token.replace(/\./g, '') : token
  } else {
    normalised = token
  }

  const value = Number(normalised)
  if (!Number.isFinite(value) || value <= 0) return { value: null, reason: 'no_number' }

  // `listings.price` is an integer column.
  const euros = Math.round(value)

  /**
   * Separate a discount pair, then check plausibility.
   *
   * `220.250 €` is syntactically a perfectly good German price — two hundred
   * twenty thousand two hundred fifty euros — and it is ALSO exactly what a
   * discounted card looks like once its two prices are welded and a dot lands
   * between them. Syntax cannot separate the readings, so the shape does: 220
   * and 250 are both ordinary asking prices and the second is the larger, which
   * is a discount, not a synthesiser worth a quarter of a million euros.
   *
   * The earlier release refused the ambiguous value on the grounds that a wrong
   * price is worse than a missing one. That reasoning was sound and the premise
   * was not: the value is not wrong, it is two right values adjacent, and the
   * markup fixes their order — the current price is nested before the
   * struck-through one, so the left half is what the seller is asking today.
   * Discarding it threw away a real price rather than protecting anyone from a
   * false one.
   */
  const recovered = recoverKleinanzeigenPrice(euros)

  const verdict = classifyKleinanzeigenPrice(recovered.value)
  if (!verdict.ok) return { value: null, reason: verdict.reason ?? 'above_impossible_bound' }

  return { value: recovered.value, reason: null, previous: recovered.previous }
}

/** Remove struck-through old prices before any text is read from a fragment. */
function stripOldPrice(html: string): string {
  return html.replace(
    /<(\w+)\b[^>]*class=["'][^"']*(?:old-price|strikethrough)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  )
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Text of the card's one bold paragraph — the price in the 2026-09 layout.
 *
 * THE DEFECT THIS EXISTS TO FIX (measured on a sampled results page, 2026-09-08).
 * Kleinanzeigen replaced the semantic `aditem-*` classes with utility classes.
 * The page carries **no element whose class contains `price`** any more, so
 * tiers 3 and 4 match nothing and every card arrives as `no_number` — 8,443 of
 * 8,455 logged refusals. Title, URL and image still resolve, so the listing is
 * stored, priceless, and the asking-price band silently loses it.
 *
 * WHY BOLD, AND WHY A PARAGRAPH. On the sampled page every card had exactly one
 * `<p>` whose class contains `font-strong`, and it was the asking price in all
 * 16. The heading is bold too but is an `<h3>`; the struck-through former price
 * is a `<p>` that is NOT bold; the shipping line is a `<p>` carrying no amount.
 * Requiring a bold paragraph therefore selects the current asking price and
 * nothing that could be mistaken for one.
 *
 * `line-through` is skipped as well, so a future layout that bolds the former
 * price cannot resurrect the welded-pair defect this module was written for.
 */
function boldParagraphText(html: string): string | null {
  // `Array.from` rather than iterating the matcher directly: this module is
  // compiled by the frontend tsconfig, whose target refuses a bare `for...of`
  // over a RegExp iterator.
  const paragraphs = Array.from(
    html.matchAll(/<p\b([^>]*class=["'][^"']*font-strong[^"']*["'][^>]*)>([\s\S]*?)<\/p>/gi),
  )
  for (const match of paragraphs) {
    if (/line-through/i.test(match[1])) continue
    const text = stripTags(match[2])
    if (text.length > 0) return text
  }
  return null
}

/** Text of the first element whose class matches `classPattern`, tags removed. */
function textOfElementWithClass(html: string, classPattern: string): string | null {
  const re = new RegExp(
    `<(\\w+)\\b[^>]*class=["'][^"']*${classPattern}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  )
  const match = html.match(re)
  if (!match) return null
  const text = stripTags(match[2])
  return text.length > 0 ? text : null
}

/**
 * Extract the asking price from one search-result card, in precedence order.
 *
 * The first tier that yields a number wins. Measured against live markup on
 * 2026-08-29:
 *
 *   1. structured offer data — JSON-LD `Offer` / `Product.offers` in the card.
 *      NOT present today (the only card-level ld+json is an `ImageObject`), but
 *      it is the most authoritative source if Kleinanzeigen adds it, and it
 *      costs a few lines to prefer it now rather than re-diagnose later.
 *   2. price metadata — `<meta itemprop="price">`. Present on the ad's own
 *      detail page (`content="800.00"`), absent from cards today.
 *   3. the dedicated price element — `…--price`. This is what today's cards
 *      carry, and what recovers the 800 EUR SH-101.
 *   4. the price/shipping wrapper — the previous behaviour, kept for older or
 *      A/B markup, but only after the old price has been removed so it can no
 *      longer concatenate.
 *   5. the bold paragraph — the card layout Kleinanzeigen served from 2026-09,
 *      which carries no `price` class at all. See `boldParagraphText`.
 *
 * The old price is stripped up front, so NO tier can reproduce the defect.
 */
export function extractCardPrice(cardHtml: string): number | null {
  return extractCardPriceOutcome(cardHtml).value
}

/** The reasoned form, for callers that log why a card produced no price. */
export function extractCardPriceOutcome(cardHtml: string): PriceOutcome {
  if (!cardHtml) return { value: null, reason: 'no_number' }

  // 1. structured offer data
  const fromJsonLd = extractOfferPriceFromJsonLd(cardHtml)
  if (fromJsonLd != null) return { value: fromJsonLd, reason: null }

  // 2. price metadata
  const metaMatch = cardHtml.match(
    /<meta\b[^>]*itemprop=["']price["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  ) ?? cardHtml.match(
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*itemprop=["']price["'][^>]*>/i,
  )
  if (metaMatch) {
    const fromMeta = parseGermanPriceOutcome(metaMatch[1])
    if (fromMeta.value != null) return fromMeta
  }

  const withoutOldPrice = stripOldPrice(cardHtml)

  // 3. the dedicated price element
  const dedicated = textOfElementWithClass(withoutOldPrice, '--price')
  if (dedicated) {
    const fromDedicated = parseGermanPriceOutcome(dedicated)
    if (fromDedicated.value != null) return fromDedicated
    if (fromDedicated.reason !== 'no_number') return fromDedicated
  }

  // 4. the wrapper, as a fallback
  const wrapper = textOfElementWithClass(withoutOldPrice, 'price')
  if (wrapper) return parseGermanPriceOutcome(wrapper)

  // 5. the current layout, which names no element `price` at all
  const bold = boldParagraphText(withoutOldPrice)
  if (bold) return parseGermanPriceOutcome(bold)

  return { value: null, reason: 'no_number' }
}

/** Tier 1: a JSON-LD `Offer` or `Product.offers` carried inside the card. */
function extractOfferPriceFromJsonLd(cardHtml: string): number | null {
  const blocks = cardHtml.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  if (!blocks) return null

  for (const block of blocks) {
    const body = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '')
    let parsed: unknown
    try {
      parsed = JSON.parse(body.trim())
    } catch {
      continue
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      const price = offerPriceFrom(node)
      if (price != null) return price
    }
  }
  return null
}

function offerPriceFrom(node: unknown): number | null {
  if (!node || typeof node !== 'object') return null
  const record = node as Record<string, unknown>

  const offers = record.offers
  if (offers) {
    for (const offer of Array.isArray(offers) ? offers : [offers]) {
      const price = offerPriceFrom(offer)
      if (price != null) return price
    }
  }

  const raw = record.price
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const euros = Math.round(raw)
    return euros > KLEINANZEIGEN_MAX_PRICE_EUR ? null : euros
  }
  if (typeof raw === 'string') return parseGermanPrice(raw)

  return null
}

/**
 * Fold one price outcome into a per-run tally.
 *
 * WHY THIS EXISTS. `no_price_stated` was the only refusal reason the scraper
 * did not log, and it turned out to carry 100% of the missing prices — the
 * defect was invisible in the run's own output for weeks. Counting is done
 * here rather than logged per advert so the volume stays bounded: one line per
 * run, whatever the listing count.
 *
 * The tally holds counts only. No markup, no listing identity, no credential
 * can reach it, because nothing but static reason codes is ever used as a key.
 */
export function recordPriceOutcome(
  tally: Record<string, number>,
  outcome: PriceOutcome,
): Record<string, number> {
  tally.cards = (tally.cards ?? 0) + 1
  if (outcome.value != null) {
    tally.priced = (tally.priced ?? 0) + 1
  } else if (outcome.reason) {
    tally[outcome.reason] = (tally[outcome.reason] ?? 0) + 1
  }
  return tally
}

/**
 * Fold a write-boundary refusal into the SAME tally.
 *
 * The card was already counted as `priced` when it was parsed, so this MOVES
 * the count rather than adding one. `cards === priced + every refusal` has to
 * reconcile in the emitted summary, or a reader cannot compute a rate from it —
 * and computing that rate is the whole point of the aggregate.
 *
 * The reason is typed, so only a static code can ever become a key.
 */
export function recordWriteGateRefusal(
  tally: Record<string, number>,
  reason: PriceRejectionReason,
): Record<string, number> {
  const code = `write_gate_${reason}`
  tally[code] = (tally[code] ?? 0) + 1
  tally.priced = (tally.priced ?? 0) - 1
  return tally
}
