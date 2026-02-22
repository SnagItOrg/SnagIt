'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadOnboarding, saveOnboarding, brandLogoUrl, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'
import { OnboardingHeader } from '@/components/OnboardingHeader'

const BG   = '#102218'
const SURF = '#1a2e22'
const BORD = '#326748'
const PRI  = '#13ec6d'

interface Brand {
  id: string
  label: string
  textLogo?: boolean
}

const BRANDS: Brand[] = [
  { id: 'apple',               label: 'Apple'               },
  { id: 'sony',                label: 'Sony'                },
  { id: 'teenageengineering',  label: 'Teenage Engineering' },
  { id: 'bang-olufsen',        label: 'Bang & Olufsen'      },
  { id: 'canon',               label: 'Canon'               },
  { id: 'bose',                label: 'Bose'                },
  { id: 'nintendo',            label: 'Nintendo'            },
]

export default function Step2() {
  const router = useRouter()
  const { t } = useLocale()
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  useEffect(() => {
    const saved = loadOnboarding()
    if (saved.brands?.length) {
      setStarred(new Set(saved.brands))
    }
  }, [])

  function toggleStar(id: string) {
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleContinue() {
    const brands = Array.from(starred)
    saveOnboarding({ brands })
    fireEvent('onboarding_step2', { brands })
    router.push('/onboarding/step3')
  }

  const filtered = search.trim()
    ? BRANDS.filter((b) => b.label.toLowerCase().includes(search.toLowerCase()))
    : BRANDS

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BG, color: '#f1f5f9' }}>
      <OnboardingHeader currentStep={2} />

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 lg:p-12 pb-36">
        {/* Title */}
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Indsnævr jagten.
          </h1>
          <p className="text-lg" style={{ color: '#94a3b8' }}>
            Vælg de mærker du holder øje med.
          </p>
        </div>

        {/* Search + filter row */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: '#64748b' }}>
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søg efter mærker (fx Teenage Engineering...)"
              className="w-full rounded-2xl pl-12 pr-4 py-4 text-white outline-none transition-all"
              style={{ backgroundColor: SURF, border: `1px solid ${BORD}` }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = PRI
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(19,236,109,0.15)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = BORD
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>
          <button
            className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-semibold transition-colors"
            style={{ border: `1px solid ${BORD}`, color: '#cbd5e1' }}
          >
            <span className="material-symbols-outlined">filter_list</span>
            Alle kategorier
          </button>
        </div>

        {/* Brand grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
          {filtered.map((brand) => {
            const isStarred = starred.has(brand.id)
            return (
              <button
                key={brand.id}
                onClick={() => toggleStar(brand.id)}
                className={`group relative rounded-2xl overflow-hidden transition-all duration-200 ease-in-out ${
                  isStarred
                    ? 'border-2 border-[#13ec6d]'
                    : 'border border-slate-700 hover:border-[#13ec6d]/50'
                }`}
                style={{
                  aspectRatio: '1 / 1',
                  backgroundColor: BG,
                  boxShadow: isStarred ? '0 0 20px rgba(19,236,109,0.15)' : undefined,
                }}
              >
                {/* Background image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={brandLogoUrl(brand.id)}
                  alt={brand.label}
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-200 ease-in-out ${
                    isStarred ? 'opacity-100' : 'opacity-50 group-hover:opacity-80'
                  }`}
                />

                {/* Gradient overlay */}
                <div
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(to top, ${BG} 0%, transparent 55%)` }}
                />

                {/* Brand name bottom-left */}
                <div className="absolute bottom-4 left-4 right-10">
                  <p className="font-bold text-sm text-white truncate">{brand.label}</p>
                </div>

                {/* Star top-right */}
                <span
                  className={`material-symbols-outlined absolute top-3 right-3 z-10 transition-all duration-200${isStarred ? ' filled' : ''}`}
                  style={{ color: isStarred ? PRI : 'rgba(255,255,255,0.5)', fontSize: '20px' }}
                >
                  star
                </span>
              </button>
            )
          })}

          {/* Add Another — decorative */}
          <div
            className="rounded-2xl flex flex-col items-center justify-center"
            style={{ aspectRatio: '1 / 1', border: `2px dashed ${BORD}`, backgroundColor: `${SURF}33` }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: SURF }}
            >
              <span className="material-symbols-outlined" style={{ color: '#64748b' }}>add</span>
            </div>
            <p className="font-bold text-sm" style={{ color: '#64748b' }}>Tilføj endnu et</p>
          </div>
        </div>

        {/* Security note — sits above fixed footer */}
        <div className="pt-6 pb-2 text-center">
          <div className="inline-flex items-center gap-2" style={{ color: '#475569' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{t.securityNote}</span>
          </div>
        </div>
      </main>

      {/* Sticky footer */}
      <footer
        className="fixed bottom-0 left-0 right-0 border-t p-6 backdrop-blur-xl z-40"
        style={{ borderColor: BORD, backgroundColor: `${BG}e6` }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.push('/onboarding/step1')}
            className="flex items-center gap-2 font-bold transition-colors hover:text-white"
            style={{ color: '#64748b' }}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Tilbage
          </button>

          <div className="flex items-center gap-6">
            <span className="hidden sm:inline text-sm font-medium italic" style={{ color: '#64748b' }}>
              {starred.size} {starred.size === 1 ? 'mærke' : 'mærker'} valgt
            </span>
            <button
              onClick={handleContinue}
              className="flex items-center gap-2 px-10 py-4 rounded-2xl font-black text-lg transition-all"
              style={{
                backgroundColor: PRI,
                color: BG,
                boxShadow: '0 10px 15px -3px rgba(19,236,109,0.2)',
              }}
            >
              Fortsæt
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
