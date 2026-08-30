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
  parseGermanPriceOutcome,
} from '../../frontend/lib/scrapers/kleinanzeigen-price'
import {
  KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR,
  classifyKleinanzeigenPrice,
  hasPlausibleListingPrice,
  MAX_DISCOUNT_RATIO,
  recoverKleinanzeigenPrice,
  looksLikeConcatenatedPair,
  sanitizeListingPrice,
} from '../../frontend/lib/listing-price-integrity'

const ROOT = join(__dirname, '..', '..')

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
  // 600000 halves to 600 | 000: the leading zero means it was never a pair of
  // prices, so it stays a single implausible value and is refused.
  assert.equal(parseGermanPrice('600.000 €'), null)
})

test('a welded discount pair is recovered, not refused', () => {
  // 12491299 is "1.249 €" struck through from "1.299 €" — two real prices.
  assert.equal(parseGermanPrice('12491299'), 1249)
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

/* ══════════════════════════════════════════════════════════════════════════
 * PRICE INTEGRITY — the inflated-price defect
 *
 * Two production rows, measured 2026-08-30:
 *
 *   "Boss RE-20 Space Echo Reverb Pedal Effekt Tape 201 Roland Vintage"
 *     stored 235240, scraped 2026-08-28.  Real ask 235 EUR; 240 is the
 *     struck-through old price.
 *   "Behringer MS-1-BK/ Klon des legendären Roland SH-101"
 *     stored 220250, scraped 2026-08-27.  Real ask 220 EUR; 250 is the old
 *     price.
 *
 * The real values are established from the pair's own structure, not guessed:
 * both decompose into equal-length halves where the second is the larger, which
 * is what a discount looks like, and it is the same shape as every other bad
 * row (12491299 = 1249|1299, 62006800 = 6200|6800).
 *
 * The HTML extraction was already fixed. What was NOT fixed is that a dotted
 * value survives as a "valid" German price: `220.250 €` parses to 220250, and
 * the write guard was 500,000 EUR — far too high to catch two three-digit
 * prices. So the bad value was stored, displayed and believed.
 * ══════════════════════════════════════════════════════════════════════════ */

test('the two observed production values are recovered to their current price', () => {
  // THE CORRECTION. These were read as corrupt and discarded. They are
  // discounted ads: 220 EUR now (was 250), 235 EUR now (was 240). The markup
  // nests the struck-through price inside the current one, so the current
  // price always comes first and the left half is what the seller is asking.
  for (const [text, welded, current, previous] of [
    ['220.250 €', 220250, 220, 250],
    ['235.240 €', 235240, 235, 240],
  ] as const) {
    const outcome = parseGermanPriceOutcome(text)
    assert.notEqual(outcome.value, welded, `${text} still yields ${welded}`)
    assert.equal(outcome.value, current, `${text} must yield the current price`)
    assert.equal(outcome.reason, null, 'a recoverable pair is not a rejection')
    assert.equal(outcome.previous, previous, 'the former price is available internally')
  }
})

test('the real prices behind those two listings survive untouched', () => {
  assert.equal(parseGermanPrice('220 €'), 220)
  assert.equal(parseGermanPrice('235 €'), 235)
  assert.equal(parseGermanPrice('240 €'), 240)
  assert.equal(parseGermanPrice('250 €'), 250)
})

test('the card markup behind them yields the current price, never the pair', () => {
  const card = (now: string, was: string) =>
    `<div class="aditem-main--middle--price-shipping">` +
    `<p class="aditem-main--middle--price-shipping--price">${now}` +
    `<p class="aditem-main--middle--price-shipping--old-price">${was}</p></p></div>`
  assert.equal(extractCardPrice(card('220 €', '250 €')), 220)
  assert.equal(extractCardPrice(card('235 €', '240 €')), 235)
  // …and with no old-price class at all, only the first token is ever read.
  assert.equal(
    extractCardPrice('<p class="aditem-main--middle--price-shipping--price">220 € 250 €</p>'),
    220,
  )
})

test('every required German format parses', () => {
  assert.equal(parseGermanPrice('800 € VB'), 800, 'VB is a suffix on a real ask')
  assert.equal(parseGermanPrice('1.200 €'), 1200, 'a dot groups thousands')
  assert.equal(parseGermanPrice('1.200,00 €'), 1200, 'a comma decimates')
  assert.equal(parseGermanPrice('220 €'), 220)
  assert.equal(parseGermanPrice('Zu verschenken'), null, 'free is not zero')
  assert.equal(parseGermanPrice('VB'), null, 'VB with no number is absence')
})

test('free, wanted and price-on-request forms all become null', () => {
  for (const text of [
    'Zu verschenken', 'zu verschenken', 'Preis auf Anfrage', 'auf Anfrage',
    'Gegen Gebot', 'Verschenken',
  ]) {
    assert.equal(parseGermanPrice(text), null, `${text} must not become a price`)
  }
  // Absence is stated, not silently swallowed.
  assert.equal(parseGermanPriceOutcome('Zu verschenken').reason, 'no_price_stated')
})

test('a shipping surcharge can never become the asking price', () => {
  assert.equal(parseGermanPrice('+ Versand ab 5,49 €'), null)
  assert.equal(parseGermanPriceOutcome('+ Versand ab 5,49 €').reason, 'shipping_only')
  assert.equal(parseGermanPrice('Versand möglich'), null)
  // But a real price followed by a shipping note is still a real price.
  assert.equal(parseGermanPrice('450 € Versand möglich'), 450)
})

test('title years and model numbers cannot reach the price', () => {
  // The parser is never handed a title — it reads the price element only. This
  // pins that: a card whose ONLY numbers live in the title yields nothing.
  const card =
    '<article class="aditem"><h2><a href="/s-anzeige/x/1">Korg MS-20 Vintage 1978 Seriennummer 146267</a></h2>' +
    '<div class="aditem-main--middle--price-shipping">' +
    '<p class="aditem-main--middle--price-shipping--price">Zu verschenken</p></div></article>'
  assert.equal(extractCardPrice(card), null, 'a year or serial must not become a price')
})

test('separate numeric fragments are never concatenated', () => {
  assert.equal(parseGermanPrice('800 € 900 €'), 800)
  assert.equal(parseGermanPrice('1.249 € 1.299 €'), 1249)
  assert.equal(parseGermanPrice('220 €250 €'), 220)
})

test('the concatenation shape is recognised on every observed production value', () => {
  // Every one of these is a real stored row.
  for (const [welded, current, previous] of [
    [220250, 220, 250], [235240, 235, 240], [12491299, 1249, 1299],
    [62006800, 6200, 6800], [41504950, 4150, 4950], [26502750, 2650, 2750],
    [490600, 490, 600], [489579, 489, 579], [466500, 466, 500],
  ] as const) {
    const verdict = looksLikeConcatenatedPair(welded)
    assert.equal(verdict.suspect, true, `${welded} not recognised`)
    assert.deepEqual(verdict.parts, [current, previous])

    // Recoverable, therefore believable — the row carries a real asking price.
    assert.equal(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: welded }), true)
    const recovered = recoverKleinanzeigenPrice(welded)
    assert.equal(recovered.value, current, `${welded} must recover ${current}`)
    assert.equal(recovered.previous, previous)
    assert.equal(recovered.recovered, true)
  }
})

