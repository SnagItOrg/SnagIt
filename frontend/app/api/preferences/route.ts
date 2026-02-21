import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = row not found — return empty defaults instead of 500
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({
      categories: [],
      brands: [],
      onboarding_completed: false,
    })
  }

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const patch: {
    categories?: string[]
    brands?: string[]
    onboarding_completed?: boolean
  } = {}

  if (Array.isArray(body.categories)) patch.categories = body.categories
  if (Array.isArray(body.brands)) patch.brands = body.brands
  if (typeof body.onboarding_completed === 'boolean') {
    patch.onboarding_completed = body.onboarding_completed
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
