/**
 * scripts/lib/kg-merge-conflict.ts
 *
 * Conflict-resolution truth table for duplicate-product consolidation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS MODULE PERFORMS NO DATABASE ACCESS AND IS NOT EXECUTED BY ANY
 * MIGRATION. The executable artefact is
 * `scripts/migrations/053_kg_duplicate_product_consolidation.sql`, which
 * implements these exact rules in SQL. This module exists so the rules can be
 * unit-tested without a production write, and so a reviewer can read the
 * decision table as data rather than as SQL CASE expressions.
 *
 * If the SQL and this table ever disagree, the SQL is authoritative and this
 * file is the bug.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY A TRUTH TABLE AT ALL: `listing_product_match` is UNIQUE on
 * (listing_id, product_id). When a listing is matched to BOTH rows of a
 * duplicate group and those rows are merged, the two match rows collapse into
 * one — and their `is_valid` states may disagree. `is_valid` encodes HUMAN and
 * AI review decisions (see CLAUDE.md "Match quality flags"), so collapsing it
 * carelessly would silently discard a reviewer's judgement.
 */

/** `null` = unreviewed, `true` = confirmed, `false` = rejected. */
export type Validation = boolean | null

export interface MatchSide {
  is_valid: Validation
  score: number
  method: string
  rejected_reason: string | null
  /** True when the state came from a human reviewer rather than the AI pass. */
  manual?: boolean
}

export type MergeAction =
  /** Safe to merge automatically; `resolved` describes the surviving row. */
  | { action: 'merge'; resolved: { is_valid: Validation; score: number; method: string; rejected_reason: string | null } }
  /** Contradictory human validation — migration 053 aborts the whole run. */
  | { action: 'abort'; reason: string }

/**
 * Resolve one (survivor, loser) match pair for the same listing.
 *
 * RULES, in order:
 *
 *  1. ANY true/false CONTRADICTION -> ABORT.
 *     One side says "this listing IS this product", the other says it is not.
 *     No automatic rule can be right, and picking either silently destroys a
 *     review decision. Migration 053 raises and rolls back the entire
 *     transaction; the group must be resolved by hand first.
 *
 *     This is deliberately STRICTER than "contradictory *manual* validation".
 *     `listing_product_match` has no column recording whether a verdict came
 *     from a human or from the AI pass (that lives only inside `explain`), so
 *     the migration cannot reliably tell them apart in SQL. Aborting on every
 *     contradiction is the safe reading, and it keeps this table and
 *     migration 053's precondition provably identical. `manual` is retained
 *     below only as documentation of provenance; it does not change the rule.
 *
 *  2. REJECTION DOMINATES. If either side is `false` (and the other is not
 *     `true`, which would have aborted at rule 1), the survivor is `false`.
 *     A rejection is an explicit statement that this listing is not this
 *     product; promoting it to trusted would put known-bad evidence back into
 *     price data. This is deliberately asymmetric with rule 3.
 *
 *  3. CONFIRMATION BEATS UNREVIEWED. `true` + `null` -> `true`. The unreviewed
 *     side carries no information, so the confirmed side is strictly better.
 *
 *  4. UNREVIEWED + UNREVIEWED -> `null`. Nothing is learned by merging; the
 *     row stays in the review queue.
 *
 * Non-validation fields: the highest score wins and carries its `method`
 * (strongest evidence survives), and `rejected_reason` is preserved from
 * whichever side has one, survivor first.
 */
export function resolveMatchConflict(survivor: MatchSide, loser: MatchSide): MergeAction {
  // Rule 1 — mirrors migration 053's precondition exactly.
  if ((survivor.is_valid === true  && loser.is_valid === false) ||
      (survivor.is_valid === false && loser.is_valid === true)) {
    return {
      action: 'abort',
      reason: `contradictory validation: survivor=${survivor.is_valid}, loser=${loser.is_valid}`,
    }
  }

  let is_valid: Validation
  if (survivor.is_valid === false || loser.is_valid === false) is_valid = false
  else if (survivor.is_valid === true || loser.is_valid === true) is_valid = true
  else is_valid = null

  const strongest = loser.score > survivor.score ? loser : survivor

  return {
    action: 'merge',
    resolved: {
      is_valid,
      score: Math.max(survivor.score, loser.score),
      method: strongest.method,
      rejected_reason: survivor.rejected_reason ?? loser.rejected_reason,
    },
  }
}

