/**
 * scripts/lib/identifier-safety.ts
 *
 * Write-side guard for `kg_identifier` values.
 *
 * WHY THIS EXISTS: `kg_identifier` hits score 95 — the matcher's highest
 * confidence tier, reserved for EXCLUSIVE product evidence. Migration 054
 * removes three values that violate that ('PAUL', 'TOM', '335'), but the
 * repository OWNS the path that created them:
 *
 *   data/knowledge-graph.json  ->  "sku": ["PAUL"] on Gibson Les Paul
 *                                  "sku": ["TOM"]  on Sequential Circuits TOM
 *   scripts/import-knowledge-graph.ts:241  deleteAll('kg_identifier')
 *   scripts/import-knowledge-graph.ts:251  insertBatch('kg_identifier', ...)
 *
 * So a DB-only fix is undone by the next `npm run import-kg`. This module is
 * the smallest change that closes that loop: the importer filters values
 * through `isUnsafeIdentifierValue` and reports what it dropped.
 *
 * SCOPE: deliberately a small, explicit deny-list plus two structural rules.
 * It is NOT a language model, an ontology, or a redesign of ingestion.
 */

/**
 * Values that are ordinary natural-language words in a marketplace title and
 * therefore cannot be exclusive product evidence.
 *
 * Evidence for each entry comes from live DBA/Kleinanzeigen title hits:
 *   PAUL — 426 hits; "2014 Paul Reed Smith Custom 24" matched Gibson Les Paul @95
 *   TOM  — 6 hits; also a drum-kit part ("floor tom", "tom expansion pack")
 */
const GENERIC_TOKENS = new Set([
  'paul', 'tom', 'solo', 'custom', 'standard', 'studio', 'classic',
  'junior', 'special', 'deluxe', 'pro', 'mini', 'max', 'plus',
])

/**
 * Bare numeric fragments. A model number like '335' is a FRAGMENT of 'ES-335',
 * not a manufacturer code, and it fires inside unrelated model numbers:
 * "Gibson ES-345TD ... 345 335 Guitar" and "Gibson ES-347 TD ... 335 Guitar"
 * both matched ES-335 at 95. Real EANs are 12+ digits and are allowed.
 */
function isBareShortNumber(v: string): boolean {
  return /^\d{1,6}$/.test(v)
}

export interface IdentifierCandidate {
  type: string
  value: string
}

export type UnsafeReason = 'generic_token' | 'bare_short_number' | 'too_short'

/**
 * Returns why the value must not be stored as a score-95 identifier, or null
 * when it is acceptable.
 *
 * `EAN` is exempt from the numeric rule: an EAN is by definition a long
 * numeric code and is globally unique.
 */
export function isUnsafeIdentifierValue(
  value: string,
  type: string,
): UnsafeReason | null {
  const v = value.trim()
  if (v.length < 3) return 'too_short'          // below the matcher's token floor
  if (GENERIC_TOKENS.has(v.toLowerCase())) return 'generic_token'
  if (type !== 'EAN' && isBareShortNumber(v)) return 'bare_short_number'
  return null
}

/** Partition a candidate list into rows that may be inserted and rows that must not. */
export function filterIdentifiers(candidates: IdentifierCandidate[]): {
  safe: IdentifierCandidate[]
  rejected: Array<IdentifierCandidate & { reason: UnsafeReason }>
} {
  const safe: IdentifierCandidate[] = []
  const rejected: Array<IdentifierCandidate & { reason: UnsafeReason }> = []
  for (const c of candidates) {
    const reason = isUnsafeIdentifierValue(c.value, c.type)
    if (reason) rejected.push({ ...c, reason })
    else safe.push(c)
  }
  return { safe, rejected }
}
