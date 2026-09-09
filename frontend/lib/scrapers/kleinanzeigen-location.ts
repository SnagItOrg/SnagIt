/**
 * Kleinanzeigen card location — the shared, dependency-free contract.
 *
 * THE DEFECT THIS EXISTS TO FIX (measured 2026-09-08, one read-only sample).
 * The 2026-09 markup redesign removed the semantic `aditem-*` classes, and the
 * card's place is now rendered by a class-LESS `<span>`. Both call sites
 * selected on a class name — `location`, then `aditem-main--top--left` — so
 * both matched nothing: 0 of 25 cards. The database agrees: 56 of 63 rows had a
 * location in 2026-05, and 0 of 3,249 have had one since 2026-08.
 *
 * WHY THE RULE IS SHAPE AND NOT STRUCTURE. The location and the posting date
 * are structurally indistinguishable: each is a class-less leaf `<span>`,
 * inside the same `div.flex.items-center.gap-xxsmall`, each preceded by its own
 * icon `<svg>`. Measured on the sample, "a span preceded by an svg" is 25
 * locations AND 25 dates. No class, and no path from the card root, separates
 * them — only the text shape does.
 *
 * So the search is scoped to spans, never to the whole card, and the shape is
 * the German postcode followed by a place: exactly ONE leaf span per card
 * matched it in all 25, and no other element type carried that shape at all.
 * `08.09.2026` cannot match — five consecutive digits never start it — and
 * neither can `Versand möglich` (17 cards) or `Gesuch` (1).
 *
 * This module owns the axis for BOTH callers, the way `./kleinanzeigen-price`
 * owns the price: the PM2 writer and admin live-search had separate copies of
 * the same two selectors, so they could drift. They no longer can.
 */

/** Postcode, then a place that may carry spaces, hyphens or a slash. */
const POSTCODE_AND_PLACE = /^\d{5}\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.\-/ ]*$/

/**
 * The entity set the PM2 writer has always decoded, in its order.
 *
 * Lifted verbatim from `decodeHtmlEntities` in `scripts/scrape-kleinanzeigen.ts`
 * rather than imported: that helper is private to a PM2 script, and
 * `frontend/lib` importing from `scripts/` would invert the dependency across
 * the boundary `wp4a-boundary` guards. Moving it out would rewire the scraper's
 * own `stripTags` and `extractAttr`, which is more than this seam may change.
 *
 * The three umlauts are not decorative — someone added them to the base decoder
 * because they saw them in the source. Dropping them here would silently change
 * two behaviours: legacy markup would store a raw `M&uuml;nchen` in
 * `listings.location`, and the current-layout rule would return null outright,
 * because `&` and `;` are not in the place charset. Cheerio decodes at parse
 * time, so the admin path would keep working while the PM2 writer — the one that
 * writes the database — lost the location.
 */
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&uuml;/g, 'ü')
    .replace(/&ouml;/g, 'ö')
    .replace(/&auml;/g, 'ä')
}

/** Decode, then strip tags, then collapse — the base `stripTags` order exactly. */
function textOf(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstByClass(cardHtml: string, className: string): string | null {
  const match = cardHtml.match(
    new RegExp(`<[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'),
  )
  return match?.[1] ? textOf(match[1]) || null : null
}

/**
 * The card's stated location, or null when it states none.
 *
 * Tier 1 and 2 are the previous behaviour, kept ahead of the new rule so older
 * and A/B markup resolves exactly as it does today. Nothing is fabricated: a
 * card with no place yields null.
 */
export function extractCardLocation(cardHtml: string): string | null {
  const semantic = firstByClass(cardHtml, 'location')
  if (semantic) return semantic

  const legacy = firstByClass(cardHtml, 'aditem-main--top--left')
  if (legacy) return legacy

  // 3. the 2026-09 layout, which names no element `location` at all.
  // `Array.from` rather than iterating the matcher: the frontend tsconfig
  // target refuses a bare `for...of` over a RegExp iterator (TS2802).
  const spans = Array.from(cardHtml.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi))
  for (const span of spans) {
    const text = textOf(span[1])
    if (POSTCODE_AND_PLACE.test(text)) return text
  }
  return null
}
