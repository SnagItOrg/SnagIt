/**
 * Data-presentation primitives — the pure parts.
 *
 * Covers only what can be wrong without being visible: the palette's stability
 * guarantee, the geometry's degenerate inputs, and the formatters' sign and
 * range handling. Nothing here asserts a CSS colour value or a class name —
 * those are design decisions, not behaviour, and a test that pins them only
 * makes the design harder to change.
 *
 * Runs under the root `tsx --test` harness; all three modules under test are
 * deliberately import-free.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_SERIES_COLORS,
  DIRECTION_GLYPH,
  MARKET_SLOTS,
  NAMED_SERIES_SLOTS,
  directionOf,
  directionTone,
  isKnownMarket,
  seriesColor,
  seriesShape,
  seriesSlot,
} from '../../frontend/lib/chart-palette'
import { divergingBarGeometry, sparklineGeometry } from '../../frontend/lib/chart-geometry'
import {
  formatCompact,
  formatCount,
  formatDateRange,
  formatDkk,
  formatDkkAmount,
  formatPercent,
  formatSignedDkk,
} from '../../frontend/lib/chart-format'

/* ── palette: colour follows the entity ─────────────────────────────────── */

test('palette: the sequence is the eight validated hues, in order', () => {
  assert.deepEqual(
    [...CHART_SERIES_COLORS],
    ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  )
})

test('palette: each tracked market holds a distinct, fixed slot', () => {
  const slots = Object.values(MARKET_SLOTS)
  assert.equal(new Set(slots).size, slots.length, 'two markets share a slot')
  for (const market of Object.keys(MARKET_SLOTS)) {
    assert.equal(seriesSlot(market), MARKET_SLOTS[market])
    assert.ok(isKnownMarket(market))
  }
})

test('palette: colour is a function of the key alone, so filtering cannot repaint', () => {
  // The failure this prevents: assigning by position in the rendered array.
  // Filtering DE out of [DK, DE, SE] must leave SE on exactly its own hue.
  const full = ['DK', 'DE', 'SE', 'NO', 'US']
  const filtered = full.filter((m) => m !== 'DE')
  for (const market of filtered) {
    assert.equal(seriesColor(market), seriesColor(market))
  }
  assert.equal(seriesColor('SE'), CHART_SERIES_COLORS[MARKET_SLOTS.SE])
  // ...and reordering is equally inert.
  const reversed = [...full].reverse()
  for (const market of reversed) {
    assert.equal(seriesColor(market), CHART_SERIES_COLORS[MARKET_SLOTS[market]])
  }
})

test('palette: an unknown key is stable, case-insensitive and inside the sequence', () => {
  const a = seriesColor('reverb-sold')
  assert.equal(a, seriesColor('reverb-sold'))
  assert.equal(a, seriesColor('  REVERB-SOLD '))
  assert.ok(CHART_SERIES_COLORS.includes(a as (typeof CHART_SERIES_COLORS)[number]))
  assert.ok(seriesSlot('reverb-sold') >= 0)
  assert.ok(seriesSlot('reverb-sold') < CHART_SERIES_COLORS.length)
})

test('palette: a named series takes its chosen slot, not the hash', () => {
  // The public product page draws one sold-price series. Leaving its hue to
  // the hash once landed it on the red end of the sequence, which reads as a
  // negative signal in a system where red is the destructive token.
  assert.equal(seriesSlot('sold-price'), NAMED_SERIES_SLOTS['SOLD-PRICE'])
  assert.equal(seriesColor('sold-price'), CHART_SERIES_COLORS[NAMED_SERIES_SLOTS['SOLD-PRICE']])
  assert.equal(seriesColor('sold-price'), seriesColor('SOLD-PRICE'))
})

test('palette: every key also gets a non-colour channel', () => {
  assert.equal(seriesShape('DK'), seriesShape('dk'))
  assert.ok(['circle', 'square', 'triangle', 'diamond'].includes(seriesShape('anything')))
})

test('palette: direction is derived from the sign, and zero is flat', () => {
  assert.equal(directionOf(1), 'up')
  assert.equal(directionOf(-1), 'down')
  assert.equal(directionOf(0), 'flat')
  assert.equal(directionOf(null), 'flat')
  assert.equal(directionOf(Number.NaN), 'flat')
  // Each direction carries a glyph, so hue is never the only channel.
  assert.notEqual(DIRECTION_GLYPH.up, DIRECTION_GLYPH.down)
  assert.notEqual(DIRECTION_GLYPH.up, DIRECTION_GLYPH.flat)
})

