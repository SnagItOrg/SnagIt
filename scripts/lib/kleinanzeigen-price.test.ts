/**
 * Kleinanzeigen price extraction.
 *
 * These cover one production defect: a Roland SH-101 in the Hamburg area asking
 * 800 EUR arrived with no price, because the card's struck-through old price
 * (900 €) was concatenated onto the current price and the resulting 800900 was
 * rejected by the impossible-value bound.
 *
 * The fixture reproduces that markup exactly, including the invalid nesting
 * that causes it. Every assertion here is one a real card can violate.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  extractCardPrice,
  parseGermanPrice,
} from '../../frontend/lib/scrapers/kleinanzeigen-price'

const FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'kleinanzeigen-search-cards.html'),
  'utf8',
)

/** Split the fixture into individual `<article>` cards, as the scrapers do. */
function cards(): Map<string, string> {
  const out = new Map<string, string>()
  const re = /<article\b[^>]*data-adid="(\d+)"[\s\S]*?<\/article>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(FIXTURE)) !== null) out.set(m[1], m[0])
  return out
}

const CARDS = cards()

/* ------------------------------------------------------------------ *
 * The defect
 * ------------------------------------------------------------------ */

test('a discounted card yields the current price, not the two welded together', () => {
  // The regression. Old behaviour: "800 € 900 €" -> 800900 -> over the bound -> null.
  assert.equal(extractCardPrice(CARDS.get('1000000001')!), 800)
})

test('the old price never leaks into the value by any route', () => {
  const card = CARDS.get('1000000001')!
  assert.notEqual(extractCardPrice(card), 900)
  assert.notEqual(extractCardPrice(card), 800900)
  assert.notEqual(extractCardPrice(card), 1700)
})

test('a wrapper whose text holds two prices still yields only the first', () => {
  // Defence for a parser that keeps the invalid nesting instead of hoisting it.
  const welded =
    '<article data-adid="1"><div class="aditem-main--middle--price-shipping">' +
    '800 € 900 €</div></article>'
  assert.equal(extractCardPrice(welded), 800)
})

/* ------------------------------------------------------------------ *
 * German price forms
 * ------------------------------------------------------------------ */

test('German price forms parse to whole EUR', () => {
  assert.equal(parseGermanPrice('800 €'), 800)
  assert.equal(parseGermanPrice('800 € VB'), 800)
  assert.equal(parseGermanPrice('VB 800 €'), 800)
  assert.equal(parseGermanPrice('1.200 €'), 1200)
  assert.equal(parseGermanPrice('1.200,00 €'), 1200)
  assert.equal(parseGermanPrice('EUR 800'), 800)
})

test('thousands separators are not multiplied by a thousand', () => {
  // The old parser stripped `.` then all non-digits: `1.200` became 1200 by
  // luck, but `1.200,00` became 120000.
  assert.equal(parseGermanPrice('1.699 €'), 1699)
  assert.equal(parseGermanPrice('12.500 €'), 12500)
  assert.equal(parseGermanPrice('1.200,50 €'), 1201)
})

test('a lone comma is a decimal separator, not a group', () => {
  assert.equal(parseGermanPrice('12,50 €'), 13)
  assert.equal(parseGermanPrice('1200,00 €'), 1200)
})

/* ------------------------------------------------------------------ *
 * Absence is absence — never zero
 * ------------------------------------------------------------------ */

test('non-price text yields null and never 0', () => {
  for (const text of [
    'Zu verschenken',
    'Preis auf Anfrage',
    'Auf Anfrage',
    'VB',
    'Gegen Gebot',
    '',
    '   ',
  ]) {
    const value = parseGermanPrice(text)
    assert.equal(value, null, `${JSON.stringify(text)} must be null`)
    assert.notEqual(value, 0, `${JSON.stringify(text)} must never become 0`)
  }
})

test('a giveaway card is null, not free-as-zero', () => {
  // 0 would enter the asking-price band as a real observation and make a
  // giveaway look like the market rate.
  assert.equal(extractCardPrice(CARDS.get('1000000005')!), null)
})

