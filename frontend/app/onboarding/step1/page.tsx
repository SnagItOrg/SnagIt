'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveOnboarding, categoryImageUrl, fireEvent } from '@/lib/onboarding'
import { useLocale } from '@/components/LocaleProvider'

const CATEGORIES = [
  { id: 'photography', label: 'Fotografi',    sub: 'Objektiver & Kameraer',     icon: 'photo_camera' },
  { id: 'music-gear',      label: 'Musikudstyr',  sub: 'Studieudstyr & Instrumenter', icon: 'piano' },
  { id: 'danish-modern',  label: 'Dansk Design', sub: 'Møbeldesign',                icon: 'chair' },
  { id: 'fashion',     label: 'Mode',         sub: 'Vintage & Streetwear',       icon: 'apparel'     },
  { id: 'tech',        label: 'Teknologi',    sub: 'Mobil & Computer',           icon: 'devices'     },
]

const BG   = '#0a140e'
const SURF = '#162a1e'
const BORD = '#2a4d38'
const PRI  = '#13ec6d'

export default function Step1() {
  const router = useRouter()
  const { t } = useLocale()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleContinue() {
    const categories = Array.from(selected)
    saveOnboarding({ categories })
    fireEvent('onboarding_step1', { categories })
    router.push('/onboarding/step2')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: BG, color: '#f1f5f9' }}>
      {/* Header */}
      <header className="w-full py-8 px-6 lg:px-10">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-6">
            {/* Logo */}
            <div className="flex items-center gap-3" style={{ color: PRI }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                   style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}>
                <span className="material-symbols-outlined text-2xl">radar</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight">Klup.dk</h2>
            </div>

            {/* Step + skip */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-bold" style={{ color: '#94a3b8' }}>
                TRIN 1 <span style={{ color: '#475569' }}>AF 4</span>
              </span>
              <button
                onClick={() => router.push('/login')}
                className="text-sm font-bold transition-colors hover:text-white"
                style={{ color: '#64748b' }}
              >
                Spring over
              </button>
            </div>
          </div>

          {/* Progress bar — 1/4 */}
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: SURF }}>
            <div
              className="h-full rounded-full"
              style={{ width: '25%', backgroundColor: PRI, boxShadow: '0 0 10px rgba(19,236,109,0.5)' }}
            />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-[1400px] mx-auto px-6 lg:px-10 py-12 w-full flex flex-col items-center">
        <div className="text-center mb-16 max-w-2xl">
          <h1
            className="text-5xl lg:text-6xl font-black tracking-tight mb-6"
            style={{
              background: 'linear-gradient(to bottom, #ffffff, #64748b)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Vælg dine jagtmarker.
          </h1>
          <p className="text-lg font-medium" style={{ color: '#94a3b8' }}>
            Vælg de kategorier, du er mest interesseret i. Vi scanner danske
            markedspladser for de bedste tilbud tilpasset din smag.
          </p>
        </div>

        {/* Category tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 w-full mb-20">
          {CATEGORIES.map((cat) => {
            const isSelected = selected.has(cat.id)
            return (
              <button
                key={cat.id}
                onClick={() => toggle(cat.id)}
                className="group relative rounded-2xl overflow-hidden transition-all duration-300 text-left"
                style={{
                  aspectRatio: '4/5',
                  border: `1px solid ${isSelected ? PRI : BORD}`,
                  backgroundColor: SURF,
                  boxShadow: isSelected ? '0 0 25px rgba(19,236,109,0.3)' : undefined,
                }}
              >
                {/* Background image from Supabase Storage */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={categoryImageUrl(cat.id)}
                  alt={cat.label}
                  className="absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
                  style={{ opacity: isSelected ? 0.8 : 0.6 }}
                />
                {/* Gradient overlay */}
                <div
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(to top, ${BG}, transparent)` }}
                />
                {/* Content */}
                <div className="absolute bottom-6 left-6 right-6">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors"
                    style={{
                      backgroundColor: isSelected ? PRI : 'rgba(19,236,109,0.2)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ color: isSelected ? BG : PRI }}
                    >
                      {cat.icon}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">{cat.label}</h3>
                  <p className="text-xs mt-1 uppercase tracking-widest font-bold"
                     style={{ color: '#94a3b8' }}>
                    {cat.sub}
                  </p>
                </div>
                {/* Selection indicator */}
                <div
                  className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
                  style={{ borderColor: isSelected ? PRI : '#475569' }}
                >
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PRI }} />
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* CTA */}
        <div className="w-full max-w-md flex flex-col items-center">
          <button
            onClick={handleContinue}
            className="w-full py-4 rounded-xl font-black text-lg transition-all flex items-center justify-center gap-2 group"
            style={{
              backgroundColor: PRI,
              color: BG,
              boxShadow: '0 20px 25px -5px rgba(19,236,109,0.2)',
            }}
          >
            Fortsæt til trin 2
            <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
              arrow_forward
            </span>
          </button>
          <p className="mt-6 text-sm font-medium" style={{ color: '#64748b' }}>
            Du kan ændre kategorier eller tilføje flere senere.
          </p>
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
