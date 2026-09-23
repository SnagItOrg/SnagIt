/**
 * scripts/lib/reverb-csp-ranking.ts
 *
 * PAN-99. The ordering rule for Reverb CSP (Comparison Shopping Page)
 * candidates, extracted from `scripts/enrich-from-reverb-csp.ts` so it is
 * testable: that script loads env, can `process.exit(1)` and calls `main()`
 * at import time, so nothing there could ever be imported by a test.
 *
 * ── THE DEFECT THIS LOCKS OUT ──────────────────────────────────────────────
 * `scoreMatch` measures RECALL only — what fraction of the canonical name's
 * tokens appear in the CSP title. It never charges for extra tokens, so every
 * CSP title that is a superset of the canonical name scores exactly 1.0:
 *
 *     canonical "Yamaha DX7"
 *       "Yamaha DX7 Digital FM Synthesizer"  -> 1.0
 *       "Yamaha DX7 Data ROM Cartridge"      -> 1.0
 *       "Yamaha DX7 Data RAM Cartridge"      -> 1.0
 *
 * The old sort was `score desc, used_total desc`. With the scores tied,
 * `used_total` — Reverb's count of used listings — decided identity. The
 * cartridge had 54 used listings and the synthesizer 44, so the accessory won
 * and `yamaha-dx7` (legendary, public) rendered a picture of a data cartridge.
 *
 * That ordering was never arbitrary; it was deterministic and wrong. Inventory
 * popularity is not an identity signal — accessories and current-production
 * variants outnumber a vintage base model by design.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * Lexicographic, most decisive key first:
 *
 *   1. exact slug   `candidate.slug === product.slug` wins outright. Reverb
 *                   CSP slugs are unique, so at most one candidate can carry
 *                   the product's own slug and this key can never tie.
 *   2. score        unchanged, and deliberately so — see below.
 *   3. extra tokens distinct CSP-title tokens the canonical name does not
 *                   account for, ascending. This is what breaks the 1.0
 *                   pile-up that `used_total` used to arbitrate.
 *   4. csp_id       ascending. A total order, so the outcome never depends on
 *                   the order Reverb happened to return.
 *
 * ── WHY `score` IS NOT RESCALED ────────────────────────────────────────────
 * `classifyConfidence(score)` gates migration 032, which promotes a CSP out of
 * jsonb into `kg_product.reverb_csp_id` only for confidence high|medium, i.e.
 * score >= 0.75. Folding precision into `score` would move that scale under
 * the gate: an F1 of recall and precision puts the CORRECT DX7 match at 0.57,
 * demoting it — and most of the resolved rows — below the promotion
 * threshold. The pile-up is therefore broken by a separate, named ranking key
 * instead of by moving a number something else depends on.
 *
 * ── WHY THE SLUG KEY MUST COME FIRST ───────────────────────────────────────
 * Extra-token count alone is not sufficient, and is not always right. Measured
 * against the twelve rows PAN-99 lists it picks the correct CSP for nine, ties
 * on three (arturia-minibrute, akai-lpd8, yamaha-dx7), and is actively WRONG
 * for one: `moog-memorymoog`, whose base model is titled "Moog Memorymoog
 * 1982 - 1985" (two extra tokens) against the variant "Moog Memorymoog Plus"
 * (one). The exact slug resolves all twelve. Specificity is the fallback, not
 * the authority.
 */

export interface RankableCandidate {
  csp_id: number
  slug: string
  title: string
  score: number
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

// Score = |canonical tokens ∩ csp title tokens| / |canonical tokens|
// Bonus +0.1 if canonical is a contiguous prefix of CSP title.
export function scoreMatch(canonical: string, cspTitle: string): number {
  const canTokens = tokenize(canonical)
  if (canTokens.length === 0) return 0
  const cspTokens = new Set(tokenize(cspTitle))
  const overlap   = canTokens.filter(t => cspTokens.has(t)).length
  let score = overlap / canTokens.length
  // Prefix bonus: CSP title starts with the canonical name (after normalization)
  const canNorm = tokenize(canonical).join(' ')
  const cspNorm = tokenize(cspTitle).join(' ')
  if (cspNorm.startsWith(canNorm)) score = Math.min(1.0, score + 0.1)
  return Math.round(score * 100) / 100
}

export function classifyConfidence(score: number, canonicalTokens: number): 'high' | 'medium' | 'low' | 'none' {
  if (canonicalTokens < 2) return 'low'    // single-token canonical names (e.g. just "Fender") are too generic
  if (score >= 0.95) return 'high'
  if (score >= 0.75) return 'medium'
  if (score >= 0.5)  return 'low'
  return 'none'
}

/** Distinct CSP-title tokens that the canonical name does not account for. */
export function extraTokenCount(canonical: string, cspTitle: string): number {
  const canon = new Set(tokenize(canonical))
  let extra = 0
  for (const t of new Set(tokenize(cspTitle))) if (!canon.has(t)) extra++
  return extra
}

export function compareCandidates<T extends RankableCandidate>(
  productSlug: string,
  canonicalName: string,
  a: T,
  b: T,
): number {
  const exact = Number(b.slug === productSlug) - Number(a.slug === productSlug)
  if (exact !== 0) return exact
  if (b.score !== a.score) return b.score - a.score
  const extra = extraTokenCount(canonicalName, a.title) - extraTokenCount(canonicalName, b.title)
  if (extra !== 0) return extra
  return a.csp_id - b.csp_id
}

/** Best first. Total ordering: the result does not depend on input order. */
export function rankCandidates<T extends RankableCandidate>(
  productSlug: string,
  canonicalName: string,
  candidates: T[],
): T[] {
  return [...candidates].sort((a, b) => compareCandidates(productSlug, canonicalName, a, b))
}
