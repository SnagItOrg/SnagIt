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

// GET /api/admin/users/[id] — user detail (watchlists + saved)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const userId = params.id

  const [watchlists, saved] = await Promise.all([
    admin
      .from('watchlists')
      .select('id, query, max_price, created_at, active')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    admin
      .from('saved_listings')
      .select('listing_id, listing_data, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  return NextResponse.json({
    watchlists: watchlists.data ?? [],
    saved: saved.data ?? [],
  })
}

// DELETE /api/admin/users/[id] — delete user
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const { error } = await admin.auth.admin.deleteUser(params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST /api/admin/users/[id] — actions (reset-password)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action } = await req.json()

  if (action === 'reset-password') {
    const admin = getSupabaseAdmin()
    // Get user email first
    const { data: { user }, error: userError } = await admin.auth.admin.getUserById(params.id)
    if (userError || !user?.email) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const supabase = createSupabaseServerClient()
    const { error } = await supabase.auth.resetPasswordForEmail(user.email)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
