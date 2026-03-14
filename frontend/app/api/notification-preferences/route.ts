import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const DEFAULTS = {
  email_enabled: true,
  push_enabled:  false,
  price_drops:   true,
  new_listings:  true,
}

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data ?? { ...DEFAULTS, user_id: user.id })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const patch: Record<string, boolean | string> = { user_id: user.id, updated_at: new Date().toISOString() }

  if (typeof body.email_enabled === 'boolean') patch.email_enabled = body.email_enabled
  if (typeof body.push_enabled  === 'boolean') patch.push_enabled  = body.push_enabled
  if (typeof body.price_drops   === 'boolean') patch.price_drops   = body.price_drops
  if (typeof body.new_listings  === 'boolean') patch.new_listings  = body.new_listings

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(patch, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
