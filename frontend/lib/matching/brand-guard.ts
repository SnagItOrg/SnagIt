/**
 * Minimum brand-compatibility guard for automatic listing→product matching.
 *
 * THE PROBLEM THIS SOLVES: the deterministic matcher keys on `model_name`, and
 * a licensed budget brand shares the model name with the instrument it is a
 * budget version of. "Epiphone Les Paul Standard" contains the token
 * "Les Paul", so it matched the *Gibson* Les Paul product; "Squier
 * Stratocaster" would match Fender Stratocaster the same way. Observed in
 * production: an Epiphone Les Paul at 4,547 DKK and an Epiphone ES-335 at
 * 3,900 DKK sitting under the Gibson products, both with `is_valid IS NULL`,
 * which the product API and the intel dashboard treat as trusted. A budget
 * clone at a third of the price drags the product median down and makes the
 * "is this a good price?" answer wrong.
 *
 * SCOPE — deliberately closed, not an ontology. This table lists only the
 * licensed-subsidiary relationships where the parent brand's model names are
 * reused verbatim by the subsidiary. That is a small, well-known, stable set.
 * A general "any other brand in the title disqualifies the match" rule was
 * rejected: it would break legitimate matches like the Kleinanzeigen title
 * "Fender Rhodes Mark I, 73 Stage Piano", where "Fender" is part of the
 * instrument's real historical name and the correct product's brand is Rhodes.
 *
 * Extending this table is a deliberate act. Add a pair only when the
 * subsidiary genuinely reuses the parent's model names.
 */

export interface BrandCollision {
  /** The brand detected in the listing title, e.g. `epiphone`. */
  detectedBrand: string
  /** The KG product's brand that it must not be matched to, e.g. `gibson`. */
  productBrand: string
}

interface CollisionRule {
  /** Brand token as it appears in listing titles (lowercase). */
  detectedBrand: string
  /** KG brand names this detected brand must never auto-match to (lowercase). */
  blockedProductBrands: readonly string[]
}

export const BRAND_COLLISION_RULES: readonly CollisionRule[] = [
  // Epiphone is Gibson's licensed budget brand and ships Les Paul, SG, ES-335,
  // Casino etc. under the same model names.
  { detectedBrand: 'epiphone', blockedProductBrands: ['gibson'] },
  // Squier is Fender's licensed budget brand and ships Stratocaster,
  // Telecaster, Jazz Bass, Precision Bass under the same model names.
  { detectedBrand: 'squier', blockedProductBrands: ['fender'] },
]

/**
 * Word-boundary token test. `-` and `_` are treated as word characters so that
 * "es-335" does not match inside "es-335x", and so a brand name embedded in a
 * hyphenated compound is not a false hit.
 */
export function containsBrandToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text)
}

/**
 * Brand tokens shorter than this are not used as evidence. `kg_brand` contains
 * at least one 2-character name, and a 2-character token produces too many
 * incidental hits inside free-text marketplace titles to be trustworthy.
 */
const MIN_BRAND_TOKEN_LENGTH = 3

/**
 * Child-brand precedence, derived from the collision rules so the two cannot
 * disagree: `squier -> fender`, `epiphone -> gibson`.
 *
 * WHY THIS MATTERS: "Squier by Fender Telecaster" and "Fender Squier
 * Stratocaster" contain BOTH brand words. Naive brand detection would see
 * "fender" and conclude the listing is a Fender. The child brand always wins —
 * a Squier-by-Fender is a Squier, and an Epiphone sold as "Epiphone (Gibson)"
 * is an Epiphone.
 */
const CHILD_TO_PARENTS = new Map<string, readonly string[]>(
  BRAND_COLLISION_RULES.map((r) => [r.detectedBrand, r.blockedProductBrands]),
)

/**
 * Instrument brands that are NOT in `kg_brand` but appear as the OFFERED brand
 * in observed contamination. Without these the catalogue-brand layer is blind
 * to the seller's own brand and reads a referenced model as the offer.
 *
 * Closed and evidence-derived — every entry was observed leading a live title
 * that the matcher trusted as a different manufacturer's product, e.g.
 * "Jackson USA Anthrax … Gibson Les Paul DC Junior Guitar" -> Gibson Les Paul,
 * "ESP The Mirage Custom Shop Stratocaster" -> Fender Stratocaster.
 *
 * This is NOT a general brand ontology and must not become one: adding an
 * entry requires an observed false positive.
 */
/**
 * PAIRED WITH THE SEED. `tokai`, `greco` and `burny` were removed from this list
 * in the same change that added them to `data/knowledge-graph.json` as verified
 * `kg_brand` identities with exact products (Springy Sound, Breezy Sound, Love
 * Rock; Spacey Sound, Super Real, Mint Collection; Super Grade).
 *
 * WHY BOTH HALVES MUST SHIP TOGETHER. This list feeds `detectOfferedBrand`,
 * which unions it with `catalogueBrands`. A brand present in EITHER source is
 * recognised as the offered maker, so a Tokai title is protected from becoming
 * a Gibson either way. What the token list ALSO does is mark the brand as
 * merely an external copy reference — and once Tokai has its own products, that
 * classification would fight its own listings. Removing the token while the
 * brand row is absent would drop the protection entirely; adding the brand
 * while the token remains would keep the wrong semantics. Hence one change.
 *
 * Everything still listed here is a maker Klup has NOT verified into the KG.
 * They stay because they are the observed copy-listing vocabulary; each becomes
 * a removal candidate only when it is added as a verified brand.
 */
