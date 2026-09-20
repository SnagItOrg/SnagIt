/**
 * PAN-93 — price evidence counts adjudicated matches only.
 *
 * `listing_product_match.is_valid` is three-valued and the two questions it is
 * asked are NOT the same question:
 *
 *   DISPLAY     is_valid IS NOT FALSE   — a place to look
 *   EVIDENCE    isPriceEvidence()       — a claim about the market
 *
 * The public route already drew that line; /intel did not, and drew none at
 * all. These tests pin the predicate itself, pin that both surfaces reach it
 * rather than re-implementing it, and pin the render state the split creates:
 * a product that is monitored but not yet priced.
 *
 * Deliberately NOT tested here: `isMatchableProduct` and `isCanonical`. What
 * may be matched and what may be published are separate axes from what may be
 * priced (CLAUDE.md §5), and this ticket moved none of them.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  MIN_BAND_N,
  buildPopulationStats,
  groupByPopulation,
  isPriceEvidence,
  type PriceObservation,
} from '../../frontend/lib/price-populations'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const codeOf = (...seg: string[]) => readFileSync(join(FRONTEND, ...seg), 'utf8')
/** Comments state intent; only executable text may satisfy these assertions. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const dk = (price: number): PriceObservation =>
  ({ price, price_dkk: price, source: 'dba.dk', country: 'DK', condition: null })

/** One match row, as the product route sees it before it splits them. */
type MatchRow = { is_valid: boolean | null; listing: PriceObservation }

/**
 * The route's two lines, and nothing else: rejections never arrive (the query
 * filters them), the wall is what remains, evidence is what `isPriceEvidence`
 * admits. Stated here so a test can vary `is_valid` without a Supabase client.
 */
const split = (rows: readonly MatchRow[]) => {
  const wall = rows.filter((r) => r.is_valid !== false).map((r) => r.listing)
  const evidence = rows.filter((r) => isPriceEvidence(r.is_valid)).map((r) => r.listing)
  return { wall, evidence }
}

const dkStats = (rows: readonly PriceObservation[]) =>
  buildPopulationStats('dk-asking', groupByPopulation(rows).byPopulation['dk-asking'])

/* ── 1. an unreviewed match cannot move a median ───────────────────────────── */

test('PAN-93/1: unreviewed matches are shown, never counted', () => {
  // Eight adjudicated Danish listings around 20,000 — exactly the band gate.
  const approved: MatchRow[] = Array.from({ length: MIN_BAND_N }, (_, i) => ({
    is_valid: true,
    listing: dk(20000 + i * 100),
  }))
  const baseline = dkStats(split(approved).evidence)
  assert.equal(baseline.tier, 'band')
  assert.equal(baseline.nFiltered, MIN_BAND_N)
  assert.ok(baseline.median != null)

  // Now bury them under a hundred unreviewed rows an order of magnitude below —
  // the shape of the ten public guitars: hundreds of automatic matches, none
  // adjudicated. A NULL row that counted would drag the median to ~700.
  const flooded = [
    ...approved,
    ...Array.from({ length: 100 }, (_, i) => ({ is_valid: null, listing: dk(600 + i) })),
  ]
  const after = dkStats(split(flooded).evidence)

  assert.deepEqual(
    { median: after.median, q1: after.q1, q3: after.q3, n: after.nFiltered },
    { median: baseline.median, q1: baseline.q1, q3: baseline.q3, n: baseline.nFiltered },
    'an unreviewed match must not move any published statistic',
  )
  // ...and it is still on the wall. This ticket separates two concerns; it
  // does not hide listings.
  assert.equal(split(flooded).wall.length, MIN_BAND_N + 100)

  // The inverse: with NOTHING adjudicated there is no band and no median at
  // all, while every listing still shows.
  const unreviewedOnly = flooded.filter((r) => r.is_valid === null)
  const none = dkStats(split(unreviewedOnly).evidence)
  assert.equal(none.tier, 'none')
  assert.equal(none.median, null)
  assert.equal(none.q1, null)
  assert.equal(none.nFiltered, 0)
  assert.equal(split(unreviewedOnly).wall.length, 100)
})

/* ── 2. a rejected match contributes nowhere ───────────────────────────────── */

