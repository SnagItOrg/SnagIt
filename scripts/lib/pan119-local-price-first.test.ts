/**
 * PAN-119 — the local price is shown first, and shown as an observation.
 *
 * The owner: "Den lokale pris er jo den folk er mest interesserede i."
 *
 * Measured on production 2026-09-23, across the 50 canonical public products:
 * 35 have no adjudicated Danish listing at all, 8 have exactly one, 7 have two
 * or more, and the largest Danish population anywhere is six (Juno-106). So
 * `dk-asking` reaches `median-only` on five products and `listings-only` on
 * ten, and `MIN_BAND_N` is unreachable — PAN-109.
 *
 * The defect this pins: at `listings-only` the block used to describe the
 * listings in prose ("Klup har 1 gennemgået dansk annonce...") while the
 * international reference rendered a bold median beside it, so the only NUMBER
 * on 45 of 50 product pages was the foreign one. The fix shows the observed
 * Danish asking price itself.
 *
 * The risk the fix introduces is the opposite one: that a raw price array
 * becomes a back door for a statistic the tier gate forbids. Both tests below
 * exist for that, not for the layout.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildPopulationStats, MIN_DESCRIPTIVE_MEDIAN_N } from '../../frontend/lib/price-populations'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const codeOf = (...seg: string[]) => readFileSync(join(FRONTEND, ...seg), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = ['app', '(shell)', 'product', '[slug]', 'page.tsx']
const ROUTE = ['app', 'api', 'product', '[slug]', 'route.ts']
const BLOCK = ['components', 'PriceAnswer.tsx']

const obs = (n: number[]) => n.map((v) => ({ price: v, price_dkk: v }))

test('PAN-119a: the local block renders before the international reference, and carries the observed prices', () => {
  const page = strip(codeOf(...PAGE))
  const local = page.indexOf('<DanishMarketBlock')
  const reference = page.indexOf('<ReferencePopulationBlock')
  assert.ok(local !== -1 && reference !== -1, 'both blocks render')
  assert.ok(local < reference, 'the Danish market is rendered first')

  // The observed prices must actually reach the block, or the thin tier falls
  // back to prose and the only number on the page is the international one.
  assert.ok(page.includes('askingPrices={dkAskingPrices}'), 'the page passes the observed prices')
  assert.ok(page.includes('setDkAskingPrices(data.dkAskingPrices ?? [])'),
    'and reads them from the route rather than re-deriving them from the wall')

  // Re-deriving them on the client is what PAN-93 forbids: the wall carries
  // unreviewed rows (is_valid NULL), so a client-side filter would price the
  // Danish market from matches nobody has adjudicated.
  assert.equal(page.includes('classifyListing('), false,
    'the client must not re-classify listings into a price population')
})

test('PAN-119b: the observed prices are evidence-only, and never become a statistic', () => {
  const route = strip(codeOf(...ROUTE))
  // Derived from `grouped`, which is built from `verifiedListings` — so the
  // array inherits `isPriceEvidence` and cannot contain an unreviewed row.
  assert.ok(/const dkAskingPrices = grouped\.byPopulation\['dk-asking'\]/.test(route),
    'the observed prices come from the adjudicated population, not from the wall')
  assert.ok(route.includes('dkAskingPrices'), 'and are serialised to the page')

  const block = strip(codeOf(...BLOCK))
  // The block may print them. It may not compute anything from them: a median
  // or a quartile derived here would reintroduce, at n=1..2, exactly the claim
  // `buildPopulationStats` redacts.
  const usage = block.slice(block.indexOf('const observed = askingPrices'))
  for (const forbidden of ['median(', 'quartiles(', 'percentile', 'reduce(', '/ observed.length']) {
    assert.equal(usage.includes(forbidden), false,
      `the block must not derive a statistic from the observed prices: ${forbidden}`)
  }
  // And it is reachable only from the tier that has no statistic to show.
  assert.ok(block.includes("if (stats.tier === 'listings-only')"), 'still gated on the tier')

  // The redaction contract itself is unchanged: below the descriptive-median
  // gate there is no median and never a band, whatever the page renders.
  for (const n of [1, 2]) {
    const stats = buildPopulationStats('dk-asking', obs(Array.from({ length: n }, (_, i) => 10000 + i)))
    assert.equal(stats.tier, 'listings-only', `n=${n} is the thin tier`)
    assert.equal(stats.median, null, `n=${n} exposes no median`)
    assert.equal(stats.q1, null, `n=${n} exposes no q1`)
    assert.equal(stats.q3, null, `n=${n} exposes no q3`)
    assert.ok(n < MIN_DESCRIPTIVE_MEDIAN_N)
  }
})
