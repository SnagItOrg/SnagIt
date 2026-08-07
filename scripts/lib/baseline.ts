/**
 * scripts/lib/baseline.ts
 *
 * Cohort-scoped baseline selection for the scrape quality gate.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────
 * The previous `robustBaseline()` filtered on (source, status='passed') and
 * nothing else. Every passed run of a source was treated as comparable to
 * every other one. Observed live: the first full 30-product DBA bootstrap
 * reported `volume_swing: 12600% (6 -> 762)` because the only prior passed
 * runs were `--product=juno-106` runs of six listings. The gate quarantined a
 * correct run because it compared it against a measurement of something else.
 *
 * Same class of bug as the unscoped coverage function retired in migration
 * 048: an approval that belongs to a narrow scope leaking onto a wide one.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────
 * A run may only be compared against runs that measured the same thing. The
 * cohort is six fields, matched EXACTLY (see BASELINE_COHORT_FIELDS), and a
 * qualifying run must additionally be complete, promoted, and coverage-
 * approved.
 *
 * When no qualifying run exists the answer is `unavailable`. That is
 * INFORMATION, not a violation: a first complete run in a new cohort is
 * judged only on hard invariants and absolute data contracts. Relative volume
 * rules activate on the second run of an identical cohort.
 *
 * ── WHY SELECTION IS A PURE FUNCTION ────────────────────────────────────
 * `selectBaseline()` takes candidate rows and returns a decision with no I/O,
 * so every rule below is unit-testable without a database — and so the
 * decision recorded on `scrape_run.baseline` can be replayed exactly.
 */

import type { SupabaseClient } from '../../frontend/node_modules/@supabase/supabase-js'

/** Bump when the selection rules change, so an old decision stays readable. */
export const BASELINE_VERSION = '2.0.0'

/**
 * Median over the last N qualifying runs, never over the single previous run.
 * Comparing against only the last run lets one bad run become the new normal,
 * which lets the NEXT bad run through.
 */
export const BASELINE_WINDOW = 14

/**
 * How many rows to consider before applying the rules. Bounded so an old,
 * busy source cannot make the gate scan its whole history; generous enough
 * that a long stretch of quarantined runs still finds the last good ones.
 */
export const BASELINE_CANDIDATE_LIMIT = 200

/**
 * The cohort key. All six must match EXACTLY. `coverage_scope_hash` already
 * digests the product/query universe, but the rest are compared independently
 * so a mismatch is visible in the audit trail rather than buried in a hash —
 * and so a scraper can change what it feeds the hash without silently
 * widening the cohort.
 */
export const BASELINE_COHORT_FIELDS = [
  'source',
  'coverage_scope_hash',
  'coverage_version',
  'scraper_version',
  'parser_version',
  'pagination_strategy',
] as const

export type CohortField = (typeof BASELINE_COHORT_FIELDS)[number]

export type RunCohort = Record<CohortField, string>

/**
 * A prior run being considered as baseline material. Field names match the
 * `scrape_run` columns exactly so the row can be passed through unchanged.
 */
export interface BaselineCandidate {
  id: string
  started_at: string
  status: string | null
  promoted_at: string | null
  run_scope: string | null
  coverage_complete: boolean | null
  /** The GLOBAL measurement — distinct external_ids across the whole run. */
  global_unique_listings: number | null
  source: string | null
  coverage_scope_hash: string | null
  coverage_version: string | null
  scraper_version: string | null
  parser_version: string | null
  pagination_strategy: string | null
}

/** The run being evaluated. Its own row must never enter its own baseline. */
export interface BaselineAnchor {
  id: string | null
  startedAt: string
}

export interface RejectedCandidate {
  run_id: string
  reason: string
}

export interface Baseline {
  status: 'available' | 'unavailable'
  /** Why unavailable, or null when available. */
  reason: string | null
  medianVolume: number | null
  sampleSize: number
  /** Selected runs, most recent first. The audit trail for this decision. */
  runIds: string[]
  volumes: number[]
  cohort: RunCohort | null
  window: number
  /** Named so nobody can mistake this for a query-local count. */
  measure: 'global_unique_listings'
  version: string
  rejected: RejectedCandidate[]
}

function unavailable(
  reason: string,
  cohort: RunCohort | null,
  rejected: RejectedCandidate[] = [],
  window = BASELINE_WINDOW,
): Baseline {
  return {
    status: 'unavailable',
    reason,
    medianVolume: null,
    sampleSize: 0,
    runIds: [],
    volumes: [],
    cohort,
    window,
    measure: 'global_unique_listings',
    version: BASELINE_VERSION,
    rejected,
  }
}

/** A baseline that was never attempted (dry runs, runs with no run record). */
export function baselineNotAttempted(reason: string): Baseline {
  return unavailable(reason, null)
}

/**
 * Build a cohort key from a run's own identity fields. Returns null if any
 * field is missing: a run that cannot state what it measured cannot be
 * compared to anything, in either direction.
 */
export function cohortOf(run: Partial<Record<CohortField, string | null>>): RunCohort | null {
  const cohort = {} as RunCohort
  for (const field of BASELINE_COHORT_FIELDS) {
    const value = run[field]
    if (typeof value !== 'string' || value.length === 0) return null
    cohort[field] = value
  }
  return cohort
}

