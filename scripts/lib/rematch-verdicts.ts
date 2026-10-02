/**
 * scripts/lib/rematch-verdicts.ts
 *
 * The standing rule for the brand re-match runner (scripts/rematch-brand.ts):
 * a live match row that carries a verdict is never
 * re-decided, released or rewritten, whatever the boundaries now say. The
 * scripts skip such a row, count it and list it for the owner instead.
 */

/**
 * A match row a person decided: `explain.admin_decision` (the admin surfaces
 * and the pan-95 qualification write it). Manager decision 2026-10-01.
 */
export const HUMAN_DECISION = (explain: unknown): boolean =>
  !!explain && typeof explain === 'object' && 'admin_decision' in (explain as Record<string, unknown>)

/**
 * A match the AI pass (or a person) confirmed: `is_valid=true`. Manager
 * decision 8 (PAN-205).
 */
export const AI_TRUE = (isValid: boolean | null): boolean => isValid === true