test('palette: direction tints resolve to semantic tokens, never to the sequence', () => {
  for (const direction of ['up', 'down', 'flat'] as const) {
    const tone = directionTone(direction)
    assert.match(tone, /^var\(--/)
    assert.ok(!CHART_SERIES_COLORS.some((c) => tone.includes(c)))
  }
})

/* ── sparkline geometry ─────────────────────────────────────────────────── */

test('sparkline: no observations produce no geometry', () => {
  assert.equal(sparklineGeometry([], 240, 40), null)
  assert.equal(sparklineGeometry([Number.NaN], 240, 40), null)
})

test('sparkline: one observation is a single centred point with no direction', () => {
  const g = sparklineGeometry([5000], 240, 40)
  assert.ok(g)
  assert.equal(g!.points.length, 1)
  assert.equal(g!.change, 0)
  assert.equal(g!.current, 5000)
  assert.ok(Number.isFinite(g!.points[0].x))
  assert.ok(Number.isFinite(g!.points[0].y))
})

test('sparkline: a flat series pins to the middle instead of dividing by zero', () => {
  const g = sparklineGeometry([100, 100, 100], 240, 40)
  assert.ok(g)
  for (const p of g!.points) assert.ok(Number.isFinite(p.y), 'NaN coordinate on a flat series')
  assert.equal(g!.change, 0)
})

test('sparkline: every coordinate stays inside the box, and x spans it exactly', () => {
  const g = sparklineGeometry([10, 90, 30, 70], 240, 40)
  assert.ok(g)
  assert.equal(g!.points[0].x, 0)
  assert.equal(g!.points[g!.points.length - 1].x, 240)
  for (const p of g!.points) {
    assert.ok(p.y >= 0 && p.y <= 40, `y out of box: ${p.y}`)
  }
  assert.ok(g!.lastYPercent >= 0 && g!.lastYPercent <= 100)
})

test('sparkline: y is inverted, so a higher value sits higher on the page', () => {
  const g = sparklineGeometry([10, 90], 240, 40)
  assert.ok(g)
  assert.ok(g!.points[1].y < g!.points[0].y, 'the larger value must have the smaller y')
})

test('sparkline: change is current minus first, and drives the reported direction', () => {
  assert.equal(directionOf(sparklineGeometry([100, 140], 240, 40)!.change), 'up')
  assert.equal(directionOf(sparklineGeometry([140, 100], 240, 40)!.change), 'down')
  // Not the slope of the last segment: a series that dipped and recovered to
  // its start is flat over the period, whatever the final leg did.
  assert.equal(directionOf(sparklineGeometry([100, 20, 100], 240, 40)!.change), 'flat')
})

/* ── diverging bar geometry ─────────────────────────────────────────────── */

test('diverging bar: the side follows the sign, never the magnitude', () => {
  assert.equal(divergingBarGeometry(6084, 20000).side, 'right')
  assert.equal(divergingBarGeometry(-17001, 20000).side, 'left')
  assert.equal(divergingBarGeometry(0, 20000).side, 'none')
  assert.equal(divergingBarGeometry(null, 20000).side, 'none')
})

test('diverging bar: equal magnitudes render equal widths on opposite sides', () => {
  const up = divergingBarGeometry(5000, 20000)
  const down = divergingBarGeometry(-5000, 20000)
  assert.equal(up.fraction, down.fraction)
  assert.notEqual(up.side, down.side)
})

test('diverging bar: an extreme value clamps to the track and says so', () => {
  const g = divergingBarGeometry(500000, 20000)
  assert.equal(g.fraction, 1)
  assert.equal(g.clamped, true)
  assert.equal(divergingBarGeometry(20000, 20000).clamped, false)
})

test('diverging bar: a degenerate scale yields no bar rather than NaN', () => {
  for (const max of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const g = divergingBarGeometry(100, max)
    assert.equal(g.side, 'none')
    assert.equal(g.fraction, 0)
  }
})

/* ── formatting ─────────────────────────────────────────────────────────── */

test('format: DKK groups with the Danish separator and carries no unit by default', () => {
  assert.equal(formatDkk(12500), '12.500')
  assert.equal(formatDkkAmount(12500), '12.500 kr')
  assert.equal(formatDkk(null), null)
  assert.equal(formatDkk(Number.NaN), null)
})

test('format: a signed delta always prints its sign, in both directions', () => {
  assert.equal(formatSignedDkk(6084), '+6.084')
  assert.equal(formatSignedDkk(-17001), '−17.001')
  assert.equal(formatSignedDkk(0), '±0')
  assert.equal(formatSignedDkk(null), null)
})

test('format: the minus is U+2212, not a hyphen', () => {
  const negative = formatSignedDkk(-538)!
  assert.ok(negative.startsWith('−'))
  assert.ok(!negative.startsWith('-'))
})

test('format: a sample size is exact — never compacted, never rounded away', () => {
  assert.equal(formatCount(1), '1')
  assert.equal(formatCount(117), '117')
  assert.equal(formatCount(null), '0')
  assert.equal(formatCount(-3), '0')
})

test('format: compact notation is for summary magnitudes only', () => {
  assert.ok(formatCompact(269000)!.length < String(269000).length)
  assert.equal(formatCompact(null), null)
})

test('format: a percentage outside 0..1 is refused rather than rendered', () => {
  // Intl separates the value from the sign with a non-breaking space in da-DK,
  // so the assertion is on the digits and the unit, not on the whitespace.
  assert.match(formatPercent(0)!, /^0\s?%$/)
  assert.match(formatPercent(1)!, /^100\s?%$/)
  assert.equal(formatPercent(1.42), null, 'a coverage above 100% means a wrong denominator')
  assert.equal(formatPercent(-0.1), null)
  assert.equal(formatPercent(null), null)
})

test('format: a date range collapses when both ends fall in one month', () => {
  const same = formatDateRange('2026-08-01T00:00:00Z', '2026-08-28T00:00:00Z')
  assert.ok(same && !same.includes('–'), `expected a single month, got ${same}`)
  const spread = formatDateRange('2024-03-01T00:00:00Z', '2026-08-28T00:00:00Z')
  assert.ok(spread && spread.includes('–'))
  assert.equal(formatDateRange(null, null), null)
  assert.equal(formatDateRange('not-a-date', null), null)
})

/* ==========================================================================
   P2 — price answer, market basis and deal signal.

   Owner decisions C1/C2/C3, 2026-09-01. These cover the parts that can be
   wrong without being visible: the quantile contract, the population walls,
   the display ladder and the verdict boundaries.
   ========================================================================== */

import {
  percentile,
  quartiles as t7Quartiles,
  partitionByIqr,
} from '../../frontend/lib/statistics'
import {
  MAX_BAND_WIDTH_RATIO,
  MIN_BAND_N,
  buildPopulationStats,
  classifyListing,
  firstSeenTimestamp,
  groupByPopulation,
  hasUsableConditionData,
  isApproximateDkk,
  isConfirmedSales,
  verdictFor,
  type PriceObservation,
} from '../../frontend/lib/price-populations'

// ── fixtures ────────────────────────────────────────────────────────────────

const OWNER_FIXTURE = [1000, 1200, 1500, 1800, 2000, 5000]

const dk = (price: number, extra: Partial<PriceObservation> = {}): PriceObservation =>
  ({ price, price_dkk: price, source: 'dba.dk', country: 'DK', condition: null, ...extra })
const rvb = (price: number, extra: Partial<PriceObservation> = {}): PriceObservation =>
  ({ price, price_dkk: price, source: 'reverb', country: 'US', condition: 'Excellent', ...extra })
const de = (price: number, dkk: number | null = null): PriceObservation =>
  ({ price, price_dkk: dkk ?? price * 7.46, source: 'kleinanzeigen', country: 'DE', condition: null })

/** n identical-ish DKK values, spread just enough to keep the IQR non-zero. */
const dkSeries = (n: number, base = 20000): PriceObservation[] =>
  Array.from({ length: n }, (_, i) => dk(base + i * 100))

// ── C1: one quantile contract ───────────────────────────────────────────────

test('C1: the owner control fixture yields Type 7 quartiles', () => {
  const q = t7Quartiles(OWNER_FIXTURE)
  assert.ok(q)
  assert.equal(q.q1, 1275)
  assert.equal(q.median, 1650)
  assert.equal(q.q3, 1950)
})

test('C1: percentile() and quartiles() agree on the same fixture', () => {
  assert.equal(percentile(OWNER_FIXTURE, 0.25), 1275)
  assert.equal(percentile(OWNER_FIXTURE, 0.5), 1650)
  assert.equal(percentile(OWNER_FIXTURE, 0.75), 1950)
})

test('C1: the owner fixture 5000 is an IQR outlier at the Tukey fence', () => {
  // Q3 + 1.5*IQR = 1950 + 1.5*675 = 2962.5, so 5000 is trimmed. Asserted
  // explicitly because it is the difference between the raw and filtered n
  // the page has to explain.
  const { kept, excluded } = partitionByIqr(OWNER_FIXTURE)
  assert.deepEqual(excluded, [5000])
  assert.equal(kept.length, 5)
})

test('C1: the band path uses the same estimator as the raw one', () => {
  // The route builds bands through buildPopulationStats; it must not acquire a
  // second estimator on the way. Eight tightly-spread values so nothing is
  // trimmed and the two paths are directly comparable.
  const values = [10000, 10100, 10200, 10300, 10400, 10500, 10600, 10700]
  const stats = buildPopulationStats('reverb-asking', values.map((p) => rvb(p)))
  const direct = t7Quartiles(values)
  assert.ok(direct)
  assert.equal(stats.nFiltered, values.length, 'no trimming in this fixture')
  assert.equal(stats.median, direct.median)
  assert.equal(stats.q1, direct.q1)
  assert.equal(stats.q3, direct.q3)
})

test('C1: percentile is unrounded, so width ratios match their inputs', () => {
  assert.equal(percentile([1000, 1001], 0.5), 1000.5)
})

// ── C2: population walls ────────────────────────────────────────────────────

test('C2: a dba.dk listing is Danish by country', () => {
  const c = classifyListing({ source: 'dba.dk', country: 'DK' })
  assert.equal(c.population, 'dk-asking')
  assert.equal(c.basis, 'country')
})

test('C2: a Reverb row stored as currency DKK does NOT become Danish', () => {
  // The whole reason `currency` is never consulted: 39,926 active Reverb rows
  // are converted USD stored as currency='DKK'.
  const c = classifyListing({ source: 'reverb', country: 'US' })
  assert.equal(c.population, 'reverb-asking')
  assert.equal(c.basis, 'source-platform')
})

test('C2: even a Reverb row carrying country=DK stays international', () => {
  const c = classifyListing({ source: 'reverb', country: 'DK' })
  assert.equal(c.population, 'reverb-asking')
})

test('C2: source is the documented fallback when country is missing', () => {
  const c = classifyListing({ source: 'kleinanzeigen', country: null })
  assert.equal(c.population, 'de-asking')
  assert.equal(c.basis, 'source-fallback')
})

test('C2: a Thomann retail row is not a Danish used-market listing', () => {
  // country='DK' would otherwise file a NEW-price retail reference into the
  // second-hand Danish band.
  const c = classifyListing({ source: 'thomann', country: 'DK' })
  assert.equal(c.population, null)
  assert.equal(c.basis, 'unresolved')
})

test('C2: an unresolvable listing is excluded fail-closed', () => {
  const c = classifyListing({ source: 'facebook', country: null })
  assert.equal(c.population, null)
  assert.equal(c.basis, 'unresolved')
})

test('C2: DBA and Reverb asking are never grouped together', () => {
  const { byPopulation } = groupByPopulation([dk(20000), rvb(30000), dk(21000)])
  assert.equal(byPopulation['dk-asking'].length, 2)
  assert.equal(byPopulation['reverb-asking'].length, 1)
  assert.equal(byPopulation['dk-asking'].every((l) => l.source === 'dba.dk'), true)
})

test('C2: DBA and Kleinanzeigen are never grouped together', () => {
  const { byPopulation } = groupByPopulation([dk(20000), de(2000), de(2500)])
  assert.equal(byPopulation['dk-asking'].length, 1)
  assert.equal(byPopulation['de-asking'].length, 2)
})

test('C2: Reverb asking and Reverb sold are distinct populations', () => {
  assert.equal(isConfirmedSales('reverb-sold'), true)
  assert.equal(isConfirmedSales('reverb-asking'), false)
  const sold = buildPopulationStats('reverb-sold', dkSeries(10).map((r) => ({ ...r, source: null, country: null })))
  const ask = buildPopulationStats('reverb-asking', dkSeries(10))
  assert.equal(sold.kind, 'sold')
  assert.equal(ask.kind, 'asking')
})

test('C2: only reverb-sold is confirmed sales', () => {
  const keys = ['dk-asking', 'de-asking', 'se-asking', 'no-asking', 'reverb-asking'] as const
  for (const k of keys) assert.equal(isConfirmedSales(k), false, `${k} must not claim sales`)
})

// ── C2: the Danish display ladder ───────────────────────────────────────────

test('C2 ladder: Danish n=0 shows nothing', () => {
  const s = buildPopulationStats('dk-asking', [])
  assert.equal(s.tier, 'none')
  assert.equal(s.median, null)
})

for (const n of [1, 2]) {
  test(`C2 ladder: Danish n=${n} shows listings only — no median, no band`, () => {
    const s = buildPopulationStats('dk-asking', dkSeries(n))
    assert.equal(s.tier, 'listings-only')
    assert.equal(s.median, null)
    assert.equal(s.q1, null)
    assert.equal(s.q3, null)
    assert.equal(s.nFiltered, n)
  })
}

for (const n of [3, 7]) {
  test(`C2 ladder: Danish n=${n} shows a descriptive median but no Q1–Q3`, () => {
    const s = buildPopulationStats('dk-asking', dkSeries(n))
    assert.equal(s.tier, 'median-only')
    assert.notEqual(s.median, null)
    assert.equal(s.q1, null)
    assert.equal(s.q3, null)
  })
}

test('C2 ladder: Danish n=8 unlocks the band', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(8))
  assert.equal(s.tier, 'band')
  assert.equal(s.nFiltered, MIN_BAND_N)
  assert.notEqual(s.median, null)
  assert.notEqual(s.q1, null)
  assert.notEqual(s.q3, null)
})

