/**
 * The demand list (PAN-247): every DBA link pasted into /tjek-prisen, saved
 * with what Klup answered, re-read nightly and listed on /admin/demand.
 *
 * Shared by the route (`/api/tjek-prisen`) and the nightly
 * (`scripts/recheck-demand.ts`), so the identification a saved ad gets at
 * night is the one it got when pasted. No IP, no user id, no PII: the ad's
 * URL, title and price, and the answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CANONICAL_STATUS, CANONICAL_SUPPORT, CATALOGUE_STATE_SELECT, loadCanonicalSlugs } from './catalogue'
import { NAVIGATION_FAMILIES } from './families'
import { detectBrandCollision, detectCatalogueBrands, detectOfferedBrand } from './matching/brand-guard'
import { detectNonProductIntent } from './matching/listing-intent'
import { decideMatch, type MatchIndex } from './matching/match-listings'
import { guessCandidates, guessProducts, type GuessCandidate, type PriceCheckGuess, type PriceCheckSource, type PriceCheckState } from './price-check'

/** What the last read of the ad itself showed. */
export type DemandAdState = 'active' | 'sold' | 'removed'

/** One row of `price_check_demand` (migration 065). */
export interface DemandRow {
  url: string
  source: PriceCheckSource
  title: string | null
  price: number | null
  currency: string | null
  /** The answer the last check gave. */
  state: PriceCheckState
  /** The product Klup recognised, public or not. A private match is the demand signal. */
  matched_slug: string | null
  guesses: PriceCheckGuess[]
  /** The guess the user picked (PAN-244 part 2). */
  picked_slug: string | null
  ad_state: DemandAdState
  check_count: number
  created_at: string
  last_seen_at: string
  rechecked_at: string | null
}

/**
 * What a read of the ad says about the ad itself. `fetched` is the listing,
 * or the text of the error a failed fetch threw (the route's convention).
 * A 404 or 410 is a removed ad; a stated availability other than InStock is a
 * sold one; anything else — an unreachable page included — leaves the ad
 * active, so the next read tries again.
 */
export function adStateFrom(fetched: { availability?: string | null } | string | null): DemandAdState {
  if (typeof fetched === 'string') return /\b(404|410)\b/.test(fetched) ? 'removed' : 'active'
  const availability = fetched?.availability
  return availability && !/InStock$/.test(availability) ? 'sold' : 'active'
}

/** The public products, decided by the one authority and never cached. */
export function canonicalSlugs(admin: SupabaseClient): Promise<Set<string>> {
  return loadCanonicalSlugs(async () => {
    const res = await admin.from('kg_product').select(CATALOGUE_STATE_SELECT)
      .eq('status', CANONICAL_STATUS).eq('support_state', CANONICAL_SUPPORT)
    return { data: res.data, error: res.error }
  })
}

/**
 * PAN-244 part 2, PAN-245 stage 1: what an unrecognised DBA ad may mean, for a
 * person to confirm — suggest only, never a match. The rows are the public
 * products (`canonical`, from the one authority) and the navigation families;
 * `guessCandidates` picks the trigram neighbours, the rows named in full and
 * the named brand's rows behind the brand guard, and `guessProducts` ranks
 * them. The ad's own description naming exactly one catalogue brand makes the
 * title plus that brand an ordinary `decideMatch`, shown as the top guess.
 * `priceRangeFor` supplies a product's observed range when the caller has one
 * — the route reads the product page for the few candidates in front; the
 * nightly has no page and ranks by name alone.
 */
export async function guessesFor(
  canonical: ReadonlySet<string>,
  index: MatchIndex,
  listing: { title: string; description?: string | null },
  priceDkk: number | null,
  priceRangeFor: (slug: string) => Promise<{ low: number; high: number } | null>,
): Promise<PriceCheckGuess[]> {
  const brands = Array.from(detectCatalogueBrands(listing.description ?? '', index.catalogueBrands))
  const decision = brands.length === 1 ? decideMatch(`${brands[0]} ${listing.title}`, index) : null
  const hit = decision?.kind === 'matched' ? index.productById.get(decision.best.product_id) : undefined
  const top: PriceCheckGuess[] = hit && canonical.has(hit.slug)
    ? [{ slug: hit.slug, name: hit.canonical_name, kind: 'product', href: `/product/${hit.slug}` }] : []

  const rows: GuessCandidate[] = [
    ...index.products.filter((p) => canonical.has(p.slug))
      .map((p) => ({ slug: p.slug, name: p.canonical_name, model_name: p.model_name, brand_name: p.brand_name, kind: 'product' as const })),
    ...NAVIGATION_FAMILIES
      .map((f) => ({ slug: f.slug, name: f.label, model_name: null, brand_name: f.brand.toLowerCase(), kind: 'family' as const, aliases: f.aliases })),
  ]
  // The matcher's own refusals hold here too: a part, a wanted ad or a lot is not guessed at; a row whose brand
  // the title names a competitor of (Squier against Fender) is out; and the brand the title offers first — a
  // catalogue brand or an external one such as Jackson or Harley Benton — decides which rows may stay.
  if (detectNonProductIntent(listing.title)) return top
  const offered = detectOfferedBrand(listing.title, index.catalogueBrands)
  const candidates = guessCandidates(listing.title, rows.filter((r) => !detectBrandCollision(listing.title, r.brand_name)), offered)
  const lead = guessProducts(listing.title, priceDkk, candidates, new Map(), 6)
  const ranges = new Map<string, { low: number; high: number }>()
  if (lead.length > 1) {
    for (const g of lead) {
      if (g.kind !== 'product') continue
      const range = await priceRangeFor(g.slug)
      if (range) ranges.set(g.slug, range)
    }
  }
  const ranked = guessProducts(listing.title, priceDkk, candidates.filter((c) => lead.some((g) => g.slug === c.slug)), ranges)
  return [...top, ...ranked.filter((g) => g.slug !== top[0]?.slug)].slice(0, 3)
}

/**
 * Saves one check. The row is keyed by the ad's URL; a repeat updates what was
 * answered and counts it, unless `bump` is false — the user picking a guess
 * for the ad they just pasted is the same check continued. A pick is kept
 * until the next pick. Read then upsert: two simultaneous pastes of one URL
 * can lose a count, which the list can bear. Fails soft: a demand write never
 * fails the answer, and the log carries the error code only.
 */
export async function recordDemand(
  admin: SupabaseClient,
  row: Pick<DemandRow, 'url' | 'source' | 'title' | 'price' | 'currency' | 'state' | 'matched_slug' | 'guesses' | 'picked_slug' | 'ad_state'>,
  bump: boolean,
): Promise<void> {
  const { data: seen } = await admin.from('price_check_demand').select('check_count, picked_slug')
    .eq('url', row.url).maybeSingle()
  const { error } = await admin.from('price_check_demand').upsert({
    ...row,
    picked_slug: row.picked_slug ?? seen?.picked_slug ?? null,
    check_count: (seen?.check_count ?? 0) + (bump || !seen ? 1 : 0),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'url' })
  if (error) console.error('[tjek-prisen] demand write failed', error.code)
}
