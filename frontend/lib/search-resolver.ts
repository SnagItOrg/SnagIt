/**
 * The restricted-catalogue resolver — SERVER ONLY.
 *
 * Stage 3 WP-4, boundary corrected in WP-4a. Implements the supported-search
 * contract in docs/klup-launch-catalogue-selection.md §11, adopted verbatim by
 * the build plan §8.2.
 *
 * SEARCH IS A RESOLVER, NOT A RESULT PAGE. It answers "which Klup entity do
 * you mean?" and produces exactly one of the outcomes in `./search-contract`.
 * It never produces a listing list, never calls a marketplace scraper, and
 * never writes anything (decision 8; build plan §13.3). The previous `/search`
 * ran four live marketplace scrapes per keystroke-submitted query through an
 * unauthenticated write endpoint; none of that survives.
 *
 * WHY THIS MODULE IS SERVER-ONLY, AND SAYS SO ITSELF.
 *
 * It resolves against `./search-index`, which carries all 48 supported
 * identities — 34 of them UNPUBLISHED. Resolution therefore reads private
 * catalogue state by construction: it must be able to RECOGNISE a private
 * product in order to decline it. That is exactly why the answer, not the
 * index, is what may cross to the browser.
 *
 * WP-4 left the client importing this module for its payload builders, and the
 * value edge to `./search-index` came with it — blanking `/search` on the
 * server-only guard and putting private slugs in a public chunk. WP-4a moves
 * the client-safe half to `./search-contract` and adds the guard below, so the
 * boundary is enforced by this module rather than inherited from its imports.
 * The guard is defence in depth: `./search-index` keeps its own.
 *
 * THIS MODULE IS OTHERWISE PURE. `resolveQuery` takes a query and an index and
 * returns an outcome; it performs no I/O, so every branch is unit-testable
 * without a database, and the eligibility re-check is a separate, explicitly
 * injected step (`filterEligibleSlugs`).
 *
 * ORDER OF RESOLUTION IS THE CONTRACT. Shadow brands are refused before
 * anything else, dangerous terms are refused before synonyms are consulted,
 * and synonyms are consulted before exact matching — so no rewrite can ever
 * smuggle a blocked term into an auto-navigation.
 */

// SERVER-ONLY, AND FIRST. ES modules evaluate imports before the importing
// module's body, so a guard written here would run after ./search-index had
// already been evaluated — unreachable code that reads like protection. The
// side-effect import below runs before every import beneath it, so this module
// refuses a browser on its own terms rather than by inheritance. See
// ./search-server-only.
import './search-server-only'

import {
  DANGEROUS_TERM_KEYS,
  SHADOW_BRAND_KEYS,
  allEntities,
  type SearchEntity,
  type SearchIndex,
} from './search-index'
import { modelKey, queryNorm, queryTokens } from './model-key'
import { lookupSynonym } from './synonyms'
import {
  CANONICAL_DOMAIN,
  CatalogueUnavailableError,
  loadCanonicalSlugs,
} from './catalogue'
import type { SearchCandidate, SearchOutcome } from './search-contract'

/**
 * The contract half is DEFINED in ./search-contract and re-exported here.
 *
 * Not duplicated: one declaration, two import paths. Server callers and the
 * WP-4 suite keep importing outcome types and payload builders from this
 * module; the client imports the same declarations from ./search-contract and
 * never reaches the index through them.
 */
export {
  UNSUPPORTED_CLASS_BY_OUTCOME,
  demandSignalPayload,
  searchResolvedPayload,
  searchSubmittedPayload,
  searchUnsupportedPayload,
} from './search-contract'
export type {
  DemandCaptureMethod,
  DemandSignalPayload,
  ResolutionClass,
  SearchCandidate,
  SearchEntrySurface,
  SearchInputMethod,
  SearchOutcome,
  SearchOutcomeKind,
  SearchResolution,
  SearchResolvedPayload,
  SearchSubmittedPayload,
  SearchUnsupportedPayload,
  TaxonomyResolution,
  TaxonomyResolutionClass,
} from './search-contract'


function href(entity: SearchEntity): string {
  return entity.kind === 'family' ? `/family/${entity.slug}` : `/product/${entity.slug}`
}

function toCandidate(entity: SearchEntity): SearchCandidate {
  return {
    kind: entity.kind,
    slug: entity.slug,
    label: entity.label,
    brand: entity.brand,
    href: href(entity),
  }
}

/** Deterministic ordering everywhere a set is shown: label, then slug. */
function byLabel(a: SearchCandidate, b: SearchCandidate): number {
  const byName = a.label.localeCompare(b.label, 'da')
  return byName !== 0 ? byName : a.slug.localeCompare(b.slug)
}

