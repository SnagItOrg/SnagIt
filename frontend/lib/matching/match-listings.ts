/**
 * Shared listing-to-product matching logic.
 *
 * Accepts a Supabase client and an array of listing IDs to match.
 * Used by:
 *   - scripts/match-listings.ts  (manual runs)
 *   - app/api/cron/scrape/route.ts  (automatic after each scrape)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  detectBrandCollision,
  brandCollisionReason,
  detectCatalogueBrands,
  detectOfferedBrand,
  tokenFollowedByReference,
  wordIndexOf,
  OFFERED_BRAND_LEAD_WORDS,
  containsBrandToken,
  type BrandCollision,
} from './brand-guard'
import { detectNonProductIntent, type NonProductIntent } from './listing-intent'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Listing {
  id:    string
  title: string
}

interface Identifier {
  product_id: string
  type:       string
  value:      string
}

interface Synonym {
  alias:           string
  canonical_query: string | null
}

export interface Product {
  id:             string
  slug:           string
  canonical_name: string
  model_name:     string | null
  /** Lowercased `kg_brand.name`; null when the product has no brand row. */
  brand_name:     string | null
  /**
   * `kg_product.status`. REQUIRED, not optional: making it mandatory forces
   * every construction site to state eligibility explicitly, so a new caller
   * cannot silently inherit "unknown status" and have it treated as eligible.
   * Only the exact string `'active'` is eligible — see MATCHABLE_STATUS.
   */
  status:         string | null
  /**
   * `kg_product.support_state` (migration 056). REQUIRED for the same reason as
   * `status`. Identity (`status`) says "this is a verified music product";
   * SUPPORT says "this product is in the frozen launch cohort and may receive
   * automatic matches". They are different questions and the KG holds far more
   * verified products than the launch cohort — see MATCHABLE_SUPPORT_STATE.
   */
  support_state:  string | null
}

export interface MatchCandidate {
  product_id: string
  method:     'EAN' | 'SKU' | 'MODEL' | 'SYNONYM' | 'FUZZY'
  score:      number
  explain:    Record<string, unknown>
}

/**
 * Minimum score at which an automatic match may be written as trusted.
 *
 * EVIDENCE FOR THIS EXACT VALUE — the existing scoring contract is:
 *   95  kg_identifier SKU/MODEL — a curated identifier token
 *   80  synonym alias (match_type='alias') — a curated alias
 *   70  kg_product.model_name token — the ONLY tier with no curation behind it
 *   (100 FUZZY is produced by the admin curation routes, never by this core.)
 *
 * The 70 tier is exactly the class the dry run showed to be unsafe: 76 DBA and
 * 342 Kleinanzeigen proposals, including cross-brand instruments ("ESP J-Four
 * Jazz Bass" -> Fender Jazz Bass, "Ibanez Performer PF100" -> Crumar
 * Performer), parts and wanted ads. 80 is therefore the narrowest threshold
 * that excludes the observed failure class without touching either curated
 * tier.
 */
export const AUTO_CONFIDENCE_MIN = 80

/**
 * Why a listing produced no trusted automatic match. Deferred outcomes write
 * NO ROW — they are re-evaluated on a later run, or picked up by human review.
 */
export type DeferralReason =
  /** >1 distinct product shares the top score and no brand evidence separates them. */
  | 'ambiguous_tie'
  /** Best score is below AUTO_CONFIDENCE_MIN and the product's own brand is absent. */
  | 'low_confidence'
  /** The title names a different catalogue brand than every surviving candidate. */
  | 'brand_mismatch'
  /** The title offers a part/accessory, or is a wanted ad — not the product itself. */
  | 'non_product_intent'
  /** The tied products are duplicate KG rows for the same (brand, model). */
  | 'product_data_conflict'
  /** The tie comes from an identifier term that several products can claim. */
  | 'shared_identifier_conflict'
  /** The title offers a different maker's product and merely REFERENCES this one. */
  | 'copy_or_reference'

/**
 * Outcome of evaluating one listing title against the knowledge graph.
 * The five kinds are mutually exclusive; see DECISION PRECEDENCE in decideMatch.
 *
 *   matched  — a single product is the unambiguous, brand-compatible,
 *              sufficiently-confident winner. Row written, is_valid unset.
 *   rejected — a hard licensed-subsidiary brand collision (Epiphone/Gibson,
 *              Squier/Fender) left nothing admissible. Row written with
 *              is_valid=false so the decision stays auditable.
 *   deferred — unsafe for automation. NO ROW.
 *   none     — no candidate at all. NO ROW.
 */
