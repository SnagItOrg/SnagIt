'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function SignupPage() {
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
      setError('Noget gik galt. Prøv igen.')
      setLoading(false)
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4 text-center"
        style={{ backgroundColor: 'var(--color-dark-bg)' }}
      >
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-primary)' }}>
          Tjek din indbakke
        </h1>
        <p className="text-sm max-w-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Vi har sendt et bekræftelseslink til <strong className="text-white">{email}</strong>.
          Klik på linket for at aktivere din konto.
        </p>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: 'var(--color-dark-bg)' }}
    >
      {/* Wordmark */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight" style={{ color: 'var(--color-primary)' }}>
          Klup
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Kup efter kup – det er Klup
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-base font-semibold text-text mb-5">Opret konto</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-xl border border-gray-200 bg-bg px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Adgangskode</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-xl border border-gray-200 bg-bg px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 -mt-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98] glow-primary disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-dark-bg)' }}
          >
            {loading ? 'Opretter konto…' : 'Opret konto'}
          </button>
        </form>
      </div>

      <p className="mt-5 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Har du allerede en konto?{' '}
        <Link href="/login" className="font-medium underline" style={{ color: 'var(--color-primary)' }}>
          Log ind
        </Link>
      </p>
    </main>
  )
}