/** True when any whitespace token of the query is a shadowed brand. */
function containsShadowBrand(raw: string): boolean {
  if (SHADOW_BRAND_KEYS.has(modelKey(raw))) return true
  return queryTokens(raw).some((token) => SHADOW_BRAND_KEYS.has(modelKey(token)))
}

/**
 * A dangerous term is dangerous as the WHOLE query.
 *
 * `rhodes` is dangerous; `rhodes mark i suitcase 73` is a real identity and
 * must still navigate. Checking the whole key rather than any token is what
 * makes the qualifier significant, which is precisely what the contract
 * requires of `Mini`, `Kit`, `FS`, `Suitcase`, `Stage`, `73`, `88` and the rest.
 */
function isDangerousQuery(raw: string): boolean {
  return DANGEROUS_TERM_KEYS.has(modelKey(raw))
}

/** Entities whose alias set contains the key exactly. */
function exactMatches(entities: SearchEntity[], key: string): SearchEntity[] {
  if (key.length === 0) return []
  return entities.filter((entity) => entity.aliasKeys.includes(key))
}

/**
 * Entities the key is a meaningful prefix of, or that share a token with the
 * query. Used only to populate the disambiguation set for a dangerous term and
 * the nearest-product suggestions for an unsupported one — never to navigate.
 */
function relatedMatches(
  entities: SearchEntity[],
  raw: string,
): { entities: SearchEntity[]; best: number } {
  const key = modelKey(raw)
  const tokens = queryTokens(raw).filter((token) => token.length >= 2)
  if (key.length === 0) return { entities: [], best: 0 }

  const scored = entities
    .map((entity) => {
      let score = 0

      // Whole-query relation. `includes` is kept only for the bare model
      // numbers the contract calls dangerous — `808` has to be able to find
      // `tr808` so the disambiguation set is not empty.
      for (const alias of entity.aliasKeys) {
        if (alias === key) score = Math.max(score, 100)
        else if (alias.startsWith(key) || key.startsWith(alias)) score = Math.max(score, 60)
        else if (alias.includes(key)) score = Math.max(score, 40)
      }

      // Token relation, EXACT ALIAS ONLY.
      //
      // Substring token matching was tried and removed: it scored `mini` from
      // "MS-20 Mini" against `minimoog`, so the disambiguation set for a Korg
      // query offered a Moog. A token is evidence when it names an identity,
      // not when it happens to be a prefix of one.
      for (const token of tokens) {
        const tokenKey = modelKey(token)
        if (tokenKey.length < 2) continue
        if (entity.aliasKeys.includes(tokenKey)) score += 25
      }

      // Brand affinity, deliberately weak. Enough to make "Yamaha CS-80"
      // suggest the Yamaha that Klup does follow; never enough on its own to
      // reach the candidate threshold below, so "roland tr" cannot list every
      // Roland in the catalogue.
      const brandKey = modelKey(entity.brand)
      if (brandKey.length >= 2 && tokens.some((token) => modelKey(token) === brandKey)) {
        score += 15
      }

      return { entity, score }
    })
    .filter(({ score }) => score > 0)

  if (scored.length === 0) return { entities: [], best: 0 }

  // Keep only what is competitive with the best match. Without this a weak
  // brand hit sits in the same list as an exact model hit and the
  // disambiguation screen stops disambiguating anything.
  const best = Math.max(...scored.map((s) => s.score))
  const threshold = best / 2

  return {
    best,
    entities: scored
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.entity.slug.localeCompare(b.entity.slug)
      })
      .map(({ entity }) => entity),
  }
}

/**
 * The weakest score that counts as evidence about the MODEL rather than about
 * the brand.
 *
 * Below this the only thing the query and the entity have in common is the
 * manufacturer, and "did you mean one of the seven Rolands?" is not a
 * disambiguation — it is a list. `roland tr-707` asks for a specific product
 * Klup does not publish, and the honest answer is "not followed, here is the
 * nearest", not "which one did you mean?".
 */
const MODEL_EVIDENCE_MIN = 40

const MAX_CANDIDATES = 8
const MAX_SUGGESTIONS = 4

function base(raw: string): Omit<SearchOutcome, 'outcome' | 'resolution' | 'resolutionClass'> {
  return {
    queryNorm: queryNorm(raw),
    rawTokenCount: queryTokens(raw).length,
    navigateTo: null,
    navigateKind: null,
    navigateSlug: null,
    autoNavigated: false,
    candidates: [],
    suggestions: [],
    viaSynonym: false,
  }
}

/**
 * Resolve a query against the index.
 *
 * Nothing here decides eligibility. Every slug this returns is a CLAIM that
 * must still be re-validated against live catalogue state by
 * `filterEligibleSlugs` before it reaches a visitor, so that a stale index can
 * under-serve but never link to a page that 404s.
 */
