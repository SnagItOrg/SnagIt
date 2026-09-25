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
import { extractCardLocation } from '../../frontend/lib/scrapers/kleinanzeigen-location'
import { DBA_CONFIG, scrapeSchibsted } from '../../frontend/lib/scrapers/schibsted'

const SCRIPTS = join(__dirname, '..')
const FRONTEND = join(SCRIPTS, '..', 'frontend')

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

/* ── PAN-118: one decoder, reached from every frontend caller ────────────── */

/**
 * The fixture set every caller must agree on. PAN-118 found two more decoders
 * in `frontend/`: a copy of the old seven-entity chain in the Kleinanzeigen
 * location seam, and none at all on the Schibsted (dba.dk, Blocket, FINN)
 * title path. Both now call the shared decoder, so each caller runs the same
 * inputs and must give the decoder's own output.
 */
const PAN_118_FIXTURES: [string, string][] = [
  ['Fender 62&#039;s Telecaster', "Fender 62's Telecaster"], // zero-padded: what the chain missed
  ['Fender 62&#39;s Telecaster', "Fender 62's Telecaster"],
  ['Tekst &amp;#39; bevaret', 'Tekst &#39; bevaret'], // one decode: literal text, not an apostrophe
  ['Marshall & Sons', 'Marshall & Sons'], // a bare ampersand is the seller's text
  ['Korg &notarealentity; MS-20', 'Korg &notarealentity; MS-20'], // unknown: verbatim, never dropped
]

test('PAN-118: the fixture set decodes as the ticket requires', () => {
  for (const [input, expected] of PAN_118_FIXTURES) {
    assert.equal(decodeHtmlEntities(input), expected, input)
  }
})

test('PAN-118: the Kleinanzeigen location seam decodes exactly as the shared decoder', () => {
  // Tier 1 returns any text, so it carries every fixture through `textOf`.
  const card = (text: string) => `<article><div class="ad-listitem-location">${text}</div></article>`
  for (const [input, expected] of PAN_118_FIXTURES) {
    assert.equal(extractCardLocation(card(input)), expected, input)
  }

  // Inputs the old chain decoded differently. It knew `&#39;` but no other
  // numeric entity and only three umlauts, and it took `&amp;` before the
  // rest, so an escaped entity was decoded twice.
  assert.equal(extractCardLocation(card('80331 M&#252;nchen')), '80331 München')
  assert.equal(extractCardLocation(card('80331 M&#xFC;nchen')), '80331 München')
  assert.equal(extractCardLocation(card('&Uuml;berlingen wei&szlig;')), 'Überlingen weiß')
  assert.equal(extractCardLocation(card('&amp;uuml;')), '&uuml;')
  assert.equal(extractCardLocation(card('&amp;quot;')), '&quot;')

  const src = readFileSync(join(FRONTEND, 'lib', 'scrapers', 'kleinanzeigen-location.ts'), 'utf8')
  assert.match(src, /import \{ decodeHtmlEntities \} from '\.\.\/html-entities'/)
  assert.doesNotMatch(src, /function decodeHtmlEntities/, 'no local decoder beside the shared one')
})

test('PAN-118: the Schibsted title path (dba.dk, Blocket, FINN) decodes the JSON-LD name', async () => {
  // JSON.parse undoes JSON escapes only; an HTML entity inside the JSON-LD
  // string survives it. One page and one query variant, so no pagination delay.
  const items = PAN_118_FIXTURES.map(([name], i) => ({
    item: {
      name,
      url: `https://www.dba.dk/recommerce/forsale/item/${1000 + i}`,
      offers: { price: '100', priceCurrency: 'DKK' },
    },
  }))
  const page = JSON.stringify({ '@type': 'CollectionPage', mainEntity: { itemListElement: items } })
  const html = `<html><head><script type="application/ld+json">${page}</script></head></html>`

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(html, { status: 200 })) as typeof fetch
  try {
    const listings = await scrapeSchibsted(DBA_CONFIG, 'telecaster', 1)
    assert.deepEqual(
      listings.map((l) => l.title),
      PAN_118_FIXTURES.map(([, expected]) => expected),
    )
  } finally {
    globalThis.fetch = realFetch
  }
})
