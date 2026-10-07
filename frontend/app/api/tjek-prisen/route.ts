import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { fetchListingFromUrl } from '@/lib/scrapers/listing-url'
import { decideMatch, loadMatchIndex } from '@/lib/matching/match-listings'
import { classify, guessCandidates, guessProducts, listingsUnderAnswer, parseLot, readLink, type GuessCandidate, type PriceCheckCause, type PriceCheckGuess, type PriceCheckListing, type PriceCheckResult } from '@/lib/price-check'
import { reverbSoldGuide } from '@/lib/reverb-sold'
import { NAVIGATION_FAMILIES } from '@/lib/families'
import { detectBrandCollision, detectCatalogueBrands, detectOfferedBrand } from '@/lib/matching/brand-guard'
import { detectNonProductIntent } from '@/lib/matching/listing-intent'
import { CANONICAL_STATUS, CANONICAL_SUPPORT, CATALOGUE_STATE_SELECT, loadCanonicalSlugs } from '@/lib/catalogue'
import type { PopulationKey, PopulationStats } from '@/lib/price-populations'
import type { SearchOutcome } from '@/lib/search-contract'
import { GET as getProduct } from '@/app/api/product/[slug]/route'
import { GET as resolveSearch } from '@/app/api/search/resolve/route'

/**
 * Tjek prisen (PAN-207): one pasted link, one price answer.
 *
 * Public and unauthenticated, so it is rate-limited per IP in middleware.ts and
 * makes at most one request to the pasted site. Its only writes are the two
 * idempotent ones the ticket names: the Thomann new price (`thomann_product`)
 * and the watch queue (`price_fetch_queue`).
 *
 * The two sibling routes are called in-process rather than re-implemented:
 * /api/product/[slug] owns "is this product public, and what are its price
 * populations", and /api/search/resolve owns "which public family or product
 * does this text point at". A product that is not public therefore never
 * reaches the response.
 */
export const dynamic = 'force-dynamic'

/**
 * The match index is four paginated catalogue reads, and it only changes when
 * a product is promoted. One build serves every check on this instance for ten
 * minutes (PAN-212). The promise is what is cached, so concurrent checks share
 * one load; a failed load is dropped, so the next check tries again.
 */
const MATCH_INDEX_TTL_MS = 10 * 60_000
let matchIndex: { at: number; index: ReturnType<typeof loadMatchIndex> } | null = null

function cachedMatchIndex(admin: Parameters<typeof loadMatchIndex>[0]) {
  if (!matchIndex || Date.now() - matchIndex.at > MATCH_INDEX_TTL_MS) {
    const index = loadMatchIndex(admin)
    index.catch(() => {
      if (matchIndex?.index === index) matchIndex = null
    })
    matchIndex = { at: Date.now(), index }
  }
  return matchIndex.index
}

async function publicPage(req: NextRequest, slug: string) {
  const res = await getProduct(new NextRequest(new URL(`/api/product/${slug}`, req.url)), {
    params: Promise.resolve({ slug }),
  })
  if (!res.ok) return null
  const page = (await res.json()) as {
    product: { canonical_name: string }
    listings: PriceCheckListing[]
    priceRange: { low: number; high: number } | null
    populations: Record<PopulationKey, PopulationStats>
    dkAskingPrices: number[]
    adminPreview: boolean
  }
  return page.adminPreview ? null : page
}

/**
 * PAN-244 part 2, PAN-245 stage 1: what an unrecognised DBA ad may mean, for
 * the user to confirm — suggest only, never a match. The rows are the public
 * products (`loadCanonicalSlugs`, the one authority, never cached) and the
 * navigation families; `guessCandidates` picks the trigram neighbours, the
 * rows named in full and the named brand's rows behind the brand guard, and
 * `guessProducts` ranks them. The ad's own description naming exactly one
 * catalogue brand makes the title plus that brand an ordinary `decideMatch`,
 * shown as the top guess. The price range is read only for the few product
 * candidates in front, so the common case costs one small read.
 */
async function guessesFor(
  req: NextRequest,
  admin: ReturnType<typeof getSupabaseAdmin>,
  index: Awaited<ReturnType<typeof loadMatchIndex>>,
  listing: { title: string; description?: string | null },
  priceDkk: number | null,
): Promise<PriceCheckGuess[]> {
  const canonical = await loadCanonicalSlugs(async () => {
    const res = await admin.from('kg_product').select(CATALOGUE_STATE_SELECT)
      .eq('status', CANONICAL_STATUS).eq('support_state', CANONICAL_SUPPORT)
    return { data: res.data, error: res.error }
  })
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
      const page = await publicPage(req, g.slug)
      if (page?.priceRange) ranges.set(g.slug, page.priceRange)
    }
  }
  const ranked = guessProducts(listing.title, priceDkk, candidates.filter((c) => lead.some((g) => g.slug === c.slug)), ranges)
  return [...top, ...ranked.filter((g) => g.slug !== top[0]?.slug)].slice(0, 3)
}

