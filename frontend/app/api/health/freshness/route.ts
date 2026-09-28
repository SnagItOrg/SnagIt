import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { DAILY_SOURCES, staleSources } from '@/lib/scrape-freshness'

// PAN-158: public, read-only scraper heartbeat, polled off-box by
// .github/workflows/scrape-freshness.yml. Returns timestamps only.
// 503 when any daily source is stale, so the caller fails on the status code.
export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = getSupabaseAdmin()
  const results = await Promise.all(
    DAILY_SOURCES.map((source) =>
      admin
        .from('listings')
        .select('scraped_at')
        .eq('source', source)
        .not('scraped_at', 'is', null)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  )

  if (results.some((r) => r.error)) {
    return NextResponse.json({ error: 'freshness query failed' }, { status: 500 })
  }

  const latest = Object.fromEntries(
    DAILY_SOURCES.map((source, i) => [source, results[i].data?.scraped_at ?? null]),
  )
  const stale = staleSources(latest, new Date())
  return NextResponse.json({ latest, stale }, { status: stale.length ? 503 : 200 })
}
