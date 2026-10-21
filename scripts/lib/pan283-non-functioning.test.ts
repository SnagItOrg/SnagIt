/**
 * scripts/lib/pan283-non-functioning.test.ts
 *
 * PAN-283, owner decision 2026-10-21: a listing whose Reverb condition is
 * "Non Functioning" may still be shown, with its condition, but it never
 * counts toward any price statistic and gets no under / typisk / over verdict.
 *
 * Fixtures are production rows as read on 2026-10-21 (SELECT over the valid,
 * active matches): the Shure SM57, the Roland TR-909 and the Sequential
 * Circuits Prophet 600, each with its Non Functioning Reverb rows flagged.
 *
 * Run: npx tsx --test scripts/lib/pan283-non-functioning.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildPopulationStats,
  isNonFunctioning,
  listingVerdict,
  NON_FUNCTIONING_CONDITION,
  type PriceObservation,
} from '../../frontend/lib/price-populations'
import { cardVerdictsByProduct } from '../../frontend/lib/listing-verdicts'
import { classify } from '../../frontend/lib/price-check'

type Row = PriceObservation & { condition: string | null }

/** `195N` is a Non Functioning row at 195 kr; every other condition is a working unit. */
const reverb = (spec: string): Row[] =>
  spec.split(',').map((token) => {
    const nf = token.endsWith('N')
    return {
      price: Number(nf ? token.slice(0, -1) : token),
      price_dkk: Number(nf ? token.slice(0, -1) : token),
      source: 'reverb',
      country: null,
      condition: nf ? 'Non Functioning' : 'Excellent',
    }
  })

// Shure SM57 — 54 valid active Reverb rows, three of them Non Functioning at 195 / 253 / 267 kr.
const SM57 = reverb('195N,253N,267N,345,566,566,586,593,594,600,617,633,660,666,688,688,693,694,700,726,726,726,726,726,726,726,726,726,726,726,726,726,732,733,733,737,737,737,741,768,779,793,800,800,827,836,842,930,970,993,993,1023,1134,2626')
// Roland TR-909 — 23 valid active Reverb rows, one "BAD SHAPE For Parts" at 16,462 kr.
const TR909 = reverb('16462N,27216,29325,31991,32880,39302,41322,42611,43321,43321,43654,45340,46620,46647,46940,47315,49979,49986,53948,56923,58317,60532,62509')
// Sequential Circuits Prophet 600 — 11 valid active Reverb rows, one Non Functioning at 15,559 kr, INSIDE the band.
const P600 = reverb('7331,8658,12097,12297,12630,12901,13028,14855,15559N,16662,17905')

const working = (rows: Row[]) => rows.filter((r) => !isNonFunctioning(r.condition))

test('the predicate matches Reverb\'s display_name exactly, case-insensitively, and nothing else', () => {
  assert.equal(NON_FUNCTIONING_CONDITION, 'non functioning')
  assert.equal(isNonFunctioning('Non Functioning'), true)
  assert.equal(isNonFunctioning('non functioning'), true)
  assert.equal(isNonFunctioning('  NON FUNCTIONING '), true)
  // Working units, Reverb's other eight values and the local sources' null all stay in.
  for (const kept of ['Brand New', 'Mint', 'Excellent', 'Very Good', 'Good', 'Fair', 'Poor', 'B-Stock', '', null, undefined]) {
    assert.equal(isNonFunctioning(kept), false, String(kept))
  }
  // The hyphenated title phrase the matcher knows is not this predicate's business.
  assert.equal(isNonFunctioning('non-functioning'), false)
})

