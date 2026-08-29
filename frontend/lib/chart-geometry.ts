/**
 * The pure scale maths behind the data-display primitives.
 *
 * Split out of the components so it can be tested from plain Node: the way a
 * sparkline breaks is a NaN coordinate on a one-point or flat series, and the
 * way a diverging bar breaks is an outlier that renders a bar wider than its
 * own track. Neither failure needs a browser to catch, and neither is visible
 * in a snapshot of the happy path.
 *
 * Import-free, like `lib/catalogue.ts`, so it runs under the root
 * `tsx --test` harness.
 */

export type Point = { x: number; y: number }

export type SparklineGeometry = {
  points: Point[]
  /** The most recent observation — the one the endpoint marker sits on. */
  last: Point
  /** Vertical position of the endpoint as a percentage of the box height. */
  lastYPercent: number
  min: number
  max: number
  first: number
  current: number
  /** current − first. Sign, not slope: the caller prints it. */
  change: number
}

/**
 * Map a series onto a fixed viewBox.
 *
 * Three cases that are all real in production data:
 *  - empty          -> null. The caller renders a NoDataState, not a flat line.
 *  - one observation-> a single centred point and no line. A one-point series
 *                      has no direction, and drawing one would invent a trend.
 *  - flat series    -> min === max, so the naive (v-min)/(max-min) is 0/0.
 *                      Pinned to the vertical middle instead of NaN.
 */
export function sparklineGeometry(
  values: number[],
  width: number,
  height: number,
  padding = 2,
): SparklineGeometry | null {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length === 0) return null

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const top = padding
  const bottom = Math.max(height - padding, padding)
  const span = bottom - top

  const yFor = (v: number): number => {
    if (max === min) return top + span / 2
    return bottom - ((v - min) / (max - min)) * span
  }

  const points: Point[] =
    clean.length === 1
      ? [{ x: width / 2, y: yFor(clean[0]) }]
      : clean.map((v, i) => ({
          x: (i / (clean.length - 1)) * width,
          y: yFor(v),
        }))

  const last = points[points.length - 1]
  const first = clean[0]
  const current = clean[clean.length - 1]

  return {
    points,
    last,
    lastYPercent: height > 0 ? (last.y / height) * 100 : 50,
    min,
    max,
    first,
    current,
    change: current - first,
  }
}

export type DivergingBarGeometry = {
  /** Which half of the track the bar occupies. */
  side: 'left' | 'right' | 'none'
  /** Share of ONE half-track, 0..1. Never exceeds 1, however extreme the value. */
  fraction: number
  /** True when |value| exceeded the scale and the bar was clamped. */
  clamped: boolean
}

/**
 * Zero-centred bar scale.
 *
 * `max` is the largest absolute value in the comparison group. A value beyond
 * it clamps to a full half-track and reports `clamped`, so an outlier widens
 * nothing and the caller can mark it. A non-positive or non-finite `max` — the
 * degenerate group where every value is zero — yields no bar rather than a
 * division by zero.
 */
export function divergingBarGeometry(
  value: number | null | undefined,
  max: number,
): DivergingBarGeometry {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return { side: 'none', fraction: 0, clamped: false }
  }
  if (!Number.isFinite(max) || max <= 0) {
    return { side: 'none', fraction: 0, clamped: false }
  }
  const raw = Math.abs(value) / max
  const fraction = Math.min(raw, 1)
  return {
    side: value > 0 ? 'right' : 'left',
    fraction,
    clamped: raw > 1,
  }
}
