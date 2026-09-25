/**
 * PAN-114 — HTML entities must be decoded once, at the ingest boundary.
 *
 * A title reached `listings.title` still HTML-escaped, React escaped it again
 * on the way out, and the product page rendered the source text:
 * `Fender 62&#039;s Telecaster Custom Shop LTD`. Every string in the first two
 * tests below is a real production row, read from `listings` on 2026-09-22.
 *
 * The previous decoder was a chain of `.replace()` calls over seven named
 * entities. It matched `&#39;` but not the zero-padded `&#039;` Kleinanzeigen
 * actually emits, which is why 75 of its rows were affected while the decoder
 * looked like it was doing the job.
 *
 * Neither scraper is imported here: `scrape-kleinanzeigen.ts` and
 * `scrape-reverb.ts` both call `main()` at module scope, so importing one
 * would start a scrape. The decode is tested directly and the wiring is
 * asserted from source.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decodeHtmlEntities } from '../../frontend/lib/html-entities'

const SCRIPTS = join(__dirname, '..')

const source = (file: string) => readFileSync(join(SCRIPTS, file), 'utf8')

/* ── The production rows ─────────────────────────────────────────────────── */

test('kleinanzeigen: the titles that rendered their own markup now decode', () => {
  const rows: [string, string][] = [
    [
      'Fender 62&#039;s Telecaster Custom Shop LTD (Abigail Ybarra)',
      "Fender 62's Telecaster Custom Shop LTD (Abigail Ybarra)",
    ],
    [
      'Fender Limited Edition &#039;72 Telecaster Custom 2012 - Orange Sparkl',
      "Fender Limited Edition '72 Telecaster Custom 2012 - Orange Sparkl",
    ],
    [
      '&#034;Fender&#034; oder Kopie von Telecaster oder ???',
      '"Fender" oder Kopie von Telecaster oder ???',
    ],
    [
      'BIETE: Korg MS-20 Vintage (IC35 / OTA) --&gt; SUCHE: Synthesizer',
      'BIETE: Korg MS-20 Vintage (IC35 / OTA) --> SUCHE: Synthesizer',
    ],
  ]

  for (const [stored, expected] of rows) {
    assert.equal(decodeHtmlEntities(stored), expected)
  }
})

test('reverb: the JSON API escapes too, rarely, and those rows decode as well', () => {
  assert.equal(
    decodeHtmlEntities('Manley SLAM! Limiter &amp; Microphone Preamp'),
    'Manley SLAM! Limiter & Microphone Preamp',
  )
  assert.equal(
    decodeHtmlEntities('Cube Street II 10-Watt 2x6.5&quot; Guitar Combo Amplifier (Red)'),
    'Cube Street II 10-Watt 2x6.5" Guitar Combo Amplifier (Red)',
  )
})

/* ── The decode itself ───────────────────────────────────────────────────── */

test('all three spellings of an apostrophe give the same character', () => {
  for (const entity of ['&#039;', '&#39;', '&apos;', '&#x27;', '&#X27;']) {
    assert.equal(decodeHtmlEntities(`Fender ${entity}62 Strat`), "Fender '62 Strat")
  }
})

test('the decode runs once: an escaped ampersand cannot form a second entity', () => {
  // `&amp;#39;` is the stored form of the literal text `&#39;`. Decoding it
  // must yield that text, not an apostrophe. A `.replace()` chain that takes
  // `&amp;` first produces `'` here — the double-decode this guards.
  assert.equal(decodeHtmlEntities('&amp;#39;'), '&#39;')
  assert.equal(decodeHtmlEntities('&amp;amp;'), '&amp;')
  assert.equal(decodeHtmlEntities('&amp;quot;'), '&quot;')
})

test('a literal ampersand in a title survives untouched', () => {
  for (const title of ['Marshall & Sons', 'R&D Audio', '50% off & more', 'Fender & Co.']) {
    assert.equal(decodeHtmlEntities(title), title)
  }
})

test('a clean title is unchanged, and decoding is stable when repeated', () => {
  const clean = "Fender 62's Telecaster Custom Shop LTD"
  assert.equal(decodeHtmlEntities(clean), clean)
  assert.equal(decodeHtmlEntities(decodeHtmlEntities(clean)), clean)
})

test('an unknown or malformed entity is left alone, never dropped', () => {
  for (const title of ['&notarealentity;', '&#;', '&#x;', '&amp', 'Korg &sect;']) {
    assert.equal(decodeHtmlEntities(title), title)
  }
  // Out of Unicode range, and a lone surrogate: kept verbatim rather than throwing.
  assert.equal(decodeHtmlEntities('&#1114112;'), '&#1114112;')
  assert.equal(decodeHtmlEntities('&#55296;'), '&#55296;')
})

test('German named entities decode — Kleinanzeigen is a German marketplace', () => {
  assert.equal(decodeHtmlEntities('Verst&auml;rker'), 'Verstärker')
  assert.equal(decodeHtmlEntities('Schl&uuml;ssel &Ouml;sen wei&szlig;'), 'Schlüssel Ösen weiß')
})

test('a decoded title normalizes without the entity leaking in as a token', () => {
  const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  // Derived from the escaped title, `normalized_text` carries a bogus `039`
  // token that the matcher then has to see through.
  assert.match(normalize('Fender 62&#039;s Telecaster'), /\b039\b/)
  assert.doesNotMatch(
    normalize(decodeHtmlEntities('Fender 62&#039;s Telecaster')),
    /\b039\b/,
  )
})

/* ── The wiring, at the two ingest boundaries that write listings.title ──── */

test('kleinanzeigen ingest: the title path uses the shared decode, not a local table', () => {
  const src = source('scrape-kleinanzeigen.ts')

  assert.match(src, /import \{ decodeHtmlEntities \} from '\.\.\/frontend\/lib\/html-entities'/)
  assert.doesNotMatch(
    src,
    /function decodeHtmlEntities/,
    'the partial seven-entity decoder must not come back alongside the shared one',
  )
  // `parseArticle` takes its title from `extractFirst` -> `stripTags` -> decode.
  assert.match(src, /function stripTags\(input: string\): string \{\s*return decodeHtmlEntities\(input\)/)
})

test('reverb ingest: the title is decoded once and normalized_text derives from it', () => {
  const src = source('scrape-reverb.ts')

  assert.match(src, /import \{ decodeHtmlEntities \} from '\.\.\/frontend\/lib\/html-entities'/)
  assert.match(src, /const title = decodeHtmlEntities\(listing\.title\)/)
  assert.doesNotMatch(
    src,
    /title: listing\.title,/,
    'the raw API title must not be written to the column',
  )
  assert.doesNotMatch(
    src,
    /normalized_text: listing\.title/,
    'normalized_text must derive from the decoded title, not the escaped one',
  )
})
