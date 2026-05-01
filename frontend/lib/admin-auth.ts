import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type AdminState = {
  userId: string | null
  isAdmin: boolean
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
