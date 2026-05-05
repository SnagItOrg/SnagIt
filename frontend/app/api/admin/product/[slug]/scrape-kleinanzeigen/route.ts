import { NextRequest, NextResponse } from 'next/server'
import { scrapeKleinanzeigen } from '@/lib/scrapers/kleinanzeigen'
import { requireAdminInRoute } from '@/lib/admin-auth'

// POST /api/admin/product/[slug]/scrape-kleinanzeigen
// Body: { query: string }
// Side-effect-free: returns scraped listings without writing to the DB.
export async function POST(
  req: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ctx: { params: { slug: string } },
) {
  const denied = await requireAdminInRoute()
  if (denied) return denied

  const { query } = (await req.json()) as { query?: string }
  const trimmed = (query ?? '').trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  try {
    const listings = await scrapeKleinanzeigen(trimmed, 3)
    return NextResponse.json({ listings })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'scrape failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
