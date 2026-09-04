/**
 * scripts/lib/baseline.test.ts
 *
 * Contract tests for cohort-scoped baseline selection.
 *
 * Run: npm run test:baseline    (npx tsx --test scripts/lib/baseline.test.ts)
 *
 * Every case here corresponds to a rule that, when it was absent, produced a
 * real incident: the first full 30-product DBA run was quarantined with
 * `volume_swing: 12600% (6 -> 762)` because six-listing `--product=juno-106`
 * runs were treated as its baseline.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  selectBaseline,
  cohortOf,
  disqualify,
  BASELINE_WINDOW,
  type BaselineAnchor,
  type BaselineCandidate,
  type RunCohort,
} from './baseline'
import { evaluateRun, type ListingSample, type RunCounters, classifyIngestionRun, coverageIsComplete } from './scrape-health'

// ── fixtures ──────────────────────────────────────────────────────────────

const COHORT: RunCohort = {
  source: 'dba.dk',
  coverage_scope_hash: 'scope-full-30',
  coverage_version: 'v2',
  scraper_version: 'dba-2.0.0',
  parser_version: 'dba-jsonld-1.0.0',
  pagination_strategy: 'page-increment-until-empty',
}

const ANCHOR: BaselineAnchor = { id: 'run-anchor', startedAt: '2026-08-07T01:00:00Z' }

/** A run that qualifies in every respect. Override one field per test. */
function qualifying(overrides: Partial<BaselineCandidate> = {}): BaselineCandidate {
  return {
    id: 'run-prev',
    started_at: '2026-08-06T01:00:00Z',
    status: 'passed',
    promoted_at: '2026-08-06T01:20:00Z',
    run_scope: 'complete',
    coverage_complete: true,
    global_unique_listings: 700,
    ...COHORT,
    ...overrides,
  }
}

const CLEAN_COUNTERS: RunCounters = {
  productsAttempted: 30,
  productsFailed: 0,
  listingsFetched: 0,
  listingsSaved: 0,
  newListings: 0,
  priceChanges: 0,
  refoundListings: 0,
}

/** n clean listings — nothing an absolute rule could object to. */
function cleanListings(n: number): ListingSample[] {
  return Array.from({ length: n }, (_, i) => ({
    external_id: `https://dba.dk/${i}`,
    url: `https://dba.dk/${i}`,
    title: `Roland Juno-106 #${i}`,
    price: 9000,
    currency: 'DKK',
    price_dkk: 9000,
  }))
}

// ── 1. A targeted run cannot seed a baseline for a complete scope ─────────

test('targeted run cannot seed a baseline for a complete scope', () => {
  // The literal live failure: `--product=juno-106` runs of six listings.
  // They differ from the full run by scope hash AND by run_scope; either
  // alone must be enough to keep them out.
  const differentScope = qualifying({
    id: 'run-targeted-real',
    coverage_scope_hash: 'scope-juno-106-only',
    run_scope: 'targeted',
    global_unique_listings: 6,
  })
  assert.equal(selectBaseline([differentScope], COHORT, ANCHOR).status, 'unavailable')

  // And defence in depth: even a targeted run that somehow produced an
  // identical scope hash is still excluded on run_scope alone.
  const sameHashTargeted = qualifying({
    id: 'run-targeted-samehash',
    run_scope: 'targeted',
    global_unique_listings: 6,
  })
  const result = selectBaseline([sameHashTargeted], COHORT, ANCHOR)
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reason, 'no_qualifying_runs')
  assert.deepEqual(result.rejected, [{ run_id: 'run-targeted-samehash', reason: 'run_scope_targeted' }])

  // A run that never declared its scope is unusable, not assumed complete.
  assert.equal(
    disqualify(qualifying({ run_scope: null }), COHORT, ANCHOR),
    'run_scope_unknown',
  )
})

// ── 2. A different scope hash gives baseline_unavailable ─────────────────

test('different coverage_scope_hash gives baseline_unavailable', () => {
  const otherScope = qualifying({ id: 'run-other-scope', coverage_scope_hash: 'scope-full-48' })
  const result = selectBaseline([otherScope], COHORT, ANCHOR)

  assert.equal(result.status, 'unavailable')
  assert.equal(result.reason, 'no_qualifying_runs')
  assert.equal(result.medianVolume, null)
  assert.deepEqual(result.rejected, [
    { run_id: 'run-other-scope', reason: 'cohort_mismatch:coverage_scope_hash' },
  ])
})

// ── 3. Differing versions or pagination give baseline_unavailable ────────