/**
 * The 14 audited duplicate groups. Mirrors the manifest embedded in migration
 * 053 so the preconditions can be asserted in tests. `merge: false` marks the
 * out-of-vertical HP Z8 group, where BOTH rows are deactivated and neither is
 * a survivor.
 */
export interface MergeGroup {
  grp: string
  survivor: string | null
  losers: string[]
  merge: boolean
}

export const MERGE_MANIFEST_053: readonly MergeGroup[] = [
  { grp: 'elektron|analog rytm mkii', survivor: '3845393d-00ad-473a-bdad-af69fe9a886e', losers: ['76e1995a-3c03-4a8f-a19a-d342da7bc48f'], merge: true },
  { grp: 'elektron|sps-1',            survivor: 'aaae5cda-7738-4a53-afdd-3cd493d4dab4', losers: ['923a8381-1887-4edb-acc5-2e72db6e6821'], merge: true },
  { grp: 'jomox|airbase 99',          survivor: '6d6bd2ee-89e9-4469-afb1-10a4982e20f0', losers: ['f96d61dc-cf81-463b-8bf1-d9beffb0e1d5'], merge: true },
  { grp: 'manley|core',               survivor: '92982f65-e9eb-448a-b647-2cc81f23af4c', losers: ['a08c0c96-c842-496e-8fa7-d7fc97cbe658'], merge: true },
  { grp: 'manley|reference cardioid', survivor: '6aeb4f2a-357d-4a2b-8cb2-cd87d0c470ac', losers: ['3bfa3be3-fc54-4698-a1e8-bb2c488ba63c', '185521d4-c2bc-45e1-a42c-85fadd2248e7'], merge: true },
  { grp: 'manley|reference gold',     survivor: 'b921847d-4513-4206-8902-f1c7616ca6ac', losers: ['37e806b8-0c43-423c-b5eb-89ca10aa5360'], merge: true },
  { grp: 'moog|slim phatty',          survivor: '40355ea0-81f8-4df4-a2c9-fc788197a146', losers: ['950e7f3b-a902-4602-9632-2702a755f03a'], merge: true },
  { grp: 'moog|subsequent 37',        survivor: '46509b95-ce08-4727-85ea-c237d594413d', losers: ['15f32b11-fab0-4007-a1ce-ff7cb2aafb49'], merge: true },
  { grp: 'novation|bass station ii',  survivor: '666dc5e3-7a50-4f55-90ff-fef267ca9db0', losers: ['cef40460-946f-45ac-a7a7-c1aba9770ad4'], merge: true },
  { grp: 'propellerhead|rb-338',      survivor: 'a452be02-2649-4c95-9b77-c19fbb353c4f', losers: ['56e302b8-892a-4948-89e3-ff07d944d64f'], merge: true },
  { grp: 'roland|re-201',             survivor: '07cc1ac5-a0c9-4707-99ed-c4440a1f9563', losers: ['26fd7032-0d6c-4162-b0c0-a5b74755b0f5'], merge: true },
  { grp: 'teenage engineering|ep-133 k.o. ii', survivor: '40000232-c58e-4ffa-948f-8de9b90b3285', losers: ['d6b5172d-2cd3-4398-801f-d1d4e57f30dd'], merge: true },
  { grp: 'teisco|synthesizer 110f',   survivor: '958685c7-deb4-40cf-87e0-0514f6ded940', losers: ['0782e37c-c6ad-4045-aeef-b578c5849e75'], merge: true },
  { grp: 'hp|z8',                     survivor: null, losers: ['7e90858b-1652-4a6a-a07b-544bbf38b1f3', '6e6dd995-d4c9-43ac-8ad0-9dbde6116fa1'], merge: false },
]