test('PAN-93/2: a rejected match reaches neither the wall nor the evidence', () => {
  // The predicate is exact-match and fail-closed, like isCanonical: only `true`.
  assert.equal(isPriceEvidence(true), true)
  assert.equal(isPriceEvidence(null), false)
  assert.equal(isPriceEvidence(false), false)
  assert.equal(isPriceEvidence(undefined), false)

  const rows: MatchRow[] = [
    ...Array.from({ length: MIN_BAND_N }, (_, i) => ({
      is_valid: true as boolean | null,
      listing: dk(20000 + i * 100),
    })),
    { is_valid: false, listing: dk(150) },      // a slider cap
    { is_valid: false, listing: dk(400000) },   // a two-instrument bundle
  ]
  const { wall, evidence } = split(rows)

  assert.equal(wall.length, MIN_BAND_N, 'a rejection is not shown')
  assert.equal(evidence.length, MIN_BAND_N, 'a rejection is not counted')
  const stats = dkStats(evidence)
  assert.ok(stats.low != null && stats.low >= 20000)
  assert.ok(stats.high != null && stats.high <= 20700)

  // Both surfaces must reach the shared predicate rather than restate it.
  const route = strip(codeOf('app', 'api', 'product', '[slug]', 'route.ts'))
  assert.ok(route.includes("not('is_valid', 'is', false)"), 'rejections stay off the wall')
  assert.ok(route.includes('isPriceEvidence(m.is_valid)'), 'statistics use the predicate')
  assert.equal(/is_valid\s*===\s*true/.test(route), false, 'no inline copy of the predicate')

  const intel = strip(codeOf('app', 'intel', 'page.tsx'))
  assert.ok(intel.includes('isPriceEvidence(m.is_valid)'), '/intel uses the same predicate')
  assert.ok(intel.includes("'product_id, is_valid,"), '/intel must read the column it filters on')
  assert.equal(/is_valid\s*===\s*true/.test(intel), false, 'no second copy on /intel')
})

/* ── 3. monitored, not yet priced ──────────────────────────────────────────── */

test('PAN-93/3: an unadjudicated product renders as monitored, not as zero', async () => {
  const { translations } = await import('../../frontend/lib/i18n')

  // The copy exists in both locales — frontend/CLAUDE.md, and it is distinct
  // from the genuinely-empty message it replaces.
  for (const locale of ['da', 'en'] as const) {
    const t = translations[locale]
    assert.ok(t.dkMarketAwaitingReview, `${locale} carries the awaiting-review copy`)
    assert.notEqual(t.dkMarketAwaitingReview, t.dkMarketNone)
  }

  // The component chooses between them on the count of unreviewed Danish wall
  // rows, and only inside the empty-population branch: a product with a real
  // median must never be relabelled as unreviewed.
  const block = strip(codeOf('components', 'PriceAnswer.tsx'))
  assert.ok(
    block.includes('awaitingReview > 0 ? t.dkMarketAwaitingReview : t.dkMarketNone'),
    'the none branch distinguishes "nothing" from "nothing reviewed yet"',
  )
  const noneBranch = block.indexOf("stats.tier === 'none'")
  assert.ok(noneBranch !== -1)
  assert.ok(
    block.indexOf('t.dkMarketAwaitingReview') > noneBranch,
    'the awaiting-review copy belongs to the none branch alone',
  )
  assert.equal(
    block.slice(block.indexOf("tier === 'band'")).includes('awaitingReview'),
    false,
    'a banded population is never qualified by unreviewed rows',
  )

  // The signal is computed server-side from the UNVERIFIED half of the wall,
  // and reaches the component. A client-side count would be capped by
  // DISPLAY_LISTING_LIMIT and could not be trusted.
  const route = strip(codeOf('app', 'api', 'product', '[slug]', 'route.ts'))
  assert.ok(
    route.includes('allMatched.filter((m) => !m.isVerified)'),
    'awaitingReview is derived from the unadjudicated wall rows',
  )
  assert.ok(route.includes('awaitingReview,'), 'the route ships it')

  const page = strip(codeOf('app', 'product', '[slug]', 'page.tsx'))
  assert.ok(page.includes('setAwaitingReview(data.awaitingReview ?? 0)'), 'the page reads it')
  assert.ok(page.includes('awaitingReview={awaitingReview}'), 'the page passes it')
})
