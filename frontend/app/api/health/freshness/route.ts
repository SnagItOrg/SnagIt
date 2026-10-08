import { NextResponse } from 'next/server'
import { DAILY_SOURCES, staleSources } from '@/lib/scrape-freshness'
import { latestScrapedAt } from '@/lib/scrape-freshness-read'

// PAN-158: public, read-only scraper heartbeat, polled off-box by
// .github/workflows/scrape-freshness.yml. Returns timestamps only.
// 503 when any daily source is stale, so the caller fails on the status code.
export const dynamic = 'force-dynamic'

export async function GET() {
  const latest = await latestScrapedAt(DAILY_SOURCES)
  if (!latest) {
    return NextResponse.json({ error: 'freshness query failed' }, { status: 500 })
  }

  const stale = staleSources(latest, new Date())
  return NextResponse.json({ latest, stale }, { status: stale.length ? 503 : 200 })
}
