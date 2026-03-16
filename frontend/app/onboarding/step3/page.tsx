'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadOnboarding, saveOnboarding, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'
import { OnboardingHeader } from '@/components/OnboardingHeader'
import { PriceRangeSlider } from '@/components/PriceRangeSlider'
import { MAX_WATCHLIST_PRICE } from '@/lib/constants'

export default function Step3() {
  const router = useRouter()
  const { t } = useLocale()
  const [query,    setQuery]    = useState('')
  const [minPrice, setMinPrice] = useState(0)
  const [maxPrice, setMaxPrice] = useState(4500)
  const [fuzzy,    setFuzzy]    = useState(true)

  useEffect(() => {
    const saved = loadOnboarding()
    if (saved.query)     setQuery(saved.query)
    if (saved.min_price) setMinPrice(saved.min_price)
    if (saved.max_price) setMaxPrice(saved.max_price)
  }, [])

  function handleContinue() {
    saveOnboarding({ query: query.trim(), min_price: minPrice, max_price: maxPrice })
    fireEvent('onboarding_step3', { query: query.trim(), min_price: minPrice, max_price: maxPrice })
    router.push('/onboarding/step4')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
      <OnboardingHeader currentStep={3} />

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6 py-10 -mt-8">
        <div className="w-full max-w-2xl">
          {/* Heading */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              Opsæt din første{' '}
              <span style={{ color: 'var(--foreground)' }}>Overvågning</span>
            </h1>
            <p className="text-lg" style={{ color: 'var(--muted-foreground)' }}>
              Fortæl os, hvad du jager efter, og vi scanner markederne 24/7.
            </p>
          </div>

          {/* Card */}
          <div
            className="p-8 md:p-12 rounded-3xl"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
            }}
          >
            <div className="space-y-10">
              {/* Search input */}
              <div className="space-y-4">
                <label
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  Hvad leder du efter?
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--muted-foreground)', fontSize: '24px' }}
                  >
                    search
                  </span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Mac Mini M4, Vintage Eames, cykel..."
                    autoFocus
                    className="w-full rounded-2xl pl-14 pr-6 py-5 text-xl font-medium outline-none transition-all"
                    style={{
                      backgroundColor: 'var(--input-background)',
                      border: '1px solid var(--border)',
                      color: 'var(--foreground)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </div>
              </div>

              {/* Price range */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Prisgrænse
                  </label>
                  <div className="text-2xl font-black">
                    <span style={{ color: 'var(--foreground)' }}>
                      {minPrice > 0 ? `${minPrice.toLocaleString('da-DK')} – ` : ''}
                      {maxPrice === MAX_WATCHLIST_PRICE
                        ? `${maxPrice.toLocaleString('da-DK')}+`
                        : maxPrice.toLocaleString('da-DK')}
                    </span>
                    <span className="text-sm font-bold ml-1" style={{ color: 'var(--muted-foreground)' }}>DKK</span>
                  </div>
                </div>
                <div className="px-1">
                  <PriceRangeSlider
                    minPrice={minPrice}
                    maxPrice={maxPrice}
                    maxValue={MAX_WATCHLIST_PRICE}
                    onChange={(min, max) => { setMinPrice(min); setMaxPrice(max) }}
                  />
                  <div
                    className="flex justify-between mt-6 text-[10px] font-bold uppercase tracking-tighter select-none"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    <span>0</span>
                    <span>5.000</span>
                    <span>10.000</span>
                    <span>15.000</span>
                    <span>100k+</span>
                  </div>
                </div>
              </div>

              {/* Fuzzy matching toggle */}
              <div
                className="flex items-center justify-between p-4 rounded-2xl"
                style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                  >
                    <span className="material-symbols-outlined">auto_awesome</span>
                  </div>
                  <div>
                    <p className="font-bold text-sm" style={{ color: 'var(--foreground)' }}>Udvidet søgning</p>
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
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
                    style={{ backgroundColor: fuzzy ? 'var(--primary)' : 'var(--muted)' }}
                  >
                    <div
                      className="absolute top-0.5 h-5 w-5 rounded-full shadow transition-transform"
                      style={{
                        backgroundColor: fuzzy ? 'var(--primary-foreground)' : 'var(--foreground)',
                        transform: fuzzy ? 'translateX(24px)' : 'translateX(2px)',
                      }}
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
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
              >
                {t.continueToStep4}
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
              className="flex items-center gap-2 font-bold transition-colors"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Tilbage
            </button>
            <button
              onClick={() => router.push('/onboarding/step4')}
              className="text-sm font-semibold transition-colors"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Jeg gør det senere
            </button>
          </div>
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
