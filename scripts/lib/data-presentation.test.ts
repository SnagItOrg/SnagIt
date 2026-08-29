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
