/**
 * PAN-95 — qualify a proposed match by IDENTITY, with price as EVIDENCE and
 * never as a rule.
 *
 * WHY A THRESHOLD CANNOT BE THE RULE. The question a match row answers is
 * "is this listing this product?". A price FLOOR answers a different one and
 * fails in both directions: a Roland SH-101 at 7.500 DKK against a ~15.000 DKK
 * band is an unusually cheap GENUINE instrument — exactly the bargain Klup
 * exists to surface, already recorded as a known false reject in
 * `frontend/lib/matching/listing-intent.ts` — while a 900 DKK pickguard clears
 * any floor that would keep a cheap Squier.
 *
 * WHY DENYING THE JUDGE PRICE ENTIRELY WAS THE WRONG CORRECTION. The first
 * revision of this module removed price from the payload by construction. That
 * over-generalised: the thing to avoid is a threshold, and withholding context
 * is not the same act as refusing to threshold on it. Measured on the
 * 2026-09-20 dry run, it cost the only strong signal for the mirror failure —
 * A PART WHOSE TITLE READS LIKE THE PRODUCT. "1978 Gibson Les Paul Custom
 * 1-ply Cream W/Bracket" was approved `exact` at confidence 88 on the words
 * alone. It is a pickguard, at 293 DKK against an adjudicated median of 30.266
 * — 1.0%. On the title the row is genuinely undecidable; with the ratio in
 * view it is not.
 *
 * WHAT PRICE CONTEXT IS, AND WHERE IT COMES FROM. Not `kg_product`'s
 * `price_min_dkk`/`price_max_dkk` — only 5 of the supported products carry
 * that, and those five are Reverb comps. The context here is the product's own
 * ADJUDICATED population: the prices of listings a human already confirmed on
 * it (`is_valid = true`, PAN-93's `isPriceEvidence`). Measured 2026-09-20 that
 * covers 49 of the 50 products with unreviewed rows, 44 of them at n >= 8.
 * The gates are the repo's own — `MIN_DESCRIPTIVE_MEDIAN_N` for a median,
 * `MIN_BAND_N` for a quartile band — so this pass cannot show a number a
 * product page would refuse to.
 *
 * IT IS STILL EVIDENCE, NOT A GATE. No code here compares a ratio to a
 * constant and no verdict is derived from one; the prompt says in as many
 * words that a low ratio is a reason to look harder at the title and never a
 * reason to reject. The measurement that backs that: of 1.140 approvals with a
 * median to compare against, 21 sit between 12% and 50% of it — a DX7 at 23%,
 * an SH-101 at 45% — and every one is a genuine instrument. A floor anywhere
 * above 12% deletes all of them. Conversely 52 REJECTED rows sit above 80% of
 * the median, so price can never decide alone in either direction.
 *
 * WHAT THE MODEL SEES BESIDES: the product's canonical and model name, its
 * brand, and the SIBLING ROWS of the same brand that could compete for the
 * listing. The failure that is built for is real and current — two
 * "Fender American Ultra II Telecaster" listings sit unreviewed on
 * `fender-telecaster-custom` while `fender-american-ultra-ii-telecaster` has
 * its own supported row. A judge that never sees the sibling cannot notice.
 *
 * ABSTAIN IS A FIRST-CLASS OUTCOME, and it maps to the existing `skipped`
 * disposition, which persists nothing. Under PAN-93 only `is_valid = true`
 * prices a product, so an abstained row prices nothing and costs nothing but
 * a later look. A judge that always decides is worse than one that declines.
 *
 * NO MOVE DISPOSITION, DELIBERATELY. When the model believes a sibling owns
 * the listing, the outcome here is `wrong` on the reviewed product and the
 * sibling slug recorded as audit only. `planWrites` in
 * `frontend/app/admin/match/dispositions.ts` REFUSES `move_to_existing_product`
 * whenever a row already exists on the reviewed product — and in this pipeline
 * one always does, because the pipeline exists to qualify rows that already
 * exist. Re-pointing a persisted match needs both ends to move together and is
 * specified in `docs/admin-match-deferred-disposition-contract.md`; it is not
 * approximated here.
 *
 * Import-light on purpose: `dispositions.ts` and `listing-intent.ts` are the
 * authorities for the write vocabulary and the deterministic guard, and this
 * module adds no second definition of either.
 */

