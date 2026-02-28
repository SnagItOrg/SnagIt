import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { query } = await req.json()

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
  }

  let listings
  try {
    listings = await scrapeDba(query.trim())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Fetch Reverb listings from DB in parallel with DBA upsert.
  // Anchor on first word, then filter client-side requiring all words.
  // Normalize hyphens/spaces so "re-201" matches "RE 201" and "RE201".
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1)
  const normalize = (s: string) => s.toLowerCase().replace(/[-\s_]+/g, '')

  const reverbPromise = words.length > 0
    ? getSupabaseAdmin()
        .from('listings')
        .select('*')
        .eq('source', 'reverb')
        .ilike('title', `%${words[0]}%`)
        .limit(100)
    : Promise.resolve({ data: [] as Record<string, unknown>[] })

  if (listings.length === 0) {
    const { data: reverbRaw } = await reverbPromise
    const reverbData = (reverbRaw ?? []).filter((l) =>
      words.every((w) => normalize(String(l.title)).includes(normalize(w)))
    ).slice(0, 20)
    return NextResponse.json({ inserted: 0, listings: reverbData, query })
  }

  const now = new Date().toISOString()
  // watchlist_id: null marks these as manual scrapes (not tied to a watchlist)
  const rows = listings.map((l) => ({ ...l, scraped_at: now, watchlist_id: null }))

  // Upsert DBA + fetch Reverb in parallel
  const [{ data, error }, { data: reverbRaw }] = await Promise.all([
    getSupabaseAdmin()
      .from('listings')
      .upsert(rows, { onConflict: 'url,watchlist_id' })
      .select('*'),
    reverbPromise,
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const reverbData = (reverbRaw ?? []).filter((l) =>
    words.every((w) => normalize(String(l.title)).includes(normalize(w)))
  ).slice(0, 20)

  // Merge DBA + Reverb, deduplicate by url
  const seen = new Set<string>()
  const merged = [...(data ?? []), ...reverbData].filter((l) => {
    if (seen.has(l.url as string)) return false
    seen.add(l.url as string)
    return true
  })

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_scraped: listings.length,
    query,
    listings: merged,
  })
}
