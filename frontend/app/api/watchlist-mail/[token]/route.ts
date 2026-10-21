import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { MAIL_TOKEN } from '@/lib/watchlist-mail'

/**
 * POST /api/watchlist-mail/<token> — PAN-278. The two buttons on a watchlist
 * mail's page: `action=stop` pauses that mail's watchlist (`active = false`),
 * `action=resume` switches it back on. A plain HTML form posts here and is
 * sent back to `/w/<token>` with 303, so it works without JavaScript.
 *
 * The mail's token is the credential, as on the page: whoever holds the mail
 * may stop or restart that one watchlist and nothing else. No session is
 * asked for, for the reason the page gives. Only a POST changes anything, so
 * a link scanner that fetches every URL in a mail cannot.
 *
 * Responses carry no body beyond a static code; nothing is logged.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!MAIL_TOKEN.test(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let action: FormDataEntryValue | null = null
  try {
    action = (await req.formData()).get('action')
  } catch {
    /* not a form: falls through to bad_request */
  }
  if (action !== 'stop' && action !== 'resume') return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const db = getSupabaseAdmin()
  const { data: mail } = await db
    .from('watchlist_mail')
    .select('watchlist_id, clicked_at')
    .eq('token', token)
    .maybeSingle<{ watchlist_id: string; clicked_at: string | null }>()
  if (!mail) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error } = await db.from('watchlists').update({ active: action === 'resume' }).eq('id', mail.watchlist_id)
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  if (!mail.clicked_at) {
    await db.from('watchlist_mail').update({ clicked_at: new Date().toISOString() }).eq('token', token).is('clicked_at', null)
  }

  const back = new URL(`/w/${token}${action === 'resume' ? '?svar=fortsaet' : ''}`, req.url)
  return NextResponse.redirect(back, 303)
}
