/**
 * PAN-95 — qualify a proposed match by IDENTITY, never by a price threshold.
 *
 * WHY A THRESHOLD CANNOT BE THE RULE. The question a match row answers is
 * "is this listing this product?". Price is a proxy for that question and it
 * fails in both directions: a Roland SH-101 at 7.500 DKK against a ~15.000 DKK
 * band is an unusually cheap GENUINE instrument — exactly the bargain Klup
 * exists to surface, already recorded as a known false reject in
 * `frontend/lib/matching/listing-intent.ts` — while a 900 DKK pickguard clears
 * any floor that would keep a cheap Squier.
 *
 * MEASURED, 2026-09-20, production, SELECT only: 5 of the 58 supported
 * products carry a `price_min_dkk`/`price_max_dkk` band at all. For the other
 * 53 a price rule has nothing to compare against, and the five bands it does
 * have are Reverb comps — asking-side US evidence, not Danish sold history.
 *
 * SO PRICE IS NOT IN THE MODEL'S INPUT AT ALL. `buildIdentityPayload` is the
 * single constructor of what the model sees, `MODEL_PAYLOAD_KEYS` names every
 * key it may contain, and a test pins that neither list admits a price field.
 * The prohibition is structural rather than a sentence in a prompt that a
 * later edit can soften. Price still reaches the MANIFEST, because the human
 * vetoing a row should see it; it just cannot reach the judgement.
 *
 * WHAT THE MODEL SEES INSTEAD IS IDENTITY: the product's canonical and model
 * name, its brand, and the SIBLING ROWS of the same brand that could compete
 * for the listing. The failure this is built for is real and current — two
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
  /** Audit columns. Present on the manifest, absent from the model payload. */
  listing_price_dkk: number | null
  listing_currency: string | null
  listing_url: string | null
  prior_explain: Record<string, unknown>
}

/**
 * Every key `buildIdentityPayload` may emit.
 *
 * This list is the price prohibition. A test compares it to the payload's own
 * keys and to a literal deny-list, so adding `listing_price_dkk` back into the
 * judge's view fails the suite rather than quietly reintroducing the threshold
 * the product owner removed.
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
}

/** The ONLY constructor of the judge's view. Identity in, no money. */
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
 * reviewability; it loses only the authority to be wrong on its own. The four
 * tokens that misfired — `chip`/`chips`, `eprom` — belong to PAN-96, which
 * owns that file; this module does not edit it.
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
  /** Audit only — the human vetoes with it, the judge never saw it. */
  listing_price_dkk: number | null
  listing_currency: string | null
  listing_url: string | null
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
    deterministic_signal: deterministicSignal(row.listing_title),
    verdict,
    disposition,
    confidence: args.confidence,
    evidence: args.evidence,
    competing_slug: args.competingSlug ?? null,
    would_write: wouldWrite,
  }
}