import {
  MANUAL_METHOD,
  MANUAL_SCORE,
  REJECTION_REASON,
  planDecisionWrites,
  type Disposition,
  type PlannedRow,
  type PriorRow,
} from '../../frontend/app/admin/match/dispositions'
import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'
import { MIN_BAND_N, MIN_DESCRIPTIVE_MEDIAN_N } from '../../frontend/lib/price-populations'
import { quartiles, usableValues } from '../../frontend/lib/statistics'

/** What the judge may return. `abstain` is a verdict, not a failure to answer. */
export type Verdict = 'exact' | 'accessory' | 'wanted_ad' | 'wrong' | 'abstain'

/**
 * Verdict to the EXISTING operator vocabulary. No parallel convention: every
 * value on the right is a `Disposition` the admin surface already writes, so a
 * row this pass produces is indistinguishable in shape from a human one and is
 * read by the same consumers.
 */
export const VERDICT_DISPOSITION: Readonly<Record<Verdict, Disposition>> = {
  exact: 'exact',
  accessory: 'accessory',
  wanted_ad: 'wanted_ad',
  wrong: 'wrong',
  abstain: 'skipped',
}

/** A supported row of the same brand that could compete for the listing. */
export interface SiblingIdentity {
  slug: string
  canonical_name: string
}

/**
 * What one listing costs, set against what this product is known to cost.
 *
 * Every field is nullable independently, because they fail independently: a
 * listing can have no stated price, and a product can have too little
 * adjudicated evidence for a median or for a band. Nothing is substituted — a
 * missing number is null and the judge is told it is unknown, never given a
 * default that would read as a measurement.
 */
export interface PriceContext {
  /** The listing's asking price, normalised to DKK. Null if not stated. */
  listing_price_dkk: number | null
  /** Median of the adjudicated population. Null below MIN_DESCRIPTIVE_MEDIAN_N. */
  product_median_dkk: number | null
  /** Q1–Q3 of the same population. Null below MIN_BAND_N. */
  product_q1_dkk: number | null
  product_q3_dkk: number | null
  /** How many confirmed listings the numbers above are computed from. */
  adjudicated_n: number
  /** The listing as a percentage of the median. Null if either side is null. */
  listing_pct_of_median: number | null
}

/**
 * Build the price context for one row from the product's adjudicated prices.
 *
 * A zero or negative asking price is NOT a price — on dba.dk it is how a
 * "byttes"/"vurderes solgt" listing renders, and three such rows sit in the
 * 2026-09-20 manifest. Treating 0 as a number would hand the judge a ratio of
 * 0.0% and manufacture the exact false reject this design exists to prevent.
 *
 * The two gates are the repo's, not new ones: a median needs
 * `MIN_DESCRIPTIVE_MEDIAN_N` observations and a quartile band needs
 * `MIN_BAND_N`. Below the first, the judge gets the listing price and an
 * explicit `adjudicated_n` and no comparison to draw.
 */
export function buildPriceContext(
  listingPriceDkk: number | null,
  adjudicatedPricesDkk: readonly (number | null)[],
): PriceContext {
  const prices = usableValues(adjudicatedPricesDkk).filter((p) => p > 0)
  const n = prices.length
  const q = n >= MIN_DESCRIPTIVE_MEDIAN_N ? quartiles(prices) : null
  const median = q ? Math.round(q.median) : null
  const price = listingPriceDkk !== null && listingPriceDkk > 0 ? listingPriceDkk : null

  return {
    listing_price_dkk: price,
    product_median_dkk: median,
    product_q1_dkk: q && n >= MIN_BAND_N ? Math.round(q.q1) : null,
    product_q3_dkk: q && n >= MIN_BAND_N ? Math.round(q.q3) : null,
    adjudicated_n: n,
    listing_pct_of_median:
      price !== null && median !== null && median > 0
        ? Math.round((price / median) * 1000) / 10
        : null,
  }
}

