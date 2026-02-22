'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'

const BG   = '#102218'
const SURF = '#1a2e22'
const BORD = '#326748'
const PRI  = '#13ec6d'

function StepDots() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex gap-1.5">
        {([1, 2, 3] as const).map((n) => (
          <div
            key={n}
            className="h-1.5 w-8 rounded-full"
            style={{ backgroundColor: 'rgba(19,236,109,0.3)' }}
          />
        ))}
        <div
          className="h-1.5 w-12 rounded-full"
          style={{ backgroundColor: PRI, boxShadow: '0 0 8px rgba(19,236,109,0.5)' }}
        />
      </div>
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
        Trin 4 af 4
      </span>
    </div>
  )
}

function CheckInbox({ email }: { email: string }) {
  const { t } = useLocale()
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: BG, color: '#f1f5f9' }}
    >
      <div className="w-full max-w-md text-center">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8"
          style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}
        >
          <span className="material-symbols-outlined" style={{ color: PRI, fontSize: '40px' }}>
            mark_email_unread
          </span>
        </div>
        <h1 className="text-3xl font-black tracking-tight mb-4">{t.checkInbox}</h1>
        <p className="text-base mb-2" style={{ color: '#94a3b8' }}>
          {t.confirmationSentTo}
        </p>
        <p className="font-bold text-white mb-6">{email}</p>
        <p className="text-sm" style={{ color: '#64748b' }}>
          {t.clickToActivate}
        </p>
        <div className="mt-10 pt-8 border-t" style={{ borderColor: BORD }}>
          <p className="text-xs" style={{ color: '#475569' }}>
            Gik noget galt?{' '}
            <Link
              href="/onboarding/step4"
              className="underline font-medium hover:text-white transition-colors"
              style={{ color: '#64748b' }}
            >
              Prøv igen
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function Step4() {
  const router = useRouter()
  const { t } = useLocale()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createSupabaseBrowserClient()
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (data.session) {
      // Email confirmation disabled — session is immediate.
      // Home page useEffect picks up localStorage and syncs.
      router.push('/')
      return
    }

    // Email confirmation required — show inbox prompt.
    setDone(true)
    setLoading(false)
  }

  if (done) return <CheckInbox email={email} />

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BG, color: '#f1f5f9' }}>
      {/* Header */}
      <header className="w-full py-8 px-6 lg:px-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3" style={{ color: PRI }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}
            >
              <span className="material-symbols-outlined">radar</span>
            </div>
            <h2 className="text-xl font-black tracking-tight">Klup.dk</h2>
          </div>
          <StepDots />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-10 -mt-8">
        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-3">
              {t.secureYourHunt}
            </h1>
            <p className="text-base" style={{ color: '#94a3b8' }}>
              {t.secureSubtitle}
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
            {/* SSO buttons */}
            <div className="flex flex-col gap-3 mb-6">
              {/* Google */}
              <div className="relative">
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl font-semibold text-sm opacity-50 cursor-not-allowed"
                  style={{ backgroundColor: '#ffffff', color: '#1f2937', border: `1px solid ${BORD}` }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.017 17.64 11.71 17.64 9.2z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  {t.continueWithGoogle}
                </button>
                <span
                  className="absolute -top-2 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(19,236,109,0.1)', color: PRI }}
                >
                  {t.comingSoon}
                </span>
              </div>

              {/* Apple */}
              <div className="relative">
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl font-semibold text-sm opacity-50 cursor-not-allowed"
                  style={{ backgroundColor: '#000000', color: '#ffffff', border: `1px solid ${BORD}` }}
                >
                  <svg width="15" height="18" viewBox="0 0 15 18" fill="currentColor" aria-hidden="true">
                    <path d="M12.507 9.457c-.022-2.178 1.78-3.232 1.86-3.282-1.012-1.48-2.587-1.684-3.147-1.707-1.337-.136-2.61.791-3.286.791-.677 0-1.719-.773-2.827-.752-1.447.022-2.783.842-3.527 2.135C-.158 8.958.965 13.692 2.684 15.878c.853 1.067 1.862 2.264 3.19 2.218 1.286-.047 1.768-.826 3.322-.826 1.553 0 1.993.826 3.347.8 1.38-.022 2.251-1.09 3.09-2.166.984-1.244 1.386-2.466 1.408-2.528-.031-.013-2.695-1.033-2.726-4.114zm-2.553-7.575C10.707.97 11.178-.18 11.04-1.382c-1 .043-2.24.675-2.96 1.486-.643.726-1.212 1.905-1.057 3.019 1.124.083 2.279-.547 2.931-1.241z"/>
                  </svg>
                  {t.continueWithApple}
                </button>
                <span
                  className="absolute -top-2 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(19,236,109,0.1)', color: PRI }}
                >
                  {t.comingSoon}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 h-px" style={{ backgroundColor: BORD }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#475569' }}>
                {t.orDivider}
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: BORD }} />
            </div>

            {/* Form */}
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
                  placeholder="din@email.dk"
                  className="w-full rounded-2xl px-5 py-4 text-base outline-none transition-all placeholder:text-slate-600"
                  style={{ backgroundColor: BG, border: `2px solid ${BORD}`, color: '#f1f5f9' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = PRI }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = BORD }}
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-2">
                <label
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: '#64748b' }}
                >
                  {t.password}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Mindst 6 tegn"
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
                {loading ? '…' : (
                  <>
                    {t.finishAndHunt}
                    <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                      arrow_forward
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Terms */}
          <p className="mt-5 text-center text-xs" style={{ color: '#475569' }}>
            {t.termsNote}{' '}
            <span className="underline" style={{ color: '#64748b' }}>{t.termsOfService}</span>
            {' '}{t.and}{' '}
            <span className="underline" style={{ color: '#64748b' }}>{t.privacyPolicy}</span>
          </p>

          {/* Footer actions */}
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => router.push('/onboarding/step3')}
              className="flex items-center gap-2 font-bold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Tilbage
            </button>
            <p className="text-sm" style={{ color: '#64748b' }}>
              {t.alreadyHaveAccount}{' '}
              <Link
                href="/login"
                className="font-bold underline hover:text-white transition-colors"
                style={{ color: '#94a3b8' }}
              >
                {t.login}
              </Link>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-10 text-center">
        <div className="inline-flex items-center gap-2" style={{ color: '#475569' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {t.securityNote}
          </span>
        </div>
      </footer>
    </div>
  )
}
