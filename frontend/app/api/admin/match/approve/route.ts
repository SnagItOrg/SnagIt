import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

async function verifyAdmin(): Promise<boolean> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  return !!prefs?.is_admin
}

// POST /api/admin/match/approve
// Body: { product_id: string, listing_ids: string[] }
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { product_id, listing_ids } = await req.json() as {
    product_id: string
    listing_ids: string[]
  }

  if (!product_id || !Array.isArray(listing_ids) || listing_ids.length === 0) {
    return NextResponse.json({ error: 'product_id and listing_ids required' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  const rows = listing_ids.map((listing_id) => ({
    listing_id,
    product_id,
    score:      1.0,   // manually confirmed — highest confidence
    match_type: 'manual',
  }))

  const { error } = await admin
    .from('listing_product_match')
    .upsert(rows, { onConflict: 'listing_id,product_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ approved: listing_ids.length })
}
