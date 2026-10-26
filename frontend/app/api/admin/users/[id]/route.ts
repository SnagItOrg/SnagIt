import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { deleteAccount } from '@/lib/account-deletion'

async function verifyAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
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
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params
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

// DELETE /api/admin/users/[id] — delete user, through the same plan as the
// user's own "Slet konto" (PAN-277). A bare auth delete failed on the NO ACTION
// foreign keys and cascaded the user's watchlists into shared market data.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getSupabaseAdmin()
  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(params.id)
  if (userError || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const result = await deleteAccount(admin, { id: user.id, email: user.email })
  if (!result.ok) return NextResponse.json({ error: result.code, table: result.table }, { status: 500 })
  return NextResponse.json({ ok: true })
}
