import { NextRequest, NextResponse } from 'next/server'
import { scrapeDba } from '@/lib/scrapers/dba'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { query } = await req.json()

  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 })
  }

  let listings
  try {
    listings = await scrapeDba(query.trim())
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }

  if (listings.length === 0) {
    return NextResponse.json({ inserted: 0, message: 'No listings found' })
  }

  const now = new Date().toISOString()
  const rows = listings.map((l) => ({ ...l, scraped_at: now }))

  // Upsert — on url conflict, update title/price/image in case they changed
  const { data, error } = await supabaseAdmin
    .from('listings')
    .upsert(rows, { onConflict: 'url' })
    .select('*')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_scraped: listings.length,
    query,
    listings: data ?? [],
  })
}