/** Everything the pipeline knows about one unreviewed match. */
export interface QualificationRow {
  match_id: string
  listing_id: string
  product_id: string
  product_slug: string
  canonical_name: string
  model_name: string | null
  brand_name: string | null
  subcategory: string | null
  listing_title: string
  listing_source: string
  matcher_method: string
  matcher_score: number
  siblings: readonly SiblingIdentity[]
  /** The listing's price against the product's adjudicated population. */
  price_context: PriceContext
  /** Audit columns. Present on the manifest; only the price reaches the judge. */
  listing_price_dkk: number | null
  listing_currency: string | null
  listing_url: string | null
  prior_explain: Record<string, unknown>
}

/**
 * Every key `buildIdentityPayload` may emit.
 *
 * The list used to be the price PROHIBITION — a test failed if any key matched
 * `/price|dkk|currency/`. It is now the price GUARANTEE, inverted for the
 * reason in the module header: the test asserts that `price_context` is there
 * and correctly shaped. What the list still does is keep the judge's view
 * enumerable, so a field cannot enter it without a test noticing.
 */
export const MODEL_PAYLOAD_KEYS: readonly string[] = [
  'id',
  'listing_title',
  'listing_source',
  'candidate_product',
  'candidate_model_name',
  'candidate_brand',
  'candidate_subcategory',
  'sibling_products',
  'matcher_method',
  'matcher_score',
  'deterministic_signal',
  'price_context',
]

export interface IdentityPayload {
  id: string
  listing_title: string
  listing_source: string
  candidate_product: string
  candidate_model_name: string | null
  candidate_brand: string | null
  candidate_subcategory: string | null
  sibling_products: SiblingIdentity[]
  matcher_method: string
  matcher_score: number
  /** `listing-intent` finding, or null. A signal to weigh, never a verdict. */
  deterministic_signal: string | null
  /** Money as evidence. Nothing in this module thresholds on it. */
  price_context: PriceContext
}

/** The ONLY constructor of the judge's view. */
export function buildIdentityPayload(row: QualificationRow): IdentityPayload {
  return {
    id: row.match_id,
    listing_title: row.listing_title,
    listing_source: row.listing_source,
    candidate_product: row.canonical_name,
    candidate_model_name: row.model_name,
    candidate_brand: row.brand_name,
    candidate_subcategory: row.subcategory,
    sibling_products: row.siblings.map((s) => ({
      slug: s.slug,
      canonical_name: s.canonical_name,
    })),
    matcher_method: row.matcher_method,
    matcher_score: row.matcher_score,
    deterministic_signal: deterministicSignal(row.listing_title),
    price_context: row.price_context,
  }
}

/**
 * The deterministic guard, run FIRST — as a SIGNAL, not as a verdict.
 *
 * WHY IT DOES NOT DECIDE, THOUGH THE CHEAPER DESIGN SAYS IT SHOULD. Measured
 * on the 1,764 unreviewed matches across the matchable cohort, 2026-09-20:
 *
 *   - it fires on **18 rows, 1.0%** of the backlog. The saving from letting it
 *     decide alone is one batch of tokens, not a tier of the pipeline;
 *   - hand-checked, **13 of those 18 are right**. The five that are not are
 *     the expensive class: "Roland TR-909 Rhythm Composer eprom v4" at 49.903
 *     and 42.224 DKK (a complete TR-909 with a v4 EPROM, condition Fair, one
 *     Reverb listing), "Roland Juno-106 Poly Synth (Serviced) New Voice
 *     Chips/Sliders/Knobs" at 10.430 DKK and "Roland Juno-106 | Fully Serviced
 *     | Borish Voice Chips" at 16.728 DKK — complete serviced synthesizers
 *     rejected because the seller named the component that was replaced — plus
 *     "Yamaha DX7 - 6 Cartridges & Flightcase" at 5.215 DKK, which reads as a
 *     DX7 sold with cartridges.
 *
 * `listing-intent.ts` was derived as a DEFERRAL rule for the matcher, where
 * firing writes no row and the listing stays recoverable. Here the same token
 * would write `is_valid = false` on a row that already exists, and after
 * PAN-93 that is the difference between a 49.903 DKK bargain being priced and
 * being deleted. Same vocabulary, different cost of being wrong.
 *
 * So the finding travels to the judge as `deterministic_signal` and the judge
 * must name title words to override it. The guard keeps its cheapness and its
 * reviewability; it loses only the authority to be wrong on its own. The three
 * tokens that misfired — `chips`, `eprom`, `cartridges` — belong to PAN-96,
 * which owns that file; this module does not edit it.
 */
