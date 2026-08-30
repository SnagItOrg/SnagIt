/**
 * Retrieval planning for /admin/match.
 *
 * WHAT WAS BROKEN, measured against production on 2026-08-30.
 *
 * The candidate sweep built ONE conjunctive query: every token longer than two
 * characters from the hyphen-normalised canonical name became a required
 * `title ILIKE '%token%'`. Only hyphens were normalised, so punctuation
 * survived into the tokens:
 *
 *   'Roland RE-201 (Space Echo)'  ->  roland AND 201 AND "(space" AND "echo)"
 *
 * No marketplace title contains `(space` or `echo)`, so the clean, curated,
 * legendary RE-201 product retrieved **0** candidates across all five sources.
 *
 * The duplicate `Roland RE-201 Space Echo Tape Delay / Reverb 1974 - 1988 -
 * Black` retrieved 11 — and it is worth being precise about why, because the
 * obvious explanation is wrong. It is not that the longer name is more
 * forgiving; under AND, more tokens can only ever match less. It retrieved
 * because that name IS a verbatim Reverb listing title, so its ten required
 * tokens are exactly the words Reverb puts in its own titles. All 11 hits were
 * Reverb. On DBA, Finn, Blocket and Kleinanzeigen it scored 0 — the polluted
 * name has worse cross-marketplace recall than the clean one would with a
 * working query.
 *
 * WHAT THIS MODULE DOES. It turns one product into a small set of OR
 * alternatives instead of one long AND. Measured recall for RE-201:
 *
 *   canonical (punctuation-stripped)   roland AND 201            -> reaches every source
 *   model token                        %re-201%                  -> 61 (2 blocket, 3 finn, 8 KA, 48 reverb)
 *   model spaced                       %re 201%                  -> 17
 *   model joined                       %re201%                   ->  2
 *
 * Two rules keep this from becoming a fuzzy global search:
 *
 *   1. A variant is a conjunction; variants are alternatives. Widening happens
 *      by ADDING an alternative, never by dropping a required term from one.
 *   2. A variant must be distinctive. `Roland RE-201` may never degrade to a
 *      bare `Roland` search — measured at 4,367 active listings, which is not
 *      retrieval, it is the whole marketplace.
 *
 * The final relevance decision is untouched. This module only decides what the
 * classifier is allowed to look at.
 *
 * Deliberately import-free so the root `tsx --test` harness can exercise it.
 */

export type ProductFacts = {
  canonicalName: string
  /** `kg_product.model_name` — curated, and null for many products. */
  modelName: string | null
  brandName: string | null
  /** Stored aliases. Admitted only if clean — see `isAdmissibleAlias`. */
  aliases?: readonly string[]
}

export type QueryVariant = {
  /** Stable identifier, used in diagnostics. Never free text. */
  id: string
  /** ILIKE terms, AND-ed together within this variant. */
  terms: string[]
}

/** Hard ceiling on alternatives per product. */
export const MAX_VARIANTS = 6

/** Minimum token length carried into a query, matching the previous behaviour. */
const MIN_TOKEN = 3

/**
 * Colour and condition words that may appear in a stored alias.
 *
 * Not a stopword list for titles — a listing may say whatever it likes. This is
 * only used to REJECT an alias as a retrieval source, because an alias built
 * from a marketplace title would smuggle "black" or "mint" in as a required
 * term and reproduce the defect this module exists to fix.
 */
const DIRTY_ALIAS_WORDS = [
  'black', 'white', 'red', 'blue', 'green', 'silver', 'grey', 'gray', 'cream',
  'mint', 'vintage', 'original', 'serviced', 'working', 'boxed', 'rare',
]

/**
 * Lower-case and reduce a term to the characters that are safe to interpolate
 * into a PostgREST filter: letters, digits, spaces and the hyphen.
 *
 * The hyphen is kept ON PURPOSE and is load-bearing. `%re-201%` and `%re 201%`
 * are different substring searches — measured on production at 61 hits and 17
 * respectively — so folding one into the other silently discards the better
 * variant. Comma, parenthesis and dot are what PostgREST reads as grammar, and
 * those are exactly what this removes.
 */
export function sanitizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lower-case, strip every character that is not a letter, digit or space. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Tokens for the canonical-name variant.
 *
 * Punctuation becomes a separator rather than part of a token. This single
 * change is what unblocks `Roland RE-201 (Space Echo)`: the old tokenizer
 * emitted `(space` and `echo)` as required substrings.
 */