test('a change to any cohort identity field gives baseline_unavailable', () => {
  const variants: Array<[string, Partial<BaselineCandidate>]> = [
    ['source', { source: 'finn.no' }],
    ['coverage_version', { coverage_version: 'v3' }],
    ['scraper_version', { scraper_version: 'dba-2.1.0' }],
    ['parser_version', { parser_version: 'dba-jsonld-2.0.0' }],
    ['pagination_strategy', { pagination_strategy: 'cursor-token' }],
  ]

  for (const [field, override] of variants) {
    const result = selectBaseline([qualifying(override)], COHORT, ANCHOR)
    assert.equal(result.status, 'unavailable', `${field} mismatch must not produce a baseline`)
    assert.equal(result.rejected[0].reason, `cohort_mismatch:${field}`)
  }

  // A run that cannot state its own identity is excluded rather than guessed at.
  assert.equal(
    disqualify(qualifying({ parser_version: null }), COHORT, ANCHOR),
    'cohort_identity_incomplete',
  )
  // ...and an evaluated run without a full identity gets no baseline either.
  assert.equal(cohortOf({ ...COHORT, parser_version: null }), null)
  assert.equal(
    selectBaseline([qualifying()], null, ANCHOR).reason,
    'cohort_identity_incomplete',
  )
})

// ── 4. Quarantined and unpromoted runs are ignored ───────────────────────

test('quarantined, failed and unpromoted runs never enter a baseline', () => {
  const rejects = [
    qualifying({ id: 'run-quarantined', status: 'quarantined', global_unique_listings: 762 }),
    qualifying({ id: 'run-failed', status: 'failed' }),
    qualifying({ id: 'run-running', status: 'running', promoted_at: null }),
    qualifying({ id: 'run-unpromoted', promoted_at: null }),
    qualifying({ id: 'run-uncovered', coverage_complete: false }),
    qualifying({ id: 'run-no-volume', global_unique_listings: null }),
  ]

  const onlyRejects = selectBaseline(rejects, COHORT, ANCHOR)
  assert.equal(onlyRejects.status, 'unavailable')
  assert.deepEqual(onlyRejects.rejected.map(r => r.reason), [
    'status_quarantined',
    'status_failed',
    'status_running',
    'not_promoted',
    'coverage_not_approved',
    'no_global_volume',
  ])

  // Mixed in with one good run, only the good run counts.
  const mixed = selectBaseline(
    [...rejects, qualifying({ id: 'run-good', global_unique_listings: 700 })],
    COHORT,
    ANCHOR,
  )
  assert.equal(mixed.status, 'available')
  assert.deepEqual(mixed.runIds, ['run-good'])
  assert.equal(mixed.medianVolume, 700)

  // The REJECTED DBA candidate bootstrap specifically: quarantined, never
  // promoted, 762 staged rows. It must stay forensic evidence and nothing else.
  const bootstrap = qualifying({
    id: '43f27632-5881-4095-83a7-b7b840638ba1',
    status: 'quarantined',
    promoted_at: null,
    coverage_complete: false,
    global_unique_listings: 701,
  })
  assert.equal(disqualify(bootstrap, COHORT, ANCHOR), 'status_quarantined')
})

// ── 5. A first complete run is not quarantined for lacking a baseline ────

test('first complete run in a new cohort is not quarantined for a missing baseline', () => {
  const baseline = selectBaseline([], COHORT, ANCHOR)
  assert.equal(baseline.status, 'unavailable')
  assert.equal(baseline.reason, 'no_cohort_runs')

  const { status, violations, metrics } = evaluateRun(cleanListings(762), CLEAN_COUNTERS, baseline)

  assert.equal(status, 'passed')
  assert.deepEqual(violations, [])
  assert.equal(metrics.global_unique_listings, 762)
  // Relative rules produced no comparison at all.
  assert.equal(metrics.volume_delta_pct, null)
})

test('a missing baseline does not suppress hard invariants or absolute rules', () => {
  const baseline = selectBaseline([], COHORT, ANCHOR)

  // Hard invariant: every price_dkk NULL (the Finn/Blocket bug).
  const nulled = cleanListings(762).map(l => ({ ...l, price_dkk: null }))
  const hard = evaluateRun(nulled, CLEAN_COUNTERS, baseline)
  assert.equal(hard.status, 'failed')
  assert.ok(hard.violations.some(v => v.code === 'all_price_dkk_null' && v.severity === 'hard'))

  // Absolute soft rule: a near-empty run from 30 products is still suspicious
  // even with nothing to compare it against.
  const tiny = evaluateRun(cleanListings(2), CLEAN_COUNTERS, baseline)
  assert.equal(tiny.status, 'quarantined')
  assert.ok(tiny.violations.some(v => v.code === 'suspiciously_low_volume'))
  // ...but NOT because a baseline was missing.
  assert.ok(!tiny.violations.some(v => v.code.includes('baseline')))
  assert.ok(!tiny.violations.some(v => v.code === 'volume_swing'))
})

