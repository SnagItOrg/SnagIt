/**
 * Brand identity for knowledge-graph expansion.
 *
 * TWO SEPARATE CONCERNS LIVE HERE AND MUST NOT BE CONFLATED.
 *
 *   1. NORMALISATION — how a stored brand name is compared against the spelling
 *      a marketplace title happens to use.
 *   2. ELIGIBILITY   — which brands may receive music-vertical suggestions at
 *      all, regardless of how well they match.
 *
 * They failed independently and produced one symptom, so fixing either alone
 * leaves the other live.
 *
 * WHAT WAS BROKEN (measured against production, SELECT only, 2026-08-30).
 *
 * `expand-knowledge-graph.ts` matched brands with
 * `title.toLowerCase().includes(brand.name.toLowerCase())` over a brand list
 * sorted longest-name-first, returning the first hit.
 *
 *   a) Raw substring, so `Electro Harmonix` (as stored) never matched
 *      `Electro-Harmonix` (as written). 463 of 530 Reverb listings that name
 *      the manufacturer use the hyphen — 87% of them were unmatchable.
 *   b) Having failed, the loop continued down the list and hit `Canyon`, which
 *      is a road-bicycle manufacturer left over from a retired vertical. 145 of
 *      the 160 Reverb titles containing "Canyon" also contain "Electro"; they
 *      are EHX Canyon delay pedals. The bicycle brand accumulated 66 pending
 *      product suggestions.
 *   c) Nothing restricted the pool to the music vertical, so 43 brands from
 *      four retired verticals (cycling, tech, photography, design) were live
 *      candidates and between them own 498 pending suggestions.
 *   d) No token boundary, so a manufacturer named inside product prose could
 *      become the primary brand: `Apple` claimed 84 suggestions, largely from
 *      Meinl "Byzance Big Apple Ride" cymbals and "Candy Apple" finishes.
 *
 * This module is deliberately dependency-free and pure. It is imported by the
 * root `scripts/` runtime (tsx, CommonJS, no DOM lib) and by the root test
 * runner with no build step, exactly like `frontend/lib/admin-match-sources.ts`.
 * A single import of anything heavier would break one of those.
 *
 * NO FUZZY MATCHING. Every rule below is exact after a deterministic fold.
 * There is no edit distance, no phonetic key and no prefix scoring, because a
 * near-miss on a brand is precisely the failure that produced Canyon.
 */

// ── 1. Normalisation ─────────────────────────────────────────────────────────

/**
 * Characters treated as hyphen/dash. Each is replaced by a single space, so the
 * replacement preserves string length and character offsets stay valid against
 * the original title — `stripBrandSpan` depends on that.
 */
const DASHES = /[\u002D\u00AD\u2010-\u2015\u2212\uFE58\uFE63\uFF0D_]/g

/** Apostrophe and prime variants. Also length-preserving. */
const APOSTROPHES = /[\u0027\u00B4\u0060\u02B9\u02BC\u2018\u2019\u2032]/g

/**
 * Separators: whitespace and ASCII/general punctuation.
 *
 * Written as a negated run rather than as `\p{L}\p{N}` because the frontend
 * tsconfig has no `target`, so it compiles as ES5 and Unicode property escapes
 * are unavailable. Defining the separator set instead of the letter set also
 * keeps non-Latin scripts and Danish `ø`/`æ`/`å` inside tokens, which a
 * hand-rolled `[a-z0-9]` class would have silently destroyed.
 */
const SEPARATOR_CLASS = '\\s!-\\/:-@\\[-`{-~\\u00A0\\u2000-\\u206F'
const TOKEN_RE = new RegExp('[^' + SEPARATOR_CLASS + ']+', 'g')
const SEPARATOR_RE = new RegExp('[' + SEPARATOR_CLASS + ']', 'g')

