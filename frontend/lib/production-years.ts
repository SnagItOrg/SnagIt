/**
 * PAN-137 — a product's production years: `year_released` and, once migration
 * 059 is applied, `year_discontinued`.
 *
 * Import-free, like `catalogue.ts` and `publication.ts`, so the one rule is
 * exercisable from plain Node and the admin forms and the admin routes cannot
 * hold two opinions about what a year is.
 *
 * WHY THIS EXISTS. The new-product form sent `parseInt('Discontinued', 10)`,
 * which is `NaN`, and `JSON.stringify` serialises `NaN` as `null`. The route's
 * guard only ran on a non-null value, so an unparsable year became no year,
 * with no error. A year is now parsed from what the operator typed, and a value
 * that is not exactly four digits in range is REFUSED — never coerced to null.
 *
 * DISPLAY METADATA ONLY. A production range states nothing about identity,
 * support, visibility, tier or monitoring, and must never reach matching, a
 * price population or an eligibility rule. Years stay ASSUMED until an operator
 * has checked them against a source (PAN-52 §11); nothing here records
 * provenance, so the admin copy asks for sourced years only.
 */

export const YEAR_MIN = 1900
export const YEAR_MAX = 2030

export type YearField = 'year_released' | 'year_discontinued'

/** Why a pair of years was refused. The field names the input to highlight. */
export type ProductionYearsRefusal = {
  field: YearField
  code: 'invalid_year' | 'discontinued_without_released' | 'discontinued_before_released'
}

/**
 * One year, from a form string or a JSON value.
 *
 * Empty (`''`, `null`, `undefined`) is `null`: no year. A string must be
 * exactly four digits — `'1960abc'` is refused, where `parseInt` would have
 * read 1960 — and a number must be an integer, so `NaN` and `1960.5` are
 * refused. Either way the year must lie in YEAR_MIN..YEAR_MAX.
 */
export function parseYear(value: unknown): { ok: true; year: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, year: null }

  let year: number
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return { ok: true, year: null }
    if (!/^\d{4}$/.test(trimmed)) return { ok: false }
    year = Number(trimmed)
  } else if (typeof value === 'number' && Number.isInteger(value)) {
    year = value
  } else {
    return { ok: false }
  }

  return year >= YEAR_MIN && year <= YEAR_MAX ? { ok: true, year } : { ok: false }
}

/**
 * Both years, and the rule between them — the same rule migration 059's CHECK
 * enforces: a discontinued year needs a release year, and is not before it.
 * An equal pair (one production year) is allowed.
 */
export function validateProductionYears(input: {
  year_released: unknown
  year_discontinued: unknown
}):
  | { ok: true; year_released: number | null; year_discontinued: number | null }
  | ({ ok: false } & ProductionYearsRefusal) {
  const released = parseYear(input.year_released)
  if (!released.ok) return { ok: false, field: 'year_released', code: 'invalid_year' }
  const discontinued = parseYear(input.year_discontinued)
  if (!discontinued.ok) return { ok: false, field: 'year_discontinued', code: 'invalid_year' }

  if (discontinued.year !== null) {
    if (released.year === null) {
      return { ok: false, field: 'year_discontinued', code: 'discontinued_without_released' }
    }
    if (discontinued.year < released.year) {
      return { ok: false, field: 'year_discontinued', code: 'discontinued_before_released' }
    }
  }
  return { ok: true, year_released: released.year, year_discontinued: discontinued.year }
}

/**
 * The one display form: `1960–1975`, or `1960–` while still in production.
 *
 * `undefined` for the discontinued year means it was NOT READ — the column is
 * off (see `yearDiscontinuedEnabled`) — so no range is claimed and the release
 * year renders alone, exactly as before PAN-137. `null` means read and empty,
 * which is the open-ended range. No release year, nothing to render.
 */
export function formatProductionYears(
  released: number | null,
  discontinued: number | null | undefined,
): string | null {
  if (released === null) return null
  if (discontinued === undefined) return String(released)
  return discontinued === null ? `${released}–` : `${released}–${discontinued}`
}

/**
 * DEPLOY SAFETY. `kg_product.year_discontinued` arrives with migration 059,
 * which the owner applies by hand. PostgREST fails a select that names a
 * missing column, so NOTHING reads or writes it until this flag is `on` — a
 * merge ahead of the migration changes no query in production.
 *
 * Server-only: read it in a server component or route and pass the answer
 * down. Retire the flag, and `selectWithYearDiscontinued`, once 059 is applied
 * everywhere.
 */
export const YEAR_DISCONTINUED_FLAG = 'KLUP_YEAR_DISCONTINUED'

export function yearDiscontinuedEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[YEAR_DISCONTINUED_FLAG] === 'on'
}

/** A `kg_product` select list, plus `year_discontinued` when the flag is on. */
export function selectWithYearDiscontinued(select: string): string {
  return yearDiscontinuedEnabled() ? `${select}, year_discontinued` : select
}
