/**
 * PAN-136 — is a brand the operator wants to create one we already hold?
 *
 * Import-free, like `subcategory-filter.ts`, so the rule is exercisable from
 * plain Node and the route and the picker cannot each restate it differently.
 *
 * The `kg_brand.slug` unique index does not answer this question. It is a
 * plain, case-sensitive btree, and production already holds rows it let
 * through: `Elektron|elektron` beside `Elektron|Elektron`, `E-mu|emu` beside
 * `E Mu|e-mu` — nine such groups on 2026-09-24. So the comparison is done here,
 * on a key that ignores case, diacritics, whitespace and every separator, and
 * it is checked against BOTH the name and the slug of every existing row.
 *
 * Equality of keys only. No edit distance, no prefix: `Neumann Berlin` is not
 * `Neumann`, and a rule that said it was would block a legitimate brand.
 */

export type BrandRow = { id: string; name: string; slug: string }

/** Lowercase, diacritics folded, everything that is not a letter or digit removed. */
export function brandKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** The slug a new brand gets unless the operator overrides it. */
export function brandSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Every existing brand whose name or slug has the same key as the candidate's
 * name or slug. Empty means the candidate is new.
 */
export function findBrandNearMatches(
  candidate: { name: string; slug: string },
  existing: BrandRow[],
): BrandRow[] {
  const keys = new Set([brandKey(candidate.name), brandKey(candidate.slug)])
  keys.delete('')
  return existing.filter((b) => keys.has(brandKey(b.name)) || keys.has(brandKey(b.slug)))
}