test('C2 ladder: a reference population is a band or nothing — no descriptive middle', () => {
  assert.equal(buildPopulationStats('reverb-asking', dkSeries(5)).tier, 'none')
  assert.equal(buildPopulationStats('reverb-sold', dkSeries(5)).tier, 'none')
  assert.equal(buildPopulationStats('reverb-asking', dkSeries(8)).tier, 'band')
})

// ── width guard ─────────────────────────────────────────────────────────────

test('width guard suppresses the range but keeps an otherwise valid median', () => {
  // Ten values spanning far more than 10x, spread so the IQR fences keep them.
  const wide = [500, 900, 1400, 2500, 4000, 9000, 20000, 40000, 60000, 90000]
  const s = buildPopulationStats('dk-asking', wide.map((p) => dk(p)))
  assert.equal(s.tier, 'band')
  assert.ok(s.widthRatio != null && s.widthRatio > MAX_BAND_WIDTH_RATIO, 'fixture must be too wide')
  assert.equal(s.widthOk, false)
  assert.notEqual(s.median, null, 'the median survives a failed width guard')
  assert.equal(s.q1, null, 'the range does not')
  assert.equal(s.q3, null)
})

// ── C3: currency behaviour ──────────────────────────────────────────────────

test('C3: a price of null is excluded as "not listed", not as a conversion failure', () => {
  const s = buildPopulationStats('dk-asking', [...dkSeries(8), { ...dk(0), price: null, price_dkk: null }])
  assert.equal(s.nRaw, 9)
  assert.equal(s.excluded.price_not_listed, 1)
  assert.equal(s.excluded.no_comparable_dkk, 0)
  assert.equal(s.nEligible, 8)
})

