/**
 * One product's wall, its asking bands, and each wall listing's verdict.
 *
 * Extracted from /api/product/[slug] for PAN-272, so the family page measures
 * a listing with the SAME code its child's product page uses. The product
 * route calls `wallMatches` and `askingPopulations`; the family page calls
 * `loadChildVerdicts`, which runs both once per child. A copy of this
 * pipeline in a second route is how the two surfaces would come to badge one
 * listing differently (the PAN-93 lesson, where /intel and the product route
 * drifted on the evidence predicate).
 *
 * A FAMILY NEVER GETS A BAND (CLAUDE.md §7, PAN-94). `cardVerdictsByProduct`
 * groups rows by `product_id` BEFORE anything is built, and builds every
 * population from one product's rows only. There is no function here that
 * takes two products' rows and returns one population, so a family-level
 * band, median or verdict is unrepresentable rather than merely avoided.
 *
 * WHAT LEAVES THIS MODULE FOR A FAMILY IS A `CardVerdict`: the verdict word,
 * the basis label key and the small-sample n. Never a price, never a band.
 * The price columns are read here and stop here, so `FamilyListing` still has
 * no field a price could travel in.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from './exhaustive-fetch'
import { hasPlausibleListingPrice, sanitizeListingPrice } from './listing-price-integrity'
import {
  buildPopulationStats,
  groupByPopulation,
  isPriceEvidence,
  listingVerdict,
  type BuildOptions,
  type GroupedListings,
  type PopulationStats,
  type Verdict,
} from './price-populations'
import { PUBLIC_LISTING_SELECT, toPublicListing, type PublicListing } from './public-product'
import { CatalogueUnavailableError } from './catalogue'

/** A `listing_product_match` row with its listing embedded, as the routes read it. */
export interface MatchWithListing {
  score?: number | null
  is_valid: boolean | null
  listings: Record<string, unknown> | null
}

export interface WallMatch {
  isValid: boolean | null
  /** `isPriceEvidence(isValid)`: only these rows build a band. */
  isVerified: boolean
  listing: PublicListing
}

/**
 * The wall population: active rows with a believable price, newest first.
 *
 * Moved verbatim from /api/product/[slug]. Normalise a legacy Kleinanzeigen
 * discount pair before anything renders it. 235240 is 235 EUR now, down from
 * 240 — two real prices welded by an old parser, not a corrupt number — so the
 * current price is recovered and its DKK figure rescaled to match. See
 * lib/listing-price-integrity.ts. Only a value that is still beyond belief
 * AFTER recovery is dropped; the recovery itself happens in `toPublicListing`,
 * the one place the public price is built.
 */
export function wallMatches(rows: readonly MatchWithListing[]): WallMatch[] {
  return rows
    .map((m) => ({ score: m.score ?? 0, isValid: m.is_valid, isVerified: isPriceEvidence(m.is_valid), listing: m.listings }))
    .filter(({ listing }) => listing != null && listing.is_active !== false)
    .filter(({ listing }) => hasPlausibleListingPrice({
      source: (listing as { source?: string | null } | null)?.source ?? null,
      price:  sanitizeListingPrice({
        source: (listing as { source?: string | null } | null)?.source ?? null,
        price:  (listing as { price?: number | string | null } | null)?.price ?? null,
      }).price,
    }))
    .sort((a, b) => {
      const ta = new Date((a.listing?.scraped_at as string) ?? 0).getTime()
      const tb = new Date((b.listing?.scraped_at as string) ?? 0).getTime()
      return tb - ta
    })
    .map(({ isValid, isVerified, listing }) => ({ isValid, isVerified, listing: toPublicListing(listing) }))
    .filter((m): m is WallMatch => m.listing !== null)
}

export const ASKING_KEYS = ['dk-asking', 'de-asking', 'se-asking', 'no-asking', 'reverb-asking'] as const
export type AskingKey = (typeof ASKING_KEYS)[number]