export const EXTERNAL_BRAND_TOKENS: readonly string[] = [
  'jackson', 'charvel', 'esp', 'edwards', 'cimar',
  'vision', 'fenix', 'leader', 'harley benton', 'samick', 'aria',
]

/**
 * Words that turn a model mention into a REFERENCE rather than the offer.
 * Only fire when they sit IMMEDIATELY after the matched token — see
 * `tokenFollowedByReference`.
 */
const REFERENCE_WORDS = new Set([
  'type', 'typ', 'style', 'stil', 'kopi', 'copy', 'klon', 'clone',
  'replica', 'replika', 'nachbau', 'lookalike', 'look-alike',
])

/**
 * True when `token` appears immediately followed by a reference word, e.g.
 * "Leader Flashback 335 type", "Korg MS-20 Nachbau", "Neve 1081 style",
 * "Roland TR-909 Clone".
 *
 * Adjacency is essential. A looser "reference word anywhere" test destroyed
 * 254 legitimate proposals in measurement, because real products are named
 * "Gibson Les Paul '52 Tribute", "Epiphone SG Tribute" and
 * "Epiphone Inspired by Gibson J-45".
 */
export function tokenFollowedByReference(title: string, token: string): boolean {
  if (!token) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'ig')
  let m: RegExpExecArray | null
  while ((m = re.exec(title)) !== null) {
    const rest = title.slice(m.index + m[0].length).trim()
    const next = rest.split(/[\s,./()-]+/)[0] ?? ''
    if (REFERENCE_WORDS.has(next.toLowerCase())) return true
  }
  return false
}

/** Zero-based word index of `token`'s first occurrence, or null. */
export function wordIndexOf(title: string, token: string): number | null {
  if (!token) return null
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').exec(title)
  if (!m) return null
  return title.slice(0, m.index).trim().split(/\s+/).filter(Boolean).length
}

/**
 * The brand a listing appears to be OFFERING: the earliest brand token in the
 * title, drawn from catalogue brands plus `EXTERNAL_BRAND_TOKENS`.
 */
export function detectOfferedBrand(
  title: string,
  catalogueBrands: Iterable<string>,
): string | null {
  let best: string | null = null
  let bestAt = -1
  const consider = (b: string) => {
    if (!b || b.length < MIN_BRAND_TOKEN_LENGTH) return
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').exec(title)
    if (m && (bestAt < 0 || m.index < bestAt)) { bestAt = m.index; best = b }
  }
  Array.from(catalogueBrands).forEach(consider)
  EXTERNAL_BRAND_TOKENS.forEach(consider)
  return best
}

/**
 * How far into the title the matched product's own brand may first appear
 * before the listing reads as "someone else's product that mentions it".
 *
 * 3 preserves genuine manufacturer collaborations, which name both brands up
 * front — "Sequential Oberheim OB-X8", "Arp Rhodes Chroma",
 * "GForce Software Oberheim OB-1" — while catching references buried deep in a
 * different maker's title.
 */
export const OFFERED_BRAND_LEAD_WORDS = 3

/**
 * Brands explicitly named in a listing title, restricted to brands the
 * knowledge graph actually knows about, with child-brand precedence applied.
 *
 * Returns a set because a title may legitimately name several unrelated brands
 * ("Squier Jazz Bass + Harley Benton amp"). Callers must treat a set of size
 * != 1 as *unusable* brand evidence rather than guessing — that is the rule
 * that stops product array order from deciding anything.
 */
export function detectCatalogueBrands(
  title: string,
  catalogueBrands: Iterable<string>,
): Set<string> {
  // Array.from rather than for-of over the iterable: frontend/tsconfig.json
  // sets no `target`, so raw tsc defaults to ES5 and rejects downlevel
  // iteration (TS2802). Keep this file target-agnostic.
  const found = new Set<string>()
  Array.from(catalogueBrands).forEach((brand) => {
    if (!brand || brand.length < MIN_BRAND_TOKEN_LENGTH) return
    if (containsBrandToken(title, brand)) found.add(brand)
  })

  // Child-brand precedence: drop a parent brand when its child is also present.
  Array.from(found).forEach((child) => {
    const parents = CHILD_TO_PARENTS.get(child)
    if (!parents) return
    parents.forEach((parent) => found.delete(parent))
  })
  return found
}

/**
 * Returns the collision if `title` is explicitly branded as a competitor of
 * `productBrand`, otherwise null.
 *
 * Returns null (i.e. allows the match) when:
 *   - the product has no brand recorded — nothing to protect;
 *   - no rule's detected brand appears in the title — the common case,
 *     including titles that carry the canonical brand or no brand at all.
 */
export function detectBrandCollision(
  title: string,
  productBrand: string | null | undefined,
): BrandCollision | null {
  if (!productBrand) return null
  const brand = productBrand.trim().toLowerCase()
  if (!brand) return null

  for (const rule of BRAND_COLLISION_RULES) {
    if (!rule.blockedProductBrands.includes(brand)) continue
    if (!containsBrandToken(title, rule.detectedBrand)) continue
    return { detectedBrand: rule.detectedBrand, productBrand: brand }
  }
  return null
}

/**
 * Stable, greppable reason string written to
 * `listing_product_match.rejected_reason` so a rejection can be traced back to
 * the exact rule that produced it.
 */
export function brandCollisionReason(collision: BrandCollision): string {
  return `brand_collision:${collision.detectedBrand}_listing_vs_${collision.productBrand}_product`
}