/** "See Telecaster prices": the resolver's one unambiguous target, or nothing. */
async function guideFor(req: NextRequest, text: string | null): Promise<PriceCheckResult['guide']> {
  if (!text) return null
  const url = new URL('/api/search/resolve', req.url)
  url.searchParams.set('q', text.slice(0, 120))
  const outcome = (await (await resolveSearch(new NextRequest(url))).json()) as Partial<SearchOutcome>
  if (outcome.navigateTo) return { href: outcome.navigateTo, label: text }
  const options = [...(outcome.candidates ?? []), ...(outcome.suggestions ?? [])]
  return options.length === 1 ? { href: options[0].href, label: options[0].label } : null
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: unknown; pick?: unknown } | null
  const link = readLink(typeof body?.url === 'string' ? body.url : '')
  // PAN-244 part 2: the slug the user picked from the guesses, if any.
  const pick = typeof body?.pick === 'string' ? body.pick : null
  const empty: PriceCheckResult = {
    state: 'cant_read', source: null, cause: null, title: null, priceDkk: null,
    product: null, verdict: null, ranges: [], dkFew: null, guide: null, listings: [], guesses: [], fromPick: false, reverbSold: null, lot: null,
  }
  if ('cause' in link) {
    return NextResponse.json({ ...empty, cause: link.cause, guide: await guideFor(req, link.query) })
  }

  const { source, url } = link
  const admin = getSupabaseAdmin()
  const [fetched, index, known] = await Promise.all([
    fetchListingFromUrl(url).then((r) => r?.listing ?? null, (e: unknown) => String(e)),
    cachedMatchIndex(admin),
    source === 'thomann'
      ? admin.from('thomann_product').select('canonical_name, price_dkk, kg_product_id')
          .eq('thomann_url', url).maybeSingle().then((r) => r.data)
      : null,
  ])
  const listing = typeof fetched === 'string' ? null : fetched
  const match = (name: string | null | undefined) => {
    const decision = name ? decideMatch(name, index) : null
    return decision?.kind === 'matched' ? index.productById.get(decision.best.product_id) : undefined
  }

  // Thomann identity, cheapest first: the stored link, the name in the URL,
  // then the fetched title. Only the new price depends on the fetch.
  const slugName = new URL(url).pathname.replace(/^\/|\.html?$/g, '').replace(/_/g, ' ')
  const recognised = source === 'dba'
    ? match(listing?.title)
    : (known?.kg_product_id ? index.productById.get(known.kg_product_id) : undefined)
      ?? match(known?.canonical_name) ?? match(slugName) ?? match(listing?.title)
  // PAN-244 part 2: a pick replaces the recognition, never the verdict rules, and only a
  // public product can be picked — anything else falls back to what was recognised.
  const picked = pick && source === 'dba' && listing ? index.products.find((p) => p.slug === pick) : undefined
  const pickedPage = picked ? await publicPage(req, picked.slug) : null
  const product = pickedPage ? picked : recognised

  let cause: PriceCheckCause | null = null
  if (!listing && !(source === 'thomann' && (product || known))) {
    cause = /\b(404|410)\b/.test(String(fetched)) ? 'gone' : 'unreachable'
  } else if (source === 'dba' && !listing?.price) {
    cause = 'no_price'
  }

  if (source === 'thomann' && listing) {
    const { error } = await admin.from('thomann_product').upsert({
      thomann_url: url,
      canonical_name: listing.title,
      price_dkk: listing.price,
      scraped_at: new Date().toISOString(),
      // Only ever fills an empty link; an existing one is left out of the write.
      ...(product && !known?.kg_product_id ? { kg_product_id: product.id } : {}),
    }, { onConflict: 'thomann_url' })
    if (error) console.error('[tjek-prisen] thomann_product write failed', error.code)
  }

  const page = pickedPage && !cause ? pickedPage : (product && !cause ? await publicPage(req, product.slug) : null)
  const title = listing?.title ?? known?.canonical_name ?? (source === 'thomann' ? slugName : null)
  const priceDkk = listing?.price ?? known?.price_dkk ?? null
  const outcome = classify({
    source, cause, matched: !!product, priceDkk,
    populations: page?.populations ?? null,
    dkAskingPrices: page?.dkAskingPrices ?? [],
  })

  if (outcome.state === 'not_enough_data' && product) {
    // Watch it. A plain insert: the unique index on pending slugs makes a
    // repeat a no-op (23505), which is the idempotence wanted here.
    const { error } = await admin.from('price_fetch_queue').insert({ product_slug: product.slug, status: 'pending' })
    if (error && error.code !== '23505') console.error('[tjek-prisen] queue write failed', error.code)
  }

  // PAN-250: a lot has no single-unit price, so it gets no verdict; an ad Klup does not recognise, and the
  // user did not pick a guess for, gets what the item went for on Reverb — unless it is a part or a wanted ad.
  const lot = source === 'dba' && listing ? parseLot(listing.title) : null
  const intent = listing ? detectNonProductIntent(listing.title)?.intent : undefined
  const reverbSold = outcome.state === 'not_recognised' && source === 'dba' && listing && !pick && intent !== 'part_or_accessory' && intent !== 'wanted_or_non_sale'
    ? await reverbSoldGuide(listing.title) : null

  return NextResponse.json({
    ...empty,
    ...outcome,
    verdict: lot ? null : outcome.verdict,
    source,
    cause,
    title,
    priceDkk,
    lot: lot ? { count: lot.count, perUnitDkk: priceDkk != null ? Math.round(priceDkk / lot.count) : null } : null,
    reverbSold,
    product: page && product ? { slug: product.slug, name: page.product.canonical_name } : null,
    // The page's own listings, so a product that is not public has none here either.
    listings: page ? listingsUnderAnswer(page.listings ?? [], url) : [],
    guide: outcome.state === 'not_recognised' ? await guideFor(req, title) : null,
    guesses: outcome.state === 'not_recognised' && source === 'dba' && listing
      ? await guessesFor(req, admin, index, listing, priceDkk) : [],
    fromPick: !!pickedPage,
  } satisfies PriceCheckResult)
}