test('C3: a price with no stored price_dkk is fail-closed out of the statistics', () => {
  // Measured zero times in production today; the branch still has to hold.
  const s = buildPopulationStats('de-asking', [...dkSeries(8), { price: 250, price_dkk: null, source: 'kleinanzeigen', country: 'DE' }])
  assert.equal(s.nRaw, 9)
  assert.equal(s.excluded.no_comparable_dkk, 1)
  assert.equal(s.nEligible, 8)
})

test('C3: foreign populations are approximate, Danish is exact', () => {
  assert.equal(isApproximateDkk('dk-asking'), false)
  for (const k of ['de-asking', 'se-asking', 'no-asking', 'reverb-asking', 'reverb-sold'] as const) {
    assert.equal(isApproximateDkk(k), true, `${k} must be marked ca.`)
  }
})

// ── condition ───────────────────────────────────────────────────────────────

test('local asking with 100% null condition cannot produce a condition chart', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(10))
  assert.equal(s.conditionCoverage, 0)
  assert.equal(hasUsableConditionData(s), false)
})

test('Reverb populations do carry usable condition data', () => {
  const s = buildPopulationStats('reverb-asking', dkSeries(10).map((r) => ({ ...r, source: 'reverb', country: 'US', condition: 'Excellent' })))
  assert.equal(s.conditionCoverage, 1)
  assert.equal(hasUsableConditionData(s), true)
})

test('missing condition never removes a listing from the price statistics', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(8))
  assert.equal(s.nFiltered, 8, 'null condition rows still count toward the band')
})

// ── first_seen_at ───────────────────────────────────────────────────────────

test('null first_seen_at yields no age copy and never falls back to scraped_at', () => {
  assert.equal(firstSeenTimestamp({ first_seen_at: null, scraped_at: '2026-09-01T00:00:00Z' }), null)
  assert.equal(firstSeenTimestamp({ first_seen_at: '  ', scraped_at: '2026-09-01T00:00:00Z' }), null)
  assert.equal(firstSeenTimestamp({ first_seen_at: 'not-a-date' }), null)
  assert.equal(firstSeenTimestamp({ first_seen_at: '2026-07-01T10:00:00Z' }), '2026-07-01T10:00:00Z')
})

// ── verdict boundaries ──────────────────────────────────────────────────────

test('verdict boundaries are inclusive at exactly Q1 and Q3', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(9, 10000))
  assert.equal(s.tier, 'band')
  const { q1, q3 } = s
  assert.ok(q1 != null && q3 != null)
  assert.equal(verdictFor(q1 - 1, 'dk-asking', s).verdict, 'under')
  assert.equal(verdictFor(q1, 'dk-asking', s).verdict, 'typical', 'exactly Q1 is typical')
  assert.equal(verdictFor(q3, 'dk-asking', s).verdict, 'typical', 'exactly Q3 is typical')
  assert.equal(verdictFor(q3 + 1, 'dk-asking', s).verdict, 'over')
})

test('no verdict below n=8', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(7))
  const r = verdictFor(20000, 'dk-asking', s)
  assert.equal(r.verdict, null)
  assert.equal(r.reason, 'insufficient_n')
})

test('no verdict when the width guard fails', () => {
  const wide = [500, 900, 1400, 2500, 4000, 9000, 20000, 40000, 60000, 90000]
  const s = buildPopulationStats('dk-asking', wide.map((p) => dk(p)))
  const r = verdictFor(3000, 'dk-asking', s)
  assert.equal(r.verdict, null)
  assert.equal(r.reason, 'width_guard_failed')
})