/**
 * Why this candidate may NOT serve as baseline material, or null if it may.
 * Order matters only for the quality of the audit message.
 */
export function disqualify(
  candidate: BaselineCandidate,
  cohort: RunCohort,
  anchor: BaselineAnchor,
): string | null {
  if (anchor.id != null && candidate.id === anchor.id) return 'self'

  // Anchored on the evaluated run's own start time rather than on "now", so a
  // run inserted concurrently while the gate is deciding cannot change the
  // answer. Selection must be reproducible after the fact.
  if (!(candidate.started_at < anchor.startedAt)) return 'not_before_anchor'

  const candidateCohort = cohortOf(candidate)
  if (candidateCohort === null) return 'cohort_identity_incomplete'
  for (const field of BASELINE_COHORT_FIELDS) {
    if (candidateCohort[field] !== cohort[field]) return `cohort_mismatch:${field}`
  }

  // Quarantined and failed runs describe a fault, not the market.
  if (candidate.status !== 'passed') return `status_${candidate.status ?? 'null'}`
  // An unpromoted run's rows never became authoritative, so its volume never
  // described the published universe.
  if (candidate.promoted_at == null) return 'not_promoted'
  // A targeted run measured a deliberate subset. It must never define the
  // norm for a complete scope — the exact live failure this module exists for.
  if (candidate.run_scope !== 'complete') {
    return candidate.run_scope == null ? 'run_scope_unknown' : `run_scope_${candidate.run_scope}`
  }
  // Coverage approval: a run that fetched only page 1 of every query saw a
  // fraction of the universe, and its volume is not the market's volume.
  if (candidate.coverage_complete !== true) return 'coverage_not_approved'

  if (candidate.global_unique_listings == null) return 'no_global_volume'
  if (candidate.global_unique_listings <= 0) return 'zero_global_volume'

  return null
}

/**
 * Select the baseline for `anchor` from `candidates`.
 *
 * Deterministic: candidates are ordered by (started_at DESC, id DESC), so the
 * result does not depend on the order rows arrived in.
 */
export function selectBaseline(
  candidates: BaselineCandidate[],
  cohort: RunCohort | null,
  anchor: BaselineAnchor,
  window: number = BASELINE_WINDOW,
): Baseline {
  if (cohort === null) return unavailable('cohort_identity_incomplete', null, [], window)

  const rejected: RejectedCandidate[] = []
  const qualifying: BaselineCandidate[] = []

  for (const candidate of candidates) {
    const reason = disqualify(candidate, cohort, anchor)
    if (reason === null) qualifying.push(candidate)
    else rejected.push({ run_id: candidate.id, reason })
  }

  if (qualifying.length === 0) {
    return unavailable(
      candidates.length === 0 ? 'no_cohort_runs' : 'no_qualifying_runs',
      cohort,
      rejected,
      window,
    )
  }

  const selected = [...qualifying]
    .sort((a, b) =>
      a.started_at === b.started_at
        ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
        : (a.started_at < b.started_at ? 1 : -1),
    )
    .slice(0, window)

  const volumes = selected.map(r => r.global_unique_listings as number)
  const sorted = [...volumes].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]

  return {
    status: 'available',
    reason: null,
    medianVolume: median,
    sampleSize: selected.length,
    runIds: selected.map(r => r.id),
    volumes,
    cohort,
    window,
    measure: 'global_unique_listings',
    version: BASELINE_VERSION,
    rejected,
  }
}

/**
 * Fetch candidates for `cohort` and select. The cohort equality is pushed
 * into the query for cheapness, but every rule is re-applied by
 * `selectBaseline()` — the database narrows, it does not decide.
 */
export async function resolveBaseline(
  supabase: SupabaseClient,
  cohort: RunCohort,
  anchor: BaselineAnchor,
  window: number = BASELINE_WINDOW,
): Promise<Baseline> {
  let query = supabase
    .from('scrape_run')
    .select(
      'id, started_at, status, promoted_at, run_scope, coverage_complete, ' +
      'global_unique_listings, source, coverage_scope_hash, coverage_version, ' +
      'scraper_version, parser_version, pagination_strategy',
    )
    .lt('started_at', anchor.startedAt)
    .order('started_at', { ascending: false })
    .limit(BASELINE_CANDIDATE_LIMIT)

  for (const field of BASELINE_COHORT_FIELDS) {
    query = query.eq(field, cohort[field])
  }

  const { data, error } = await query
  if (error) {
    // Fail closed on the RELATIVE rules only: no baseline means those rules
    // stay inactive. Hard invariants are unaffected, so a lookup failure
    // cannot make a bad run pass.
    return unavailable(`lookup_failed:${error.message}`, cohort, [], window)
  }

  return selectBaseline((data ?? []) as BaselineCandidate[], cohort, anchor, window)
}

/** One-line summary for the run log. */
export function describeBaseline(baseline: Baseline): string {
  if (baseline.status === 'available') {
    return `baseline: median ${baseline.medianVolume} ${baseline.measure} ` +
      `over ${baseline.sampleSize} qualifying run(s) in an identical cohort`
  }
  return `baseline_unavailable (${baseline.reason}) — ` +
    'relative volume rules INACTIVE for this run; this is information, not a violation'
}
