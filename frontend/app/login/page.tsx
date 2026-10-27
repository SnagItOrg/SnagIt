'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { safeNextPath } from '@/lib/safe-next'
import { useLocale } from '@/components/LocaleProvider'
import type { Locale } from '@/lib/i18n'
import { Icon } from '@/components/Icon'
import { EmailCodeSignIn } from '@/components/EmailCodeSignIn'

/**
 * PAN-300 — one screen for everyone: "Fortsæt med e-mail", then the 6-digit
 * code. There is no password, no separate signup (`/signup` redirects here)
 * and no choice to make first; Supabase creates the account on the first
 * code for a new address.
 *
 * After the code, a returning visitor goes where they were going (`next`,
 * PAN-187) or to search. A new one goes to `next` too when there is one, and
 * otherwise to their watchlists with a welcome: the first screen of an
 * account is the place its watches will live, and it creates any watch that
 * was parked before sign-in.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>
}) {
  const router = useRouter()
  const { locale, setLocale, t } = useLocale()
  const { next: rawNext, error } = use(searchParams)
  const next = safeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext)
  // `/auth/confirm` sends a link that no longer verifies here: an old mail,
  // or one a mail scanner opened first. The code is the way on.
  const linkFailed = (Array.isArray(error) ? error[0] : error) === 'auth'

  function handleSignedIn({ isNewUser }: { isNewUser: boolean }) {
    // replace, not push: Back must not return to a sign-in form.
    router.replace(next ?? (isNewUser ? '/watchlists?velkommen=1' : '/search'))
    router.refresh()
  }

  return (
    <div
      className="min-h-screen flex items-start sm:items-center justify-center px-4 pt-20 pb-10 sm:py-10"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      {/* Locale toggle */}
      <div className="absolute top-4 right-4 flex gap-1">
        {(['da', 'en'] as Locale[]).map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors"
            style={{
              color: locale === l ? 'var(--foreground)' : 'var(--muted-foreground)',
              backgroundColor: locale === l ? 'var(--secondary)' : 'transparent',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <main className="surface-card w-full max-w-md flex flex-col gap-6 p-6 sm:p-8 rounded-2xl">
        <div className="flex flex-col gap-2 text-center">
          <div className="flex items-center justify-center gap-3 text-primary">
            <div className="size-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0">
              <Icon name="radar" style={{ fontSize: '20px' }} />
            </div>
            <span className="text-lg font-semibold tracking-tight">Klup.dk</span>
          </div>
          <h1 className="type-title text-[1.75rem]">{t.authHeading}</h1>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {t.authSubheading}
          </p>
        </div>

        {linkFailed && (
          <p className="text-sm rounded-lg px-3 py-2 bg-surface-2 text-foreground">
            {t.authLinkExpired}
          </p>
        )}

        <EmailCodeSignIn next={next} onSignedIn={handleSignedIn} autoFocus />

        <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
          {t.termsLoginNote}{' '}
          <span className="underline">{t.termsLink}</span>
        </p>
      </main>
    </div>
  )
}
