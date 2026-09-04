/**
 * Price populations — the module that makes "never blend" structural.
 *
 * Product-owner decision C2, 2026-09-01: asking populations are kept apart by
 * platform/market and are never combined into one band. There is no blended
 * cross-market statistic anywhere in this file, and no function accepts rows
 * from two populations at once — mixing is not forbidden by convention here,
 * it is unrepresentable, because a band is only ever built from one
 * `PopulationKey`.
 *
 * SIX POPULATIONS, ONE OF WHICH IS SALES.
 *
 *   dk-asking      dba.dk                asking   PRIMARY, user-facing
 *   de-asking      kleinanzeigen         asking   computed, not a rendered block in P2
 *   se-asking      blocket               asking   computed
 *   no-asking      finn                  asking   computed
 *   reverb-asking  reverb (active)       asking   reference block
 *   reverb-sold    reverb_price_history  SOLD     reference block — the ONLY confirmed sales
 *
 * `source` identifies the platform population. `country` describes geography
 * and is the primary market fact; `source` is a documented fallback when
 * `country` is absent. Reverb is deliberately exempt from country-based
 * assignment in BOTH directions: it never becomes a national market, and a
 * national market is never inferred for it from its source alone.
 *
 * WHY REVERB IS EXEMPT. `scripts/scrape-reverb.ts:259-261` stores
 * `price: <converted DKK>, currency: 'DKK', country: 'US'` — every active
 * Reverb row is an already-converted USD price wearing a DKK label. Any rule
 * that read `currency` would classify 39,926 international listings as Danish
 * market data. `currency` is therefore never consulted in this file.
 *
 * Import-free apart from the shared quantile contract, so the root test
 * harness can exercise it without Next.js, Supabase or a DOM.
 */

import { partitionByIqr, quartiles, usableValues } from './statistics'

export type PopulationKind = 'asking' | 'sold'

export type PopulationKey =
  | 'dk-asking'
  | 'de-asking'
  | 'se-asking'
  | 'no-asking'
  | 'reverb-asking'
  | 'reverb-sold'

/** How a population is treated on the page. */
export type PopulationRole = 'primary' | 'reference' | 'computed'

export interface PopulationDescriptor {
  key: PopulationKey
  kind: PopulationKind
  role: PopulationRole
  /** True only where the observations are completed transactions. */
  confirmedSales: boolean
}

export const POPULATIONS: Readonly<Record<PopulationKey, PopulationDescriptor>> = {
  'dk-asking':     { key: 'dk-asking',     kind: 'asking', role: 'primary',   confirmedSales: false },
  'de-asking':     { key: 'de-asking',     kind: 'asking', role: 'computed',  confirmedSales: false },
  'se-asking':     { key: 'se-asking',     kind: 'asking', role: 'computed',  confirmedSales: false },
  'no-asking':     { key: 'no-asking',     kind: 'asking', role: 'computed',  confirmedSales: false },
  'reverb-asking': { key: 'reverb-asking', kind: 'asking', role: 'reference', confirmedSales: false },
  'reverb-sold':   { key: 'reverb-sold',   kind: 'sold',   role: 'reference', confirmedSales: true },
}

/**
 * Real lowercase `listings.source` values, verified against production
 * 2026-09-01. `ACTIVE_PLATFORMS` in lib/platforms.ts carries capitalised
 * display names ('DBA', 'Finn', …) and must never be used for this lookup —
 * it matches nothing in the database.
 */
export const SOURCE_TO_POPULATION: Readonly<Record<string, PopulationKey>> = {
  'dba.dk':        'dk-asking',
  'kleinanzeigen': 'de-asking',
  'blocket':       'se-asking',
  'finn':          'no-asking',
  'reverb':        'reverb-asking',
}

/** ISO country → the local-market asking population it belongs to. */
export const COUNTRY_TO_POPULATION: Readonly<Record<string, PopulationKey>> = {
  DK: 'dk-asking',
  DE: 'de-asking',
  SE: 'se-asking',
  NO: 'no-asking',
}

export const REVERB_SOURCE = 'reverb'

/**
 * Sources that are not a used-market asking population, whatever their country.
 *
 * Thomann is a retailer NEW-price reference — the page shows it as "Ny hos
 * Thomann". Its rows carry country='DK', so a country-first rule would have
 * filed them into the Danish used-market band and quietly mixed retail new
 * prices into a second-hand median. Zero active Thomann rows exist today
 * (5 total, all inactive), so this closes a latent hole rather than fixing a
 * live number — but the hole is one bad scrape away from being live.
 */
export const NON_MARKET_SOURCES: ReadonlySet<string> = new Set(['thomann'])

export interface ListingClassificationInput {
  source?: string | null
  country?: string | null
}