test('price-on-request and bare VB cards are null', () => {
  assert.equal(extractCardPrice(CARDS.get('1000000006')!), null)
  assert.equal(extractCardPrice(CARDS.get('1000000007')!), null)
})

test('a card with no price block is null', () => {
  assert.equal(extractCardPrice(CARDS.get('1000000008')!), null)
})

test('a real asking price is never rejected for being cheap', () => {
  // The product exists to surface unusually cheap listings; an outlier low
  // price is the signal, not noise.
  assert.equal(parseGermanPrice('1 €'), 1)
  assert.equal(parseGermanPrice('5 € VB'), 5)
  assert.equal(extractCardPrice(CARDS.get('1000000002')!), 450)
})

/* ------------------------------------------------------------------ *
 * Precedence
 * ------------------------------------------------------------------ */

test('price metadata outranks the visible element', () => {
  // Card 9 shows 999 € but declares content="640.00".
  assert.equal(extractCardPrice(CARDS.get('1000000009')!), 640)
})

test('structured offer data outranks everything below it', () => {
  // Card 10 shows 1.999 € but its Offer says 1750.00.
  assert.equal(extractCardPrice(CARDS.get('1000000010')!), 1750)
})

test('unparseable structured data falls through instead of failing', () => {
  const card =
    '<article data-adid="1"><script type="application/ld+json">{ not json </script>' +
    '<p class="aditem-main--middle--price-shipping--price">320 €</p></article>'
  assert.equal(extractCardPrice(card), 320)
})

test('an ImageObject ld+json block is not mistaken for an offer', () => {
  // This is what live cards actually carry.
  const card =
    '<article data-adid="1"><script type="application/ld+json">' +
    '{"@type":"ImageObject","contentUrl":"https://example.invalid/a.jpg"}</script>' +
    '<p class="aditem-main--middle--price-shipping--price">275 €</p></article>'
  assert.equal(extractCardPrice(card), 275)
})

/* ------------------------------------------------------------------ *
 * The impossible-value bound stays, but is no longer load-bearing
 * ------------------------------------------------------------------ */

test('an impossible price is still refused', () => {
  assert.equal(parseGermanPrice('600.000 €'), null)
  assert.equal(parseGermanPrice('12491299'), null)
})

test('the bound is not what recovers the SH-101 case', () => {
  // If the concatenation were still happening, this would be null.
  assert.equal(extractCardPrice(CARDS.get('1000000001')!), 800)
})

/* ------------------------------------------------------------------ *
 * Currency stays EUR at extraction
 * ------------------------------------------------------------------ */

test('extraction returns a number only — no currency and no conversion', () => {
  // Conversion is the callers' job, through the existing toDkkApprox path.
  // A rate must never appear in this module.
  const source = readFileSync(
    join(__dirname, '..', '..', 'frontend', 'lib', 'scrapers', 'kleinanzeigen-price.ts'),
    'utf8',
  )
  assert.equal(/7\.45|toDkkApprox|price_dkk/.test(source), false)
  assert.equal(typeof extractCardPrice(CARDS.get('1000000002')!), 'number')
})

/* ------------------------------------------------------------------ *
 * Both scrapers share this module — the reason the 2026-05 fix did not stick
 * ------------------------------------------------------------------ */

test('neither scraper keeps a private price parser', () => {
  const root = join(__dirname, '..', '..')
  for (const rel of [
    ['frontend', 'lib', 'scrapers', 'kleinanzeigen.ts'],
    ['scripts', 'scrape-kleinanzeigen.ts'],
  ]) {
    const src = readFileSync(join(root, ...rel), 'utf8')
    assert.ok(
      src.includes('extractCardPrice'),
      `${rel.join('/')} must use the shared extractor`,
    )
    assert.equal(
      /function parsePrice\s*\(/.test(src),
      false,
      `${rel.join('/')} must not define its own price parser — the PM2 writer ` +
        'having a private copy is why the 2026-05 diagnosis never reached production',
    )
  }
})
