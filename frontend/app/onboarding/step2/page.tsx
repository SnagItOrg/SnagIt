'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadOnboarding, saveOnboarding, brandLogoUrl, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'
import { OnboardingHeader } from '@/components/OnboardingHeader'

interface KgBrand {
  id: string
  slug: string
  name: string
}

export default function Step2() {
  const router = useRouter()
  const { t } = useLocale()
  const [starred,       setStarred]       = useState<Set<string>>(new Set())
  const [search,        setSearch]        = useState('')
  const [allBrands,     setAllBrands]     = useState<KgBrand[]>([])
  const [loadingBrands, setLoadingBrands] = useState(true)

  useEffect(() => {
    const saved = loadOnboarding()
    if (saved.brands?.length) setStarred(new Set(saved.brands))

    fetch('/api/brands')
      .then((r) => {
        if (!r.ok) throw new Error(`/api/brands ${r.status}`)
        return r.json()
      })
      .then((data: unknown) => {
        const brands: KgBrand[] = Array.isArray(data)
          ? (data as KgBrand[])
          : ((data as { brands?: KgBrand[] }).brands ?? [])
        console.log('Brands loaded:', brands.length)
        setAllBrands(brands)
      })
      .catch((err) => console.error('[step2] /api/brands failed:', err))
      .finally(() => setLoadingBrands(false))
  }, [])

  const displayBrands = search.trim()
    ? allBrands.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : allBrands

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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
      <OnboardingHeader currentStep={2} />

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 lg:p-12">
        {/* Title */}
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Indsnævr jagten.
          </h1>
          <p className="text-lg" style={{ color: 'var(--muted-foreground)' }}>
            Vælg de mærker du holder øje med.
          </p>
        </div>

        {/* Search row */}
        <div className="mb-8">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--muted-foreground)' }}>
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchBrands}
              className="w-full rounded-2xl pl-12 pr-4 py-4 outline-none transition-all"
              style={{
                backgroundColor: 'var(--input-background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--ring)'
                e.currentTarget.style.boxShadow = 'none'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
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
                style={{ aspectRatio: '1 / 1', backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
              />
            ))}
          </div>
        ) : isSearchEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center mb-4">
            <span className="material-symbols-outlined" style={{ fontSize: '40px', color: 'var(--muted-foreground)' }}>
              search_off
            </span>
            <p className="font-bold text-base" style={{ color: 'var(--muted-foreground)' }}>
              Fandt ikke &ldquo;{search}&rdquo;?
            </p>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Prøv et andet søgeord eller tjek stavningen.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
            {displayBrands.map((brand) => {
              const isStarred = starred.has(brand.slug)

              return (
                <button
                  key={brand.id}
                  onClick={() => toggleStar(brand.slug)}
                  className={`group relative rounded-2xl overflow-hidden transition-all duration-200 ease-in-out ${
                    isStarred
                      ? 'border-2 border-border'
                      : 'border border-border hover:border-border/80'
                  }`}
                  style={{
                    aspectRatio: '1 / 1',
                    backgroundColor: 'var(--background)',
                  }}
                >
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
                    style={{ background: 'linear-gradient(to top, var(--background) 0%, transparent 55%)' }}
                  />
                  {/* Star top-right */}
                  <span
                    className={`material-symbols-outlined absolute top-3 right-3 z-10 transition-all duration-200${isStarred ? ' filled' : ''}`}
                    style={{ color: isStarred ? 'var(--foreground)' : 'var(--muted-foreground)', fontSize: '20px' }}
                  >
                    star
                  </span>
                  {/* Brand name bottom-left */}
                  <div className="absolute bottom-4 left-4 right-10">
                    <p className="font-bold text-sm text-foreground truncate">{brand.name}</p>
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
              className="flex items-center gap-2 font-bold transition-colors"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Tilbage
            </button>
            <span className="text-sm font-medium italic" style={{ color: 'var(--muted-foreground)' }}>
              {starred.size} {starred.size === 1 ? 'mærke' : 'mærker'} valgt
            </span>
          </div>
          <button
            onClick={handleContinue}
            className="w-full py-4 rounded-xl font-black text-lg transition-all flex items-center justify-center gap-2 group"
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
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
        <div className="inline-flex items-center gap-2" style={{ color: 'var(--muted-foreground)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.securityNote}</span>
        </div>
      </footer>
    </div>
  )
}