export type ClassificationBasis = 'source-platform' | 'country' | 'source-fallback' | 'unresolved'

export interface Classification {
  population: PopulationKey | null
  basis: ClassificationBasis
}

/**
 * Assign a listing to exactly one population.
 *
 * Order matters. Reverb is resolved by platform FIRST, so a Reverb row whose
 * `country` were ever written as 'DK' still lands in `reverb-asking`. Local
 * marketplaces resolve by `country` (the primary market fact) and fall back to
 * `source` only when country is missing. Anything unrecognised returns null
 * and is excluded from every statistic — fail-closed, matching `isCanonical`.
 */
export function classifyListing(listing: ListingClassificationInput): Classification {
  const source = typeof listing.source === 'string' ? listing.source.trim().toLowerCase() : null
  const country = typeof listing.country === 'string' ? listing.country.trim().toUpperCase() : null

  if (source === REVERB_SOURCE) {
    return { population: 'reverb-asking', basis: 'source-platform' }
  }

  // Retail/new-price references are not a used-market population at all.
  if (source && NON_MARKET_SOURCES.has(source)) {
    return { population: null, basis: 'unresolved' }
  }

  if (country) {
    const byCountry = COUNTRY_TO_POPULATION[country]
    if (byCountry) return { population: byCountry, basis: 'country' }
  }

  if (source) {
    const bySource = SOURCE_TO_POPULATION[source]
    if (bySource) return { population: bySource, basis: 'source-fallback' }
  }

  return { population: null, basis: 'unresolved' }
}

/** True only for the one population that describes completed transactions. */
export function isConfirmedSales(key: PopulationKey): boolean {
  return POPULATIONS[key].confirmedSales
}

// ── Gates ───────────────────────────────────────────────────────────────────

/** V1 §9.2 / decision 13. A band — median + Q1–Q3 — needs eight observations. */
export const MIN_BAND_N = 8
/** Below this a median is not shown at all, even descriptively. */
export const MIN_DESCRIPTIVE_MEDIAN_N = 3
/** Measurement G3, promoted to a render gate by V1 D7. */
export const MAX_BAND_WIDTH_RATIO = 10

export type DisplayTier =
  /**
   * The population could not be read completely, so no number derived from it
   * is trustworthy. Distinct from 'none': 'none' means "we looked and there is
   * nothing", this means "we could not finish looking". Never show an `n`.
   */
  | 'unavailable'
  /** Nothing to say. */
  | 'none'
  /** Too few for any statistic; show the listings and the count only. */
  | 'listings-only'
  /** A descriptive median over a named count. Never called "typical". */
  | 'median-only'
  /** Median as the headline; Q1–Q3 secondary when the width guard holds. */
  | 'band'

export type ExclusionReason =
  | 'price_not_listed'
  | 'no_comparable_dkk'
  | 'unresolved_population'
  | 'iqr_outlier'

export interface PriceObservation {
  price?: number | null
  price_dkk?: number | null
  source?: string | null
  country?: string | null
  condition?: string | null
}

export interface PopulationStats {
  /** False when retrieval was truncated; every statistic is then withheld. */
  complete: boolean
  key: PopulationKey
  kind: PopulationKind
  role: PopulationRole
  confirmedSales: boolean
  /** Every row assigned to this population, before any price filtering. */
  nRaw: number
  /** Rows carrying a usable comparable DKK value. */
  nEligible: number
  /** Rows surviving the Tukey fences — the number every statistic is built on. */
  nFiltered: number
  excluded: Record<ExclusionReason, number>
  median: number | null
  q1: number | null
  q3: number | null
  low: number | null
  high: number | null
  /** q3 / q1. Null when q1 is not a positive number. */
  widthRatio: number | null
  /** False suppresses the range and any verdict — never the median. */
  widthOk: boolean
  tier: DisplayTier
  /** Share of rows in the filtered set carrying a condition value, 0–1. */
  conditionCoverage: number
}

function emptyExclusions(): Record<ExclusionReason, number> {
  return { price_not_listed: 0, no_comparable_dkk: 0, unresolved_population: 0, iqr_outlier: 0 }
}

function tierFor(role: PopulationRole, n: number): DisplayTier {
  if (n >= MIN_BAND_N) return 'band'
  // A reference population is either a band or it is not shown. Only the
  // primary population earns the descriptive middle steps, because a thin
  // Danish market is information the user needs, while a thin Reverb sample
  // is just a worse version of a number we already have.
  if (role !== 'primary') return 'none'
  if (n >= MIN_DESCRIPTIVE_MEDIAN_N) return 'median-only'
  if (n >= 1) return 'listings-only'
  return 'none'
}

