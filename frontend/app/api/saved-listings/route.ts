import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('saved_listings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { listing_id, listing_data } = body

  if (!listing_id || typeof listing_id !== 'string') {
    return NextResponse.json({ error: 'Missing listing_id' }, { status: 400 })
  }
  if (!listing_data || typeof listing_data !== 'object') {
    return NextResponse.json({ error: 'Missing listing_data' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('saved_listings')
    .upsert(
      { user_id: user.id, listing_id, listing_data },
      { onConflict: 'user_id,listing_id' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire-and-forget: queue price fetch if product lacks price history
  void (async () => {
    try {
      const admin = getSupabaseAdmin()
      const { data: match } = await admin
        .from('listing_product_match')
        .select('product_id, kg_product!inner(slug)')
        .eq('listing_id', listing_id)
        .limit(1)
        .single()

      if (!match) return
      const slug = (match.kg_product as unknown as { slug: string }).slug

      const { count } = await admin
        .from('reverb_price_history')
        .select('id', { count: 'exact', head: true })
        .eq('query', slug)

      if ((count ?? 0) >= 5) return

      await admin
        .from('price_fetch_queue')
        .upsert(
          { product_slug: slug, status: 'pending' },
          { onConflict: 'product_slug,status' },
        )
    } catch {
      // Non-critical — don't let queue errors affect the save response
    }
  })()

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { listing_id } = body

  if (!listing_id || typeof listing_id !== 'string') {
    return NextResponse.json({ error: 'Missing listing_id' }, { status: 400 })
  }

  const { error } = await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listing_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
