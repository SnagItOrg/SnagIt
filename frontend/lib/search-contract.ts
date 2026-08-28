/**
 * The client-safe half of the restricted-search contract.
 *
 * Stage 3 WP-4a. See docs/stage-3-v1-decision-and-build-plan.md §8.2.
 *
 * WHY THIS MODULE EXISTS. `/search` is a client component and it needs three
 * things from the search layer: the shape of an outcome so it can render one,
 * the analytics payload builders so its events match WP-5's taxonomy, and
 * normalisation. It needs NONE of the resolution machinery. Before this split
 * it imported all of it from `lib/search-resolver.ts`, which value-imports
 * `lib/search-index.ts` — a module that carries the slugs and labels of the 34
 * UNPUBLISHED supported identities and throws on evaluation in a browser. The
 * import edge alone was enough: bundling pulled the private artefact into a
 * public chunk and the module-scope guard then blanked the page with a
 * hydration failure. The guard was right; the boundary was wrong.
 *
 * WHAT MAY LIVE HERE. Types, the outcome vocabulary, and pure functions over
 * an outcome that a browser is allowed to see. Everything here is derived from
 * data the server has already decided to send.
 *
 * WHAT MAY NEVER LIVE HERE — and the WP-4a suite fails if it does:
 *   - the search artefact or any slug/label from it;
 *   - `lib/search-index.ts`, `lib/families.ts`, `lib/catalogue.ts`, or
 *     `lib/synonyms.ts`, at any import depth;
 *   - eligibility predicates or support/visibility axes;
 *   - resolution itself, which runs on the server against candidates the
 *     browser must never receive.
 *
 * The ONE dependency is `./model-key`, which composes `./query-normalizer`:
 * string normalisation with no catalogue data in it.
 *
 * NOTHING IS DUPLICATED. The outcome vocabulary, the analytics taxonomy types
 * and the payload builders are DEFINED here and re-exported by
 * `lib/search-resolver.ts`, so server callers and the existing WP-4 test suite
 * keep their import path and there is exactly one declaration of each.
 */

import { queryNorm, queryTokens } from './model-key'

/**
 * Six outcomes. Five are the contract's; `no_result` is the contract's
 * `unsupported` with nothing to suggest, split out so the interface can tell a
 * visitor "we do not follow this, here is what we do follow" apart from "we do
 * not follow this, and we have nothing close to offer".
 */
export type SearchOutcomeKind =
  | 'canonical_exact'
  | 'accepted_alias'
  | 'disambiguation'
  | 'dangerous_alias_blocked'
  | 'unsupported'
  | 'no_result'

/** The vocabulary `search_resolved.resolution` may carry (build plan §8.2). */
export type SearchResolution =
  | 'canonical_exact'
  | 'accepted_alias'
  | 'disambiguation'
  | 'dangerous_alias_blocked'
  | 'unsupported'

/** `search_unsupported.resolution_class` (measurement spec §10). */
export type ResolutionClass =
  | 'unsupported'
  | 'ambiguous'
  | 'dangerous_alias_blocked'
  | 'zero_results_supported'

export interface SearchCandidate {
  kind: 'product' | 'family'
  slug: string
  label: string
  brand: string
  /** `/product/<slug>` or `/family/<slug>`. Never anything else. */
  href: string
}

export interface SearchOutcome {
  outcome: SearchOutcomeKind
  /** The contract vocabulary, for `search_resolved`. */
  resolution: SearchResolution
  /** Present only on the unsupported/no-result branches. */
  resolutionClass: ResolutionClass | null
  /** Contract-normalised query. The only form that may reach analytics. */
  queryNorm: string
  rawTokenCount: number
  /** Set only when the outcome navigates. Null on every other outcome. */
  navigateTo: string | null
  /**
   * What the navigation target IS, so analytics can name it correctly.
   *
   * `search_resolved` must carry `product_slug` for a product and leave it null
   * for a family (build plan §8.2), with the family named by its own property.
   * Deriving that from the URL string at the call site invites exactly the
   * mistake the contract calls out, so the resolver states it.
   */
  navigateKind: 'product' | 'family' | null
  navigateSlug: string | null
  /** True only when `navigateTo` is set. Guardrail G1 reads this. */
  autoNavigated: boolean
  /** Disambiguation set. Empty unless the outcome lists candidates. */
  candidates: SearchCandidate[]
  /** Nearest followed products on the unsupported branch. */
  suggestions: SearchCandidate[]
  /** True when a reviewed synonym rewrote the term. */
  viaSynonym: boolean
}