test('legitimate high-value gear is preserved — no arbitrary low ceiling', () => {
  // Real active rows, measured 2026-08-30.
  for (const [price, what] of [
    [8063, 'Gibson 1959 Les Paul Reissue'],
    [12345, 'Gibson Les Paul bundle'],
    [16500, 'Korg MS-20 Kraftwerk provenance'],
    [17934, 'Wurlitzer 207'],
    [24999, 'just under the unconditional floor'],
  ] as const) {
    assert.equal(
      hasPlausibleListingPrice({ source: 'kleinanzeigen', price }), true,
      `${what} at ${price} EUR must survive`,
    )
    assert.equal(looksLikeConcatenatedPair(price).suspect, false)
  }
})

test('a genuine large round price is not mistaken for a pair', () => {
  // Its second half carries a leading zero, so it was never two prices.
  for (const price of [150000, 200000, 100000, 250000]) {
    assert.equal(looksLikeConcatenatedPair(price).suspect, false, `${price} wrongly flagged`)
  }
  // Odd digit counts are out of scope for the shape test entirely.
  for (const price of [45000, 32500, 9999]) {
    assert.equal(looksLikeConcatenatedPair(price).suspect, false)
  }
})

test('the shape test cannot fire below the unconditional floor', () => {
  assert.equal(KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR, 25_000)
  assert.equal(
    hasPlausibleListingPrice({ source: 'kleinanzeigen', price: KLEINANZEIGEN_UNCONDITIONAL_MAX_EUR }),
    true,
  )
  // 220250 is above the floor AND pair-shaped; 220 is below it and safe.
  assert.equal(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: 220 }), true)
})

