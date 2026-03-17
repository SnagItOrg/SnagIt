import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()

  // Verify admin
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()
  if (!prefs?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch all users from auth.users via admin API
  const allUsers: Array<{ id: string; email?: string; created_at: string }> = []
  let page = 1
  while (true) {
    const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!users || users.length === 0) break
    allUsers.push(...users.map(u => ({ id: u.id, email: u.email, created_at: u.created_at })))
    if (users.length < 1000) break
    page++
  }

  // Watchlist counts per user
  const { data: watchlistCounts } = await admin
    .from('watchlists')
    .select('user_id')
  const wMap = new Map<string, number>()
  for (const w of watchlistCounts ?? []) {
    wMap.set(w.user_id, (wMap.get(w.user_id) ?? 0) + 1)
  }

  // Saved listing counts per user
  const { data: savedCounts } = await admin
    .from('saved_listings')
    .select('user_id')
  const sMap = new Map<string, number>()
  for (const s of savedCounts ?? []) {
    sMap.set(s.user_id, (sMap.get(s.user_id) ?? 0) + 1)
  }

  const result = allUsers.map(u => ({
    id: u.id,
    email: u.email ?? null,
    created_at: u.created_at,
    watchlist_count: wMap.get(u.id) ?? 0,
    saved_count: sMap.get(u.id) ?? 0,
  }))

  // Sort by created_at DESC
  result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return NextResponse.json(result)
}
