import { NextRequest, NextResponse } from 'next/server'
import { requireAdminInRoute } from '@/lib/admin-auth'
import { toDkkApprox } from '@/lib/currency'
import { scrapeBlocket } from '@/lib/scrapers/blocket'
import { scrapeDba } from '@/lib/scrapers/dba'
import { scrapeFinn } from '@/lib/scrapers/finn'
import { scrapeKleinanzeigen } from '@/lib/scrapers/kleinanzeigen'
import { detectListingUrl, fetchListingFromUrl } from '@/lib/scrapers/listing-url'
import { scrapeThomannSearch, type ThomannProduct } from '@/lib/scrapers/thomann-search'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/**
 * Admin-only live search across the marketplaces Klup scrapes.
 *
 * This is the admin-gated successor to the deleted public /api/scrape
 * (removed in 1ae0b7f, "Stage 3 WP-4: replace the live-scrape SERP with a
 * catalogue resolver"). PAN-31 restores the three capabilities that route had
 * and this one had lost, and nothing else:
 *
 *   - Thomann, the sixth source of the former ALL_SOURCES;
 *   - URL mode, so a pasted DBA / Thomann / Reverb link resolves to one listing;
 *   - per-source failure isolation, which the former route had as
 *     `.catch(() => [])` on every job.
 *
 * WHAT DELIBERATELY STAYS DELETED. The old route upserted into `listings` and
 * `thomann_product` on every unauthenticated search — the public write path
 * WP-4 closed. Search here is READ-ONLY. Nothing is persisted and no
 * listing_product_match, alias or synonym is touched until an admin explicitly
 * attaches a result through save-listing.
 */

type Platform = 'dba' | 'finn' | 'blocket' | 'kleinanzeigen' | 'reverb' | 'thomann'

type ScrapedListing = {
  title: string
  price: number | null
  currency: string
  url: string
  image_url: string | null
  location: string | null
  source: string
  country: string | null
  price_dkk: number | null
}

type RawScrapedListing = {
  title: string
  price: number | null
  currency: string
  url: string
  image_url: string | null
  location: string | null
  source: string
  country?: string | null
  price_dkk?: number | null
}

const VALID_PLATFORMS: Platform[] = ['dba', 'finn', 'blocket', 'kleinanzeigen', 'reverb', 'thomann']

const normalizeTitle = (s: string) => s.toLowerCase().replace(/[-\s_]+/g, '')

async function scrapeReverbDb(query: string): Promise<RawScrapedListing[]> {
  const words = query.split(/\s+/).filter((w) => w.length > 1)
  if (words.length === 0) return []

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('listings')
    .select('title, price, currency, price_dkk, url, image_url, location, source, country')
    .eq('source', 'reverb')
    .eq('is_active', true)
    .ilike('title', `%${words[0]}%`)
    .limit(50)

  return ((data ?? []) as RawScrapedListing[]).filter((l) =>
    words.every((w) => normalizeTitle(String(l.title)).includes(normalizeTitle(w))),
  )
}

/**
 * Thomann's catalogue fallback, recovered from 1ae0b7f^.
 *
 * Thomann sits behind Cloudflare and the live search returns nothing when it
 * blocks. `kg_product` already carries a scraped thomann_url and price for part
 * of the catalogue, so the former route fell back to it rather than showing the
 * operator an empty retail column. Both fixups are kept: legacy rows store
 * literal "\/" escapes, and /sbpics/ URLs are Thomann salesperson portraits
 * rather than product images.
 */