/**
 * Build the statistics for ONE population.
 *
 * `rows` must already belong to `key`; callers get that guarantee from
 * `groupByPopulation`. There is deliberately no variant of this function that
 * takes a list of populations.
 */
export interface BuildOptions {
  /**
   * True when retrieval could not be completed — see `fetchAllPages`'s
   * `truncated`. A partial population must never be presented as a complete
   * one, so every statistic is withheld rather than computed from a fragment.
   */
  incomplete?: boolean
}

export function buildPopulationStats(
  key: PopulationKey,
  rows: readonly PriceObservation[],
  options: BuildOptions = {},
): PopulationStats {
  const descriptor = POPULATIONS[key]
  const excluded = emptyExclusions()

  const eligible: PriceObservation[] = []
  for (const row of rows) {
    if (row.price == null) {
      excluded.price_not_listed += 1
      continue
    }
    const dkk = row.price_dkk == null ? null : Number(row.price_dkk)
    // Fail-closed. A row with a price but no stored conversion keeps its
    // original price on screen and leaves every DKK statistic alone.
    if (dkk == null || !Number.isFinite(dkk) || dkk <= 0) {
      excluded.no_comparable_dkk += 1
      continue
    }
    eligible.push(row)
  }

  const values = usableValues(eligible.map((r) => Number(r.price_dkk)))
  const { kept, excluded: outliers } = partitionByIqr(values)
  excluded.iqr_outlier = outliers.length

  const keptRows = (() => {
    // Re-associate kept values with rows so condition coverage is measured on
    // the same set the statistics are built on, not on the pre-filter set.
    const remaining = [...kept]
    const out: PriceObservation[] = []
    for (const row of eligible) {
      const idx = remaining.indexOf(Number(row.price_dkk))
      if (idx !== -1) {
        remaining.splice(idx, 1)
        out.push(row)
      }
    }
    return out
  })()

  const q = kept.length > 0 ? quartiles(kept) : null
  const widthRatio = q && q.q1 > 0 ? q.q3 / q.q1 : null
  const widthOk = widthRatio != null && widthRatio <= MAX_BAND_WIDTH_RATIO
  const tier: DisplayTier = options.incomplete
    ? 'unavailable'
    : tierFor(descriptor.role, kept.length)

  /**
   * REDACTION, not a rendering convention.
   *
   * A tier that may not show a statistic gets `null` for it, so a template
   * cannot render a median at n=2 by forgetting to check the tier. The counts
   * survive redaction — they are how the number is explained, and `nRaw`,
   * `nEligible` and `nFiltered` still reconcile on every path.
   *
   * The width guard suppresses the RANGE only. A median over eight or more
   * observations stays true even when the spread is too wide to summarise.
   */
  const showMedian = tier === 'median-only' || tier === 'band'
  const showRange = tier === 'band' && widthOk
  const complete = !options.incomplete

  const withCondition = keptRows.filter(
    (r) => typeof r.condition === 'string' && r.condition.trim() !== '',
  ).length

  return {
    key,
    kind: descriptor.kind,
    role: descriptor.role,
    confirmedSales: descriptor.confirmedSales,
    complete,
    // An incomplete population reports zero observations rather than a
    // fragment's count, because a partial `n` reads as a real one.
    nRaw: complete ? rows.length : 0,
    nEligible: complete ? eligible.length : 0,
    nFiltered: complete ? kept.length : 0,
    excluded,
    median: showMedian && q ? q.median : null,
    q1: showRange && q ? q.q1 : null,
    q3: showRange && q ? q.q3 : null,
    low: showMedian && kept.length ? Math.min(...kept) : null,
    high: showMedian && kept.length ? Math.max(...kept) : null,
    widthRatio,
    widthOk,
    tier,
    conditionCoverage: keptRows.length === 0 ? 0 : withCondition / keptRows.length,
  }
}

export interface GroupedListings {
  byPopulation: Record<PopulationKey, PriceObservation[]>
  unresolved: PriceObservation[]
}

/** Split a product's listings into their populations. Never merges. */
export function groupByPopulation(listings: readonly PriceObservation[]): GroupedListings {
  const byPopulation = {
    'dk-asking': [] as PriceObservation[],
    'de-asking': [] as PriceObservation[],
    'se-asking': [] as PriceObservation[],
    'no-asking': [] as PriceObservation[],
    'reverb-asking': [] as PriceObservation[],
    'reverb-sold': [] as PriceObservation[],
  } as Record<PopulationKey, PriceObservation[]>
  const unresolved: PriceObservation[] = []

  for (const listing of listings) {
    const { population } = classifyListing(listing)
    if (population == null) unresolved.push(listing)
    else byPopulation[population].push(listing)
  }
  return { byPopulation, unresolved }
}

