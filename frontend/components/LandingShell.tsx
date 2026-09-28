'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import { TextField } from '@/components/TextField'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/Button'

/**
 * The homepage shell: everything interactive, and nothing that needs the
 * catalogue.
 *
 * PAN-68 lifted this out of app/page.tsx so the page could become a server
 * component and put the product cards in the first response. The shell stays a
 * client component — every string on it comes from useLocale(), the search box
 * owns real state, and the signed-in redirect is a browser-session fact — but
 * it holds no data dependency, so it renders in the FIRST streamed flush while
 * the shelves are still resolving.
 *
 * That is why the shelves arrive as `children` rather than as an import: a slot
 * keeps the server-rendered Suspense boundary on the server side of the
 * boundary. Importing them here would drag lib/browse and the service-role
 * client into the client bundle, which wp4a-boundary.test.ts forbids outright.
 */
export function LandingShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { t } = useLocale()
  const [query, setQuery] = useState('')

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/watchlists')
    })
  }, [router])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      {/* Logo */}
      <header className="px-6 py-5 flex items-center">
        <div className="flex items-center gap-3" style={{ color: 'var(--foreground)' }}>
          <div
            className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--secondary)' }}
          >
            <Icon name="radar" style={{ fontSize: '20px' }} />
          </div>
          <span className="text-lg font-semibold tracking-tight">Klup.dk</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col pb-16">
        {/* Search section */}
        <div className="flex flex-col items-center text-center px-6 pt-12 pb-10">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <h1 className="type-display">
              {t.headline}
            </h1>
            <p className="text-lg mt-3 text-muted-foreground">
              {t.subheadline}
            </p>
            {/* PAN-168 #8. One control, not two slabs: the submit is a compact
                button inside the field's trailing edge (Astryx TextInput +
                Button: start icon, hidden-but-present label, a labelled
                action), where a full-width filled "Søg" under the field was
                the heaviest thing on the page after the H1 — a white slab in
                dark. No autoFocus: it painted the focus ring before anyone had
                touched the page. The hero's placeholder is the examples alone,
                since the subheadline above already says what Klup follows; the
                full sentence truncated at 390px. */}
            <form onSubmit={handleSubmit} className="w-full mt-8">
              <div className="relative w-full">
                <Icon
                  name="search"
                  className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ fontSize: '22px', color: 'var(--muted-foreground)' }}
                />
                <TextField
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.heroSearchPlaceholder}
                  aria-label={t.search}
                  className="w-full rounded-2xl pl-14 pr-14 sm:pr-24 py-4 text-base sm:text-lg text-foreground"
                />
                {/* Below `sm` the label moves to the accessible name only and an
                    arrow carries the action, which is what leaves the 390px
                    placeholder room to fit (measured: 228px of box for a 211px
                    EN string). The label stays in the DOM, so the button's
                    name is "Søg"/"Search" at every width. */}
                <Button
                  variant="primary"
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-10 rounded-xl text-sm font-semibold sm:size-auto sm:px-4 sm:py-2.5"
                >
                  <span className="flex sm:hidden">
                    <Icon name="arrow_forward" style={{ fontSize: '20px' }} />
                  </span>
                  <span className="sr-only sm:not-sr-only">{t.search}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>

        {children}
      </main>

      {/* Footer */}
      <footer className="pb-8 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <span>{t.alreadyHaveAccount}</span>
        <Link
          href="/login"
          className="font-semibold transition-colors text-muted-foreground hover:text-foreground"
        >
          {t.signIn}
        </Link>
      </footer>
    </div>
  )
}
