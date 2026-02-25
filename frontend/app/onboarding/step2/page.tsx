'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { loadOnboarding, saveOnboarding, brandLogoUrl, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'
import { OnboardingHeader } from '@/components/OnboardingHeader'

const BG   = '#102218'
const SURF = '#1a2e22'
const BORD = '#326748'
const PRI  = '#13ec6d'

interface KgBrand {
  id: string
  slug: string
  name: string
  category_id: string
}

interface KgCategory {
  id: string
  slug: string
  name_da: string
  name_en: string
}

export default function Step2() {
  const router = useRouter()
  const { t } = useLocale()
  const [starred,          setStarred]          = useState<Set<string>>(new Set())
  const [search,           setSearch]           = useState('')
  const [allBrands,        setAllBrands]        = useState<KgBrand[]>([])
  const [allCategories,    setAllCategories]    = useState<KgCategory[]>([])
  const [activeBrandIds,   setActiveBrandIds]   = useState<Set<string>>(new Set())
  const [savedCategories,  setSavedCategories]  = useState<string[]>([])
  const [loadingBrands,    setLoadingBrands]    = useState(true)

  useEffect(() => {
    const saved = loadOnboarding()
    if (saved.brands?.length) setStarred(new Set(saved.brands))
    setSavedCategories(saved.categories ?? [])

    fetch('/api/brands')
      .then((r) => {
        if (!r.ok) throw new Error(`/api/brands ${r.status}`)
        return r.json()
      })
      .then(({ categories, brands, activeBrandIds: activeIds }: {
        categories: KgCategory[]
        brands: KgBrand[]
        activeBrandIds: string[]
      }) => {
        setAllCategories(categories)
        setAllBrands(brands)
        setActiveBrandIds(new Set(activeIds))
      })
      .catch((err) => console.error('[step2] /api/brands failed:', err))
      .finally(() => setLoadingBrands(false))
  }, [])

  // Brands filtered by saved step-1 categories, then by search
  const displayBrands = useMemo(() => {
    let brands = allBrands

    if (savedCategories.length > 0) {
      const categoryIds = new Set(
        allCategories
          .filter((c) => savedCategories.includes(c.slug))
          .map((c) => c.id),
      )
      brands = brands.filter((b) => categoryIds.has(b.category_id))
    }

    if (search.trim()) {
      brands = brands.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    }

    return brands
  }, [allBrands, allCategories, savedCategories, search])

  function toggleStar(slug: string) {
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function handleContinue() {
    const brands = Array.from(starred)
    saveOnboarding({ brands })
    fireEvent('onboarding_step2', { brands })
    router.push('/onboarding/step3')
  }

  const isSearchEmpty = search.trim() !== '' && displayBrands.length === 0

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BG, color: '#f1f5f9' }}>
      <OnboardingHeader currentStep={2} />

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 lg:p-12">
        {/* Title */}
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Indsnævr jagten.
          </h1>
          <p className="text-lg" style={{ color: '#94a3b8' }}>
            Vælg de mærker du holder øje med.
          </p>
        </div>

        {/* Search row */}
        <div className="mb-8">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: '#64748b' }}>
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchBrands}
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
        </div>

        {/* Brand grid / states */}
        {loadingBrands ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="rounded-2xl animate-pulse"
                style={{ aspectRatio: '1 / 1', backgroundColor: SURF, border: `1px solid ${BORD}` }}
              />
            ))}
          </div>
        ) : isSearchEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center mb-4">
            <span className="material-symbols-outlined" style={{ fontSize: '40px', color: '#334155' }}>
              search_off
            </span>
            <p className="font-bold text-base" style={{ color: '#94a3b8' }}>
              Fandt ikke &ldquo;{search}&rdquo;?
            </p>
            <p className="text-sm" style={{ color: '#475569' }}>
              Prøv et andet søgeord eller tjek stavningen.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            {displayBrands.map((brand) => {
              const isStarred  = starred.has(brand.slug)
              const hasContent = activeBrandIds.has(brand.id)

              return (
                <button
                  key={brand.id}
                  onClick={() => hasContent && toggleStar(brand.slug)}
                  disabled={!hasContent}
                  className={`group relative rounded-2xl overflow-hidden transition-all duration-200 ease-in-out ${
                    !hasContent
                      ? 'opacity-60 cursor-default'
                      : isStarred
                        ? 'border-2 border-[#13ec6d]'
                        : 'border border-slate-700 hover:border-[#13ec6d]/50'
                  }`}
                  style={{
                    aspectRatio: '1 / 1',
                    backgroundColor: BG,
                    boxShadow: isStarred && hasContent ? '0 0 20px rgba(19,236,109,0.15)' : undefined,
                  }}
                >
                  {hasContent ? (
                    <>
                      {/* Background image */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={brandLogoUrl(brand.slug)}
                        alt={brand.name}
                        className={`absolute inset-0 w-full h-full object-cover transition-all duration-200 ease-in-out ${
                          isStarred ? 'opacity-100' : 'opacity-50 group-hover:opacity-80'
                        }`}
                      />
                      {/* Gradient overlay */}
                      <div
                        className="absolute inset-0"
                        style={{ background: `linear-gradient(to top, ${BG} 0%, transparent 55%)` }}
                      />
                      {/* Star top-right */}
                      <span
                        className={`material-symbols-outlined absolute top-3 right-3 z-10 transition-all duration-200${isStarred ? ' filled' : ''}`}
                        style={{ color: isStarred ? PRI : 'rgba(255,255,255,0.5)', fontSize: '20px' }}
                      >
                        star
                      </span>
                    </>
                  ) : (
                    <>
                      {/* Placeholder icon */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="material-symbols-outlined" style={{ fontSize: '40px', color: '#334155' }}>
                          inventory_2
                        </span>
                      </div>
                      {/* Coming soon badge */}
                      <div className="absolute top-3 right-3">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: `${SURF}cc`, border: `1px solid ${BORD}`, color: '#64748b' }}
                        >
                          {t.comingSoon}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Brand name bottom-left */}
                  <div className="absolute bottom-4 left-4 right-10">
                    <p className="font-bold text-sm text-white truncate">{brand.name}</p>
                  </div>
                </button>
              )
            })}


          </div>
        )}

        {/* CTA */}
        <div className="w-full max-w-md mx-auto mt-8 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push('/onboarding/step1')}
              className="flex items-center gap-2 font-bold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Tilbage
            </button>
            <span className="text-sm font-medium italic" style={{ color: '#64748b' }}>
              {starred.size} {starred.size === 1 ? 'mærke' : 'mærker'} valgt
            </span>
          </div>
          <button
            onClick={handleContinue}
            className="w-full py-4 rounded-xl font-black text-lg transition-all flex items-center justify-center gap-2 group"
            style={{
              backgroundColor: PRI,
              color: BG,
              boxShadow: '0 20px 25px -5px rgba(19,236,109,0.2)',
            }}
          >
            {t.continueToStep3}
            <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
              arrow_forward
            </span>
          </button>
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