/**
 * Fold one isolated word to its comparison form.
 *
 * NFKD then combining-mark removal folds `Ü` to `u` and `①` to `1`. Danish
 * `ø`, `æ` and `å` have no combining decomposition and survive as themselves,
 * which is correct: the fold is applied identically to the stored name and to
 * the title, so both sides agree.
 */
function foldToken(token: string): string {
  return token
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(SEPARATOR_RE, '')
}

/**
 * Replace dashes and apostrophes with spaces without changing string length.
 *
 * Both classes become token separators rather than being deleted. That is what
 * makes `Electro-Harmonix`, `Electro–Harmonix` and `Electro Harmonix` the same
 * three-token-or-two-token sequence, and it is applied to the stored name and
 * the title alike.
 */
function prepare(value: string): string {
  return value.replace(DASHES, ' ').replace(APOSTROPHES, ' ')
}

/** One token of a title, with offsets into the ORIGINAL (unprepared) string. */
export type BrandToken = {
  /** Comparison form. */
  folded: string
  /** Inclusive start offset in the original string. */
  start: number
  /** Exclusive end offset in the original string. */
  end: number
}

/**
 * Split a string into folded tokens carrying original-string offsets.
 *
 * Offsets survive because `prepare` is length-preserving; the model hint is
 * later cut out of the untouched original so display spelling is never lost.
 */