// ── 6. A second identical complete run gets a correct baseline ───────────

test('second complete run in an identical cohort gets a correct baseline', () => {
  const first = qualifying({ id: 'run-first', global_unique_listings: 762 })
  const baseline = selectBaseline([first], COHORT, ANCHOR)

  assert.equal(baseline.status, 'available')
  assert.equal(baseline.reason, null)
  assert.equal(baseline.medianVolume, 762)
  assert.equal(baseline.sampleSize, 1)
  assert.deepEqual(baseline.runIds, ['run-first'])
  assert.deepEqual(baseline.cohort, COHORT)
  assert.equal(baseline.measure, 'global_unique_listings')

  // A normal night's drift passes.
  const { status, violations, metrics } = evaluateRun(cleanListings(770), CLEAN_COUNTERS, baseline)
  assert.equal(status, 'passed')
  assert.deepEqual(violations, [])
  assert.equal(metrics.volume_delta_pct, 1.05)
})

test('the baseline is a median over the window, not the previous run', () => {
  // One outlier run must not become the new normal; the window is capped.
  const runs = [
    ...Array.from({ length: BASELINE_WINDOW }, (_, i) =>
      qualifying({
        id: `run-${String(i).padStart(2, '0')}`,
        started_at: `2026-07-${String(20 - i).padStart(2, '0')}T01:00:00Z`,
        global_unique_listings: 700,
      })),
    // Older than the window — must be dropped, not averaged in.
    qualifying({ id: 'run-ancient', started_at: '2026-06-01T01:00:00Z', global_unique_listings: 5 }),
  ]

  const baseline = selectBaseline(runs, COHORT, ANCHOR)
  assert.equal(baseline.sampleSize, BASELINE_WINDOW)
  assert.equal(baseline.medianVolume, 700)
  assert.ok(!baseline.runIds.includes('run-ancient'))
  // Most recent first.
  assert.equal(baseline.runIds[0], 'run-00')
})

// ── 7. A volume collapse inside an identical cohort is caught ────────────

test('volume collapse within an identical cohort raises an anomaly', () => {
  const history = Array.from({ length: 5 }, (_, i) =>
    qualifying({
      id: `run-h${i}`,
      started_at: `2026-08-0${i + 1}T01:00:00Z`,
      global_unique_listings: 700,
    }))

  const baseline = selectBaseline(history, COHORT, ANCHOR)
  assert.equal(baseline.status, 'available')
  assert.equal(baseline.medianVolume, 700)

  // 700 → 120 is an 83% collapse: the source is likely blocked or reshaped.
  const collapsed = evaluateRun(cleanListings(120), CLEAN_COUNTERS, baseline)
  assert.equal(collapsed.status, 'quarantined')
  const swing = collapsed.violations.find(v => v.code === 'volume_swing')
  assert.ok(swing, 'a collapse inside an identical cohort must be flagged')
  assert.equal(swing!.severity, 'soft')
  assert.equal(collapsed.metrics.volume_delta_pct, -82.86)

  // Total collapse to zero is called out specifically — left unflagged it
  // would mark the entire source missing and eventually delist everything.
  const empty = evaluateRun([], CLEAN_COUNTERS, baseline)
  assert.equal(empty.status, 'quarantined')
  assert.ok(empty.violations.some(v => v.code === 'zero_results_after_volume'))
})

test('volume rules use the global measure, not per-query sums', () => {
  // Two queries each returned the same 700 listings: 1400 raw rows, 700
  // globally unique. Against a 700 baseline that is no change at all —
  // comparing raw rows would have reported a fabricated +100% swing.
  const duplicated = [...cleanListings(700), ...cleanListings(700)]
  const baseline = selectBaseline([qualifying({ global_unique_listings: 700 })], COHORT, ANCHOR)

  const { violations, metrics } = evaluateRun(duplicated, CLEAN_COUNTERS, baseline)
  assert.equal(metrics.global_unique_listings, 700)
  assert.equal(metrics.volume_delta_pct, 0)
  assert.ok(!violations.some(v => v.code === 'volume_swing'))
})

