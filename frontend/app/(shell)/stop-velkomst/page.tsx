import type { Metadata } from 'next'
import Link from 'next/link'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { Button } from '@/components/Button'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { translations } from '@/lib/i18n'
import { welcomeStopMatches, welcomeStopParams, welcomeStopped } from '@/lib/welcome-stop'

/**
 * `/stop-velkomst?u=<user id>&t=<token>` — PAN-308, "Stop dem her" in welcome
 * mails 2 and 3.
 *
 * THE PAGE ASKS; THE BUTTON STOPS. A visit changes nothing: Outlook Safe
 * Links and other scanners fetch every link in a mail, and a GET that stopped
 * the series would let them answer for the user. The button is a plain form
 * that POSTs to `/api/welcome/stop`, which sends the browser back here with
 * `?svar=stoppet` (or `ugyldig` / `fejl`).
 *
 * THE TOKEN IS THE CREDENTIAL (lib/welcome-stop.ts), checked here before the
 * question is asked, so a broken link says so instead of offering a button
 * that cannot work. The page names no address and no account. noindex, no
 * Referer; analytics keeps only `page` and `sub` of a query string, so the
 * token never reaches PostHog.
 *
 * Danish, like the mails it answers.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

type State = 'ask' | 'done' | 'invalid' | 'failed'

export default async function WelcomeStopPage(ctx: {
  searchParams: Promise<{ u?: string; t?: string; svar?: string }>
}) {
  const { u, t: token, svar } = await ctx.searchParams
  const params = welcomeStopParams(u, token)

  let state: State
  if (svar === 'stoppet') state = 'done'
  else if (svar === 'fejl') state = 'failed'
  else if (!params) state = 'invalid'
  else {
    const { data } = await getSupabaseAdmin().auth.admin.getUserById(params.userId)
    const meta = data?.user?.app_metadata
    state = !data?.user || !welcomeStopMatches(meta, params.token) ? 'invalid' : welcomeStopped(meta) ? 'done' : 'ask'
  }

  const t = translations.da
  const copy: Record<State, { title: string; body: string }> = {
    ask: { title: t.welcomeStopTitle, body: t.welcomeStopBody },
    done: { title: t.welcomeStopDoneTitle, body: t.welcomeStopDoneBody },
    invalid: { title: t.welcomeStopInvalidTitle, body: t.welcomeStopInvalidBody },
    failed: { title: t.welcomeStopFailedTitle, body: t.welcomeStopFailedBody },
  }

  return (
    <main id="main-content" className="flex-1 min-w-0 shell-offset pb-24 md:pb-8">
      <MobileSearchBar />
      <div className="cq-pane shell-reading flex flex-col gap-4 pt-6 pb-10 md:pt-10">
        <h1 className="type-title">{copy[state].title}</h1>
        <p className="type-measure text-ink-secondary">{copy[state].body}</p>
        {state === 'ask' && params ? (
          <form method="post" action={`/api/welcome/stop?u=${encodeURIComponent(params.userId)}&t=${encodeURIComponent(params.token)}`}>
            <Button type="submit" variant="primary" className="rounded-xl px-4 py-2 text-sm font-semibold">{t.welcomeStopButton}</Button>
          </form>
        ) : (
          <Link href="/" className="text-sm underline underline-offset-4">{t.accountDeletedHome}</Link>
        )}
      </div>
    </main>
  )
}
