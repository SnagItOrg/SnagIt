'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import { OnboardingHeader } from '@/components/OnboardingHeader'
import type { Locale } from '@/lib/i18n'

const BG   = '#102218'
const SURF = '#1a2e22'
const BORD = '#326748'
const PRI  = '#13ec6d'

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
        shouldCreateUser: true,
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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BG, color: '#f1f5f9' }}>
      <OnboardingHeader showProgress={false} />

      {/* Locale toggle */}
      <div className="absolute top-4 right-4 flex gap-1">
        {(['da', 'en'] as Locale[]).map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors"
            style={{
              color: locale === l ? PRI : 'rgba(255,255,255,0.4)',
              backgroundColor: locale === l ? 'rgba(19,236,109,0.1)' : 'transparent',
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
                style={{ fontSize: '64px', color: PRI }}
              >
                mark_email_read
              </span>
              <div>
                <h1 className="text-3xl font-black tracking-tight mb-2">
                  {t.checkInbox}
                </h1>
                <p style={{ color: '#94a3b8' }}>
                  {t.magicLinkSent}{' '}
                  <span className="font-semibold" style={{ color: '#f1f5f9' }}>{email}</span>
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
                <p className="text-base" style={{ color: '#94a3b8' }}>
                  {t.tagline}
                </p>
              </div>

              {/* Card */}
              <div
                className="p-8 rounded-3xl"
                style={{
                  backgroundColor: SURF,
                  border: `1px solid ${BORD}`,
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
                }}
              >
                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                  {/* Email */}
                  <div className="flex flex-col gap-2">
                    <label
                      className="text-xs font-bold uppercase tracking-widest"
                      style={{ color: '#64748b' }}
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
                      className="w-full rounded-2xl px-5 py-4 text-base outline-none transition-all placeholder:text-slate-600"
                      style={{ backgroundColor: BG, border: `2px solid ${BORD}`, color: '#f1f5f9' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = PRI }}
                      onBlur={(e)  => { e.currentTarget.style.borderColor = BORD }}
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
                      backgroundColor: PRI,
                      color: BG,
                      boxShadow: '0 20px 25px -5px rgba(19,236,109,0.2)',
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
              <p className="mt-5 text-center text-xs" style={{ color: '#475569' }}>
                {t.noAccount}{' '}
                <Link
                  href="/"
                  className="font-bold underline hover:text-white transition-colors"
                  style={{ color: '#94a3b8' }}
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
        <div className="inline-flex items-center gap-2" style={{ color: '#475569' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.securityNote}</span>
        </div>
      </footer>
    </div>
  )
}