async function thomannFromCatalogue(query: string): Promise<ThomannProduct[]> {
  const words = query.split(/\s+/).filter((w) => w.length > 1)
  if (words.length === 0) return []

  let q = getSupabaseAdmin()
    .from('kg_product')
    .select('canonical_name, thomann_url, thomann_price_dkk, image_url')
    .not('thomann_url', 'is', null)
    .not('thomann_price_dkk', 'is', null)
    .eq('status', 'active')

  for (const w of words) {
    q = (q as typeof q).ilike('canonical_name', `%${w}%`)
  }

  const { data } = await q.limit(5)

  return ((data ?? []) as Array<{
    canonical_name: string
    thomann_url: string
    thomann_price_dkk: number
    image_url: string | null
  }>).map((p) => {
    let img = p.image_url ? p.image_url.replace(/\\\//g, '/') : null
    if (img && img.includes('/sbpics/')) img = null
    return {
      thomann_url:    p.thomann_url,
      canonical_name: p.canonical_name,
      image_url:      img,
      price_dkk:      p.thomann_price_dkk,
    }
  })
}

function thomannToListing(p: ThomannProduct): RawScrapedListing {
  return {
    title:     p.canonical_name,
    price:     p.price_dkk,
    currency:  'DKK',
    url:       p.thomann_url,
    image_url: p.image_url,
    location:  null,
    source:    'thomann',
    country:   null,
    price_dkk: p.price_dkk,
  }
}

async function scrapeThomann(query: string): Promise<RawScrapedListing[]> {
  const live = await scrapeThomannSearch(query)
  const products = live.length > 0 ? live : await thomannFromCatalogue(query)
  return products.map(thomannToListing)
}

const SCRAPERS: Record<Platform, (query: string) => Promise<RawScrapedListing[]>> = {
  dba: (query: string) => scrapeDba(query, 1),
  finn: (query: string) => scrapeFinn(query, 1),
  blocket: (query: string) => scrapeBlocket(query, 1),
  kleinanzeigen: (query: string) => scrapeKleinanzeigen(query, 3),
  reverb: (query: string) => scrapeReverbDb(query),
  thomann: (query: string) => scrapeThomann(query),
}

function isPlatform(value: string): value is Platform {
  return VALID_PLATFORMS.includes(value as Platform)
}

function normalizeListing(listing: RawScrapedListing): ScrapedListing {
  return {
    ...listing,
    country: listing.country ?? null,
    price_dkk: listing.price_dkk ?? (
      listing.price != null
        ? toDkkApprox(listing.price, listing.currency)
        : null
    ),
  }
}

export async function POST(
  req: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { query, platforms } = (await req.json()) as {
    query?: string
    platforms?: string[]
  }

  const trimmed = (query ?? '').trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  // ── URL mode: a pasted DBA / Thomann / Reverb link resolves to one listing ──
  // Recovered from 1ae0b7f^. It short-circuits the platform selection, exactly
  // as the former route did: the link names its own source. Read-only — the old
  // route's `listings` and `thomann_product` upserts are not restored.
  const urlSource = detectListingUrl(trimmed)
  if (urlSource) {
    try {
      const result = await fetchListingFromUrl(trimmed)
      if (result) {
        return NextResponse.json({
          listings: [normalizeListing(result.listing)],
          failedSources: [],
        })
      }
    } catch (err) {
      // The source is named to the operator; the upstream message is not.
      console.error(JSON.stringify({
        route: 'admin/scrape-platform', mode: 'url', source: urlSource,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
    return NextResponse.json({ listings: [], failedSources: [urlSource] })
  }

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json({ error: 'platforms is required' }, { status: 400 })
  }

  const uniquePlatforms = Array.from(new Set(platforms))
  if (!uniquePlatforms.every(isPlatform)) {
    return NextResponse.json({ error: 'invalid platforms' }, { status: 400 })
  }

  // ── Query mode ──────────────────────────────────────────────────────────────
  // Every source is isolated. One marketplace timing out or being blocked must
  // not discard results another source already returned, and its error text
  // must not reach the client. The failed source is named instead.
  const settled = await Promise.all(
    uniquePlatforms.map(async (platform) => {
      try {
        return { platform, listings: await SCRAPERS[platform](trimmed), failed: false }
      } catch (err) {
        console.error(JSON.stringify({
          route: 'admin/scrape-platform', mode: 'query', source: platform,
          error: err instanceof Error ? err.message : String(err),
        }))
        return { platform, listings: [] as RawScrapedListing[], failed: true }
      }
    }),
  )

  return NextResponse.json({
    listings: settled.flatMap((r) => r.listings).map((listing) => normalizeListing(listing)),
    failedSources: settled.filter((r) => r.failed).map((r) => r.platform),
  })
}
