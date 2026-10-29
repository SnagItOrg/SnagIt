import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildWelcomeEmail, sendWelcomeEmail, welcomeDue } from '@/lib/email'

/**
 * PAN-308 — welcome mail #1, asked for by the browser right after the first
 * code of a new account (`requestWelcomeMail` in lib/email-code.ts).
 *
 * The request carries nothing: who to write to and whether the mail is due
 * come from the session alone. An account older than `WELCOME_WINDOW_MS` gets
 * nothing, and Resend's idempotency key (`welcome-1/<user id>`) makes a
 * doubled request inside that window one mail. No table, no migration.
 *
 * The call to action follows the account: one that already watches something
 * (signed up from a product's watch form) is sent to its watchlist, any other
 * to the catalogue.
 *
 * Logging: static codes only. Never the address, never the provider's free
 * text — the same rule as lib/watchlist-notify.ts.
 */
const PROVIDER_CODE = /^resend_rejected:[a-z_]+$/

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!user.email || !welcomeDue(user.created_at, Date.now())) {
    return NextResponse.json({ sent: false })
  }

  const { count } = await supabase
    .from('watchlists')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  try {
    await sendWelcomeEmail(user.email, user.id, buildWelcomeEmail({ hasWatchlist: (count ?? 0) > 0 }))
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    console.error(JSON.stringify({
      channel: 'operational',
      component: 'welcome',
      event: 'welcome_mail_failed',
      detail: PROVIDER_CODE.test(message) ? message : null,
    }))
    return NextResponse.json({ sent: false }, { status: 502 })
  }

  return NextResponse.json({ sent: true })
}
