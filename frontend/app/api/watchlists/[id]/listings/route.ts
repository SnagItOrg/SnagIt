import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)))
  const from = (page - 1) * limit
  const to = from + limit - 1

  // Verify the watchlist belongs to the user
  const { data: watchlist } = await supabase
    .from('watchlists')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!watchlist) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error, count } = await supabase
    .from('listings')
    .select('id, title, price, currency, url, image_url, location, scraped_at, source', { count: 'exact' })
    .eq('watchlist_id', params.id)
    .order('scraped_at', { ascending: false })
    .range(from, to)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const total = count ?? 0
  return NextResponse.json({
    listings: data ?? [],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}
