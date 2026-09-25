/**
 * HTML entity decoding for scraped text.
 *
 * A scraped title must reach `listings.title` as the characters a human typed,
 * never as their HTML source. React escapes `{listing.title}` on the way out,
 * so an entity stored in the column is escaped a second time and renders as
 * literal text: `Fender 62&#039;s Telecaster` (PAN-114).
 *
 * **Decode exactly once, at ingest.** Decoding at render would paper over a
 * wrong column and would have to be repeated at every surface showing a title.
 *
 * The decode is a SINGLE PASS. That is the whole point, not a style choice.
 * A chain of `.replace()` calls has to answer "does `&amp;` go first or last?",
 * and both answers are wrong: put it first and the literal text `&#39;`,
 * stored as `&amp;#39;`, decodes to `&#39;` and then again to `'`; put it last
 * and nothing else can be expressed. `String.prototype.replace` resumes
 * scanning *after* each match, so one pass consumes each entity once and never
 * re-reads what it just produced. `&amp;#39;` becomes `&#39;` and stops.
 *
 * **Why it lives in `frontend/lib`, and why it has no imports** (PAN-118).
 * This is the one decoder for both trees. `scripts/` already imports from
 * `frontend/lib` (the PM2 scrapers call the frontend scraper libraries), but
 * the reverse is impossible — Next cannot import from `scripts/` — so the only
 * place both trees can reach is here. Keeping it import-free lets the root
 * `tsx --test` harness import it directly, like `listing-title.ts`.
 */

/**
 * Named entities this codebase has actually seen from its sources.
 *
 * The HTML5 core five plus `&nbsp;`, then German — Kleinanzeigen is a German
 * marketplace. Numeric entities need no table, so this list only has to cover
 * what is spelled by name. An unknown name is left alone rather than guessed
 * at: a title is better with `&foo;` in it than with `&foo;` silently deleted.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
}

/** A code point, or null when it cannot be one — `String.fromCodePoint` throws. */
function fromCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return null
  if (code >= 0xd800 && code <= 0xdfff) return null // lone surrogate
  return String.fromCodePoint(code)
}

/**
 * Decode HTML entities once: `&#039;` / `&#39;` / `&apos;` all give `'`.
 *
 * Decimal (`&#039;`) and hex (`&#x27;`) are handled generically, so a source
 * that zero-pads — Kleinanzeigen does, which is why the previous table-only
 * decoder missed all 75 of its rows while matching the unpadded `&#39;` — is
 * covered by construction rather than by an entry per spelling.
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]*));/g,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (decimal !== undefined) return fromCodePoint(Number(decimal)) ?? entity
      if (hex !== undefined) return fromCodePoint(parseInt(hex, 16)) ?? entity
      return (name !== undefined ? NAMED_ENTITIES[name] : undefined) ?? entity
    },
  )
}
