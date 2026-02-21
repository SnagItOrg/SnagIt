'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

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
        Step 4 of 4
      </span>
    </div>
  )
}

function CheckInbox({ email }: { email: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
         style={{ backgroundColor: BG, color: '#f1f5f9' }}>
      <div className="w-full max-w-md text-center">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8"
          style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}
        >
          <span className="material-symbols-outlined" style={{ color: PRI, fontSize: '40px' }}>
            mark_email_unread
          </span>
        </div>
        <h1 className="text-3xl font-black tracking-tight mb-4">Tjek din indbakke</h1>
        <p className="text-base mb-2" style={{ color: '#94a3b8' }}>
          Vi har sendt et bekræftelseslink til
        </p>
        <p className="font-bold text-white mb-6">{email}</p>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Klik på linket i emailen for at aktivere din konto og starte jagten.
        </p>
        <div className="mt-10 pt-8 border-t" style={{ borderColor: BORD }}>
          <p className="text-xs" style={{ color: '#475569' }}>
            Gik noget galt?{' '}
            <Link href="/onboarding/step4"
                  className="underline font-medium hover:text-white transition-colors"
                  style={{ color: '#64748b' }}>
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
      // Email confirmation is disabled — session is immediate.
      // The home page's useEffect will pick up localStorage and sync.
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
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}>
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
              Opret konto
            </h1>
            <p className="text-base" style={{ color: '#94a3b8' }}>
              Næsten der — opret din konto for at gemme dine alerts.
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
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {/* Email */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-widest"
                       style={{ color: '#64748b' }}>
                  Email
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
                <label className="text-xs font-bold uppercase tracking-widest"
                       style={{ color: '#64748b' }}>
                  Adgangskode
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
                <div className="rounded-xl px-4 py-3 text-sm text-red-400"
                     style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
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
                {loading ? (
                  'Opretter konto…'
                ) : (
                  <>
                    Start jagten
                    <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                      arrow_forward
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer actions */}
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => router.push('/onboarding/step3')}
              className="flex items-center gap-2 font-bold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Back
            </button>
            <p className="text-sm" style={{ color: '#64748b' }}>
              Har du en konto?{' '}
              <Link href="/login"
                    className="font-bold underline hover:text-white transition-colors"
                    style={{ color: '#94a3b8' }}>
                Log ind
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