test('the guard is source-specific — other marketplaces are untouched', () => {
  for (const source of ['reverb', 'dba.dk', 'finn', 'blocket']) {
    assert.equal(hasPlausibleListingPrice({ source, price: 220250 }), true, source)
    assert.equal(hasPlausibleListingPrice({ source, price: 12491299 }), true, source)
  }
})

test('rejection reasons are static codes, never markup or free text', () => {
  const reasons = new Set<string>()
  for (const text of ['220.250 €', 'Zu verschenken', '+ Versand 5 €', 'kein Preis', '']) {
    const r = parseGermanPriceOutcome(text).reason
    if (r) reasons.add(r)
  }
  for (const r of reasons) {
    assert.match(r, /^[a-z_]+$/, `reason ${r} is not a static code`)
  }
  // `concatenated_pair` is deliberately absent: that shape is recovered now,
  // and a recovery is not a rejection reason.
  assert.ok(!reasons.has('concatenated_pair'))
  assert.ok(reasons.has('no_price_stated'))
})

test('the scraper logs a rejection and guards again at the write boundary', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'scrape-kleinanzeigen.ts'), 'utf8')
  assert.ok(src.includes("event: 'price_rejected'"), 'a parse rejection must be observable')
  assert.ok(src.includes("event: 'price_rejected_at_write'"), 'and so must a write rejection')
  assert.ok(src.includes('guardedPrice('), 'the write boundary must re-check')
  assert.ok(src.includes('classifyKleinanzeigenPrice'), 'through the shared authority')
  // Identity, timestamps and the conflict target must be untouched.
  assert.ok(src.includes('external_id: listing.url'))
  assert.ok(src.includes('scraped_at: new Date().toISOString()'))
  // No markup, card text or credentials in any log line.
  for (const leak of ['articleHtml', 'cardHtml', 'SERVICE_ROLE', 'apiKey', 'html)']) {
    const escaped = leak.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.ok(
      !new RegExp(`event: 'price_rejected[\\s\\S]{0,300}${escaped}`).test(src),
      `the rejection log leaked ${leak}`,
    )
  }
})

test('price snapshots apply the same guard as the writer', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'lib', 'price-observations.ts'), 'utf8')
  assert.ok(
    src.includes('hasPlausibleListingPrice'),
    'a bad price must not become a permanent price event',
  )
})

/* ══════════════════════════════════════════════════════════════════════════
 * READ BOUNDARY — the 77 rows already stored
 *
 * The parser guard stops new bad rows. It does nothing for rows written before
 * it, and those are what an operator actually sees. Three readers already
 * applied `hasPlausibleListingPrice` and therefore inherited the tightened
 * bound for free; `/admin/match` did not, which is why 235.240 EUR was still
 * on screen after the parser was fixed.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The two rows exactly as production stores them today. */
const STORED_BAD_ROWS = [
  {
    what: 'Boss RE-20 Space Echo Reverb Pedal Effekt Tape 201 Roland Vintage',
    source: 'kleinanzeigen', price: 235240, price_dkk: 1752538,
  },
  {
    what: 'Behringer MS-1-BK/ Klon des legendären Roland SH-101',
    source: 'kleinanzeigen', price: 220250, price_dkk: 1640862,
  },
] as const