// ── 8. Selection is stable under concurrent inserts ──────────────────────

test('baseline selection is stable under concurrent inserts', () => {
  const history = [
    qualifying({ id: 'run-a', started_at: '2026-08-04T01:00:00Z', global_unique_listings: 690 }),
    qualifying({ id: 'run-b', started_at: '2026-08-05T01:00:00Z', global_unique_listings: 700 }),
    qualifying({ id: 'run-c', started_at: '2026-08-06T01:00:00Z', global_unique_listings: 710 }),
  ]
  const expected = selectBaseline(history, COHORT, ANCHOR)
  assert.equal(expected.status, 'available')
  assert.deepEqual(expected.runIds, ['run-c', 'run-b', 'run-a'])
  assert.equal(expected.medianVolume, 700)

  // Row arrival order must not matter: the same set in any order decides the same.
  const permutations = [
    [history[2], history[0], history[1]],
    [history[1], history[2], history[0]],
    [...history].reverse(),
  ]
  for (const permutation of permutations) {
    const result = selectBaseline(permutation, COHORT, ANCHOR)
    assert.deepEqual(result.runIds, expected.runIds)
    assert.equal(result.medianVolume, expected.medianVolume)
  }

  // Runs that started at or after this run cannot influence its verdict, so a
  // sibling scraper inserting rows mid-evaluation changes nothing.
  const concurrent = [
    ...history,
    qualifying({ id: 'run-concurrent', started_at: ANCHOR.startedAt, global_unique_listings: 1 }),
    qualifying({ id: 'run-later', started_at: '2026-08-07T02:00:00Z', global_unique_listings: 1 }),
    qualifying({ id: ANCHOR.id!, started_at: ANCHOR.startedAt, global_unique_listings: 1 }),
  ]
  const withConcurrent = selectBaseline(concurrent, COHORT, ANCHOR)
  assert.deepEqual(withConcurrent.runIds, expected.runIds)
  assert.equal(withConcurrent.medianVolume, expected.medianVolume)
  assert.deepEqual(
    withConcurrent.rejected,
    [
      { run_id: 'run-concurrent', reason: 'not_before_anchor' },
      { run_id: 'run-later', reason: 'not_before_anchor' },
      { run_id: 'run-anchor', reason: 'self' },
    ],
  )

  // Timestamps are compared as instants, not strings. PostgREST renders
  // '+00:00' with microseconds; a Date.toISOString() value is 'Z' with
  // milliseconds. Lexicographically '...403Z' sorts ABOVE '...403719+00:00'
  // ('Z' > '7'), which would let a later run into an earlier run's baseline.
  const mixedFormats = [
    qualifying({ id: 'run-iso-z', started_at: '2026-08-06T01:00:00.403Z', global_unique_listings: 700 }),
    qualifying({ id: 'run-pgrst', started_at: '2026-08-06T01:00:00.403719+00:00', global_unique_listings: 700 }),
  ]
  const mixed = selectBaseline(mixedFormats, COHORT, ANCHOR)
  assert.equal(mixed.status, 'available')
  assert.equal(mixed.sampleSize, 2, 'both are genuinely before the anchor')
  // Strictly later than the anchor, expressed in the other format.
  assert.equal(
    disqualify(
      qualifying({ started_at: '2026-08-07T01:00:00.000Z' }),
      COHORT,
      { id: 'x', startedAt: '2026-08-07T01:00:00.403719+00:00' },
    ),
    null,
    '00.000Z precedes 00.403719+00:00 as an instant',
  )
  assert.equal(
    disqualify(
      qualifying({ started_at: '2026-08-07T02:00:00.000Z' }),
      COHORT,
      { id: 'x', startedAt: '2026-08-07T01:00:00.403719+00:00' },
    ),
    'not_before_anchor',
  )
  // A timestamp that cannot be read is excluded, never guessed at.
  assert.equal(
    disqualify(qualifying({ started_at: 'not-a-timestamp' }), COHORT, ANCHOR),
    'unparseable_started_at',
  )

  // Simultaneous started_at is broken by id, so ties are deterministic too.
  const tied = [
    qualifying({ id: 'run-y', started_at: '2026-08-06T01:00:00Z', global_unique_listings: 2 }),
    qualifying({ id: 'run-x', started_at: '2026-08-06T01:00:00Z', global_unique_listings: 1 }),
    qualifying({ id: 'run-z', started_at: '2026-08-06T01:00:00Z', global_unique_listings: 3 }),
  ]
  assert.deepEqual(selectBaseline(tied, COHORT, ANCHOR).runIds, ['run-z', 'run-y', 'run-x'])
  assert.deepEqual(selectBaseline([...tied].reverse(), COHORT, ANCHOR).runIds, ['run-z', 'run-y', 'run-x'])
})