/** The five asking populations of ONE product, each from its own rows only. */
export function askingPopulations(
  grouped: GroupedListings,
  options: BuildOptions,
): Record<AskingKey, PopulationStats> {
  return {
    'dk-asking':     buildPopulationStats('dk-asking',     grouped.byPopulation['dk-asking'], options),
    'de-asking':     buildPopulationStats('de-asking',     grouped.byPopulation['de-asking'], options),
    'se-asking':     buildPopulationStats('se-asking',     grouped.byPopulation['se-asking'], options),
    'no-asking':     buildPopulationStats('no-asking',     grouped.byPopulation['no-asking'], options),
    'reverb-asking': buildPopulationStats('reverb-asking', grouped.byPopulation['reverb-asking'], options),
  }
}

/**
 * What a small card may say about a listing's price: the verdict and how to
 * qualify it, exactly the three props `MarketVerdictBadge` takes. No price, no
 * band edge, no median — the number in `fewN` is the band's observation count,
 * which the badge prints as "n=5".
 */
export interface CardVerdict {
  verdict: Verdict
  /** i18n key naming the market it was measured against; the badge spells out only a borrowed Reverb basis. */
  basisLabelKey: string | null
  /** PAN-265: the band's n when it rests on 3–7 observations, else null. */
  fewN: number | null
}

/**
 * listing id -> its verdict, for each product, measured against THAT
 * product's own bands with `listingVerdict` — the function the product route
 * and tjek-prisen call. A listing with no verdict is absent from the map.
 *
 * Grouping by `product_id` comes first and nothing is built across groups.
 * The `reverb-sold` population is not built because `listingVerdict` never
 * reads it: a card verdict is never measured against sold prices (C2).
 */
export function cardVerdictsByProduct(
  rows: ReadonlyArray<MatchWithListing & { product_id: string | null }>,
  options: BuildOptions = {},
): Map<string, Map<string, CardVerdict>> {
  const byProduct = new Map<string, MatchWithListing[]>()
  for (const row of rows) {
    if (typeof row.product_id !== 'string' || row.product_id.length === 0) continue
    const group = byProduct.get(row.product_id)
    if (group) group.push(row)
    else byProduct.set(row.product_id, [row])
  }

  const out = new Map<string, Map<string, CardVerdict>>()
  for (const [productId, productRows] of byProduct) {
    const wall = wallMatches(productRows)
    const populations = askingPopulations(
      groupByPopulation(wall.filter((m) => m.isVerified).map((m) => m.listing)),
      options,
    )
    const verdicts = new Map<string, CardVerdict>()
    for (const { listing, isValid } of wall) {
      const outcome = listingVerdict(listing, isValid, populations)
      if (outcome.verdict == null) continue
      verdicts.set(listing.id, { verdict: outcome.verdict, basisLabelKey: outcome.basisLabelKey, fewN: outcome.fewN })
    }
    out.set(productId, verdicts)
  }
  return out
}

/**
 * Read the children's matches with their prices and return only verdicts.
 *
 * One exhaustive read for every child together (one request per 1,000 rows,
 * not one per child), filtered exactly as /api/product/[slug] filters one
 * product's: `is_valid` NULL or true. A truncated read builds no band
 * (`incomplete`), so every child then has no verdict rather than a partial one.
 */
export async function loadChildVerdicts(
  admin: SupabaseClient,
  childIds: readonly string[],
): Promise<Map<string, Map<string, CardVerdict>>> {
  const all = await fetchAllPages(
    async (from, to) => {
      const res = await admin
        .from('listing_product_match')
        .select(`id, product_id, score, is_valid, listings(${PUBLIC_LISTING_SELECT})`)
        .in('product_id', [...childIds])
        .not('is_valid', 'is', false)
        .order('id', { ascending: true })
        .range(from, to)
        .then(
          (r) => r,
          () => {
            throw new CatalogueUnavailableError('child_verdicts_transport')
          },
        )
      if (res.error) throw new CatalogueUnavailableError('child_verdicts_lookup')
      return (res.data ?? []) as unknown as Array<{ id: string; product_id: string | null } & MatchWithListing>
    },
    (row) => row.id,
  )
  return cardVerdictsByProduct(all.rows, { incomplete: all.truncated })
}
