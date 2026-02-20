'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import type { Locale } from '@/lib/i18n'

export default function SignupPage() {
  const { locale, setLocale, t } = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      setError(t.signupError)
      setLoading(false)
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center bg-bg">
        <h1 className="text-3xl font-bold mb-2 text-primary">{t.checkInbox}</h1>
        <p className="text-sm max-w-xs text-text-muted">
          {t.confirmationSentTo} <strong className="text-text">{email}</strong>.{' '}
          {t.clickToActivate}
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-bg">
      {/* Language toggle */}
      <div className="absolute top-4 right-4 flex gap-1">
        {(['da', 'en'] as Locale[]).map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors"
            style={{
              color: locale === l ? 'var(--color-primary)' : 'rgba(255,255,255,0.4)',
              backgroundColor: locale === l ? 'rgba(19,236,109,0.1)' : 'transparent',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Wordmark */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-primary">Klup</h1>
        <p className="mt-1 text-sm text-text-muted">{t.tagline}</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl border border-white/10">
        <h2 className="text-base font-semibold text-text mb-5">{t.createAccount}</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">{t.email}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-xl border border-white/10 bg-bg px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">{t.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-xl border border-white/10 bg-bg px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            />
          </div>

          {error && <p className="text-xs text-red-400 -mt-1">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98] glow-primary disabled:opacity-60 disabled:cursor-not-allowed bg-primary"
            style={{ color: 'var(--color-bg)' }}
          >
            {loading ? t.createAccountLoading : t.createAccount}
          </button>
        </form>
      </div>

      <p className="mt-5 text-xs text-text-muted">
        {t.alreadyHaveAccount}{' '}
        <Link href="/login" className="font-medium underline text-primary">
          {t.login}
        </Link>
      </p>
    </main>
  )
}
