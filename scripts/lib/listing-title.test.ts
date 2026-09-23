/**
 * `stripDecorativeEmoji` — the four edge cases its own header documents.
 *
 * The function is presentation-only and pure, and it is imported by six files
 * including three public surfaces (the product page, SearchResultCard and
 * /saved). It shipped with no test, so the behaviour was known but not
 * pinned; a later "tidy the regex" change could widen it silently, and the
 * damage would be a listing rendered with the seller's own words removed.
 *
 * This is a real import rather than a source read, because
 * `frontend/lib/listing-title.ts` has no imports of its own — the same reason
 * the i18n assertions elsewhere in this directory can import theirs.
 *
 * THE RISK IS ONE-SIDED. Failing to strip a ✅ is cosmetic. Stripping a 🎹, a
 * 🇯🇵 or the acute in `´80s` falsifies a listing, which is the thing the
 * module exists not to do. So most of what follows asserts what SURVIVES.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripDecorativeEmoji } from '../../frontend/lib/listing-title'

test('listing-title: decoration is removed', () => {
  assert.equal(
    stripDecorativeEmoji('Roland Juno 106 ✅ 61-Key ✅RARE from 80s✅'),
    'Roland Juno 106 61-Key RARE from 80s',
  )
  assert.equal(stripDecorativeEmoji('❗ Moog Sub 37 🔥'), 'Moog Sub 37')
})

test('listing-title: a title with no decoration is returned byte-identical', () => {
  // The whitespace collapse must run only when something was removed, so a
  // seller's own double space is not quietly rewritten.
  const untouched = 'Fender  Stratocaster — 1972'
  assert.equal(stripDecorativeEmoji(untouched), untouched)
  assert.equal(stripDecorativeEmoji(''), '')
})

test('listing-title: a title that is ALL decoration falls back to the original', () => {
  // Stripping to empty would render a card with no title at all.
  assert.equal(stripDecorativeEmoji('✅🔥⭐'), '✅🔥⭐')
  assert.equal(stripDecorativeEmoji('  ❗  '), '  ❗  ')
})

test('listing-title: U+FE0F is consumed with its symbol, never orphaned', () => {
  // ⭐️ is U+2B50 U+FE0F. Taking the symbol alone would leave an invisible
  // variation selector behind in the rendered title.
  const stripped = stripDecorativeEmoji('Nord Stage 3 ⭐️ 88')
  assert.equal(stripped, 'Nord Stage 3 88')
  assert.ok(!stripped.includes('️'), 'a variation selector survived alone')
})

test('listing-title: emoji that NAME the goods survive', () => {
  // A range over "emoji" would take these. The set is an allow-list for
  // exactly this reason: on a marketplace for instruments these carry meaning.
  for (const kept of ['🎹', '🎸', '🎵', '🎛️', '🇯🇵', '→', '€ £ $']) {
    const title = `Yamaha CS-80 ${kept} mint`
    assert.equal(stripDecorativeEmoji(title), title, `stripped a meaningful symbol: ${kept}`)
  }
})

test('listing-title: nothing here touches letters or punctuation', () => {
  for (const kept of ['Næsten ny', 'från Sverige', 'Vorverstärker', '’72 reissue', '´80s', 'A – B', '2x12 • 8 ohm', 'Tube & valve']) {
    assert.equal(stripDecorativeEmoji(kept), kept, `mangled seller text: ${kept}`)
  }
})

test('listing-title: decoration becomes a space, so words do not fuse', () => {
  assert.equal(stripDecorativeEmoji('Checked✅Roland'), 'Checked Roland')
})

test('listing-title: the stored title is never mutated', () => {
  // Presentation only. The function must be pure — the caller passes a value
  // it also renders elsewhere, and a listing keeps its own words in the data.
  const original = 'Korg MS-20 ✨ original'
  const before = String(original)
  stripDecorativeEmoji(original)
  assert.equal(original, before)
})