test('a verdict is refused across populations', () => {
  const reverbBand = buildPopulationStats('reverb-asking', dkSeries(10, 30000))
  const r = verdictFor(20000, 'dk-asking', reverbBand)
  assert.equal(r.verdict, null)
  assert.equal(r.reason, 'population_mismatch')
  assert.equal(r.against, null)
})

test('a verdict names exactly one population', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(10))
  const r = verdictFor(20050, 'dk-asking', s)
  assert.equal(r.against, 'dk-asking')
  assert.equal(r.reason, 'ok')
})

test('no verdict without a comparable DKK price', () => {
  const s = buildPopulationStats('dk-asking', dkSeries(10))
  assert.equal(verdictFor(null, 'dk-asking', s).reason, 'no_comparable_price')
  assert.equal(verdictFor(0, 'dk-asking', s).reason, 'no_comparable_price')
})

// ── reconciliation ──────────────────────────────────────────────────────────

test('raw, eligible and filtered counts always reconcile', () => {
  const rows: PriceObservation[] = [
    ...dkSeries(8, 20000),
    dk(1_000_000),                                   // IQR outlier
    { ...dk(0), price: null, price_dkk: null },       // not listed
    { price: 500, price_dkk: null, source: 'dba.dk', country: 'DK' }, // no conversion
  ]
  const s = buildPopulationStats('dk-asking', rows)
  assert.equal(s.nRaw, 11)
  assert.equal(s.excluded.price_not_listed, 1)
  assert.equal(s.excluded.no_comparable_dkk, 1)
  assert.equal(s.nEligible, 9)
  assert.equal(s.nEligible, s.nFiltered + s.excluded.iqr_outlier)
  assert.equal(s.nRaw, s.nEligible + s.excluded.price_not_listed + s.excluded.no_comparable_dkk)
})

test('partitionByIqr never loses or invents an observation', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000]
  const { kept, excluded } = partitionByIqr(values)
  assert.equal(kept.length + excluded.length, values.length)
})

/* ── P2 review: exhaustive retrieval ─────────────────────────────────────────
   The route used to cap matched listings, so every price statistic was built
   from a score-ranked fragment. These lock the completeness contract. */

import { DEFAULT_PAGE_SIZE, fetchAllPages } from '../../frontend/lib/exhaustive-fetch'

type Row = { id: string; score: number; active: boolean }

const rowsOf = (n: number, opts: Partial<Row> = {}): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, score: 50, active: true, ...opts, }))

/** A source that pages correctly, counting the requests it served. */
function pagedSource(all: Row[]) {
  let calls = 0
  return {
    get calls() { return calls },
    fetch: async (from: number, to: number) => { calls += 1; return all.slice(from, to + 1) },
  }
}

test('retrieval: 750 eligible active matches — statistics see all 750', () => {
  const all = rowsOf(750)
  const src = pagedSource(all)
  return fetchAllPages(src.fetch, (r) => r.id, { pageSize: 100 }).then((res) => {
    assert.equal(res.rows.length, 750)
    assert.equal(res.truncated, false)
    assert.equal(res.pages, 8, '750/100 = 7 full pages + 1 short page')
  })
})

test('retrieval: 600 inactive high-score rows do not displace 80 active ones', async () => {
  // The old defect exactly: inactive rows sorted first and consumed the cap.
  const inactive = Array.from({ length: 600 }, (_, i) => ({ id: `x${i}`, score: 100, active: false }))
  const active = Array.from({ length: 80 }, (_, i) => ({ id: `a${i}`, score: 1, active: true }))
  const src = pagedSource([...inactive, ...active])
  const res = await fetchAllPages(src.fetch, (r) => r.id, { pageSize: 100 })
  assert.equal(res.rows.length, 680)
  assert.equal(res.rows.filter((r) => r.active).length, 80, 'every active row survives retrieval')
})

test('retrieval: the wall is capped while statistics see the whole population', async () => {
  const DISPLAY_LIMIT = 50
  const src = pagedSource(rowsOf(320))
  const res = await fetchAllPages(src.fetch, (r) => r.id, { pageSize: 100 })
  assert.equal(res.rows.length, 320, 'statistics')
  assert.equal(res.rows.slice(0, DISPLAY_LIMIT).length, DISPLAY_LIMIT, 'wall')
})

test('retrieval: identical scores at a page boundary lose nothing', async () => {
  // Every row shares a score; only the unique id makes the order stable.
  const all = Array.from({ length: 250 }, (_, i) => ({ id: `same${String(i).padStart(4, '0')}`, score: 70, active: true }))
  const src = pagedSource(all)
  const res = await fetchAllPages(src.fetch, (r) => r.id, { pageSize: 50 })
  assert.equal(res.rows.length, 250)
  assert.equal(new Set(res.rows.map((r) => r.id)).size, 250)
})

test('retrieval: an overlapping source yields no duplicates and no lost rows', async () => {
  // Simulates an unstable boundary: each page repeats its first row.
  const all = rowsOf(120)
  let calls = 0
  const fetch = async (from: number, to: number) => {
    calls += 1
    const page = all.slice(from, to + 1)
    return from > 0 ? [all[from - 1], ...page.slice(0, page.length - 1)] : page
  }
  const res = await fetchAllPages(fetch, (r) => r.id, { pageSize: 40 })
  assert.equal(new Set(res.rows.map((r) => r.id)).size, res.rows.length, 'no duplicates survive')
  assert.ok(res.duplicatesDropped > 0, 'the overlap was detected, not silently kept')
})

test('retrieval: an exactly-divisible total ends on an empty final page', async () => {
  const src = pagedSource(rowsOf(200))
  const res = await fetchAllPages(src.fetch, (r) => r.id, { pageSize: 100 })
  assert.equal(res.rows.length, 200)
  assert.equal(res.pages, 3, 'two full pages plus the empty page that proves exhaustion')
  assert.equal(res.truncated, false)
})

