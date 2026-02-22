'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadOnboarding, saveOnboarding, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'

const BG   = '#102218'
const SURF = '#1a2e22'
const BORD = '#326748'
const PRI  = '#13ec6d'
const MAX_PRICE = 20000

// Step dots — reused shape across steps
function StepDots({ active }: { active: 1 | 2 | 3 | 4 }) {
  const dots = [1, 2, 3, 4] as const
  return (
    <div className="flex items-center gap-4">
      <div className="flex gap-1.5">
        {dots.map((n) => (
          <div
            key={n}
            className="h-1.5 rounded-full"
            style={{
              width: n === active ? '48px' : '32px',
              backgroundColor:
                n === active
                  ? PRI
                  : n < active
                  ? 'rgba(19,236,109,0.3)'
                  : '#1e293b',
              boxShadow: n === active ? '0 0 8px rgba(19,236,109,0.5)' : undefined,
            }}
          />
        ))}
      </div>
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
        Trin {active} af 4
      </span>
    </div>
  )
}

export default function Step3() {
  const router = useRouter()
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [maxPrice, setMaxPrice] = useState(4500)
  const [fuzzy, setFuzzy] = useState(true)

  useEffect(() => {
    const saved = loadOnboarding()
    if (saved.query)     setQuery(saved.query)
    if (saved.max_price) setMaxPrice(saved.max_price)
  }, [])

  function handleContinue() {
    saveOnboarding({ query: query.trim(), max_price: maxPrice })
    fireEvent('onboarding_step3', { query: query.trim(), max_price: maxPrice })
    router.push('/onboarding/step4')
  }

  const pct = (maxPrice / MAX_PRICE) * 100

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
          <StepDots active={3} />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-10 -mt-8">
        <div className="w-full max-w-2xl">
          {/* Heading */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              Opsæt din første{' '}
              <span style={{ color: PRI }}>Snag-Alert</span>
            </h1>
            <p className="text-lg" style={{ color: '#94a3b8' }}>
              Fortæl os, hvad du jager efter, og vi scanner markederne 24/7.
            </p>
          </div>

          {/* Card */}
          <div
            className="p-8 md:p-12 rounded-3xl"
            style={{
              backgroundColor: SURF,
              border: `1px solid ${BORD}`,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
            }}
          >
            <div className="space-y-10">
              {/* Search input */}
              <div className="space-y-4">
                <label
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: '#64748b' }}
                >
                  Hvad leder du efter?
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: PRI, fontSize: '24px' }}
                  >
                    search
                  </span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Mac Mini M4, Vintage Eames, cykel..."
                    autoFocus
                    className="w-full rounded-2xl pl-14 pr-6 py-5 text-xl font-medium outline-none transition-all placeholder:text-slate-600"
                    style={{
                      backgroundColor: BG,
                      border: `2px solid ${BORD}`,
                      color: '#f1f5f9',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = PRI }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = BORD }}
                  />
                </div>
              </div>

              {/* Price range */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: '#64748b' }}
                  >
                    Maksimalpris
                  </label>
                  <div className="text-3xl font-black">
                    <span style={{ color: PRI }}>
                      {maxPrice === MAX_PRICE
                        ? `${maxPrice.toLocaleString('da-DK')}+`
                        : maxPrice.toLocaleString('da-DK')}
                    </span>
                    <span className="text-sm font-bold ml-1" style={{ color: '#64748b' }}>DKK</span>
                  </div>
                </div>
                <div className="px-1">
                  <input
                    type="range"
                    min={0}
                    max={MAX_PRICE}
                    step={100}
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(Number(e.target.value))}
                    className="w-full h-3 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${PRI} ${pct}%, ${BG} ${pct}%)`,
                      border: `1px solid ${BORD}`,
                    }}
                  />
                  <div
                    className="flex justify-between mt-4 text-[10px] font-bold uppercase tracking-tighter select-none"
                    style={{ color: '#475569' }}
                  >
                    <span>0</span>
                    <span>5.000</span>
                    <span>10.000</span>
                    <span>15.000</span>
                    <span>20.000+</span>
                  </div>
                </div>
              </div>

              {/* Fuzzy matching toggle */}
              <div
                className="flex items-center justify-between p-4 rounded-2xl"
                style={{ backgroundColor: `${BG}80`, border: `1px solid ${BORD}66` }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'rgba(19,236,109,0.1)', color: PRI }}
                  >
                    <span className="material-symbols-outlined">auto_awesome</span>
                  </div>
                  <div>
                    <p className="font-bold text-sm text-white">Udvidet søgning</p>
                    <p className="text-xs" style={{ color: '#64748b' }}>
                      Inkludér lignende varer og variationer
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={fuzzy}
                    onChange={(e) => setFuzzy(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className="relative w-12 h-6 rounded-full transition-colors"
                    style={{ backgroundColor: fuzzy ? PRI : '#334155' }}
                  >
                    <div
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: fuzzy ? 'translateX(24px)' : 'translateX(2px)' }}
                    />
                  </div>
                </label>
              </div>

              {/* Continue button */}
              <button
                onClick={handleContinue}
                disabled={!query.trim()}
                className="w-full py-6 rounded-2xl font-black text-xl tracking-tight transition-all flex items-center justify-center gap-3 group disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: PRI,
                  color: BG,
                  boxShadow: query.trim() ? '0 20px 25px -5px rgba(19,236,109,0.2)' : undefined,
                }}
              >
                Fortsæt
                <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                  arrow_forward
                </span>
              </button>
            </div>
          </div>

          {/* Footer actions */}
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => router.push('/onboarding/step2')}
              className="flex items-center gap-2 font-bold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Tilbage
            </button>
            <button
              onClick={() => router.push('/onboarding/step4')}
              className="text-sm font-semibold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              Jeg gør det senere
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-10 text-center">
        <div className="inline-flex items-center gap-2" style={{ color: '#475569' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.securityNote}</span>
        </div>
      </footer>

      {/* Bottom accent */}
      <div
        className="fixed bottom-0 left-0 w-full h-px"
        style={{ background: `linear-gradient(to right, transparent, ${PRI}33, transparent)` }}
      />
    </div>
  )
}
