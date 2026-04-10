import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { detectListingUrl, fetchListingFromUrl } from '@/lib/scrapers/listing-url'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
  }

  const trimmed = query.trim()

  // ── URL mode: paste a DBA / Thomann / Reverb link directly ──────────────────
  if (detectListingUrl(trimmed)) {
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
      return NextResponse.json({ error: message }, { status: 502 })
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

  if (listings.length === 0) {
    const { data: reverbRaw } = await reverbPromise
    const reverbData = (reverbRaw ?? []).filter((l) =>
      words.every((w) => normalize(String(l.title)).includes(normalize(w)))
    ).slice(0, 20)
    return NextResponse.json({ inserted: 0, listings: reverbData, query }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
    })
  }

  const now = new Date().toISOString()
  // watchlist_id: null marks these as manual scrapes (not tied to a watchlist)
  // Use url as external_id fallback for DBA listings (they have no native external_id)
  const rows = listings.map((l) => ({
    ...l,
    scraped_at: now,
    watchlist_id: null,
    external_id: l.url,
    normalized_text: l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  }))

  // Upsert DBA + fetch Reverb in parallel
  const [{ data, error }, { data: reverbRaw }] = await Promise.all([
    getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'external_id,source' })
      .select('*'),
    reverbPromise,
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const reverbData = (reverbRaw ?? []).filter((l) =>
    words.every((w) => normalize(String(l.title)).includes(normalize(w)))
  ).slice(0, 20)

  // Interleave DBA + Reverb 1:1, deduplicate by url
  const seen = new Set<string>()
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
  const merged: typeof dba = []
  const len = Math.max(dba.length, reverb.length)
  for (let i = 0; i < len; i++) {
    if (i < dba.length)    merged.push(dba[i])
    if (i < reverb.length) merged.push(reverb[i])
  }

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_scraped: listings.length,
    query,
    listings: merged,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
  })
}
