'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import { TextField } from '@/components/TextField'
import { Icon } from '@/components/Icon'

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
                  placeholder={t.searchInputPlaceholder}
                  className="w-full rounded-2xl pl-14 pr-6 py-4 text-lg text-foreground"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="w-full mt-3 rounded-2xl px-8 py-4 text-base font-semibold transition-opacity hover:opacity-90 active:opacity-100"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {t.search}
              </button>
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
