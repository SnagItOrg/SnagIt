import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { welcomeStopMatches, welcomeStopParams, welcomeStopped } from '@/lib/welcome-stop'

/**
 * POST /api/welcome/stop?u=<user id>&t=<token> — PAN-308. Stops the welcome
 * series (mails 2 and 3) for one account by setting
 * `app_metadata.welcome_stopped_at` (lib/welcome-stop.ts).
 *
 * Two callers:
 *   - the button on `/stop-velkomst`, a plain HTML form, sent back to that
 *     page with 303 so it works without JavaScript;
 *   - a mail client's one-click unsubscribe (RFC 8058), which POSTs
 *     `List-Unsubscribe=One-Click` and gets a 200, never a redirect.
 *
 * The token is the credential; no session is asked for. Only a POST changes
 * anything — there is no GET — so a link scanner cannot. A second stop is a
 * no-op that answers the same. `app_metadata` is written whole, the account's
 * existing keys spread first, so the provider keys Supabase keeps there stay.
 *
 * Responses carry no body beyond a static code; nothing is logged.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const url = new URL(req.url)
  let oneClick = false
  try {
    oneClick = (await req.formData()).get('List-Unsubscribe') === 'One-Click'
  } catch {
    /* no form body: the page's button sends one, so treat it as the page */
  }
  const answer = (svar: 'stoppet' | 'ugyldig' | 'fejl', status: number) =>
    oneClick
      ? NextResponse.json({ stopped: svar === 'stoppet' }, { status })
      : NextResponse.redirect(new URL(`/stop-velkomst?svar=${svar}`, req.url), 303)

  const params = welcomeStopParams(url.searchParams.get('u'), url.searchParams.get('t'))
  if (!params) return answer('ugyldig', 404)

  const admin = getSupabaseAdmin().auth.admin
  const { data, error } = await admin.getUserById(params.userId)
  const meta = data?.user?.app_metadata
  if (error || !data?.user || !welcomeStopMatches(meta, params.token)) return answer('ugyldig', 404)

  if (!welcomeStopped(meta)) {
    const { error: writeError } = await admin.updateUserById(params.userId, {
      app_metadata: { ...meta, welcome_stopped_at: new Date().toISOString() },
    })
    if (writeError) return answer('fejl', 503)
  }

  return answer('stoppet', 200)
}
