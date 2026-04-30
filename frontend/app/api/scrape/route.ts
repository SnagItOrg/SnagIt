import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { scrapeDba } from '@/lib/scrapers/dba'
import { scrapeFinn } from '@/lib/scrapers/finn'
import { scrapeBlocket } from '@/lib/scrapers/blocket'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { detectListingUrl, fetchListingFromUrl } from '@/lib/scrapers/listing-url'
import { scrapeThomannSearch } from '@/lib/scrapers/thomann-search'

const ALL_SOURCES = ['dba', 'finn', 'blocket', 'reverb', 'thomann'] as const
type SourceKey = typeof ALL_SOURCES[number]

// Stable id from (source, natural-key) so a saved Thomann listing survives
// page refresh — crypto.randomUUID() rotated on every response and silently
// broke the saved-listings lookup.
function deterministicListingId(source: string, key: string): string {
  const h = createHash('sha256').update(`${source}:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// Non-blocking telemetry for fire-and-forget Supabase writes. Resolved
// responses with `{ error }` AND thrown rejections both used to vanish; now
// we surface them as structured logs without blocking the user response.
function logFireAndForget(p: PromiseLike<unknown>, query: string): void {
  void Promise.resolve(p).then(
    (res) => {
      const errMsg = (res as { error?: { message?: string } | null } | null | undefined)?.error?.message
      if (errMsg) {
        console.error(JSON.stringify({
          route: '/api/scrape', action: 'thomann_write', error: errMsg, query,
        }))
      }
    },
    (err: unknown) => {
      console.error(JSON.stringify({
        route: '/api/scrape', action: 'thomann_write',
        error: err instanceof Error ? err.message : String(err), query,
      }))
    },
  )
}

function parseSources(raw: string | null): Set<SourceKey> {
  if (!raw) return new Set(ALL_SOURCES)
  const requested = raw.split(',').map((s) => s.trim().toLowerCase())
  const allowed = new Set<SourceKey>()
  for (const s of requested) {
    if ((ALL_SOURCES as readonly string[]).includes(s)) allowed.add(s as SourceKey)
  }
  return allowed.size > 0 ? allowed : new Set(ALL_SOURCES)
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')
  const sources = parseSources(request.nextUrl.searchParams.get('sources'))

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
        await getSupabaseAdmin()
          .from('listings')
          .upsert(row, { onConflict: 'external_id,source' })

        if (urlSource === 'thomann' && result.listing.price != null) {
          // Don't await — upstream/DB errors are now logged instead of swallowed.
          logFireAndForget(
            getSupabaseAdmin()
              .from('thomann_product')
              .upsert({
                thomann_url:    result.listing.url,
                canonical_name: result.listing.title,
                image_url:      result.listing.image_url ?? null,
                price_dkk:      result.listing.price,
                scraped_at:     now,
              }, { onConflict: 'thomann_url' }),
            trimmed,
          )
        }

        return NextResponse.json({ inserted: 1, listings: [row], query: trimmed })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (urlSource === 'dba') {
        return NextResponse.json({ error: message }, { status: 502 })
      }
      console.error(`[scrape] ${urlSource} URL fetch failed:`, message)
      return NextResponse.json({ inserted: 0, listings: [], query: trimmed })
    }
  }

  // ── Query mode: run all enabled Schibsted scrapers in parallel ──────────────
  const schibstedJobs: Array<Promise<Awaited<ReturnType<typeof scrapeDba>>>> = []
  if (sources.has('dba'))     schibstedJobs.push(scrapeDba(trimmed).catch(() => []))
  if (sources.has('finn'))    schibstedJobs.push(scrapeFinn(trimmed).catch(() => []))
  if (sources.has('blocket')) schibstedJobs.push(scrapeBlocket(trimmed).catch(() => []))

  const schibstedResults = (await Promise.all(schibstedJobs)).flat()

  // Reverb: anchor on first word, then filter client-side requiring all words.
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1)
  const normalize = (s: string) => s.toLowerCase().replace(/[-\s_]+/g, '')

  const reverbPromise = sources.has('reverb') && words.length > 0
    ? getSupabaseAdmin()
        .from('listings')
        .select('*')
        .eq('source', 'reverb')
        .eq('is_active', true)
        .ilike('title', `%${words[0]}%`)
        .limit(100)
    : Promise.resolve({ data: [] as Record<string, unknown>[] })

  // Thomann: live search, fall back to kg_product when Cloudflare blocks
  const thomannPromise: Promise<import('@/lib/scrapers/thomann-search').ThomannProduct[]> =
    sources.has('thomann')
      ? scrapeThomannSearch(trimmed).then((results) => {
          if (results.length > 0) return results
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
            }>).map((p) => {
              // Legacy kg_product rows have literal "\/" escapes; normalize.
              // Also drop /sbpics/ URLs — those point to Thomann salesperson
              // portraits, not product images. Card falls back to placeholder.
              let img = p.image_url ? p.image_url.replace(/\\\//g, '/') : null
              if (img && img.includes('/sbpics/')) img = null
              return {
                thomann_url:    p.thomann_url,
                canonical_name: p.canonical_name,
                image_url:      img,
                price_dkk:      p.thomann_price_dkk,
              }
            })
          })()
        }).catch(() => [])
      : Promise.resolve([])

  const now = new Date().toISOString()

  function thomannToListings(results: Awaited<typeof thomannPromise>) {
    return results.map((p) => ({
      // Hashed id keyed on thomann_url — must be stable so /api/saved-listings
      // can resolve a saved Thomann result after a page refresh.
      id:          deterministicListingId('thomann', p.thomann_url),
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

  function persistThomann(results: Awaited<typeof thomannPromise>) {
    if (results.length === 0) return
    // Don't await — upstream/DB errors are now logged instead of swallowed.
    logFireAndForget(
      getSupabaseAdmin()
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
        ),
      trimmed,
    )
  }

  if (schibstedResults.length === 0) {
    const [{ data: reverbRaw }, thomannResults] = await Promise.all([reverbPromise, thomannPromise])
    const reverbData = (reverbRaw ?? []).filter((l) =>
      words.every((w) => normalize(String(l.title)).includes(normalize(w)))
    ).slice(0, 20)
    persistThomann(thomannResults)
    return NextResponse.json({ inserted: 0, listings: [...thomannToListings(thomannResults), ...reverbData], query: trimmed }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
    })
  }

  const rows = schibstedResults.map((l) => ({
    ...l,
    scraped_at: now,
    watchlist_id: null,
    external_id: l.url,
    normalized_text: l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  }))

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

  const seen = new Set<string>()

  // Thomann first (retail "new price" context at the top)
  const thomannListings = thomannToListings(thomannResults).filter((l) => {
    if (seen.has(l.url)) return false
    seen.add(l.url)
    return true
  })

  const schibstedRows = (data ?? []).filter((l) => {
    if (seen.has(l.url as string)) return false
    seen.add(l.url as string)
    return true
  })
  const reverb = reverbData.filter((l) => {
    if (seen.has(l.url as string)) return false
    seen.add(l.url as string)
    return true
  })

  // Interleave Schibsted (already a mix of dba/finn/blocket) with Reverb 1:1
  const interleaved: typeof schibstedRows = []
  const len = Math.max(schibstedRows.length, reverb.length)
  for (let i = 0; i < len; i++) {
    if (i < schibstedRows.length) interleaved.push(schibstedRows[i])
    if (i < reverb.length)        interleaved.push(reverb[i])
  }

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_scraped: schibstedResults.length,
    query: trimmed,
    listings: [...thomannListings, ...interleaved],
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
  })
}
