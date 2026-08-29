/**
 * Number and date formatting shared by more than one data-presentation
 * consumer.
 *
 * Scope is deliberately narrow: a formatter earns a place here when `/intel`
 * and the public product page would otherwise each write it. Anything used by
 * a single caller stays with that caller.
 *
 * Every function takes an explicit locale with a `da-DK` default, because the
 * two consumers do not share one: the public product page is Danish and the
 * private operator dashboard is English. No function embeds a translatable
 * word — units and labels are the caller's job, via `lib/i18n.ts`.
 *
 * Import-free so it runs under the root `tsx --test` harness.
 */

export type FormatLocale = 'da-DK' | 'en-GB'

const DEFAULT_LOCALE: FormatLocale = 'da-DK'

/** U+2212 MINUS SIGN. A hyphen at tabular sizes reads as a stray dash. */
export const MINUS = '−'

/** Grouped DKK integer, no unit: 12500 -> "12.500". */
export function formatDkk(
  value: number | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value))
}

/** Grouped DKK integer with the unit: 12500 -> "12.500 kr". */
export function formatDkkAmount(
  value: number | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
): string | null {
  const n = formatDkk(value, locale)
  return n == null ? null : `${n} kr`
}

/**
 * Signed DKK delta. The sign is ALWAYS printed, for both directions, because
 * it is the part a reader who cannot use the hue depends on.
 * 6084 -> "+6.084" · -538 -> "−538" · 0 -> "±0"
 */
export function formatSignedDkk(
  value: number | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
): string | null {
  if (value == null || !Number.isFinite(value)) return null
  const magnitude = formatDkk(Math.abs(value), locale)
  if (magnitude == null) return null
  if (value === 0) return `±0`
  return value > 0 ? `+${magnitude}` : `${MINUS}${magnitude}`
}

/** Compact integer for a summary tile: 269000 -> "269 K" in da-DK. */
export function formatCompact(
  value: number | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * An observation count, rendered as a count and nothing else.
 *
 * A sample size is evidence, so it is never abbreviated and never rounded:
 * "1" and "117" must both be readable exactly. The caller supplies the noun.
 */
export function formatCount(
  value: number | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '0'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value))
}

/**
 * A ratio in 0..1 as a percentage. Returns null outside that range rather than
 * printing "142 %" — a coverage figure above 1 means the denominator is wrong,
 * and silently rendering it would hide the bug.
 */
export function formatPercent(
  fraction: number | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
  fractionDigits = 0,
): string | null {
  if (fraction == null || !Number.isFinite(fraction)) return null
  if (fraction < 0 || fraction > 1) return null
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(fraction)
}

/**
 * The period a series actually covers, from its real endpoints.
 *
 * Month precision: a sold-comp series spanning years does not need days, and a
 * day-precise range invites the reader to treat two adjacent observations as a
 * daily cadence. A single-observation series collapses to one month rather
 * than printing "mar. 2024 – mar. 2024".
 */
export function formatDateRange(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
  locale: FormatLocale = DEFAULT_LOCALE,
): string | null {
  const from = toDate(fromIso)
  const to = toDate(toIso)
  if (from == null && to == null) return null
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' })
  if (from == null) return fmt.format(to!)
  if (to == null) return fmt.format(from)
  const a = fmt.format(from)
  const b = fmt.format(to)
  return a === b ? a : `${a} – ${b}`
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