export function resolveQuery(rawQuery: string, index: SearchIndex): SearchOutcome {
  const entities = allEntities(index)
  const shell = base(rawQuery)

  if (shell.queryNorm.length === 0) {
    return { ...shell, outcome: 'no_result', resolution: 'unsupported', resolutionClass: 'zero_results_supported' }
  }

  // 1. Shadowed brands never navigate and never suggest across the shadow.
  //    Squier is not a route to Fender and Epiphone is not a route to Gibson,
  //    because the matcher already rejects exactly that collision.
  if (containsShadowBrand(rawQuery)) {
    return {
      ...shell,
      outcome: 'unsupported',
      resolution: 'unsupported',
      resolutionClass: 'unsupported',
    }
  }

  // 2. Dangerous terms: show the set, never pick. Checked BEFORE synonyms so a
  //    rewrite can never turn a blocked term into a navigation.
  if (isDangerousQuery(rawQuery)) {
    // NOT capped here. The index now carries all 48 supported identities, so
    // slicing before the eligibility filter could drop the public products
    // behind private ones that are about to be removed anyway. Display caps are
    // applied in `applyEligibility`, after the filter.
    const candidates = relatedMatches(entities, rawQuery).entities.map(toCandidate)
    return {
      ...shell,
      outcome: 'dangerous_alias_blocked',
      resolution: 'dangerous_alias_blocked',
      resolutionClass: 'dangerous_alias_blocked',
      candidates: candidates.sort(byLabel),
    }
  }

  // 3. Reviewed synonyms. `space echo` is itself dangerous and was already
  //    refused above, so only safe rewrites reach this point.
  const synonym = lookupSynonym(shell.queryNorm)
  const effective = synonym ?? rawQuery
  const viaSynonym = synonym !== null
  const key = modelKey(effective)

  // 4. Exact identity or accepted alias.
  const hits = exactMatches(entities, key)

  if (hits.length === 1) {
    const hit = hits[0]
    const isPrimary = !viaSynonym && modelKey(hit.slug) === key
    return {
      ...shell,
      viaSynonym,
      outcome: isPrimary ? 'canonical_exact' : 'accepted_alias',
      resolution: isPrimary ? 'canonical_exact' : 'accepted_alias',
      resolutionClass: null,
      navigateTo: href(hit),
      navigateKind: hit.kind,
      navigateSlug: hit.slug,
      autoNavigated: true,
      // The nearest set is computed even on a successful navigation, and is
      // simply unused when the navigation stands. It exists so that a target
      // the gate later refuses — a private supported product, or one withdrawn
      // between the build and the request — can still degrade into "not
      // followed, here is the nearest" rather than a bare dead end.
      suggestions: relatedMatches(entities, effective)
        .entities.filter((e) => e.slug !== hit.slug)
        .map(toCandidate),
    }
  }

  if (hits.length > 1) {
    return {
      ...shell,
      viaSynonym,
      outcome: 'disambiguation',
      resolution: 'disambiguation',
      resolutionClass: 'ambiguous',
      candidates: hits.map(toCandidate).sort(byLabel),
    }
  }

  // 5. Nothing matched. Offer the nearest followed products, or admit there is
  //    nothing close. Neither branch ever produces a listing.
  const related = relatedMatches(entities, effective)

  // A disambiguation needs model-level evidence. Brand affinity alone means the
  // visitor named a product Klup does not follow, and the nearest-products
  // branch below is the honest answer.
  if (related.entities.length > 1 && related.best >= MODEL_EVIDENCE_MIN) {
    return {
      ...shell,
      viaSynonym,
      outcome: 'disambiguation',
      resolution: 'disambiguation',
      resolutionClass: 'ambiguous',
      candidates: related.entities.map(toCandidate).sort(byLabel),
    }
  }

  const suggestions = related.entities.map(toCandidate)
  return {
    ...shell,
    viaSynonym,
    outcome: suggestions.length > 0 ? 'unsupported' : 'no_result',
    resolution: 'unsupported',
    resolutionClass: suggestions.length > 0 ? 'unsupported' : 'zero_results_supported',
    suggestions,
  }
}

/* ------------------------------------------------------------------ *
 * Eligibility re-validation
 * ------------------------------------------------------------------ */

export interface EligibilityFetchers {
  /** Rows of `{ slug, status, support_state, browse_visibility }`. */
  canonicalRows: () => Promise<{ data: unknown; error: unknown }>
  /** Rows of `{ slug, browse_domain }` from `browse_product_projection`. */
  domainRows: () => Promise<{ data: unknown; error: unknown }>
}

