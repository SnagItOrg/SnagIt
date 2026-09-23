/**
 * Marketing decoration removed from a listing title AT RENDER.
 *
 * THIS IS DELIBERATELY NOT PAN-114. That change decoded HTML entities in
 * stored titles, because `&amp;` in a title was wrong data — the scraper had
 * mangled the seller's text and the database held something the seller never
 * wrote. An emoji is the opposite: it IS the seller's real text. Rewriting it
 * in the database would falsify a listing, and Klup would be reproducing a
 * marketplace's copy inaccurately while claiming to be the accurate one.
 *
 * So the stored title is never touched. This is presentation only, and the
 * listing keeps its own words everywhere they matter.
 *
 * WHY STRIP AT ALL: a curation product that reproduces ✅-spam undercuts the
 * claim it makes. "Roland Juno 106 ✅ 61-Key Programmable Polyphonic ✅RARE
 * from ´80s✅ …" carries six ✅ that mean nothing except that the seller
 * wanted attention.
 *
 * THE SET IS AN ALLOW-LIST, NOT A UNICODE RANGE, and it is deliberately
 * narrow. A range over "emoji" would take things that carry meaning on a
 * marketplace for musical instruments: 🎹 🎸 🎵 🎛️ name the goods, a flag
 * names an origin, an arrow names a direction, a currency sign names money.
 * Only symbols whose entire function in a sales title is decoration are
 * listed. Anything not on this list survives untouched — including 🌈 and 🍃,
 * which are decorative in practice but are not unambiguously so.
 *
 * NOTHING HERE TOUCHES LETTERS. `´80s` keeps its acute accent, `Vorverstärker`
 * and `Næsten` keep their diacritics, `’72` keeps its curly apostrophe, and
 * `–` `~` `•` `&` are punctuation the seller chose.
 *
 * U+FE0F is the variation selector that renders a symbol in emoji style. It
 * follows several of these (⭐️ is U+2B50 U+FE0F), so it is consumed with the
 * symbol rather than left behind as an invisible orphan.
 */
const DECORATIVE_EMOJI =
  /[‼⁉☑✅✔❕❗⚡✨⭐\u{1F31F}\u{1F389}\u{1F38A}\u{1F3AF}\u{1F44D}\u{1F4A5}\u{1F4AF}\u{1F525}\u{1F680}]️?/gu

/**
 * Returns the title with marketing decoration removed.
 *
 * A title with no decoration is returned BYTE-IDENTICAL — the whitespace
 * collapse runs only when something was actually removed, so an existing
 * double space in a seller's own text is not quietly rewritten. Decoration is
 * replaced by a space rather than by nothing, so `Checked✅Roland` becomes two
 * words rather than one.
 *
 * A title that is nothing but decoration would strip to empty, which would
 * render a card with no title at all; in that case the original is kept.
 */
export function stripDecorativeEmoji(title: string): string {
  const stripped = title.replace(DECORATIVE_EMOJI, ' ')
  if (stripped === title) return title

  const collapsed = stripped.replace(/\s+/g, ' ').trim()
  return collapsed === '' ? title : collapsed
}
