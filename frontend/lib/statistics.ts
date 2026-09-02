/**
 * The one quantile contract.
 *
 * Type 7 linear interpolation — the estimator R, NumPy and PostgreSQL's
 * `percentile_cont` all use by default. Product-owner decision C1, 2026-09-01.
 *
 * WHY THIS FILE EXISTS. Before it, three estimators disagreed in one codebase:
 *
 *   app/intel/page.tsx:54                  Type 7          ✓
 *   app/api/price-observations/route.ts:5  Type 7          ✓
 *   app/api/product/[slug]/route.ts:52     floor(n·p)      ✗
 *
 * On [1000,1200,1500,1800,2000,5000] the third returns Q1=1200 / Q3=2000 where
 * the first two return 1275 / 1950. The product route is the one the public
 * price answer is built on, so it was the one that was wrong. This module is
 * the shared contract the route now uses; the two correct call sites are
 * ratified rather than rewritten, and no fourth implementation is introduced.
 *
 * NO ROUNDING HERE. Rounding is a presentation decision and belongs at the
 * render boundary; rounding inside the estimator would make `q3/q1` width
 * ratios disagree with the numbers they are computed from.
 *
 * Import-free by design, so the root `tsx --test` harness can exercise it with
 * no Next.js, Supabase or DOM dependency.
 */

/** Finite, non-null numbers only. Anything else is not an observation. */
export function usableValues(values: readonly (number | null | undefined)[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (v == null) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * Type 7 quantile of an already-ascending array.
 *
 *   h = (n - 1) · p          x = x_floor(h) + (h - floor(h)) · (x_ceil(h) - x_floor(h))
 */
export function percentileSorted(sortedAsc: readonly number[], p: number): number | null {
  const n = sortedAsc.length
  if (n === 0) return null
  if (n === 1) return sortedAsc[0]
  if (p <= 0) return sortedAsc[0]
  if (p >= 1) return sortedAsc[n - 1]
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (h - lo) * (sortedAsc[hi] - sortedAsc[lo])
}

/** Type 7 quantile of an unsorted collection. */
export function percentile(values: readonly number[], p: number): number | null {
  return percentileSorted([...values].sort((a, b) => a - b), p)
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5)
}

export interface Quartiles {
  q1: number
  median: number
  q3: number
}

export function quartiles(values: readonly number[]): Quartiles | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = percentileSorted(sorted, 0.25)
  const q2 = percentileSorted(sorted, 0.5)
  const q3 = percentileSorted(sorted, 0.75)
  if (q1 == null || q2 == null || q3 == null) return null
  return { q1, median: q2, q3 }
}

export interface IqrBounds {
  lo: number
  hi: number
}

/** Tukey fences at 1.5·IQR, per V1 §9.2. */
export function iqrBounds(values: readonly number[]): IqrBounds | null {
  const q = quartiles(values)
  if (!q) return null
  const iqr = q.q3 - q.q1
  return { lo: q.q1 - 1.5 * iqr, hi: q.q3 + 1.5 * iqr }
}

export interface IqrPartition {
  kept: number[]
  excluded: number[]
}

/**
 * Split a set at the Tukey fences.
 *
 * Below four observations the fences are not meaningful, so nothing is
 * excluded — the caller still has the raw count and its own `n` gate. This
 * mirrors the guard the previous `iqrFilter` had, and keeps `kept + excluded`
 * equal to the input on every path so the two counts always reconcile.
 */
export function partitionByIqr(values: readonly number[]): IqrPartition {
  if (values.length < 4) return { kept: [...values], excluded: [] }
  const bounds = iqrBounds(values)
  if (!bounds) return { kept: [...values], excluded: [] }
  const kept: number[] = []
  const excluded: number[] = []
  for (const v of values) {
    if (v >= bounds.lo && v <= bounds.hi) kept.push(v)
    else excluded.push(v)
  }
  return { kept, excluded }
}