test('retrieval: raw/eligible/filtered still reconcile after pagination', async () => {
  const all: Row[] = rowsOf(130)
  const res = await fetchAllPages(pagedSource(all).fetch, (r) => r.id, { pageSize: 25 })
  const observations = res.rows.map((r, i) => ({
    price: i === 0 ? null : 20000 + i,
    price_dkk: i === 0 ? null : 20000 + i,
    source: 'dba.dk', country: 'DK', condition: null,
  }))
  const stats = buildPopulationStats('dk-asking', observations)
  assert.equal(stats.nRaw, 130)
  assert.equal(stats.nRaw, stats.nEligible + stats.excluded.price_not_listed + stats.excluded.no_comparable_dkk)
  assert.equal(stats.nEligible, stats.nFiltered + stats.excluded.iqr_outlier)
})

test('retrieval: the default page size covers the catalogue in one request', () => {
  // Widest canonical product is 156 matched rows (roland-juno-106, 2026-09-01).
  assert.ok(DEFAULT_PAGE_SIZE >= 1000)
})

test('eligibility: two non-eligible rows drop a Danish band to median-only', () => {
  // roland-juno-106 shape: 8 Danish rows of which 2 are not this product.
  const eligible = [11205, 12500, 15000, 18000, 18000, 15000]
  const stats = buildPopulationStats('dk-asking', eligible.map((p) => ({
    price: p, price_dkk: p, source: 'dba.dk', country: 'DK', condition: null,
  })))
  assert.equal(stats.nFiltered, 6)
  assert.equal(stats.tier, 'median-only', 'six is below the band gate')
  assert.notEqual(stats.median, null)
  assert.equal(stats.q1, null, 'no Q1-Q3 below n=8')
  assert.equal(stats.q3, null)
  assert.equal(verdictFor(15000, 'dk-asking', stats).verdict, null, 'no verdict below n=8')
  assert.equal(verdictFor(15000, 'dk-asking', stats).reason, 'insufficient_n')
})

/* ── P2 review: chart semantics ──────────────────────────────────────────────
   Individual sales are observations, not a continuous series. The chart must
   stay a scatter on a numeric time axis; it must never regress to the
   category-indexed AreaChart it replaced. Structural, because the failure is
   invisible in output — a category axis renders a plausible-looking curve. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PRODUCT_PAGE = join(__dirname, '..', '..', 'frontend', 'app', 'product', '[slug]', 'page.tsx')

test('chart: sales are drawn as unconnected observations', () => {
  const src = codeOf(PRODUCT_PAGE)
  assert.ok(src.includes('<ScatterChart'), 'must be a ScatterChart')
  assert.ok(src.includes('<Scatter'), 'points, not a path')
  assert.equal(src.includes('<AreaChart'), false, 'AreaChart connects observations')
  assert.equal(src.includes('<LineChart'), false, 'LineChart connects observations')
  assert.equal(src.includes('<Area'), false)
  assert.equal(src.includes('<Line'), false)
  assert.equal(src.includes('type="monotone"'), false, 'monotone interpolation implies a trend line')
})

/** Code only. The explanatory comments legitimately quote the banned pattern. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('chart: the x-axis is a real time domain, not a category index', () => {
  const code = codeOf(PRODUCT_PAGE)
  // The original defect: an XAxis bound to `sold_at` with no `type`, which
  // Recharts silently treats as a CATEGORY scale — plotting sale index, not time.
  assert.equal(code.includes('dataKey="sold_at"'), false, 'sold_at as a category key was the bug')
  assert.ok(code.includes('scale="time"'), 'time scale')
  assert.ok(/type="number"[\s\S]{0,200}dataKey="ts"/.test(code), 'numeric x-axis bound to a timestamp')
})

test('chart: both axes are visible and the y-axis is in kroner', () => {
  const src = codeOf(PRODUCT_PAGE)
  assert.equal(/<XAxis[^>]*\shide\b/.test(src), false, 'x-axis must not be hidden')
  assert.equal(/<YAxis[^>]*\shide\b/.test(src), false, 'y-axis must not be hidden')
  assert.ok(src.includes('chartAxisPriceDkk'), 'kroner axis label comes from i18n')
})

test('chart: the tooltip carries date, price and condition', () => {
  const src = readFileSync(PRODUCT_PAGE, 'utf8')
  assert.ok(src.includes('labelFormatter'), 'date')
  assert.ok(src.includes('formatDkkAmount'), 'price')
  assert.ok(src.includes('conditionUnknown'), 'null condition is named, not dropped')
})

test('copy: Danish public copy does not use the word "outliers"', async () => {
  const { translations } = await import('../../frontend/lib/i18n')
  const da = JSON.stringify(translations.da)
  assert.equal(/outlier/i.test(da), false, 'use "afvigende priser" in Danish public copy')
})

test('retrieval: a missing de-dup key fails loudly instead of collapsing a population', async () => {
  // Regression: rows without `id` made every key identical, so 63 rows were
  // de-duplicated down to 1 and reported as a complete population.
  const rows = Array.from({ length: 63 }, () => ({ score: 100 }))
  await assert.rejects(
    () => fetchAllPages(async () => rows as never, (r: never) => (r as { id?: string }).id as string, { pageSize: 1000 }),
    /no usable key/,
  )
})

/* ── P2 review: two eligibility contracts + fail-closed truncation ───────────
   Wall keeps `is_valid IS NOT FALSE`; statistics require `is_valid = true`.
   A truncated read produces no statistics at all. */

test('truncation: reaching MAX_PAGES reports truncated', async () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }))
  // A source that never runs out: every page comes back full.
  let n = 0
  const res = await fetchAllPages(
    async () => full.map((_, i) => ({ id: `row-${n++}-${i}` })),
    (r) => r.id,
    { pageSize: 10, maxPages: 3 },
  )
  assert.equal(res.truncated, true)
  assert.equal(res.pages, 3)
})

test('truncation: an incomplete asking population produces no statistics', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    price: 20000 + i * 100, price_dkk: 20000 + i * 100,
    source: 'dba.dk', country: 'DK', condition: null,
  }))
  const complete = buildPopulationStats('dk-asking', rows)
  const partial = buildPopulationStats('dk-asking', rows, { incomplete: true })
  assert.equal(complete.tier, 'band', 'control: this data would otherwise be a band')
  assert.equal(partial.tier, 'unavailable')
  assert.equal(partial.median, null)
  assert.equal(partial.q1, null)
  assert.equal(partial.q3, null)
  assert.equal(partial.complete, false)
})

