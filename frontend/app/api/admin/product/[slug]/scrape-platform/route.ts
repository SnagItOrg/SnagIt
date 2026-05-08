import { NextRequest, NextResponse } from 'next/server'
import { requireAdminInRoute } from '@/lib/admin-auth'
import { toDkkApprox } from '@/lib/currency'
import { scrapeBlocket } from '@/lib/scrapers/blocket'
import { scrapeDba } from '@/lib/scrapers/dba'
import { scrapeFinn } from '@/lib/scrapers/finn'
import { scrapeKleinanzeigen } from '@/lib/scrapers/kleinanzeigen'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

type Platform = 'dba' | 'finn' | 'blocket' | 'kleinanzeigen' | 'reverb'

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

const VALID_PLATFORMS: Platform[] = ['dba', 'finn', 'blocket', 'kleinanzeigen', 'reverb']

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

const SCRAPERS: Record<Platform, (query: string) => Promise<RawScrapedListing[]>> = {
  dba: (query: string) => scrapeDba(query, 1),
  finn: (query: string) => scrapeFinn(query, 1),
  blocket: (query: string) => scrapeBlocket(query, 1),
  kleinanzeigen: (query: string) => scrapeKleinanzeigen(query, 3),
  reverb: (query: string) => scrapeReverbDb(query),
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

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json({ error: 'platforms is required' }, { status: 400 })
  }

  const uniquePlatforms = Array.from(new Set(platforms))
  if (!uniquePlatforms.every(isPlatform)) {
    return NextResponse.json({ error: 'invalid platforms' }, { status: 400 })
  }

  try {
    const results = await Promise.all(
      uniquePlatforms.map((platform) => SCRAPERS[platform](trimmed)),
    )

    return NextResponse.json({
      listings: results.flat().map((listing) => normalizeListing(listing)),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'scrape failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