/* ------------------------------------------------------------------ *
 * Analytics payloads — built here, against WP-5's taxonomy
 * ------------------------------------------------------------------ */

/**
 * WHY THE PAYLOADS ARE BUILT IN THIS MODULE AND NOT IN THE PAGE.
 *
 * WP-5 owns `lib/analytics.ts` and its `KlupEventMap` is the whole contract:
 * every property is declared, every enum is a literal union, and `track()` is
 * generic over the map, so an undeclared property or an invented enum value is
 * a compile error rather than a silent taxonomy corruption. WP-4 may not touch
 * that file, and until WP-5 lands it does not exist on this branch — so the
 * only way to be certain WP-4's payloads fit it is to build them somewhere
 * that a plain Node test can import and type-check against a fixture copied
 * verbatim from the WP-5 commit. A React page cannot be imported that way.
 *
 * Nothing here emits. These are pure functions from a resolver outcome to a
 * payload; the page passes the result to the `useEmit()` seam, which WP-5
 * replaces with `track()`.
 */

/** WP-5 `KlupEventMap['search_submitted']['entry_surface']`. */
export type SearchEntrySurface = 'landing' | 'search' | 'mobile_bar' | 'nav'
/** WP-5 `KlupEventMap['search_submitted']['input_method']`. */
export type SearchInputMethod = 'typed' | 'suggestion' | 'url_param'
/** WP-5 `KlupEventMap['search_resolved']['resolution']`. */
export type TaxonomyResolution =
  | 'canonical_exact'
  | 'accepted_alias'
  | 'disambiguation'
  | 'dangerous_alias_blocked'
  | 'unsupported'
  | 'error'
/** WP-5 `KlupEventMap['search_unsupported']['resolution_class']`. */
export type TaxonomyResolutionClass =
  | 'unsupported'
  | 'ambiguous'
  | 'dangerous_alias_blocked'
  | 'zero_results_supported'
/** WP-5 `KlupEventMap['demand_signal_submitted']['capture_method']`. */
export type DemandCaptureMethod = 'inline_email' | 'notify_button'

/**
 * Resolver outcome -> `search_unsupported.resolution_class`.
 *
 * A `Record` over the outcome union rather than a `switch`, because a Record is
 * exhaustive BY CONSTRUCTION: adding a seventh `SearchOutcomeKind` without
 * classifying it here is a compile error, not a value that quietly arrives as
 * null. `resolution_class` is the property the demand log is grouped by, and a
 * null in it would silently drop that demand from every report.
 *
 * The two resolving outcomes map to `null` — they are not misses and never emit
 * this event. `searchUnsupportedPayload` returns null for them, which is how
 * the caller knows not to emit, and TypeScript narrows the survivors so the
 * emitted property can never be null.
 */
export const UNSUPPORTED_CLASS_BY_OUTCOME: Record<
  SearchOutcomeKind,
  TaxonomyResolutionClass | null
> = {
  canonical_exact: null,
  accepted_alias: null,
  disambiguation: 'ambiguous',
  dangerous_alias_blocked: 'dangerous_alias_blocked',
  unsupported: 'unsupported',
  no_result: 'zero_results_supported',
}

export interface SearchSubmittedPayload {
  query_norm: string
  query_length: number
  token_count: number
  entry_surface: SearchEntrySurface
  input_method: SearchInputMethod
}