test('truncation: an incomplete sold population produces no statistics or chart', () => {
  const sold = Array.from({ length: 30 }, (_, i) => ({
    price: 20000 + i * 50, price_dkk: 20000 + i * 50,
    source: 'reverb', country: null, condition: 'Excellent',
  }))
  const partial = buildPopulationStats('reverb-sold', sold, { incomplete: true })
  assert.equal(partial.tier, 'unavailable')
  assert.equal(partial.median, null)
  // The chart gate is `tier === 'band'`, so an unavailable population cannot draw.
  assert.notEqual(partial.tier, 'band')
})

test('truncation: a partial population never reports a plausible n', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    price: 1000 + i, price_dkk: 1000 + i, source: 'dba.dk', country: 'DK', condition: null,
  }))
  const partial = buildPopulationStats('dk-asking', rows, { incomplete: true })
  assert.equal(partial.nRaw, 0, 'a fragment count reads exactly like a real one')
  assert.equal(partial.nEligible, 0)
  assert.equal(partial.nFiltered, 0)
})

test('truncation: normal pagination is unchanged by the guard', async () => {
  const all = Array.from({ length: 130 }, (_, i) => ({ id: `n${i}` }))
  const res = await fetchAllPages(
    async (from, to) => all.slice(from, to + 1), (r) => r.id, { pageSize: 50, maxPages: 500 },
  )
  assert.equal(res.truncated, false)
  assert.equal(res.rows.length, 130)
})

test('truncation: no verdict from an incomplete population', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    price: 20000 + i * 100, price_dkk: 20000 + i * 100,
    source: 'dba.dk', country: 'DK', condition: null,
  }))
  const partial = buildPopulationStats('dk-asking', rows, { incomplete: true })
  const r = verdictFor(21000, 'dk-asking', partial)
  assert.equal(r.verdict, null)
  assert.equal(r.reason, 'insufficient_n')
})

test('eligibility: unreviewed matches are excluded from statistics but stay on the wall', () => {
  // The route splits by `is_valid`; this asserts the consequence for the stats.
  const verified = [11205, 12500, 15000, 18000, 18000]
  const unreviewed = [142, 257, 289, 618, 957]   // DX7-shaped: manuals, ROM cartridges
  const wallN = verified.length + unreviewed.length

  const stats = buildPopulationStats('dk-asking', verified.map((p) => ({
    price: p, price_dkk: p, source: 'dba.dk', country: 'DK', condition: null,
  })))
  assert.equal(stats.nFiltered, 5, 'statistics see only the verified rows')
  assert.equal(wallN, 10, 'the wall still shows all ten')
  assert.equal(stats.tier, 'median-only')
  assert.equal(stats.q1, null)
  assert.equal(verdictFor(12500, 'dk-asking', stats).verdict, null)
})

/* ── P2 final: the deal signal on the card ───────────────────────────────────
   Verdict is computed server-side against the listing's OWN population and is
   only ever a position inside one asking distribution. */

import { verdictBasisLabelKey } from '../../frontend/lib/price-populations'

/** Nine tightly-spread Danish rows: a real band with usable quartiles. */
const dkBand = buildPopulationStats('dk-asking', [
  10000, 10500, 11000, 11500, 12000, 12500, 13000, 13500, 14000,
].map((p) => ({ price: p, price_dkk: p, source: 'dba.dk', country: 'DK', condition: null })))

test('verdict 1: a reviewed Danish listing under Q1 is Under typisk', () => {
  assert.equal(dkBand.tier, 'band')
  assert.equal(verdictFor(dkBand.q1! - 1, 'dk-asking', dkBand).verdict, 'under')
})

test('verdict 2: exactly Q1 is Typisk', () => {
  assert.equal(verdictFor(dkBand.q1!, 'dk-asking', dkBand).verdict, 'typical')
})

test('verdict 3: exactly Q3 is Typisk', () => {
  assert.equal(verdictFor(dkBand.q3!, 'dk-asking', dkBand).verdict, 'typical')
})

test('verdict 4: above Q3 is Over typisk', () => {
  assert.equal(verdictFor(dkBand.q3! + 1, 'dk-asking', dkBand).verdict, 'over')
})

test('verdict 5: a Reverb asking listing is measured only against Reverb asking', () => {
  const rvbBand = buildPopulationStats('reverb-asking', [
    20000, 21000, 22000, 23000, 24000, 25000, 26000, 27000, 28000,
  ].map((p) => ({ price: p, price_dkk: p, source: 'reverb', country: 'US', condition: 'Excellent' })))
  assert.equal(verdictFor(21000, 'reverb-asking', rvbBand).against, 'reverb-asking')
  // The same price against the Danish band is refused, not silently answered.
  assert.equal(verdictFor(21000, 'reverb-asking', dkBand).reason, 'population_mismatch')
})

test('verdict 6: a German listing is measured only against German asking', () => {
  const deBand = buildPopulationStats('de-asking', [
    9000, 9500, 10000, 10500, 11000, 11500, 12000, 12500, 13000,
  ].map((p) => ({ price: p, price_dkk: p, source: 'kleinanzeigen', country: 'DE', condition: null })))
  assert.equal(verdictFor(10000, 'de-asking', deBand).against, 'de-asking')
  assert.equal(verdictFor(10000, 'de-asking', dkBand).verdict, null)
})

test('verdict 7: Reverb asking never uses the Reverb sold band', () => {
  const soldBand = buildPopulationStats('reverb-sold', [
    30000, 31000, 32000, 33000, 34000, 35000, 36000, 37000, 38000,
  ].map((p) => ({ price: p, price_dkk: p, source: 'reverb', country: null, condition: 'Mint' })))
  assert.equal(soldBand.tier, 'band')
  const r = verdictFor(31000, 'reverb-asking', soldBand)
  assert.equal(r.verdict, null)
  assert.equal(r.reason, 'population_mismatch')
  // And no listing can ever classify INTO the sold population.
  assert.notEqual(classifyListing({ source: 'reverb', country: 'US' }).population, 'reverb-sold')
})

