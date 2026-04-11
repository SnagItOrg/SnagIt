import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { detectListingUrl, fetchListingFromUrl } from '@/lib/scrapers/listing-url'
import { scrapeThomannSearch } from '@/lib/scrapers/thomann-search'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
  }

  const trimmed = query.trim()

  // ── URL mode: paste a DBA / Thomann / Reverb link directly ──────────────────
  const urlSource = detectListingUrl(trimmed)
  if (urlSource) {
    try {
      const result = await fetchListingFromUrl(trimmed)
      if (result) {
        const now = new Date().toISOString()
        const row = {
          ...result.listing,
          scraped_at: now,
          watchlist_id: null,
          external_id: result.listing.url,
          normalized_text: result.listing.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
        }
        // Upsert so repeated pastes of the same URL are idempotent
        await getSupabaseAdmin()
          .from('listings')
          .upsert(row, { onConflict: 'external_id,source' })

        return NextResponse.json({ inserted: 1, listings: [row], query: trimmed })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      // DBA failures (broken link) → 502 so user knows the link is bad.
      // Thomann/Reverb may be Cloudflare-blocked → return empty, not an error.
      if (urlSource === 'dba') {
        return NextResponse.json({ error: message }, { status: 502 })
      }
      console.error(`[scrape] ${urlSource} URL fetch failed:`, message)
      return NextResponse.json({ inserted: 0, listings: [], query: trimmed })
    }
  }

  // ── Query mode: normal text search ──────────────────────────────────────────
  let listings
  try {
    listings = await scrapeDba(trimmed)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Fetch Reverb listings from DB in parallel with DBA upsert.
  // Anchor on first word, then filter client-side requiring all words.
  // Normalize hyphens/spaces so "re-201" matches "RE 201" and "RE201".
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1)
  const normalize = (s: string) => s.toLowerCase().replace(/[-\s_]+/g, '')

  const reverbPromise = words.length > 0
    ? getSupabaseAdmin()
        .from('listings')
        .select('*')
        .eq('source', 'reverb')
        .eq('is_active', true)
        .ilike('title', `%${words[0]}%`)
        .limit(100)
    : Promise.resolve({ data: [] as Record<string, unknown>[] })

  // Fetch Thomann results: try live search, fall back to kg_product if Cloudflare blocks
  const thomannPromise: Promise<import('@/lib/scrapers/thomann-search').ThomannProduct[]> =
    scrapeThomannSearch(trimmed).then((results) => {
      if (results.length > 0) return results
      // Cloudflare likely blocked the search page — fall back to kg_product table
      // which already has thomann_url + thomann_price_dkk + image_url for matched products
      return (async () => {
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
        }>).map((p) => ({
          thomann_url:    p.thomann_url,
          canonical_name: p.canonical_name,
          image_url:      p.image_url,
          price_dkk:      p.thomann_price_dkk,
        }))
      })()
    }).catch(() => [])

  const now = new Date().toISOString()

  // Helper: transform Thomann scrape results into Listing-shaped objects
  function thomannToListings(results: Awaited<typeof thomannPromise>) {
    return results.map((p) => ({
      id:          crypto.randomUUID(),
      title:       p.canonical_name,
      price:       p.price_dkk,
      currency:    'DKK',
      url:         p.thomann_url,
      image_url:   p.image_url,
      location:    null,
      scraped_at:  now,
      source:      'thomann',
      condition:   'Ny',
      watchlist_id: null,
    }))
  }

  // Helper: persist Thomann results fire-and-forget (don't block response)
  function persistThomann(results: Awaited<typeof thomannPromise>) {
    if (results.length === 0) return
    void getSupabaseAdmin()
      .from('thomann_product')
      .upsert(
        results.map((p) => ({
          thomann_url:    p.thomann_url,
          canonical_name: p.canonical_name,
          image_url:      p.image_url,
          price_dkk:      p.price_dkk,
          scraped_at:     now,
        })),
        { onConflict: 'thomann_url' },
      )
  }

  if (listings.length === 0) {
    const [{ data: reverbRaw }, thomannResults] = await Promise.all([reverbPromise, thomannPromise])
    const reverbData = (reverbRaw ?? []).filter((l) =>
      words.every((w) => normalize(String(l.title)).includes(normalize(w)))
    ).slice(0, 20)
    persistThomann(thomannResults)
    return NextResponse.json({ inserted: 0, listings: [...thomannToListings(thomannResults), ...reverbData], query }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
    })
  }

  // watchlist_id: null marks these as manual scrapes (not tied to a watchlist)
  // Use url as external_id fallback for DBA listings (they have no native external_id)
  const rows = listings.map((l) => ({
    ...l,
    scraped_at: now,
    watchlist_id: null,
    external_id: l.url,
    normalized_text: l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  }))

  // Upsert DBA + fetch Reverb + fetch Thomann — all in parallel
  const [{ data, error }, { data: reverbRaw }, thomannResults] = await Promise.all([
    getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'external_id,source' })
      .select('*'),
    reverbPromise,
    thomannPromise,
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  persistThomann(thomannResults)

  const reverbData = (reverbRaw ?? []).filter((l) =>
    words.every((w) => normalize(String(l.title)).includes(normalize(w)))
  ).slice(0, 20)

  // Interleave DBA + Reverb 1:1, deduplicate by url
  const seen = new Set<string>()

  // Thomann first (retail "new price" context at the top)
  const thomannListings = thomannToListings(thomannResults).filter((l) => {
    if (seen.has(l.url)) return false
    seen.add(l.url)
    return true
  })

  const dba = (data ?? []).filter((l) => {
    if (seen.has(l.url as string)) return false
    seen.add(l.url as string)
    return true
  })
  const reverb = reverbData.filter((l) => {
    if (seen.has(l.url as string)) return false
    seen.add(l.url as string)
    return true
  })
  const interleaved: typeof dba = []
  const len = Math.max(dba.length, reverb.length)
  for (let i = 0; i < len; i++) {
    if (i < dba.length)    interleaved.push(dba[i])
    if (i < reverb.length) interleaved.push(reverb[i])
  }

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_scraped: listings.length,
    query,
    listings: [...thomannListings, ...interleaved],
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
  })
}