export function tokenizeWithOffsets(value: string): BrandToken[] {
  const prepared = prepare(value)
  const out: BrandToken[] = []
  // `exec` loop rather than `matchAll`: same ES5 constraint as TOKEN_RE.
  const re = new RegExp(TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(prepared)) !== null) {
    const folded = foldToken(m[0])
    if (folded) out.push({ folded, start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** The comparison tokens of a brand name or any other phrase. */
export function brandTokens(value: string): string[] {
  return tokenizeWithOffsets(value).map((t) => t.folded)
}

/**
 * THE shared normalisation function for brand comparison.
 *
 * Unicode-normalises, lowercases, folds diacritics, turns every dash and
 * apostrophe variant into a separator, drops remaining punctuation and
 * collapses whitespace. Punctuation is removed for COMPARISON ONLY — stored
 * display names are never rewritten by this module.
 *
 *   normalizeBrandKey('Electro-Harmonix') === normalizeBrandKey('Electro Harmonix')
 */
export function normalizeBrandKey(value: string): string {
  return brandTokens(value).join(' ')
}

/** True when two brand spellings are the same identity after folding. */
export function sameBrandName(a: string, b: string): boolean {
  const left = normalizeBrandKey(a)
  return left.length > 0 && left === normalizeBrandKey(b)
}

// ── 2. Eligibility ───────────────────────────────────────────────────────────

/** The one vertical Klup operates. `kg_category.domain` is the stored authority. */
export const ACTIVE_BRAND_DOMAIN = 'music'

export type BrandRow = {
  id: string
  name: string
  category_id: string | null
}

/**
 * May this brand receive music-vertical suggestions?
 *
 * The predicate reads stored provenance — `kg_brand.category_id` →
 * `kg_category.domain` — and never the brand's spelling. There is no name
 * list and no Canyon-specific branch, because the schema already carries the
 * fact: production holds 231 brands under `domain = 'music'` and 43 under
 * `design` and `other` (cycling, tech, photography, design-objects,
 * danish-modern), which is exactly the set of retired verticals.
 *
 * FAIL CLOSED. A brand with no category, or one whose category is absent from
 * the supplied map, is ineligible. An unreadable support axis must never grant
 * eligibility — the same rule `isCanonical()` and `isMatchableProduct()` apply.
 *
 * Product count is deliberately not consulted. A valid music brand with one
 * product or none is still eligible; 15 of the 43 legacy brands have no
 * products at all and are excluded on provenance, not on emptiness.
 */
export function isActiveMusicBrand(
  brand: BrandRow,
  domainByCategoryId: ReadonlyMap<string, string>,
): boolean {
  if (!brand.category_id) return false
  const domain = domainByCategoryId.get(brand.category_id)
  if (domain === undefined) return false
  return domain === ACTIVE_BRAND_DOMAIN
}

/** The eligible subset, in input order. */
export function selectActiveMusicBrands(
  brands: readonly BrandRow[],
  domainByCategoryId: ReadonlyMap<string, string>,
): BrandRow[] {
  return brands.filter((b) => isActiveMusicBrand(b, domainByCategoryId))
}

// ── 3. Matching ──────────────────────────────────────────────────────────────

export type BrandMatch = {
  brand: BrandRow
  /** Index of the first title token the brand occupies. */
  tokenStart: number
  /** How many tokens the brand name spans. */
  tokenLength: number
  /** Offsets of the matched span in the ORIGINAL title. */
  start: number
  end: number
}

/**
 * Is `a` a better primary-brand claim than `b`?
 *
 * EARLIEST WINS, then LONGEST. Marketplace titles lead with the manufacturer,
 * so a brand appearing at token 0 outranks one buried in the model prose. That
 * single rule is what stops `Canyon` claiming "Electro-Harmonix Canyon Delay"
 * and `Apple` claiming "Meinl Byzance Big Apple Ride" — the real manufacturer
 * is in front of it. Longest-at-equal-position keeps `Sequential Circuits`
 * from losing to `Sequential`, both of which are real, distinct brand rows.
 *
 * A full tie is broken on brand id so the result cannot depend on the order
 * PostgREST happened to return.
 */
function outranks(a: BrandMatch, b: BrandMatch | null): boolean {
  if (!b) return true
  if (a.tokenStart !== b.tokenStart) return a.tokenStart < b.tokenStart
  if (a.tokenLength !== b.tokenLength) return a.tokenLength > b.tokenLength
  return a.brand.id < b.brand.id
}

/**
 * Find the primary brand of a title among an ALREADY ELIGIBLE brand pool.
 *
 * Matching is on token boundaries: the brand's folded tokens must appear as a
 * contiguous run of whole title tokens. A short brand can therefore never match
 * inside a longer word — `API` does not match "capital", `Hay` does not match
 * "Hayden".
 *
 * Returns null when nothing matches. The caller must treat null as unclassified
 * input and drop it. There is no fall-through to a lower-ranked brand: falling
 * through is the mechanism that produced 66 bicycle suggestions.
 */
export function matchBrandInTitle(
  title: string,
  brands: readonly BrandRow[],
): BrandMatch | null {
  const tokens = tokenizeWithOffsets(title)
  if (tokens.length === 0) return null
  const folded = tokens.map((t) => t.folded)

  let best: BrandMatch | null = null

  for (const brand of brands) {
    const needle = brandTokens(brand.name)
    if (needle.length === 0) continue

    for (let i = 0; i + needle.length <= folded.length; i++) {
      let hit = true
      for (let j = 0; j < needle.length; j++) {
        if (folded[i + j] !== needle[j]) { hit = false; break }
      }
      if (!hit) continue

      const candidate: BrandMatch = {
        brand,
        tokenStart: i,
        tokenLength: needle.length,
        start: tokens[i].start,
        end: tokens[i + needle.length - 1].end,
      }
      if (outranks(candidate, best)) best = candidate
      // Only a brand's earliest occurrence can win, so stop scanning this one.
      break
    }
  }

  return best
}

/**
 * Remove the matched brand span from the original title and tidy the remainder.
 *
 * Cuts by offset rather than by regex over the brand name, so a title spelling
 * the brand differently from the stored name (`Electro-Harmonix` against
 * `Electro Harmonix`) still has exactly the right characters removed.
 */
export function stripBrandSpan(title: string, match: BrandMatch): string {
  const remainder = `${title.slice(0, match.start)} ${title.slice(match.end)}`
  return remainder
    .replace(/^[\s\u002D\u2010-\u2015|:,/]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