test('verdict 8: an unreviewed listing gets no verdict', () => {
  // The route only classifies rows whose id is in the reviewed set; an
  // unreviewed row yields a null population, which verdictFor refuses.
  const r = verdictFor(12000, null, dkBand)
  assert.equal(r.verdict, null)
  assert.equal(r.reason, 'population_mismatch')
})

test('verdict 9: a rejected listing gets no verdict', () => {
  // `is_valid = false` never reaches the statistics population at all.
  assert.equal(verdictFor(12000, null, dkBand).verdict, null)
})

test('verdict 10: a missing price_dkk gets no verdict', () => {
  assert.equal(verdictFor(null, 'dk-asking', dkBand).reason, 'no_comparable_price')
  assert.equal(verdictFor(undefined, 'dk-asking', dkBand).reason, 'no_comparable_price')
})

test('verdict 11: a median-only population gives no verdict', () => {
  const thin = buildPopulationStats('dk-asking', [10000, 11000, 12000, 13000, 14000]
    .map((p) => ({ price: p, price_dkk: p, source: 'dba.dk', country: 'DK', condition: null })))
  assert.equal(thin.tier, 'median-only')
  assert.equal(verdictFor(11000, 'dk-asking', thin).reason, 'insufficient_n')
})

test('verdict 12: a too-wide population gives no verdict', () => {
  const wide = buildPopulationStats('dk-asking', [500, 900, 1400, 2500, 4000, 9000, 20000, 40000, 60000, 90000]
    .map((p) => ({ price: p, price_dkk: p, source: 'dba.dk', country: 'DK', condition: null })))
  assert.equal(wide.widthOk, false)
  assert.equal(verdictFor(3000, 'dk-asking', wide).reason, 'width_guard_failed')
})

test('verdict 13: a truncated population gives no verdict', () => {
  const partial = buildPopulationStats('dk-asking', [
    10000, 10500, 11000, 11500, 12000, 12500, 13000, 13500, 14000,
  ].map((p) => ({ price: p, price_dkk: p, source: 'dba.dk', country: 'DK', condition: null })), { incomplete: true })
  assert.equal(partial.tier, 'unavailable')
  assert.equal(verdictFor(12000, 'dk-asking', partial).verdict, null)
})

test('verdict 14: a population mismatch gives no verdict', () => {
  assert.equal(verdictFor(12000, 'se-asking', dkBand).reason, 'population_mismatch')
})

test('verdict 18: the basis label names the correct asking population', () => {
  assert.equal(verdictBasisLabelKey('dk-asking'), 'verdictBasisDk')
  assert.equal(verdictBasisLabelKey('de-asking'), 'verdictBasisDe')
  assert.equal(verdictBasisLabelKey('se-asking'), 'verdictBasisSe')
  assert.equal(verdictBasisLabelKey('no-asking'), 'verdictBasisNo')
  assert.equal(verdictBasisLabelKey('reverb-asking'), 'verdictBasisReverbAsking')
  assert.equal(verdictBasisLabelKey('reverb-sold'), null, 'sold can never be a verdict basis')
  assert.equal(verdictBasisLabelKey(null), null)
})

/* ── card rendering + public copy ─────────────────────────────────────────── */

const CARD = join(__dirname, '..', '..', 'frontend', 'components', 'SearchResultCard.tsx')

test('verdict 15/16: the card renders a badge for each verdict and nothing for null', () => {
  const code = codeOf(CARD)
  assert.ok(code.includes('MarketVerdictBadge'), 'the badge component exists')
  assert.ok(code.includes('t.verdictUnder') && code.includes('t.verdictTypical') && code.includes('t.verdictOver'),
    'all three labels are rendered from i18n')
  assert.ok(/if \(!verdict\) return null/.test(code), 'no badge, and no placeholder gap, without a verdict')
  // Rendered in both card variants.
  assert.equal((code.match(/<MarketVerdictBadge/g) ?? []).length, 2)
  assert.equal(code.includes('KUP-RATING'), false, 'the dead placeholder is gone')
})

test('verdict 15c: the badge itself introduces no transition-all', () => {
  // P2 left four `transition-all` sites in this file — the pre-existing
  // email-capture UI and the action buttons — and recorded that their removal
  // belonged to P3. P3 has since replaced all four with named transition
  // properties, so the expected count is now zero rather than four.
  const code = codeOf(CARD)
  const badge = code.slice(code.indexOf('function MarketVerdictBadge'), code.indexOf('export function SearchResultCard'))
  assert.equal(badge.includes('transition-all'), false)
  assert.equal((code.match(/transition-all/g) ?? []).length, 0, 'P3 removed the last four')
})

test('verdict 15b: the badge is never colour alone and carries its basis', () => {
  const code = codeOf(CARD)
  assert.ok(code.includes('aria-label'), 'accessible label')
  assert.ok(code.includes('title={basis'), 'basis is reachable on hover')
})

test('verdict 17: public copy says gennemgået/reviewed, never verificeret/verified', async () => {
  const { translations } = await import('../../frontend/lib/i18n')
  const da = JSON.stringify(translations.da)
  const en = JSON.stringify(translations.en)
  assert.equal(/verificer/i.test(da), false, 'Danish must say "gennemgået"')
  assert.equal(/verified/i.test(en), false, 'English must say "reviewed"')
  assert.ok(/gennemgået|gennemgåede/.test(da))
  assert.ok(/reviewed/.test(en))
})

test('verdict labels are never rebranded as a buy recommendation', async () => {
  const { translations } = await import('../../frontend/lib/i18n')
  for (const loc of ['da', 'en'] as const) {
    const v = translations[loc]
    for (const key of ['verdictUnder', 'verdictTypical', 'verdictOver'] as const) {
      assert.equal(/kup|god handel|dårlig handel|billig|dyr|bargain|cheap|expensive/i.test(v[key]), false,
        `${loc}.${key} must describe position, not a recommendation`)
    }
  }
})