export interface SearchResolvedPayload {
  query_norm: string
  resolution: TaxonomyResolution
  candidate_count: number
  product_slug: string | null
  auto_navigated: boolean
  latency_ms: number
}

export interface SearchUnsupportedPayload {
  query_norm: string
  resolution_class: TaxonomyResolutionClass
  raw_token_count: number
  suggested_slugs: string[]
  suggested_count: number
  nearest_distance: number | null
}

export interface DemandSignalPayload {
  query_norm: string
  capture_method: DemandCaptureMethod
  has_email: boolean
  suggested_shown: number
}

/**
 * `search_submitted` — intent, split from outcome.
 *
 * Lengths are derived from the NORMALISED query, not the raw input, so
 * `  TR-808  ` and `tr-808` report the same length and token count. Reporting
 * the raw string would make the metric a measure of typing habits.
 */
export function searchSubmittedPayload(
  rawQuery: string,
  entrySurface: SearchEntrySurface,
  inputMethod: SearchInputMethod,
): SearchSubmittedPayload {
  const norm = queryNorm(rawQuery)
  return {
    query_norm: norm,
    query_length: norm.length,
    token_count: queryTokens(rawQuery).length,
    entry_surface: entrySurface,
    input_method: inputMethod,
  }
}

/**
 * `search_resolved` — exactly one per query.
 *
 * PRODUCT AND FAMILY STAY SEPARATE. The taxonomy declares `product_slug` and
 * nothing else, so a family navigation reports `product_slug: null`: a family
 * is a navigation concept with no listings and no price, and counting one as a
 * product view would overstate product engagement with rows that can never
 * carry a price. The finer-grained resolver outcome is not smuggled in as an
 * extra property — `search_unsupported.resolution_class` is the declared place
 * for it, and `via_synonym` is simply dropped because the taxonomy has no
 * field for it.
 */
export function searchResolvedPayload(
  outcome: SearchOutcome,
  latencyMs: number,
): SearchResolvedPayload {
  return {
    query_norm: outcome.queryNorm,
    resolution: outcome.resolution,
    candidate_count: outcome.candidates.length,
    product_slug: outcome.navigateKind === 'product' ? outcome.navigateSlug : null,
    auto_navigated: outcome.autoNavigated,
    latency_ms: Math.max(0, Math.round(latencyMs)),
  }
}

/**
 * `search_unsupported` — the only demand record V1 has.
 *
 * Returns null for the two resolving outcomes, which do not emit. Every other
 * outcome yields a non-null `resolution_class` by construction.
 *
 * `nearest_distance` is declared nullable and is reported as null: WP-4 ranks
 * candidates by a relevance score, not by a distance metric, and inventing a
 * number that looks like a distance would be worse than admitting there is
 * none.
 */
export function searchUnsupportedPayload(
  outcome: SearchOutcome,
): SearchUnsupportedPayload | null {
  const resolutionClass = UNSUPPORTED_CLASS_BY_OUTCOME[outcome.outcome]
  if (resolutionClass === null) return null
  return {
    query_norm: outcome.queryNorm,
    resolution_class: resolutionClass,
    raw_token_count: outcome.rawTokenCount,
    suggested_slugs: outcome.suggestions.map((s) => s.slug),
    suggested_count: outcome.suggestions.length,
    nearest_distance: null,
  }
}

/**
 * `demand_signal_submitted` — intensity.
 *
 * `inline_email` when an address was left in the inline field, `notify_button`
 * when the control was used without one. The address itself never appears:
 * `has_email` is a boolean and the address goes to Supabase through the
 * magic-link path (§8.5, §12.2).
 */
export function demandSignalPayload(
  outcome: SearchOutcome,
  emailAddress: string,
): DemandSignalPayload {
  const hasEmail = emailAddress.trim().length > 0
  return {
    query_norm: outcome.queryNorm,
    capture_method: hasEmail ? 'inline_email' : 'notify_button',
    has_email: hasEmail,
    suggested_shown: outcome.suggestions.length,
  }
}