test('SM57: the three broken microphones leave the Reverb band and are counted, like the outliers', () => {
  const after = buildPopulationStats('reverb-asking', SM57)
  const before = buildPopulationStats('reverb-asking', SM57.map((r) => ({ ...r, condition: 'Excellent' })))

  assert.equal(after.excluded.non_functioning, 3)
  assert.equal(before.excluded.non_functioning, 0)
  assert.equal(after.nRaw, 54)
  // Counted before the price is read, so the counts still reconcile.
  assert.equal(after.nRaw, after.nEligible + after.excluded.non_functioning + after.excluded.price_not_listed + after.excluded.no_comparable_dkk)
  assert.equal(after.nEligible, after.nFiltered + after.excluded.iqr_outlier)
  // Same numbers as building the band from the working units alone.
  const workingOnly = buildPopulationStats('reverb-asking', working(SM57))
  assert.deepEqual(
    [after.nFiltered, after.median, after.q1, after.q3, after.low, after.high],
    [workingOnly.nFiltered, workingOnly.median, workingOnly.q1, workingOnly.q3, workingOnly.low, workingOnly.high],
  )
  // The three were already Tukey outliers, so the median and Q1–Q3 hold
  // (726 / 688–737); what moves is the fence they had stretched: 10 outliers
  // become 8 and the top of the band comes down from 930 to 842 kr.
  assert.equal(before.excluded.iqr_outlier, 10)
  assert.equal(after.excluded.iqr_outlier, 8)
  assert.equal(after.median, 726)
  assert.deepEqual([before.high, after.high], [930, 842])
})

test('Prophet 600: a broken unit inside the band held the band itself; TR-909: one below it moves Q1', () => {
  // Before: 10 of 11 rows survive the fences — a band, median 12,964.50.
  // After: the 15,559 kr broken unit leaves, the fences tighten and three more
  // rows fall out: n = 7, 'median-only', median 12,901. The band is gone,
  // honestly — it rested on a unit sold for parts.
  const p600Before = buildPopulationStats('reverb-asking', P600.map((r) => ({ ...r, condition: 'Excellent' })))
  const p600After = buildPopulationStats('reverb-asking', P600)
  assert.equal(p600After.excluded.non_functioning, 1)
  assert.deepEqual([p600Before.tier, p600Before.nFiltered, p600Before.median], ['band', 10, 12964.5])
  assert.deepEqual([p600After.tier, p600After.nFiltered, p600After.median, p600After.q1], ['median-only', 7, 12901, null])

  // Before: 22 of 23, Q1 41,644.25. After: 20, Q1 42,288.75 — the 16,462 kr
  // "BAD SHAPE For Parts" row and the fence it had pulled down are gone.
  const trBefore = buildPopulationStats('reverb-asking', TR909.map((r) => ({ ...r, condition: 'Excellent' })))
  const trAfter = buildPopulationStats('reverb-asking', TR909)
  assert.equal(trAfter.excluded.non_functioning, 1)
  assert.deepEqual([trBefore.nFiltered, trBefore.q1, trBefore.low], [22, 41644.25, 27216])
  assert.deepEqual([trAfter.nFiltered, trAfter.q1, trAfter.low], [20, 42288.75, 29325])
  assert.equal(trAfter.median, trBefore.median)
})

test('a Non Functioning listing gets no verdict: on its own band, and on the Reverb band a thin market borrows', () => {
  const sm57Band = buildPopulationStats('reverb-asking', SM57)
  const broken = { source: 'reverb', country: null, price_dkk: 195, condition: 'Non Functioning' }
  const outcome = listingVerdict(broken, true, { 'reverb-asking': sm57Band })
  assert.equal(outcome.verdict, null)
  assert.equal(outcome.reason, 'non_functioning')
  assert.equal(outcome.basisLabelKey, null)
  // The same price on a working unit would read "under".
  assert.equal(listingVerdict({ ...broken, condition: 'Fair' }, true, { 'reverb-asking': sm57Band }).verdict, 'under')
  // Unreviewed too (PAN-268 A badges every wall listing): still nothing.
  assert.equal(listingVerdict(broken, null, { 'reverb-asking': sm57Band }).reason, 'non_functioning')

  // PAN-268 C: a local listing with no band of its own borrows Reverb's — not when it is broken.
  const dkThin = buildPopulationStats('dk-asking', [{ price: 550, price_dkk: 550, source: 'dba.dk', country: 'DK', condition: null }])
  const borrowed = listingVerdict({ source: 'dba.dk', country: 'DK', price_dkk: 300, condition: 'Non Functioning' }, null, { 'dk-asking': dkThin, 'reverb-asking': sm57Band })
  assert.equal(borrowed.verdict, null)
  assert.equal(borrowed.reason, 'non_functioning')
})

