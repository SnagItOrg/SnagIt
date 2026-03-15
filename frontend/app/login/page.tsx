'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import type { Locale } from '@/lib/i18n'

type Tab = 'password' | 'magic'

export default function LoginPage() {
  const router = useRouter()
  const { locale, setLocale, t } = useLocale()

  const [tab,                setTab]                = useState<Tab>('password')
  const [email,              setEmail]              = useState('')
  const [password,           setPassword]           = useState('')
  const [error,              setError]              = useState<string | null>(null)
  const [loading,            setLoading]            = useState(false)
  const [sent,               setSent]               = useState(false)
  const [passwordLoginFailed, setPasswordLoginFailed] = useState(false)
  const [resetSent,          setResetSent]          = useState(false)

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPasswordLoginFailed(false)
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(t.loginError)
      setPasswordLoginFailed(true)
      setLoading(false)
      return
    }
    router.push('/search')
  }

  async function handleResetPassword() {
    if (!email) return
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/auth/confirm',
    })
    setResetSent(true)
  }

  async function handleMagicLink(e: React.FormEvent) {
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

  const inputClass = "w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
  const inputStyle = {
    backgroundColor: 'var(--input-background)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
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

      {/* Card */}
      <div
        className="w-full max-w-md flex flex-col gap-6 p-8 rounded-2xl"
        style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex flex-col gap-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl">🎯</span>
            <span className="text-xl font-black">Klup.dk</span>
          </div>
          <h1 className="text-2xl font-bold">{t.welcomeBack}</h1>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {t.loginSubheading}
          </p>
        </div>

        {/* Tab switcher */}
        <div
          className="flex p-1 rounded-xl"
          style={{ backgroundColor: 'var(--secondary)' }}
        >
          {([
            { key: 'password' as Tab, label: t.loginTabPassword },
            { key: 'magic'    as Tab, label: t.loginTabMagicLink },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setError(null); setSent(false); setPasswordLoginFailed(false); setResetSent(false) }}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={tab === key
                ? { backgroundColor: 'var(--card)', color: 'var(--foreground)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                : { backgroundColor: 'transparent', color: 'var(--muted-foreground)' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'password' ? (
          <form onSubmit={handlePasswordLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--muted-foreground)' }}>
                {t.email}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder={t.emailPlaceholder}
                className={inputClass}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--muted-foreground)' }}>
                {t.password}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder={t.passwordPlaceholder}
                className={inputClass}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
            </div>

            {error && (
              <div className="flex flex-col gap-0">
                <p className="text-sm text-red-500">{error}</p>
                {passwordLoginFailed && (
                  <div
                    className="rounded-xl p-3 mt-2 flex flex-col gap-2"
                    style={{ backgroundColor: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <p className="text-xs text-muted-foreground">{t.noPasswordYet}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setTab('magic'); setError(null); setPasswordLoginFailed(false) }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                        style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                      >
                        {t.tryMagicLink}
                      </button>
                      <button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={resetSent}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                      >
                        {resetSent ? '✓' : t.resetPassword}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {loading ? t.loginLoading : t.loginButton}
            </button>
          </form>
        ) : sent ? (
          /* Magic link sent state */
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '48px', color: 'var(--foreground)' }}
            >
              mark_email_read
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{t.checkInbox}</p>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {t.magicLinkSent}{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{email}</span>
              </p>
            </div>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="text-xs underline transition-opacity hover:opacity-70"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Prøv igen
            </button>
          </div>
        ) : (
          /* Magic link form */
          <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--muted-foreground)' }}>
                {t.email}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder={t.emailPlaceholder}
                className={inputClass}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
            </div>

            {error && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {loading ? t.loginLoading : t.sendLoginLink}
            </button>

            <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
              {t.noPasswordNeeded}
            </p>
          </form>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
            {t.orDivider}
          </span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
        </div>

        {/* Google SSO */}
        <button
          type="button"
          onClick={() => {
            // TODO: wire up Google OAuth
            alert(t.googleLoginComingSoon)
          }}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
          style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {t.continueWithGoogle}
        </button>

        {/* Terms */}
        <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
          {t.termsLoginNote}{' '}
          <span className="underline">{t.termsLink}</span>
        </p>
      </div>
    </div>
  )
}