// ── Verdict ─────────────────────────────────────────────────────────────────

export type Verdict = 'under' | 'typical' | 'over'

export interface VerdictResult {
  verdict: Verdict | null
  /** The population the verdict was measured against. Null when none applies. */
  against: PopulationKey | null
  reason:
    | 'ok'
    | 'no_comparable_price'
    | 'insufficient_n'
    | 'width_guard_failed'
    | 'population_mismatch'
}

/**
 * Position one asking price inside ONE population's band.
 *
 * Boundaries per V1 §9.3, inclusive at both quartiles:
 *
 *   price <  q1            under typisk
 *   q1 <= price <= q3      typisk
 *   price >  q3            over typisk
 *
 * There is no fourth "above every recorded sale" state in P2. That would mean
 * measuring an asking price against the sold population, which decision C2
 * defers as a separate product decision.
 *
 * `listingPopulation` must equal `stats.key`. A verdict measured against
 * another market's band is the blending this module exists to prevent, so it
 * is refused rather than silently computed.
 */
export function verdictFor(
  priceDkk: number | null | undefined,
  listingPopulation: PopulationKey | null,
  stats: PopulationStats,
): VerdictResult {
  if (listingPopulation == null || listingPopulation !== stats.key) {
    return { verdict: null, against: null, reason: 'population_mismatch' }
  }
  const price = priceDkk == null ? null : Number(priceDkk)
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { verdict: null, against: null, reason: 'no_comparable_price' }
  }
  if (stats.tier !== 'band') {
    return { verdict: null, against: null, reason: 'insufficient_n' }
  }
  if (!stats.widthOk) {
    return { verdict: null, against: null, reason: 'width_guard_failed' }
  }
  if (stats.q1 == null || stats.q3 == null) {
    return { verdict: null, against: null, reason: 'insufficient_n' }
  }
  if (price < stats.q1) return { verdict: 'under', against: stats.key, reason: 'ok' }
  if (price > stats.q3) return { verdict: 'over', against: stats.key, reason: 'ok' }
  return { verdict: 'typical', against: stats.key, reason: 'ok' }
}

// ── Presentation helpers ────────────────────────────────────────────────────

/**
 * Whether a converted DKK figure should carry the "ca." qualifier.
 *
 * Danish rows are native DKK and are shown exactly. Everything else is a
 * stored conversion and is approximate. Determined by population, never by
 * `currency` — see the file header.
 */
export function isApproximateDkk(population: PopulationKey | null): boolean {
  return population != null && population !== 'dk-asking'
}

/**
 * Whether a condition breakdown is worth rendering.
 *
 * dba.dk, Kleinanzeigen, Finn and Blocket carry 100% null condition in
 * production, so a chart built from them would be a single "Ukendt" bucket
 * asserting a distribution that does not exist. Missing condition must never
 * remove a listing from price display — only from a condition breakdown.
 */
export function hasUsableConditionData(stats: PopulationStats): boolean {
  return stats.nFiltered > 0 && stats.conditionCoverage > 0
}

/**
 * The only timestamp allowed to describe how long a listing has been for sale.
 *
 * `scraped_at` is when Klup last looked, not when the seller posted. The page
 * previously rendered it as "12t siden" on every row, which was a freshness
 * claim about Klup's cron schedule wearing the clothes of a listing age. There
 * is no fallback: when `first_seen_at` is null the caller renders nothing.
 *
 * Measured on the ACTIVE population 2026-09-01 — the rows the UI actually
 * shows — coverage is dba.dk 100%, reverb 72.5%, finn 62.7%, blocket 60.0%,
 * kleinanzeigen 27.2%. The null branch is the common case, not an edge case.
 */
export function firstSeenTimestamp(listing: {
  first_seen_at?: string | null
  scraped_at?: string | null
}): string | null {
  const value = listing.first_seen_at
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  return Number.isFinite(new Date(trimmed).getTime()) ? trimmed : null
}

/**
 * The i18n key naming the population a verdict was measured against.
 *
 * A key, not rendered text: the route computes the verdict server-side and
 * does not know the caller's locale, so the label is resolved at render. It
 * is display-safe by construction — the values are copy keys, never database
 * vocabulary. Sold populations return null: a verdict is never measured
 * against sold prices.
 */
export function verdictBasisLabelKey(population: PopulationKey | null): string | null {
  switch (population) {
    case 'dk-asking':     return 'verdictBasisDk'
    case 'de-asking':     return 'verdictBasisDe'
    case 'se-asking':     return 'verdictBasisSe'
    case 'no-asking':     return 'verdictBasisNo'
    case 'reverb-asking': return 'verdictBasisReverbAsking'
    default:              return null
  }
}
