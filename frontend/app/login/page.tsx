'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import { OnboardingHeader } from '@/components/OnboardingHeader'
import type { Locale } from '@/lib/i18n'

export default function LoginPage() {
  const { locale, setLocale, t } = useLocale()
  const [email,   setEmail]   = useState('')
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        shouldCreateUser: false,
      },
    })

    if (error) {
      setError(t.loginError)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
      <OnboardingHeader showProgress={false} />

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

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-10 -mt-8">
        <div className="w-full max-w-md">

          {sent ? (
            /* Success state */
            <div className="text-center flex flex-col items-center gap-5">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '64px', color: 'var(--foreground)' }}
              >
                mark_email_read
              </span>
              <div>
                <h1 className="text-3xl font-black tracking-tight mb-2">
                  {t.checkInbox}
                </h1>
                <p style={{ color: 'var(--muted-foreground)' }}>
                  {t.magicLinkSent}{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{email}</span>
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Heading */}
              <div className="text-center mb-10">
                <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-3">
                  {t.welcomeBack}
                </h1>
                <p className="text-base" style={{ color: 'var(--muted-foreground)' }}>
                  {t.tagline}
                </p>
              </div>

              {/* Card */}
              <div
                className="p-8 rounded-3xl"
                style={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
                }}
              >
                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                  {/* Email */}
                  <div className="flex flex-col gap-2">
                    <label
                      className="text-xs font-bold uppercase tracking-widest"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {t.email}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder={t.emailPlaceholder}
                      className="w-full rounded-2xl px-5 py-4 text-base outline-none transition-all"
                      style={{ backgroundColor: 'var(--input-background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                      onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
                    />
                  </div>

                  {error && (
                    <div
                      className="rounded-xl px-4 py-3 text-sm text-red-400"
                      style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-5 rounded-2xl font-black text-xl tracking-tight transition-all flex items-center justify-center gap-3 group disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                    }}
                  >
                    {loading ? t.loginLoading : (
                      <>
                        {t.sendLoginLink}
                        <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                          arrow_forward
                        </span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Terms row */}
              <p className="mt-5 text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {t.noAccount}{' '}
                <Link
                  href="/signup"
                  className="font-bold underline hover:text-foreground transition-colors"
                  style={{ color: 'var(--foreground)' }}
                >
                  {t.createAccount}
                </Link>
              </p>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-10 text-center">
        <div className="inline-flex items-center gap-2" style={{ color: 'var(--muted-foreground)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.securityNote}</span>
        </div>
      </footer>
    </div>
  )
}