export function canonicalTerms(canonicalName: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of normalizeText(canonicalName).split(' ')) {
    if (token.length < MIN_TOKEN) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

/**
 * Is this token specific enough to search on alone?
 *
 * A model token must contain a digit. That is the whole guard against the
 * catastrophic case: `roland`, `fender`, `space`, `echo` all fail it, so no
 * brand or descriptive word can ever become a standalone query. `re201`,
 * `sh101`, `tr808` all pass.
 */
export function isDistinctiveModelToken(token: string): boolean {
  const normalized = normalizeText(token).replace(/ /g, '')
  return normalized.length >= 3 && /[0-9]/.test(normalized) && /[a-z]/.test(normalized)
}

/**
 * The punctuation forms a marketplace title may use for one model.
 *
 * `RE-201` is written `RE-201`, `RE 201` and `RE201` in the wild, and an ILIKE
 * substring match treats all three as different strings. Measured on
 * production: hyphenated 61 hits, spaced 17, joined 2 — the joined form is rare
 * but it is not zero, and a seller who writes `RE201` is invisible without it.
 */
export function modelTokenForms(modelName: string): string[] {
  const compact = normalizeText(modelName).replace(/ /g, '')
  const letters = compact.replace(/[0-9]+$/, '')
  const digits = compact.slice(letters.length)
  const forms = new Set<string>()
  forms.add(normalizeText(modelName).replace(/ /g, '-'))
  if (letters && digits) {
    forms.add(`${letters}-${digits}`)
    forms.add(`${letters} ${digits}`)
    forms.add(`${letters}${digits}`)
  }
  return Array.from(forms).filter((f) => f.length >= MIN_TOKEN)
}

/**
 * May a stored alias contribute a retrieval variant?
 *
 * Measured: all 13 stored aliases for `roland-re-201` are raw Reverb listing
 * titles — "Roland RE-201 Space Echo Tape Delay / Reverb 1970s - Black",
 * "Roland 1979 Space Echo RE-201. Mint. Boxed." Tokenising those into required
 * terms would demand a year and a colour, which is exactly the failure the
 * polluted duplicate demonstrates. So an alias is admitted only when it is
 * clean: no four-digit year, no colour or condition word, and not materially
 * longer than the canonical name it aliases.
 */
export function isAdmissibleAlias(alias: string, canonicalName: string): boolean {
  const normalized = normalizeText(alias)
  if (normalized.length === 0) return false
  if (/\b(1[89]\d{2}|20\d{2})\b/.test(normalized)) return false
  for (const word of DIRTY_ALIAS_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return false
  }
  const terms = canonicalTerms(alias)
  if (terms.length === 0) return false
  return terms.length <= canonicalTerms(canonicalName).length + 1
}

export type RetrievalPlan = {
  variants: QueryVariant[]
  /** Why a variant was not emitted. Counts and ids only — never listing data. */
  diagnostics: {
    modelToken: string | null
    modelDistinctive: boolean
    aliasesConsidered: number
    aliasesAdmitted: number
    variantsCapped: number
  }
}

/**
 * Build the OR alternatives for one product.
 *
 * Order is deliberate: the most specific alternative first, so that when the
 * cap bites it removes the broadest variant rather than the sharpest.
 */
export function planRetrieval(facts: ProductFacts): RetrievalPlan {
  const variants: QueryVariant[] = []
  const push = (id: string, terms: string[]) => {
    const cleaned = terms.map((t) => sanitizeTerm(t)).filter((t) => t.length >= MIN_TOKEN)
    if (cleaned.length === 0) return
    const key = cleaned.join('|')
    if (variants.some((v) => v.terms.join('|') === key)) return
    variants.push({ id, terms: cleaned })
  }

  const model = facts.modelName?.trim() ?? ''
  const distinctive = model.length > 0 && isDistinctiveModelToken(model)
  const brand = facts.brandName ? normalizeText(facts.brandName) : ''

  if (distinctive) {
    const forms = modelTokenForms(model)
    // Brand + model first: the sharpest thing we can ask for.
    if (brand.length >= MIN_TOKEN && forms[0]) push('brand+model', [brand, forms[0]])
    forms.forEach((form, i) => push(i === 0 ? 'model' : `model-form-${i}`, [form]))
  }

  // The canonical name, punctuation-stripped. For a product with no model token
  // this is the only variant, which is the previous behaviour minus the
  // punctuation bug.
  push('canonical', canonicalTerms(facts.canonicalName))

  let aliasesAdmitted = 0
  const aliases = facts.aliases ?? []
  for (const alias of aliases) {
    if (!isAdmissibleAlias(alias, facts.canonicalName)) continue
    aliasesAdmitted++
    push(`alias-${aliasesAdmitted}`, canonicalTerms(alias))
  }

  const capped = Math.max(0, variants.length - MAX_VARIANTS)
  return {
    variants: variants.slice(0, MAX_VARIANTS),
    diagnostics: {
      modelToken: distinctive ? normalizeText(model).replace(/ /g, '-') : null,
      modelDistinctive: distinctive,
      aliasesConsidered: aliases.length,
      aliasesAdmitted,
      variantsCapped: capped,
    },
  }
}

/**
 * Does this listing title satisfy this variant?
 *
 * Used to attribute a returned row back to the variant(s) that could have found
 * it, so per-variant recall is observable without issuing one query per
 * variant. The same conjunction semantics as the SQL: every term must appear.
 */
export function variantMatches(variant: QueryVariant, title: string): boolean {
  const haystack = title.toLowerCase()
  return variant.terms.every((term) => haystack.includes(term))
}

/**
 * Render the plan as one PostgREST `or=` filter.
 *
 * One query per source rather than one per (source × variant): the sweep keeps
 * its existing shape and its existing cost, and source balancing is untouched.
 *
 * Terms are already normalised to `[a-z0-9 ]` by `normalizeText`, which is also
 * what makes this safe to interpolate — a comma, parenthesis or dot in a term
 * would otherwise be read as PostgREST filter grammar. The guard is asserted in
 * the test suite rather than assumed here.
 */
export function buildOrFilter(variants: readonly QueryVariant[]): string {
  const groups = variants.map((variant) => {
    const clauses = variant.terms.map((t) => `title.ilike.%${t}%`)
    return clauses.length === 1 ? clauses[0] : `and(${clauses.join(',')})`
  })
  return groups.join(',')
}
