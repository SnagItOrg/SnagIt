import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isDbaListingUrl, scrapeDbaListing } from '@/lib/scrapers/dba-listing'

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query } = await req.json()
  if (!query || typeof query !== 'string') {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  let insertData: {
    user_id: string
    query: string
    type: 'query' | 'listing'
    source_url?: string
  }

  if (isDbaListingUrl(query)) {
    // Fetch the listing title to use as the display name
    let listing
    try {
      listing = await scrapeDbaListing(query)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kunne ikke hente annonce'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    insertData = {
      user_id: user.id,
      query: listing.title,
      type: 'listing',
      source_url: query,
    }
  } else {
    insertData = {
      user_id: user.id,
      query: query.trim(),
      type: 'query',
    }
  }

  const { data, error } = await supabase
    .from('watchlists')
    .insert(insertData)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