export type MatchDecision =
  | { kind: 'matched';  best: MatchCandidate; admissible: MatchCandidate[]; brandEvidence: string | null }
  | { kind: 'rejected'; best: MatchCandidate; collision: BrandCollision }
  | {
      kind: 'deferred'
      reason: DeferralReason
      candidates: MatchCandidate[]
      detail: string
      /** Present only when reason === 'non_product_intent'. */
      intent?: NonProductIntent
    }
  | { kind: 'none' }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shared token-boundary regex, so runtime matching and the shared-identifier
 *  audit can never diverge on what "contains" means. */
function tokenRegex(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i')
}

function containsToken(text: string, token: string): boolean {
  if (token.length < 3) return false
  return tokenRegex(token).test(text)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function resolveCanonical(canonical: string, products: Product[]): Product | undefined {
  const cSlug  = slugify(canonical)
  const cLower = canonical.toLowerCase()

  return (
    products.find(p => p.slug === cSlug) ??
    products.find(p => p.slug.startsWith(cSlug + '-')) ??
    products.find(p => p.slug.length >= 4 && cSlug.endsWith('-' + p.slug)) ??
    products.find(p => p.canonical_name.toLowerCase().startsWith(cLower))
  )
}

// ── Pagination helper (PostgREST caps at 1000 rows regardless of .limit()) ────

async function fetchAllRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: () => any,
  pageSize = 1000,
  label = 'table',
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (builder() as any).range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Fetch ${label} page ${offset}: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as T[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

// ── Pure decision core ────────────────────────────────────────────────────────

export interface MatchIndex {
  products:           Product[]
  idents:             Identifier[]
  synonyms:           Synonym[]
  canonicalToProduct: Map<string, Product>
  productById:        Map<string, Product>
  /** Distinct lowercased `kg_brand.name` values present in the catalogue. */
  catalogueBrands:    Set<string>
  /**
   * Normalised identifier term -> every product that term can plausibly
   * represent. Only terms with more than one such product are present.
   * See `buildSharedIdentifierIndex`.
   */
  sharedIdentifiers:  Map<string, Set<string>>
}

/**
 * Which identifier terms are NOT exclusive proof of one product.
 *
 * THE DEFECT THIS CLOSES: `kg_identifier` has no unique constraint on `value`
 * (verified against pg_constraint / pg_indexes — only a PK on id, an FK on
 * product_id, a CHECK on type and a NON-unique index on lower(value)), so the
 * same term may legitimately map to many products. In practice the table is
 * populated asymmetrically:
 *
 *   'Les Paul' -> Epiphone only     (Gibson instead owns the SKU 'PAUL')
 *   'ES-335'   -> Epiphone only     (Gibson instead owns the SKU '335')
 *   'SG', 'J-45' -> Gibson AND Epiphone
 *   'RE-201', 'SPS-1', 'Reference Cardioid/Gold', 'RB-338' -> collide with a
 *   duplicate row of the SAME product
 *
 * A score-95 identifier hit therefore conferred an unjustified brand
 * preference: a brandless "Les Paul Standard 2012" would resolve to *Epiphone*
 * purely because that is the row someone happened to attach the SKU to.
 *
 * THE RULE IS STRUCTURAL, NOT A STRING LIST. A term is shared when some OTHER
 * active product could answer to it — either because that product owns an
 * identifier with the same normalised value, or because the term matches that
 * product's `model_name` under EXACTLY the same `containsToken` semantics the
 * matcher uses on listing titles. Using the matcher's own predicate is what
 * makes the audit and the runtime agree: 'paul' is shared because it matches
 * Epiphone's model_name "Les Paul", while '335' is NOT shared because the
 * word-boundary rule refuses to fire inside "ES-335".
 *
 * Cost is one pass of (identifier terms x products) with pre-compiled
 * regexes — ~78 x 3,862 on the live catalogue.
 */
export function buildSharedIdentifierIndex(
  products: Product[],
  idents: Identifier[],
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>()
  for (const ident of idents) {
    const term = ident.value.trim().toLowerCase()
    if (!term) continue
    let set = owners.get(term)
    if (!set) { set = new Set<string>(); owners.set(term, set) }
    set.add(ident.product_id)
  }

  for (const [term, set] of Array.from(owners.entries())) {
    if (term.length < 3) continue // below the matcher's own token floor
    const re = tokenRegex(term)
    for (const product of products) {
      if (!product.model_name) continue
      if (set.has(product.id)) continue
      const model = product.model_name.trim().toLowerCase()
      if (re.test(model) || re.test(model.replace(/-/g, ' '))) set.add(product.id)
    }
  }

  const shared = new Map<string, Set<string>>()
  for (const [term, set] of Array.from(owners.entries())) {
    if (set.size > 1) shared.set(term, set)
  }
  return shared
}

/**
 * ACTIVE-ONLY ELIGIBILITY — the single enforcement point.
 *
 * THE DEFECT THIS CLOSES: `PRODUCT_SELECT` did not load `status` and no caller
 * filtered it, so the production index held 3,862 products including 293
 * `inactive` ones. Migration 053 retires duplicate losers by flipping `status`
 * only — it never touches `model_name` — so a retired duplicate stayed in
 * candidate generation with an identical `(brand, model_name)` and kept
 * producing `product_data_conflict`. 053 could not deliver its benefit.
 *
 * Filtering here rather than only in each caller's query is deliberate: the
 * index is the one thing every automatic caller must build, so a future caller
 * that forgets `.eq('status','active')` still cannot introduce an inactive
 * candidate. The database filter in `matchListings` is defence in depth.
 *
 * WHAT THIS DOES NOT DO: it never mutates or deletes an inactive product, its
 * identifiers, its synonyms or its historical `listing_product_match` rows.
 * 9 inactive products currently hold 237 historical matches; those remain
 * readable by product pages, `/intel` and the admin surfaces. An inactive
 * product simply cannot receive a NEW automatic match or create a candidate
 * conflict.
 */
export function buildMatchIndex(
  products: Product[],
  idents: Identifier[],
  synonyms: Synonym[],
  verifiedMusicBrands?: Iterable<string>,
): MatchIndex {
  /**
   * BRAND PROTECTION IS BROADER THAN CANDIDATE GENERATION.
   *
   * `catalogueBrands` drives collision detection and offered-brand elimination
   * — "this title says Tokai, so it is not a Gibson". That protection must
   * cover every verified music brand, INCLUDING brands with no supported
   * product, or narrowing the candidate set to the launch cohort would quietly
   * disable the guard for everything outside it.
   *
   * It is derived from IDENTITY (`status='active'`), never from SUPPORT, and
   * never from the raw input, so deprecated non-music brands — Apple, Samsung,
   * the furniture and cycling brands — cannot become brand evidence. Callers
   * that know the full verified brand list (`matchListings` does) pass it
   * explicitly; everyone else gets the identity-derived set.
   */
  const brandSource = products.filter((p) => p.status === MATCHABLE_STATUS)

  // Applied AFTER the brand source is captured, so that the shared-identifier
  // index and every downstream map derive only from eligible CANDIDATES.
  products = products.filter(isMatchableProduct)

  // Identifiers must be filtered too, not just products. The identifier tier
  // offers a candidate keyed on `ident.product_id` without consulting the
  // product map, so an identifier left pointing at an excluded product would
  // still produce a score-95 candidate — and every later guard treats an
  // unknown product as "no brand", i.e. permissively. Caught by the
  // "inactive product excluded even with a score-95 identifier" test.
  const eligibleIds = new Set(products.map((p) => p.id))
  idents = idents.filter((i) => eligibleIds.has(i.product_id))
  const canonicalToProduct = new Map<string, Product>()
  for (const syn of synonyms) {
    if (!syn.canonical_query) continue
    if (canonicalToProduct.has(syn.canonical_query)) continue
    const product = resolveCanonical(syn.canonical_query, products)
    if (product) canonicalToProduct.set(syn.canonical_query, product)
  }
  const productById = new Map<string, Product>()
  for (const p of products) productById.set(p.id, p)

  const catalogueBrands = new Set<string>()
  if (verifiedMusicBrands) {
    for (const b of Array.from(verifiedMusicBrands)) {
      const n = b?.trim().toLowerCase()
      if (n) catalogueBrands.add(n)
    }
  } else {
    for (const p of brandSource) if (p.brand_name) catalogueBrands.add(p.brand_name)
  }
  return {
    products, idents, synonyms, canonicalToProduct, productById, catalogueBrands,
    sharedIdentifiers: buildSharedIdentifierIndex(products, idents),
  }
}

/**
 * Evaluate one listing title. Pure — no I/O, no writes — so both the live
 * matcher and the read-only backlog report can share exactly one definition of
 * what a match is.
 *
 * The brand-compatibility guard is applied HERE, before a candidate can be
 * returned as `matched`, so no code path can produce a trusted collision.
 */
/** Highest score wins; ties broken by product_id so output never depends on input order. */
function strongest(candidates: MatchCandidate[]): MatchCandidate {
  return candidates.reduce((a, b) => {
    if (b.score !== a.score) return b.score > a.score ? b : a
    return b.product_id < a.product_id ? b : a
  })
}

/**
 * Evaluate one listing title. Pure — no I/O, no writes — so every caller
 * (scripts/match-listings.ts, app/api/cron/scrape/route.ts and the read-only
 * backlog report) shares exactly one definition of what a safe match is.
 *
 * DECISION PRECEDENCE (mutually exclusive, evaluated in this order):
 *   1. none                  — no candidate at all
 *   2. rejected              — hard licensed-subsidiary collision left nothing
 *   3. non_product_intent    — title offers a part/accessory, or is a wanted ad
 *   4. brand_mismatch        — catalogue-brand evidence eliminated everything
 *   5. product_data_conflict — tied candidates are duplicate KG rows
 *   6. shared_identifier_conflict — tie caused by a non-exclusive identifier
 *   7. ambiguous_tie         — top score shared, no evidence to separate
 *   8. low_confidence        — best below AUTO_CONFIDENCE_MIN without brand proof
 *   9. copy_or_reference    — another maker's product that merely references this one
 *  10. matched
 *
 * TIER PRECEDENCE IS BY SCORE, NOT BY SUPPRESSION. All three candidate tiers
 * contribute; a compatible higher-tier candidate still wins because 95 > 80 >
 * 70. A lower-tier candidate can only win when every higher-tier candidate was
 * eliminated as brand-incompatible — which is exactly the Gibson ES-335 case.
 *
 * ORDER INDEPENDENCE is a hard requirement: the input `products` array must
 * never be able to change the outcome. Candidates are deduplicated per
 * product, all tiers are collected (no early `break`), and every tie is either
 * broken by explicit evidence or fails closed.
 */
export function decideMatch(title: string, index: MatchIndex): MatchDecision {
  const norm = title.toLowerCase().trim()

  // Best candidate per product, so one product cannot appear twice and inflate
  // or mask a tie.
  const byProduct = new Map<string, MatchCandidate>()
  const offer = (c: MatchCandidate) => {
    const prev = byProduct.get(c.product_id)
    if (!prev || c.score > prev.score) byProduct.set(c.product_id, c)
  }

  // Products this title independently supports via their OWN model_name.
  // Computed first because the shared-identifier rule below needs it: a
  // sibling may only compete for a shared term if the title actually supports
  // that sibling on its own evidence.
  const modelSupported = new Set<string>()
  for (const product of index.products) {
    if (!product.model_name) continue
    const mOrig = product.model_name.toLowerCase().trim()
    const mSpace = mOrig.replace(/-/g, ' ')
    if (
      (mOrig.length >= 3 && containsToken(norm, mOrig)) ||
      (mSpace !== mOrig && mSpace.length >= 3 && containsToken(norm, mSpace))
    ) modelSupported.add(product.id)
  }

  // Identifier match (SKU / MODEL) — score 95
  //
  // A SHARED term does not confer exclusivity. It emits a candidate for every
  // sibling the TITLE ITSELF also supports, all at the same score — scores are
  // never lowered and no product is ever chosen arbitrarily. The siblings tie,
  // and the existing machinery resolves the tie with explicit brand evidence
  // or fails closed.
  //
  // Siblings are intersected with `modelSupported` deliberately. The live KG
  // contains the SKU 'PAUL' on Gibson Les Paul; unfiltered, that one weak term
  // is shared with 17 products (Gibson Les Paul Custom, Gibson The Paul,
  // Gibson ES-346 Paul Jackson Jr., every Epiphone Les Paul variant...) and
  // would flood the top tier, deferring every genuine Les Paul listing. The
  // intersection keeps exactly the products the title genuinely names.
  const sharedTermsHit = new Set<string>()
  for (const ident of index.idents) {
    if (!containsToken(norm, ident.value)) continue
    const term = ident.value.trim().toLowerCase()
    const siblings = index.sharedIdentifiers.get(term)
    const explainBase = { matched_identifier: ident.value, type: ident.type }

    if (!siblings) {
      offer({ product_id: ident.product_id, method: ident.type as 'SKU' | 'MODEL', score: 95, explain: explainBase })
      continue
    }

    // Owner always competes; siblings only on their own title evidence.
    const eligible = Array.from(siblings).filter(
      (id) => id === ident.product_id || modelSupported.has(id),
    )
    if (eligible.length > 1) sharedTermsHit.add(term)

    for (const productId of eligible) {
      offer({
        product_id: productId,
        method:     ident.type as 'SKU' | 'MODEL',
        score:      95,
        explain: eligible.length > 1
          ? { ...explainBase, shared_identifier: true, shared_with: eligible.slice().sort() }
          : explainBase,
      })
    }
  }

  // Synonym match — score 80.
  //
  // NO TIER GATE. This used to run only when the identifier tier produced
  // nothing, which meant a higher-scoring but BRAND-INCOMPATIBLE candidate
  // could shadow the lower tiers entirely. Observed in production: the
  // `ES-335` identifier belongs only to *Epiphone* ES-335 (Gibson's is `335`),
  // so "Gibson ES-335 Dot Ebony" produced a single Epiphone candidate at 95,
  // which brand evidence then eliminated — and the compatible Gibson product,
  // reachable at the model tier, was never even considered. Eight legitimate
  // Gibson DBA listings were deferred that way.
  //
  // All tiers now contribute candidates; compatibility, tie resolution and the
  // confidence floor pick the winner afterwards. Tier precedence is preserved
  // by SCORE, not by suppression — see the ordering note below.
  for (const syn of index.synonyms) {
    if (!syn.canonical_query) continue
    if (!containsToken(norm, syn.alias)) continue
    const product = index.canonicalToProduct.get(syn.canonical_query)
    if (!product) continue
    offer({
      product_id: product.id,
      method:     'SYNONYM',
      score:      80,
      explain:    { matched_alias: syn.alias, canonical_query: syn.canonical_query },
    })
  }

  // Model name match — score 70, from the set computed above.
  // No early `break` and no tier gate — see the note above.
  for (const productId of Array.from(modelSupported)) {
    offer({
      product_id: productId,
      method:     'MODEL',
      score:      70,
      explain:    { matched_model_name: index.productById.get(productId)?.model_name ?? null },
    })
  }

  // Deterministic ordering (score desc, then product_id) so that not only the
  // verdict but every emitted candidate list is independent of input order.
  // Without this the audit payload still varied with product array order.
  const candidates = Array.from(byProduct.values()).sort((a, b) =>
    b.score !== a.score ? b.score - a.score : (a.product_id < b.product_id ? -1 : 1),
  )
  if (candidates.length === 0) return { kind: 'none' }

  // ── 2. Hard licensed-subsidiary collision ───────────────────────────────
  // Epiphone must never become Gibson; Squier must never become Fender. These
  // brands are matched as literal tokens, NOT via the catalogue: 'squier' is
  // not a kg_brand at all, so the catalogue-brand layer below cannot see it.
  const surviving: MatchCandidate[] = []
  let hardCollision: { candidate: MatchCandidate; collision: BrandCollision } | null = null

  for (const candidate of candidates) {
    const product = index.productById.get(candidate.product_id)
    const collision = detectBrandCollision(norm, product?.brand_name ?? null)
    if (collision) {
      if (!hardCollision || candidate.score > hardCollision.candidate.score) {
        hardCollision = { candidate, collision }
      }
      continue
    }
    surviving.push(candidate)
  }

  if (surviving.length === 0) {
    // Non-null because `candidates` was non-empty and nothing survived.
    return { kind: 'rejected', best: hardCollision!.candidate, collision: hardCollision!.collision }
  }

  // ── 3. Non-product intent ───────────────────────────────────────────────
  // A property of the LISTING, not of any candidate: the title offers a part
  // or accessory, or is a wanted ad. Checked after the hard-collision branch
  // so a licensed-subsidiary collision keeps its auditable is_valid=false row,
  // but before every candidate-selection rule — no amount of brand proof or
  // score should let a pickup set become the instrument.
  const intent = detectNonProductIntent(norm)
  if (intent) {
    return {
      kind: 'deferred',
      reason: 'non_product_intent',
      intent: intent.intent,
      candidates: surviving,
      detail: `${intent.intent} (token '${intent.token}')`,
    }
  }

  // ── 4. Symmetric catalogue-brand elimination ────────────────────────────
  // If the title names exactly ONE catalogue brand (after child-brand
  // precedence), any candidate belonging to a DIFFERENT explicit brand is
  // wrong regardless of score. This is what makes Gibson->Gibson and
  // Epiphone->Epiphone deterministic instead of order-dependent.
  //
  // A set of size != 1 is unusable evidence: zero means no brand was named,
  // more than one means the title names several unrelated brands ("Squier
  // Jazz Bass + Harley Benton amp"). Neither may be used to pick a winner.
  const detected = detectCatalogueBrands(norm, index.catalogueBrands)
  const brandEvidence = detected.size === 1 ? Array.from(detected)[0] : null

  let admissible = surviving
  if (brandEvidence) {
    // Products with no brand recorded are not "a different explicit brand" and
    // are therefore not eliminated.
    admissible = surviving.filter((c) => {
      const b = index.productById.get(c.product_id)?.brand_name
      return !b || b === brandEvidence
    })
    if (admissible.length === 0) {
      return {
        kind: 'deferred',
        reason: 'brand_mismatch',
        candidates: surviving,
        detail: `title names catalogue brand '${brandEvidence}'; no candidate belongs to it`,
      }
    }
  }

  // ── 5. Ambiguity ────────────────────────────────────────────────────────
  const topScore = admissible.reduce((m, c) => (c.score > m ? c.score : m), -Infinity)
  const topTier  = admissible.filter((c) => c.score === topScore)

  if (topTier.length > 1) {
    // Duplicate KG rows: the tied products are the SAME (brand, model_name),
    // so no title could ever separate them. Reported distinctly from a genuine
    // ambiguity because the fix is a data repair, not better matching.
    //
    // A brand is REQUIRED to make this claim. Two brandless products sharing a
    // model name are merely indistinguishable, not provably duplicates, and
    // are reported as an ordinary ambiguous tie.
    const tiedProducts = topTier.map((c) => index.productById.get(c.product_id))
    const identities = new Set(tiedProducts.map((p) =>
      `${p?.brand_name ?? ''}|${(p?.model_name ?? '').trim().toLowerCase()}`,
    ))
    const allBranded = tiedProducts.every((p) => !!p?.brand_name)
    if (allBranded && identities.size === 1) {
      return {
        kind: 'deferred',
        reason: 'product_data_conflict',
        candidates: topTier,
        detail: `${topTier.length} duplicate kg_product rows share identity '${Array.from(identities)[0]}'`,
      }
    }

    // A tie produced by a shared identifier term is reported distinctly: the
    // cause is a KG identifier that several products can legitimately claim,
    // not an inherently ambiguous title. Its remedy is identifier curation.
    if (topTier.some((c) => (c.explain as { shared_identifier?: boolean }).shared_identifier)) {
      return {
        kind: 'deferred',
        reason: 'shared_identifier_conflict',
        candidates: topTier,
        detail: `${topTier.length} products claim shared identifier term(s) ` +
                `${Array.from(sharedTermsHit).sort().map(t => `'${t}'`).join(', ')} ` +
                `and no brand evidence separates them`,
      }
    }

    // Brand evidence is the only tie-break permitted. It has already been
    // applied above; if a tie survives it, there is genuinely nothing to
    // choose between the products and we must not guess.
    return {
      kind: 'deferred',
      reason: 'ambiguous_tie',
      candidates: topTier,
      detail: `${topTier.length} products tied at score ${topScore} with no brand evidence to separate them`,
    }
  }

  const best = strongest(topTier)

  // ── 6. Automatic-confidence floor ───────────────────────────────────────
  // Below the floor, the only evidence strong enough to make a candidate
  // uniquely safe is the product's OWN brand appearing verbatim in the title.
  if (best.score < AUTO_CONFIDENCE_MIN) {
    const ownBrand = index.productById.get(best.product_id)?.brand_name ?? null
    const brandProven = !!ownBrand && containsBrandToken(norm, ownBrand)
    if (!brandProven) {
      return {
        kind: 'deferred',
        reason: 'low_confidence',
        candidates: [best],
        detail: `score ${best.score} < ${AUTO_CONFIDENCE_MIN} and product brand ` +
                `${ownBrand ? `'${ownBrand}'` : '(none recorded)'} is not present in the title`,
      }
    }
  }

  // ── 7. Copy / reference guard ───────────────────────────────────────────
  // Measured on 19,902 live safe proposals across DBA, Kleinanzeigen and
  // Reverb: these two narrow rules remove ~110 (0.55%), essentially all of
  // them another maker's product that merely mentions this one. Broader
  // variants were rejected — "any reference word anywhere" destroyed 254
  // legitimate rows (Gibson Les Paul '52 Tribute, Epiphone SG Tribute,
  // Epiphone Inspired by Gibson J-45) and "two catalogue brands" destroyed 443
  // (Sequential Oberheim OB-X8, Warm Audio … Neve 1073-Style).
  const evidenceToken = String(
    (best.explain as { matched_identifier?: string; matched_model_name?: string }).matched_identifier ??
    (best.explain as { matched_model_name?: string }).matched_model_name ?? '',
  )

  // 7a. "<model> type/style/clone/kopi/Nachbau" — adjacency only.
  if (evidenceToken && tokenFollowedByReference(norm, evidenceToken.toLowerCase())) {
    return {
      kind: 'deferred',
      reason: 'copy_or_reference',
      candidates: [best],
      detail: `'${evidenceToken}' is immediately qualified as a copy/reference`,
    }
  }

  // 7b. A different maker leads the title and this product's own brand only
  // appears deep inside it.
  const bestBrand = index.productById.get(best.product_id)?.brand_name ?? null
  if (bestBrand) {
    const offered = detectOfferedBrand(norm, index.catalogueBrands)
    if (offered && offered !== bestBrand) {
      const at = wordIndexOf(norm, bestBrand)
      if (at === null || at > OFFERED_BRAND_LEAD_WORDS) {
        return {
          kind: 'deferred',
          reason: 'copy_or_reference',
          candidates: [best],
          detail: `title is led by '${offered}'; '${bestBrand}' appears only at word ` +
                  `${at === null ? 'never' : at} — reads as a reference, not the offer`,
        }
      }
    }
  }

  return { kind: 'matched', best, admissible, brandEvidence }
}

/**
 * The ONLY `kg_product.status` value eligible for automatic matching.
 *
 * Exact-match, fail-closed: `null`, `''`, `'Active'`, `'archived'` or any
 * future value is INELIGIBLE until someone deliberately adds it here.
 * Production currently holds exactly two values — `active` (3,569) and
 * `inactive` (293), with no NULLs.
 */
export const MATCHABLE_STATUS = 'active'

/**
 * The ONLY `kg_product.support_state` value eligible for automatic matching.
 *
 * WHY THIS EXISTS SEPARATELY FROM `status`: the KG is the identity universe and
 * is expected to grow well beyond the launch catalogue. `status='active'` means
 * "verified music product"; it must NOT also mean "may receive automatic
 * matches", or every KG import would silently widen the matcher's target set.
 * Support is the product owner's frozen decision and is set explicitly.
 *
 * Fail-closed and exact-match, exactly like MATCHABLE_STATUS: `null`,
 * `'known'`, `'reserve'` and any future value are INELIGIBLE.
 */
export const MATCHABLE_SUPPORT_STATE = 'supported'

/**
 * A product may generate match candidates only when it is BOTH a verified,
 * non-deprecated identity AND in the supported launch cohort.
 *
 * Visibility (`browse_visibility`) and marketplace monitoring (`tier`) are
 * deliberately absent: a supported product can be matched while still private,
 * and matching never implies that any marketplace is being queried for it.
 */
export function isMatchableProduct(p: Pick<Product, 'status' | 'support_state'>): boolean {
  return p.status === MATCHABLE_STATUS && p.support_state === MATCHABLE_SUPPORT_STATE
}

/**
 * Product select used by both the matcher and the read-only backlog report.
 * `status` is included so eligibility can be enforced in memory even when a
 * caller forgets the database-side filter.
 */
export const PRODUCT_SELECT =
  'id, slug, canonical_name, model_name, status, support_state, kg_brand(name)'

/**
 * Brands whose products are verified music identities. Used ONLY for offered-
 * brand collision protection, never for candidate generation, so it is loaded
 * independently of the supported cohort. `status='active'` is the identity
 * filter that keeps deprecated non-music brands out.
 */
export const BRAND_PROTECTION_SELECT = 'status, kg_brand(name)'

type RawProduct = Omit<Product, 'brand_name'> & {
  kg_brand: { name: string | null } | { name: string | null }[] | null
}

/** PostgREST returns an embedded to-one relation as an object or a 1-element array. */
export function normalizeProductRow(row: RawProduct): Product {
  const brand = Array.isArray(row.kg_brand) ? row.kg_brand[0] : row.kg_brand
  return {
    id:             row.id,
    slug:           row.slug,
    canonical_name: row.canonical_name,
    model_name:     row.model_name,
    brand_name:     brand?.name ? brand.name.trim().toLowerCase() : null,
    // Deliberately NOT defaulted. A row that arrives without `status` is
    // ineligible, which is the fail-closed direction.
    status:         (row as { status?: string | null }).status ?? null,
    // Same rule for support: a row loaded without `support_state` — an old
    // caller, or a query written before migration 056 — is NOT a match target.
    support_state:  (row as { support_state?: string | null }).support_state ?? null,
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

export async function matchListings(
  supabase: SupabaseClient,
  listingIds: string[],
): Promise<{ matched: number; rejected: number; deferred: number; total: number }> {
  if (listingIds.length === 0) return { matched: 0, rejected: 0, deferred: 0, total: 0 }

  const [rawProducts, brandRows, idents, synonyms, listingsResult] = await Promise.all([
    // Database-side eligibility filter. Defence in depth only — buildMatchIndex
    // enforces the same rules in memory, so correctness does not depend on
    // these lines being present.
    fetchAllRows<RawProduct>(
      () => supabase.from('kg_product').select(PRODUCT_SELECT)
              .eq('status', MATCHABLE_STATUS).eq('support_state', MATCHABLE_SUPPORT_STATE),
      1000, 'kg_product',
    ),
    // Brand protection, loaded SEPARATELY and deliberately WITHOUT the support
    // filter: a Tokai listing must be recognised as a Tokai even though no
    // Tokai product is supported. `status='active'` keeps Apple and the other
    // deprecated non-music brands out.
    fetchAllRows<RawProduct>(
      () => supabase.from('kg_product').select(BRAND_PROTECTION_SELECT).eq('status', MATCHABLE_STATUS),
      1000, 'kg_product_brands',
    ),
    fetchAllRows<Identifier>(
      () => supabase.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']),
      1000, 'kg_identifier',
    ),
    fetchAllRows<Synonym>(
      () => supabase.from('synonym').select('alias, canonical_query').eq('match_type', 'alias'),
      1000, 'synonym',
    ),
    supabase.from('listings').select('id, title').in('id', listingIds).not('title', 'is', null),
  ])

  const { data: listingsData, error: lErr } = listingsResult
  if (lErr) throw new Error(`Fetch listings: ${lErr.message}`)

  const products = rawProducts.map(normalizeProductRow)
  const verifiedMusicBrands = new Set<string>()
  for (const row of brandRows) {
    const b = normalizeProductRow(row).brand_name
    if (b) verifiedMusicBrands.add(b)
  }
  const index = buildMatchIndex(products, idents, synonyms, verifiedMusicBrands)

  // Callers are responsible for passing only unmatched IDs
  const listings = ((listingsData as Listing[]) ?? [])

  if (listings.length === 0) return { matched: 0, rejected: 0, deferred: 0, total: 0 }

  const matchRows: Array<{
    listing_id:      string
    product_id:      string
    method:          string
    score:           number
    explain:         Record<string, unknown>
    is_valid?:       boolean
    rejected_reason?: string
  }> = []

  let matchedCount  = 0
  let rejectedCount = 0
  let deferredCount = 0

  for (const listing of listings) {
    const decision = decideMatch(listing.title, index)
    if (decision.kind === 'none') continue

    // Deferred: NOT safe to automate. Deliberately writes NO ROW.
    //
    // A row with is_valid=NULL would be read as TRUSTED by /api/product/[slug]
    // and /intel, which is the exact failure this gate exists to prevent, and
    // is_valid=false would permanently bury a listing that is merely
    // undecidable rather than wrong. Writing nothing leaves the listing in the
    // unmatched backlog, where a later run with a cleaner KG — or a human in
    // /admin/product/[slug] — can still resolve it.
    if (decision.kind === 'deferred') {
      deferredCount += 1
      continue
    }

    if (decision.kind === 'matched') {
      // is_valid is deliberately left unset (NULL = unreviewed), preserving the
      // existing contract with the AI validation pass and the admin queue.
      matchedCount += 1
      matchRows.push({
        listing_id: listing.id,
        product_id: decision.best.product_id,
        method:     decision.best.method,
        score:      decision.best.score,
        explain:    decision.best.explain,
      })
      continue
    }

    // Brand collision. Persisted as an explicit rejection rather than dropped:
    //   - is_valid=false keeps it out of every consumer, which all filter
    //     `is_valid IS NULL OR is_valid = true`;
    //   - it records WHY, so the decision is auditable;
    //   - it makes the run idempotent — the listing is not re-evaluated
    //     against the same colliding product on every subsequent run.
    // `method` and `score` retain the signal that WOULD have matched, so the
    // strength of the suppressed match stays visible in the audit trail.
    rejectedCount += 1
    matchRows.push({
      listing_id:      listing.id,
      product_id:      decision.best.product_id,
      method:          decision.best.method,
      score:           decision.best.score,
      explain:         { ...decision.best.explain, brand_collision: decision.collision },
      is_valid:        false,
      rejected_reason: brandCollisionReason(decision.collision),
    })
  }

  const BATCH = 100
  for (let i = 0; i < matchRows.length; i += BATCH) {
    const { error } = await supabase
      .from('listing_product_match')
      .upsert(matchRows.slice(i, i + BATCH), { onConflict: 'listing_id,product_id', ignoreDuplicates: true })
    if (error) throw new Error(`Upsert listing_product_match batch ${i}: ${error.message}`)
  }

  // `matched` counts trusted matches only. Rejections and deferrals are
  // reported separately so no caller's success metric can be inflated by rows
  // that were suppressed or by listings that were never decided.
  return {
    matched:  matchedCount,
    rejected: rejectedCount,
    deferred: deferredCount,
    total:    listings.length,
  }
}
