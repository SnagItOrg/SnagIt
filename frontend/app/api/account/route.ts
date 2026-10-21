import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { deleteAccount, DELETE_ACCOUNT_CONFIRMATION } from '@/lib/account-deletion'

/**
 * PAN-277: DELETE /api/account — the signed-in user deletes their own account.
 *
 * The user is the session's, never a parameter, so nobody can name another
 * account. The body must carry the confirmation the profile page sends, so a
 * stray request cannot do it by accident. The plan, its order and what each
 * table gets is `lib/account-deletion.ts`; the service-role client is used here
 * and nowhere in the browser.
 *
 * Idempotent: a failed step leaves the account in place and the call can be
 * repeated; once the auth user is gone the session is too, and a repeat
 * answers 401. Logs carry the failing table and a static code — never the id
 * or the address.
 */
export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (body?.confirm !== DELETE_ACCOUNT_CONFIRMATION) {
    return NextResponse.json({ error: 'confirmation_required' }, { status: 400 })
  }

  const result = await deleteAccount(getSupabaseAdmin(), { id: user.id, email: user.email })
  if (!result.ok) {
    console.error('[account] delete failed', result.table, result.code)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }

  // The auth user is gone; clear this browser's session cookies too.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  return NextResponse.json({ ok: true })
}
