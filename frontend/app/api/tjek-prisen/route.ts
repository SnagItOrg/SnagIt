import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { fetchListingFromUrl } from '@/lib/scrapers/listing-url'
import { decideMatch, loadMatchIndex } from '@/lib/matching/match-listings'
import { classify, readLink, type PriceCheckCause, type PriceCheckResult } from '@/lib/price-check'
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
    populations: Record<PopulationKey, PopulationStats>
    adminPreview: boolean
  }
  return page.adminPreview ? null : page
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
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null
  const link = readLink(typeof body?.url === 'string' ? body.url : '')
  const empty: PriceCheckResult = {
    state: 'cant_read', source: null, cause: null, title: null, priceDkk: null,
    product: null, verdict: null, ranges: [], guide: null,
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
  const product = source === 'dba'
    ? match(listing?.title)
    : (known?.kg_product_id ? index.productById.get(known.kg_product_id) : undefined)
      ?? match(known?.canonical_name) ?? match(slugName) ?? match(listing?.title)

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

  const page = product && !cause ? await publicPage(req, product.slug) : null
  const title = listing?.title ?? known?.canonical_name ?? (source === 'thomann' ? slugName : null)
  const priceDkk = listing?.price ?? known?.price_dkk ?? null
  const outcome = classify({ source, cause, matched: !!product, priceDkk, populations: page?.populations ?? null })

  if (outcome.state === 'not_enough_data' && product) {
    // Watch it. A plain insert: the unique index on pending slugs makes a
    // repeat a no-op (23505), which is the idempotence wanted here.
    const { error } = await admin.from('price_fetch_queue').insert({ product_slug: product.slug, status: 'pending' })
    if (error && error.code !== '23505') console.error('[tjek-prisen] queue write failed', error.code)
  }

  return NextResponse.json({
    ...empty,
    ...outcome,
    source,
    cause,
    title,
    priceDkk,
    product: page && product ? { slug: product.slug, name: page.product.canonical_name } : null,
    guide: outcome.state === 'not_recognised' ? await guideFor(req, title) : null,
  } satisfies PriceCheckResult)
}