/**
 * Reduce a set of claimed product slugs to those that pass the FULL four-axis
 * predicate against live state.
 *
 * WHY THIS EXISTS. The index is a build artefact. Between deploys an operator
 * can depublish or unsupport a product through the promotion seam, and WP-1's
 * whole freshness correction was that a baked catalogue payload must never be
 * the authority. Re-checking here is what makes "no result links to a 404" true
 * rather than hoped for.
 *
 * FAIL-CLOSED. A slug whose row is missing, whose axes cannot be read, or whose
 * `browse_domain` is not `music` is dropped. The caller surfaces a
 * `CatalogueUnavailableError` as a 503 rather than presenting a thinner
 * catalogue as though it were the truth.
 */
export async function filterEligibleSlugs(
  fetchers: EligibilityFetchers,
  slugs: string[],
): Promise<Set<string>> {
  const wanted = new Set(slugs)
  if (wanted.size === 0) return new Set()

  const canonical = await loadCanonicalSlugs(fetchers.canonicalRows)

  let domainResult: { data: unknown; error: unknown }
  try {
    domainResult = await fetchers.domainRows()
  } catch {
    throw new CatalogueUnavailableError('search_domain_transport')
  }
  if (domainResult.error) throw new CatalogueUnavailableError('search_domain_probe')
  if (!Array.isArray(domainResult.data)) throw new CatalogueUnavailableError('search_domain_shape')

  const music = new Set<string>()
  for (const raw of domainResult.data as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue
    if (typeof raw.slug !== 'string') continue
    if (raw.browse_domain !== CANONICAL_DOMAIN) continue
    music.add(raw.slug)
  }

  const out = new Set<string>()
  wanted.forEach((slug) => {
    if (canonical.has(slug) && music.has(slug)) out.add(slug)
  })
  return out
}

/**
 * Apply an eligibility verdict to an outcome.
 *
 * Family targets are not database entities — `lib/families.ts` is reviewed code
 * — so they are validated against the family list, not against the predicate.
 * A product target that has become ineligible degrades rather than 404s: a
 * navigation becomes the remaining candidate set, and an empty set becomes an
 * honest "not followed".
 */
export function applyEligibility(
  outcome: SearchOutcome,
  eligibleProductSlugs: Set<string>,
  eligibleFamilySlugs: Set<string>,
): SearchOutcome {
  const keep = (c: SearchCandidate) =>
    c.kind === 'family' ? eligibleFamilySlugs.has(c.slug) : eligibleProductSlugs.has(c.slug)

  // FILTER FIRST, THEN CAP.
  //
  // The index carries all 48 supported identities, of which 34 are private
  // today. Capping before the filter would let private entries occupy the
  // display slots and push public ones out — the visitor would see a shorter
  // list, or none, for a query that has perfectly good public answers. The caps
  // are presentation, so they are applied last.
  const candidates = outcome.candidates.filter(keep).slice(0, MAX_CANDIDATES)
  const suggestions = outcome.suggestions.filter(keep).slice(0, MAX_SUGGESTIONS)

  let navigateTo = outcome.navigateTo
  if (navigateTo) {
    const stillEligible =
      outcome.navigateKind === 'family'
        ? eligibleFamilySlugs.has(outcome.navigateSlug ?? '')
        : eligibleProductSlugs.has(outcome.navigateSlug ?? '')
    if (!stillEligible) navigateTo = null
  }

  // A dangerous term that fired the guard KEEPS its resolution even if every
  // candidate is then filtered out. `dangerous_alias_blocked` records that the
  // guard worked; rewriting it to `unsupported` because the only matches were
  // private would erase the very signal the measurement contract counts, and
  // would make the guard look like it never fired.
  const guardFired = outcome.outcome === 'dangerous_alias_blocked'

  if (outcome.navigateTo && !navigateTo) {
    // The target is private, or was withdrawn between the build and this
    // request. Either way it stops being a navigation and never leaks as one.
    const hasSet = candidates.length > 0
    return {
      ...outcome,
      navigateTo: null,
      navigateKind: null,
      navigateSlug: null,
      autoNavigated: false,
      outcome: hasSet ? 'disambiguation' : suggestions.length > 0 ? 'unsupported' : 'no_result',
      resolution: hasSet ? 'disambiguation' : 'unsupported',
      resolutionClass: hasSet
        ? 'ambiguous'
        : suggestions.length > 0
          ? 'unsupported'
          : 'zero_results_supported',
      candidates,
      suggestions,
    }
  }

  if (!outcome.navigateTo && outcome.candidates.length > 0 && candidates.length === 0) {
    return {
      ...outcome,
      candidates: [],
      suggestions,
      outcome: 'no_result',
      resolution: guardFired ? 'dangerous_alias_blocked' : 'unsupported',
      resolutionClass: guardFired ? 'dangerous_alias_blocked' : 'zero_results_supported',
    }
  }

  if (outcome.outcome === 'unsupported' && suggestions.length === 0) {
    return { ...outcome, candidates, suggestions, outcome: 'no_result', resolutionClass: 'zero_results_supported' }
  }

  return { ...outcome, candidates, suggestions, navigateTo }
}