test('the two stored rows are believable once the pair is separated', () => {
  for (const row of STORED_BAD_ROWS) {
    assert.equal(
      hasPlausibleListingPrice({ source: row.source, price: row.price }), true,
      `${row.what} carries a real current price and must not be discarded`,
    )
  }
})

test('sanitising recovers the current price and rescales its DKK figure', () => {
  for (const row of STORED_BAD_ROWS) {
    const safe = sanitizeListingPrice(row)
    const expected = recoverKleinanzeigenPrice(row.price).value
    assert.equal(safe.price, expected, row.what)
    assert.ok(safe.price != null && safe.price > 0, 'the ad keeps a real price')
  }

  // The DKK figure was computed from the welded number, so it is wrong by
  // exactly the same ratio and is rescaled rather than dropped. Leaving it
  // would publish a million-krone figure with no source price behind it.
  const safe = sanitizeListingPrice({ source: 'kleinanzeigen', price: 235240, price_dkk: 1752538 })
  assert.equal(safe.price, 235)
  assert.equal(safe.price_dkk, Math.round((1752538 * 235) / 235240))
  assert.ok(safe.price_dkk! < 2000, 'the rescaled figure is an ordinary DKK price')
})

test('a genuine expensive Kleinanzeigen row keeps both prices', () => {
  assert.deepEqual(
    sanitizeListingPrice({ source: 'kleinanzeigen', price: 16500, price_dkk: 122925 }),
    { price: 16500, price_dkk: 122925 },
    'the Kraftwerk MS-20 is real and must still show its price',
  )
})

test('sanitising is source-specific', () => {
  assert.deepEqual(
    sanitizeListingPrice({ source: 'reverb', price: 235240, price_dkk: 1752538 }),
    { price: 235240, price_dkk: 1752538 },
  )
})

test('/admin/match sanitises at the read boundary and keeps the listing', () => {
  const src = readFileSync(
    join(ROOT, 'frontend', 'app', 'api', 'admin', 'match', 'candidates', 'route.ts'), 'utf8')
  assert.ok(src.includes('sanitizeListingPrice'), 'the admin queue must sanitise')
  assert.ok(/price:\s+safe\.price/.test(src), 'the rendered price must be the sanitised one')
  assert.ok(/price_dkk:\s+safe\.price_dkk/.test(src), 'and so must the DKK figure')
  // The ad itself is NOT dropped — the queue is where a bad row gets disposed of.
  assert.ok(
    !/hasPlausibleListingPrice[\s\S]{0,80}continue/.test(src),
    'the candidate must survive; only its price is neutralised',
  )
})

test('an admin writer cannot copy an implausible price onto a product', () => {
  const src = readFileSync(
    join(ROOT, 'frontend', 'app', 'api', 'admin', 'product', '[slug]', 'save-listing', 'route.ts'),
    'utf8')
  assert.ok(src.includes('sanitizeListingPrice'), 'save-listing must sanitise before writing')
  assert.ok(/price:\s*sanitizeListingPrice\(listing\)\.price/.test(src))
  assert.ok(/price_dkk:\s*sanitizeListingPrice\(listing\)\.price_dkk/.test(src))
})

