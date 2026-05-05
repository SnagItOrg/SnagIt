import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type AdminState = {
  userId: string | null
  isAdmin: boolean
}

// Route-handler helper. Returns null on success, or a NextResponse to short-circuit.
//   401 if the request has no session
//   403 if the session is not admin
export async function requireAdminInRoute(): Promise<NextResponse | null> {
  const state = await getCurrentAdminState()
  if (!state.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!state.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export async function getCurrentAdminState(): Promise<AdminState> {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { userId: null, isAdmin: false }
  }

  const admin = getSupabaseAdmin()
  const { data: prefs } = await admin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', user.id)
    .single()

  return {
    userId: user.id,
    isAdmin: !!prefs?.is_admin,
  }
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const state = await getCurrentAdminState()
  return state.isAdmin
}
