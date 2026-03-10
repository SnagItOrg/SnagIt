'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'

export default function LandingPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [query, setQuery] = useState('')

  // Fallback: redirect logged-in users client-side (middleware handles it too)
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
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
          </div>
          <span className="text-xl font-black tracking-tight">Klup.dk</span>
        </div>
      </header>

      {/* Center content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-2xl flex flex-col items-center text-center">
          <h1 className="font-black text-5xl md:text-7xl text-white tracking-tight">
            {t.headline}
          </h1>

          <p className="text-lg mt-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {t.subheadline}
          </p>

          <form onSubmit={handleSubmit} className="w-full mt-8">
            <div className="relative w-full">
              <span
                className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ fontSize: '22px', color: 'rgba(255,255,255,0.3)' }}
              >
                search
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchInputPlaceholder}
                className="w-full rounded-2xl pl-14 pr-6 py-4 text-lg text-white outline-none transition-all"
                style={{
                  backgroundColor: 'var(--input-background)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="w-full mt-3 rounded-2xl px-8 py-4 text-lg font-black transition-opacity hover:opacity-90 active:opacity-100"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {t.search}
            </button>
          </form>
        </div>
      </main>

      {/* Bottom: already have account */}
      <footer className="pb-8 flex items-center justify-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
        <span>{t.alreadyHaveAccount}</span>
        <Link
          href="/login"
          className="font-semibold transition-colors"
          style={{ color: 'rgba(255,255,255,0.4)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)' }}
        >
          {t.signIn}
        </Link>
      </footer>
    </div>
  )
}