test('the price band and Intel still drop the row entirely', () => {
  // These readers legitimately exclude, rather than sanitise: a band computed
  // from a false price is worse than a band with one fewer observation.
  const product = readFileSync(
    join(ROOT, 'frontend', 'app', 'api', 'product', '[slug]', 'route.ts'), 'utf8')
  assert.ok(/hasPlausibleListingPrice\(\{/.test(product), 'the price band must exclude')
  const intel = readFileSync(join(ROOT, 'frontend', 'app', 'intel', 'page.tsx'), 'utf8')
  assert.ok(/if \(!hasPlausibleListingPrice\(l\)\) continue/.test(intel), 'Intel must exclude')
})

test('every listings reader either excludes or sanitises — none renders raw', () => {
  const readers = [
    ['frontend/app/api/product/[slug]/route.ts', 'excludes'],
    ['frontend/app/intel/page.tsx', 'excludes'],
    ['frontend/app/api/admin/match/candidates/route.ts', 'sanitises'],
    ['frontend/app/api/admin/product/[slug]/save-listing/route.ts', 'sanitises'],
  ] as const
  for (const [path, mode] of readers) {
    const src = readFileSync(join(ROOT, ...path.split('/')), 'utf8')
    const guarded =
      src.includes('hasPlausibleListingPrice') || src.includes('sanitizeListingPrice')
    assert.ok(guarded, `${path} (${mode}) reads listing prices without any guard`)
  }
})

/* ------------------------------------------------------------------ *
 * Regression fixtures for the observed discounted cards
 *
 * These are the shapes that produced the stored values the earlier release
 * discarded. They are in the fixture as MARKUP, so the whole path is exercised:
 * the old price is nested inside the current one, the wrapper text welds them,
 * and the extractor must still return the price the seller is asking today.
 * ------------------------------------------------------------------ */

test('an observed 220-from-250 card yields the current price', () => {
  assert.equal(extractCardPrice(CARDS.get('1000000011')!), 220)
})

test('an observed 235-from-240 card yields the current price', () => {
  assert.equal(extractCardPrice(CARDS.get('1000000012')!), 235)
})

test('an observed four-digit 1249-from-1299 card yields the current price', () => {
  assert.equal(extractCardPrice(CARDS.get('1000000013')!), 1249)
})

test('a genuine 16.500 € card is never split', () => {
  // Odd digit count and no old-price element: nothing to recover, and the
  // recovery must not invent a pair out of a real five-figure instrument.
  assert.equal(extractCardPrice(CARDS.get('1000000014')!), 16500)
})

test('the welded form of each observed card recovers to the same price', () => {
  // Belt and braces: whichever path a row arrived by — live markup today, or a
  // legacy integer stored by the old parser — both must agree.
  for (const [adid, welded, current] of [
    ['1000000011', 220250, 220],
    ['1000000012', 235240, 235],
    ['1000000013', 12491299, 1249],
  ] as const) {
    assert.equal(extractCardPrice(CARDS.get(adid)!), current, `card ${adid}`)
    assert.equal(recoverKleinanzeigenPrice(welded).value, current, `stored ${welded}`)
  }
})

/* ------------------------------------------------------------------ *
 * The discount-ratio bound
 *
 * Structure alone cannot tell a discount from a placeholder. Two production
 * ads carried `123456` in the price field, and their titles say plainly that
 * neither is selling anything — one begins `Tausche` (a swap), the other
 * `[Suche]` (wanted). 123 | 456 satisfies every structural check, so without a
 * ratio bound the recovery would invent a 123 EUR asking price for an ad with
 * no price at all.
 *
 * Measured: every confirmed pair among the 77 production rows lands between
 * 1.02 and 1.933; the placeholders sit alone at 3.707.
 * ------------------------------------------------------------------ */

test('the bound sits above every observed discount and below the placeholder', () => {
  assert.equal(MAX_DISCOUNT_RATIO, 2.0)
  // The widest real discount measured in production.
  assert.equal(recoverKleinanzeigenPrice(150290).value, 150, 'ratio 1.933 is a real discount')
  // The placeholder.
  assert.equal(recoverKleinanzeigenPrice(123456).recovered, false, 'ratio 3.707 is not')
})

test('a placeholder price is left unsplit and refused, not turned into 123', () => {
  const r = recoverKleinanzeigenPrice(123456)
  assert.equal(r.recovered, false)
  assert.equal(r.value, 123456, 'the value is not split')
  assert.notEqual(r.value, 123, 'and must never become the left half')
  assert.equal(classifyKleinanzeigenPrice(123456).reason, 'ambiguous_pair')
  // Fails closed at the read boundary: neither reading is supported, so the
  // page shows no price rather than 123 EUR or 123,456 EUR.
  assert.deepEqual(
    sanitizeListingPrice({ source: 'kleinanzeigen', price: 123456, price_dkk: 919747 }),
    { price: null, price_dkk: null },
  )
})

test('the boundary is inclusive at exactly 2.0', () => {
  // A halving is steep but real, and the comparison is `previous <= current * 2`.
  assert.equal(recoverKleinanzeigenPrice(100200).value, 100, '200/100 = 2.0 exactly')
  assert.equal(recoverKleinanzeigenPrice(100200).previous, 200)
  // One euro past it is not a discount we can vouch for.
  assert.equal(recoverKleinanzeigenPrice(100201).recovered, false, '201/100 = 2.01')
  assert.equal(recoverKleinanzeigenPrice(100201).value, 100201)
  assert.equal(classifyKleinanzeigenPrice(100201).reason, 'ambiguous_pair')
})

test('an ambiguous value is distinguishable from "no pair here"', () => {
  // If ambiguity were reported as "not a pair", the raw value would fall
  // through as an ordinary price and 123456 would render as 123,456 EUR.
  assert.equal(looksLikeConcatenatedPair(123456).suspect, false)
  assert.equal(looksLikeConcatenatedPair(123456).ambiguous, true)
  // A genuinely non-pair value carries no ambiguity flag at all.
  assert.equal(looksLikeConcatenatedPair(16500).suspect, false)
  assert.equal(looksLikeConcatenatedPair(16500).ambiguous, undefined)
  assert.equal(looksLikeConcatenatedPair(150000).ambiguous, undefined, 'leading zero, not a pair')
})

test('the confirmed production pairs still recover unchanged', () => {
  for (const [welded, current] of [
    [220250, 220], [235240, 235], [12491299, 1249], [62006800, 6200],
    [41504950, 4150], [26502750, 2650], [490600, 490], [489579, 489], [466500, 466],
  ] as const) {
    assert.equal(recoverKleinanzeigenPrice(welded).value, current, `${welded}`)
  }
})

test('ordinary prices are untouched by the ratio rule', () => {
  for (const v of [1200, 16500, 150000, 2345, 17934, 800, 220, 235]) {
    const r = recoverKleinanzeigenPrice(v)
    assert.equal(r.value, v, `${v} must pass through`)
    assert.equal(r.recovered, false)
  }
})

test('price_dkk is rescaled only when recovery succeeded', () => {
  // Recovered: rescaled by the same ratio.
  assert.deepEqual(
    sanitizeListingPrice({ source: 'kleinanzeigen', price: 235240, price_dkk: 1752538 }),
    { price: 235, price_dkk: Math.round((1752538 * 235) / 235240) },
  )
  // Ambiguous: nothing is written, in either currency.
  assert.deepEqual(
    sanitizeListingPrice({ source: 'kleinanzeigen', price: 100201, price_dkk: 746497 }),
    { price: null, price_dkk: null },
  )
  // Already normalised by the remediation: left exactly as stored.
  assert.deepEqual(
    sanitizeListingPrice({ source: 'kleinanzeigen', price: 235, price_dkk: 1751 }),
    { price: 235, price_dkk: 1751 },
  )
})

test('the threshold lives once, in the shared authority', () => {
  const shared = readFileSync(
    join(__dirname, '..', '..', 'frontend', 'lib', 'listing-price-integrity.ts'), 'utf8')
  assert.ok(/export const MAX_DISCOUNT_RATIO = 2\.0/.test(shared))
  for (const rel of [
    ['frontend', 'lib', 'scrapers', 'kleinanzeigen-price.ts'],
    ['frontend', 'app', 'api', 'admin', 'match', 'candidates', 'route.ts'],
    ['frontend', 'app', 'api', 'product', '[slug]', 'route.ts'],
    ['frontend', 'lib', 'public-product.ts'],
    ['scripts', 'scrape-kleinanzeigen.ts'],
    ['scripts', 'lib', 'price-observations.ts'],
  ]) {
    const src = readFileSync(join(__dirname, '..', '..', ...rel), 'utf8')
    assert.ok(!/2\.0\s*;|ratio\s*[<>]=?\s*2/.test(src),
      `${rel.join('/')} must not carry its own copy of the threshold`)
  }
})

test('the ambiguous reason is a static code carrying no listing content', () => {
  const reason = parseGermanPriceOutcome('123456').reason!
  assert.match(reason, /^[a-z_]+$/)
  assert.equal(reason, 'ambiguous_pair')
  assert.ok(!reason.includes('123456'), 'the value must not travel in the code')
})