test('the family card (PAN-272) and tjek-prisen (PAN-207) go through the same functions, so they agree', () => {
  const rows = SM57.map((r, i) => ({
    product_id: 'sm57',
    is_valid: true as const,
    listings: { id: `l${i}`, title: 'Shure SM57', price: r.price, currency: 'DKK', url: `https://reverb.com/item/${i}`, image_url: null, location: null, scraped_at: '2026-10-20T02:00:00Z', source: 'reverb', country: null, price_dkk: r.price_dkk, platform: null, condition: r.condition, is_active: true, first_seen_at: null, last_seen_at: null },
  }))
  const verdicts = cardVerdictsByProduct(rows).get('sm57')!
  // The 195 / 253 / 267 kr rows (l0–l2) are absent; a 345 kr working unit is "under".
  assert.equal(verdicts.has('l0'), false)
  assert.equal(verdicts.has('l1'), false)
  assert.equal(verdicts.has('l2'), false)
  assert.equal(verdicts.get('l3')?.verdict, 'under')

  // tjek-prisen measures a pasted DBA ad against populations that no longer hold the broken units.
  const populations = { 'reverb-asking': buildPopulationStats('reverb-asking', SM57), 'dk-asking': buildPopulationStats('dk-asking', []) }
  const check = classify({ source: 'dba', cause: null, matched: true, priceDkk: 300, populations: populations as never, dkAskingPrices: [] })
  assert.equal(check.state, 'verdict')
  assert.equal(check.verdict, 'under')
})

test('sold: a Non Functioning sale leaves reverb-sold the same way', () => {
  const sold: Row[] = reverb('4000N,9000,9500,10000,10400,10600,11000,11500,12000').map((r) => ({ ...r, source: 'reverb' }))
  const s = buildPopulationStats('reverb-sold', sold)
  assert.equal(s.excluded.non_functioning, 1)
  assert.equal(s.nFiltered, 8)
  assert.equal(s.tier, 'band')
  assert.equal(s.low, 9000)
})

test('every stats path reads the one predicate, and the wall keeps the row', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8')
  for (const file of [
    'frontend/app/api/product/[slug]/route.ts',
    'frontend/app/(shell)/product/[slug]/page.tsx',
    'frontend/app/intel/page.tsx',
    'frontend/components/SearchResultCard.tsx',
    'scripts/qualify-matches-dry-run.ts',
  ]) {
    assert.match(read(file), /\bisNonFunctioning\b/, `${file} applies the predicate`)
  }
  // The wall population is untouched: a Non Functioning listing is still shown.
  assert.doesNotMatch(read('frontend/lib/listing-verdicts.ts'), /isNonFunctioning/)
  // The card says why there is no verdict, through copy that exists in both locales.
  assert.match(read('frontend/components/SearchResultCard.tsx'), /t\.conditionNonFunctioning/)
  const i18n = read('frontend/lib/i18n.ts')
  assert.match(i18n, /conditionNonFunctioning: 'Defekt'/)
  assert.match(i18n, /conditionNonFunctioning: 'Non-functioning'/)
  // The audit line the route reports beside the other exclusions.
  assert.match(read('frontend/app/api/product/[slug]/route.ts'), /excludedNonFunctioningN: sumOver\(\(p\) => p\.excluded\.non_functioning\)/)
})