/* ------------------------------------------------------------------ *
 * PAN-39 — a run that did no work must not report success
 * ------------------------------------------------------------------ */

test('a run given work that writes nothing while failing is not a success', () => {
  // The measured 2026-09-01..03 Reverb runs: search terms loaded, every
  // request refused upstream, zero rows written — and `✅ Done`, exit 0.
  const blocked = classifyIngestionRun({
    eligible: 53, written: 0, requestFailures: 11076, writeFailures: 0, lifecycleFailed: false,
  })
  assert.equal(blocked.outcome, 'failed')
  assert.equal(blocked.reason, 'no_writes_with_failures')

  // A database refusal alone is equally disqualifying.
  assert.equal(classifyIngestionRun({
    eligible: 53, written: 0, requestFailures: 0, writeFailures: 3, lifecycleFailed: false,
  }).outcome, 'failed')

  // So is a lifecycle step that did not complete — the stale-sweep timeout.
  assert.equal(classifyIngestionRun({
    eligible: 53, written: 0, requestFailures: 0, writeFailures: 0, lifecycleFailed: true,
  }).outcome, 'failed')

  // But zero writes with NO failure is a quiet source, not a broken job, and
  // no eligible work at all cannot fail.
  assert.equal(classifyIngestionRun({
    eligible: 53, written: 0, requestFailures: 0, writeFailures: 0, lifecycleFailed: false,
  }).outcome, 'success')
  assert.equal(classifyIngestionRun({
    eligible: 0, written: 0, requestFailures: 0, writeFailures: 0, lifecycleFailed: false,
  }).reason, 'no_eligible_work')

  // The reason is a static code: no URL, id, response body or credential.
  for (const facts of [
    { eligible: 53, written: 0, requestFailures: 1, writeFailures: 0, lifecycleFailed: false },
    { eligible: 53, written: 9, requestFailures: 1, writeFailures: 0, lifecycleFailed: false },
  ]) {
    assert.match(classifyIngestionRun(facts).reason, /^[a-z_]+$/)
  }
})

test('incomplete coverage keeps its results but must not run the lifecycle sweep', () => {
  // Run 117: half the normal volume landed before the wall came up. Those rows
  // are real and must not be discarded by calling the run a failure.
  const partial = { eligible: 53, written: 25636, requestFailures: 4000, writeFailures: 0, lifecycleFailed: false }
  assert.equal(classifyIngestionRun(partial).outcome, 'partial')
  assert.notEqual(classifyIngestionRun(partial).outcome, 'failed', 'partial progress is not total failure')
  assert.notEqual(classifyIngestionRun(partial).outcome, 'success', 'nor a clean run')

  // THE POINT. "Not seen in 48h" is an inference about the source, and it is
  // only valid if we successfully asked. Listings behind those 4000 failed
  // requests are not missing — the run just never looked at them.
  assert.equal(coverageIsComplete(partial), false, 'a partly blind run must not sweep')

  // The 403 wall: every request failed, so the run saw nothing. Sweeping would
  // have deactivated the entire active Reverb cohort.
  assert.equal(coverageIsComplete({ eligible: 53, requestFailures: 11076, writeFailures: 0 }), false)
  // A refused write is equally disqualifying, and so is having looked at nothing.
  assert.equal(coverageIsComplete({ eligible: 53, requestFailures: 0, writeFailures: 1 }), false)
  assert.equal(coverageIsComplete({ eligible: 0, requestFailures: 0, writeFailures: 0 }), false)

  // Complete coverage is the only case that may sweep — including a legitimate
  // quiet run, where every request succeeded and returned nothing.
  assert.equal(coverageIsComplete({ eligible: 53, requestFailures: 0, writeFailures: 0 }), true)

  // A single failure alongside real writes is still partial, and a clean run
  // stays clean.
  assert.equal(classifyIngestionRun({
    eligible: 53, written: 1, requestFailures: 1, writeFailures: 0, lifecycleFailed: false,
  }).outcome, 'partial')
  assert.equal(classifyIngestionRun({
    eligible: 53, written: 53216, requestFailures: 0, writeFailures: 0, lifecycleFailed: false,
  }).outcome, 'success')
})