export function deterministicSignal(title: string): string | null {
  const finding = detectNonProductIntent(title)
  return finding ? `${finding.intent}:${finding.token}` : null
}

/**
 * The value written to `explain.admin_decision.decision_source`.
 *
 * Shaped like the sweep already in production
 * (`pan-96/pickguard-sweep-2026-09-20`, 160 rows) so one pass is one auditable,
 * reversible SET. `runId` must identify a single pass — the reversal query in
 * `docs/pan-95-model-qualification.md` keys on exactly this string.
 */
export function decisionSource(runId: string): string {
  return `pan-95/qualification-${runId}`
}

/** One line of the dry-run manifest. `would_write === null` means abstained. */
export interface ManifestRow {
  match_id: string
  listing_id: string
  product_slug: string
  listing_title: string
  listing_price_dkk: number | null
  listing_currency: string | null
  listing_url: string | null
  /** The same two numbers the judge reasoned from, so a veto can check them. */
  product_median_dkk: number | null
  listing_pct_of_median: number | null
  /** The guard's finding, carried for audit whether or not the judge agreed. */
  deterministic_signal: string | null
  verdict: Verdict
  disposition: Disposition
  confidence: number | null
  evidence: string
  /** Slug the judge believes owns the listing. Audit only; nothing is written there. */
  competing_slug: string | null
  would_write: PlannedRow | null
}

export interface PlanManifestArgs {
  row: QualificationRow
  verdict: Verdict
  confidence: number | null
  evidence: string
  competingSlug?: string | null
  decidedAt: string
  runId: string
}

/**
 * Turn one verdict into one manifest line, including the exact row a later
 * authorised pass would upsert.
 *
 * The planned row comes from `planDecisionWrites` rather than being assembled
 * here, so this pass cannot produce a shape the admin surface would not. An
 * abstention yields `would_write: null` because `skipped` does not persist.
 */
export function planManifestRow(args: PlanManifestArgs): ManifestRow {
  const { row, verdict } = args
  const disposition = VERDICT_DISPOSITION[verdict]

  // The matcher's own provenance survives qualification: `planDecisionWrites`
  // keeps a prior method/score rather than stamping FUZZY/1 over a MODEL/70.
  const priorByKey: Record<string, PriorRow> = {
    [`${row.listing_id}:${row.product_id}`]: {
      method: row.matcher_method,
      score: row.matcher_score,
      isValid: null,
      explain: row.prior_explain,
    },
  }

  const planned = planDecisionWrites({
    decisions: [
      { listing_id: row.listing_id, disposition, target_product_id: null },
    ],
    reviewedProductId: row.product_id,
    priorByKey,
    // No human decided this. A user id would claim one did.
    actorUserId: null,
    decidedAt: args.decidedAt,
    manualMethod: MANUAL_METHOD,
    manualScore: MANUAL_SCORE,
    rejectedReasonConstant: REJECTION_REASON,
    decisionSource: decisionSource(args.runId),
  })

  const wouldWrite = planned[0] ?? null
  if (wouldWrite) {
    const decision = (wouldWrite.explain as { admin_decision: Record<string, unknown> })
      .admin_decision
    decision.evidence = args.evidence
    if (args.confidence !== null) decision.confidence = args.confidence
    if (args.competingSlug) decision.competing_slug = args.competingSlug
  }

  return {
    match_id: row.match_id,
    listing_id: row.listing_id,
    product_slug: row.product_slug,
    listing_title: row.listing_title,
    listing_price_dkk: row.listing_price_dkk,
    listing_currency: row.listing_currency,
    listing_url: row.listing_url,
    product_median_dkk: row.price_context.product_median_dkk,
    listing_pct_of_median: row.price_context.listing_pct_of_median,
    deterministic_signal: deterministicSignal(row.listing_title),
    verdict,
    disposition,
    confidence: args.confidence,
    evidence: args.evidence,
    competing_slug: args.competingSlug ?? null,
    would_write: wouldWrite,
  }
}
