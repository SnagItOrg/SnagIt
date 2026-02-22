'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadOnboarding, saveOnboarding, brandLogoUrl, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'

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
  { id: 'teenage-engineering', label: 'Teenage Engineering', textLogo: true },
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
  const [categoryLabel, setCategoryLabel] = useState('')

  useEffect(() => {
    const saved = loadOnboarding()
    // Pre-star brands matching saved selections
    if (saved.brands?.length) {
      setStarred(new Set(saved.brands))
    }
    // Build category label for subtitle
    if (saved.categories?.length) {
      const labels = saved.categories.map((c) =>
        BRANDS.find((b) => b.id === c)?.label ??
        c.charAt(0).toUpperCase() + c.slice(1)
      )
      setCategoryLabel(labels.join(' & '))
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
      {/* Sticky header */}
      <header
        className="sticky top-0 z-40 border-b px-6 py-4 backdrop-blur-md"
        style={{ borderColor: BORD, backgroundColor: `${BG}cc` }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3" style={{ color: PRI }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}>
              <span className="material-symbols-outlined">radar</span>
            </div>
            <h2 className="text-xl font-black tracking-tight">Klup.dk</h2>
          </div>

          {/* Step dots + label */}
          <div className="flex items-center gap-4">
            <div className="flex gap-1.5">
              {/* Step 1 — done */}
              <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: 'rgba(19,236,109,0.3)' }} />
              {/* Step 2 — active */}
              <div className="h-1.5 w-12 rounded-full"
                   style={{ backgroundColor: PRI, boxShadow: '0 0 8px rgba(19,236,109,0.5)' }} />
              {/* Steps 3–4 — future */}
              <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: '#1e293b' }} />
              <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: '#1e293b' }} />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
              Trin 2 af 4
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 lg:p-12 pb-36">
        {/* Title */}
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Indsnævr jagten.
          </h1>
          <p className="text-lg" style={{ color: '#94a3b8' }}>
            {categoryLabel ? (
              <>
                Vi fandt disse mærker baseret på dit{' '}
                <span className="font-semibold" style={{ color: PRI }}>{categoryLabel}</span>
                {' '}valg.{' '}
              </>
            ) : (
              'Vælg de mærker, du holder af. '
            )}
            Stjernemarkér dine favoritter for at prioritere dem i dit feed.
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
                className={`group relative rounded-2xl p-8 flex flex-col items-center justify-center transition-all duration-300 ease-in-out ${
                  isStarred
                    ? 'border-2 border-[#13ec6d]'
                    : 'border border-[#326748] hover:border-[#13ec6d]'
                }`}
                style={{
                  backgroundColor: SURF,
                  boxShadow: isStarred ? '0 0 20px rgba(19,236,109,0.15)' : undefined,
                }}
              >
                {/* Star */}
                <span
                  className={`material-symbols-outlined absolute top-4 right-4 transition-transform${isStarred ? ' filled' : ''}`}
                  style={{ color: isStarred ? PRI : '#475569', fontSize: '20px' }}
                >
                  star
                </span>

                {/* Logo */}
                <div className="h-16 w-32 flex items-center justify-center mb-4">
                  {brand.textLogo ? (
                    <span
                      className={`font-mono text-xs tracking-tighter text-center transition-all duration-300 ease-in-out ${
                        isStarred ? 'opacity-100' : 'opacity-60 group-hover:opacity-90'
                      }`}
                      style={{ color: '#ffffff' }}
                    >
                      {brand.label.toUpperCase()}
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={brandLogoUrl(brand.id)}
                      alt={brand.label}
                      className={`h-full w-auto object-contain brightness-0 invert transition-all duration-300 ease-in-out ${
                        isStarred ? 'opacity-100' : 'opacity-60 group-hover:opacity-90'
                      }`}
                    />
                  )}
                </div>

                <p
                  className="font-bold text-center text-sm transition-colors"
                  style={{ color: isStarred ? PRI : '#94a3b8' }}
                >
                  {brand.label}
                </p>
              </button>
            )
          })}

          {/* Add Another — decorative */}
          <div
            className="rounded-2xl p-8 flex flex-col items-center justify-center"
            style={{ border: `2px dashed ${BORD}`, backgroundColor: `${SURF}33` }}
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
