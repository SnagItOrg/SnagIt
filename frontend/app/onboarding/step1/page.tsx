'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const CATEGORIES = [
  {
    id: 'photography',
    label: 'Photography',
    sub: 'Lenses & Bodies',
    icon: 'photo_camera',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDl3TqjHMlUBUk2-CWQwMIH10m63MOi16uf-vEt_WW0-vRPB6EPeo1IKQjfq-r2tQV5veFxZtYI3GF5SOERuerGPv6_9ryyTj6FdaClG6A5VdArTWmVetcOZx2TRh_wPyVlqvxkuFpH1A7KBQ60PJPTDRSFcccMmWfFO-JmI9EAjXfScuOyI1xTyqF95SqP2g-wVEIMXXoeXPxLZp7gVS5wV3ksGJ8xCVaeUGnJxchMUsQNWXAJSK8MfZwtPU1XIDRG25NtT-_w58w',
  },
  {
    id: 'music',
    label: 'Music Gear',
    sub: 'Studio & Instruments',
    icon: 'piano',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCWVZ7L1c41mlGZVUgMWAcurwfP9CwP4KgR3_Z899J6vUSKOO14ckRT9A6GEyh_zvH4qwejalHYthRnn5JCXELqVHCARQNSPb1gr0Ibh9Ddyh6RF5bZYK7dCXEYAvd8mHFkVsGetjcq5aMykCwl0lCCB3ySTtCVQmtP8E-JClo1TW9tUGA1p3KSTAw3IbF1bjH2SXC3vGibg7O8qGbOduOrGSNSXYMP6PO0OTKk_TxhWhX9lKusOI0o2OlwPxGkuX0KphrjSvDBgVE',
  },
  {
    id: 'furniture',
    label: 'Danish Modern',
    sub: 'Furniture Design',
    icon: 'chair',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDdrZWCBaOH5-poyGr-GZoWc2SN8TOeU8B-omUV2YL_GsdEY60abYVpdvOoi9gZTTgw4Ckju7djoI1PyIscE2jtQZ4I_wi49wUHfZnDif5eL3wgd4vUwwx7TzACJEXC047f4YYgMdpaoEZkqPy-s-wxOd1Rfm8xOpkxSjIVEgo3lOa8wzxan0SduIIMHiN2Mk2vwfGN-SPWu0aHpKaeVs9i9AIzgGd86yg-si0Tn2zRSqzEaT27_EoLSpCnG6ajgUXXcxafieROgDw',
  },
  {
    id: 'fashion',
    label: 'Fashion',
    sub: 'Vintage & Hype',
    icon: 'apparel',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDwMnexn8-rFMDOn-mltq6Vq4jd5JHtvBmDc4no02PaeiS4SzlcFJbGgpCRRZE15MJvMU_5rFwaPXlkbgnyOHRCG0LNlVz9LVkg0dZVG2UyAFsEljMHeVSXCZDFYc0lmZShWeg6cgvOM0GknBp-H76Cn4mBPzRI9aug1YEzABDfdi7zAu83DJcZatUxwkZSdyN8nksI7osNg6IYM96YkuNZum1XNkTbJGEgOiPRgWAAVryGBCVX2_Ysey0KLkTyMjb4o9zHTiUZqqY',
  },
  {
    id: 'tech',
    label: 'Tech',
    sub: 'Mobile & PC',
    icon: 'devices',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBDlfwYqmno7SdSzByeZ8SY_See_Yt5gNmER9Ln6dvzobD_snFCKGiO0fRh4JHi868untZs-frxiZVHrscnU9NAlLGHX54ad0uBz9LweHt2Gy2eEwClJA5BEx3TtWlmXl5Ca2WXKJ56CXZ_QLIWzctsncgFpiijtOEH9I5g0IbMVElvIsmSgtsHCGQEplmfVx9aPdhAZBbBcaqf2gtXfnHlT6cEQKukxlmkOc5ScEneIPUpHY-4sIAeVt3ubCtYkA0mNgH1m0MG0Yk',
  },
]

export default function Step1() {
  const router = useRouter()
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
    localStorage.setItem('klup-onboarding-categories', JSON.stringify(Array.from(selected)))
    router.push('/')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#0a140e', color: '#f1f5f9' }}>
      {/* Header */}
      <header className="w-full py-8 px-6 lg:px-10">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3" style={{ color: '#13ec6d' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}>
                <span className="material-symbols-outlined text-2xl">radar</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight">Klup.dk</h2>
            </div>
            <button
              onClick={() => router.push('/')}
              className="text-sm font-bold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              Skip for now
            </button>
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
            Choose your hunting grounds.
          </h1>
          <p className="text-lg font-medium" style={{ color: '#94a3b8' }}>
            Select the categories you're most interested in. We'll start scanning Danish marketplaces
            for the best deals tailored to your taste.
          </p>
        </div>

        {/* Category grid */}
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
                  border: `1px solid ${isSelected ? '#13ec6d' : '#2a4d38'}`,
                  backgroundColor: '#162a1e',
                  boxShadow: isSelected ? '0 0 25px rgba(19,236,109,0.3)' : undefined,
                }}
              >
                {/* Background image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cat.image}
                  alt={cat.label}
                  className="absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-110"
                  style={{ opacity: isSelected ? 0.8 : 0.6 }}
                />
                {/* Gradient overlay */}
                <div
                  className="absolute inset-0"
                  style={{ background: 'linear-gradient(to top, #0a140e, transparent)' }}
                />
                {/* Content */}
                <div className="absolute bottom-6 left-6 right-6">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 transition-colors"
                    style={{
                      backgroundColor: isSelected ? '#13ec6d' : 'rgba(19,236,109,0.2)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ color: isSelected ? '#0a140e' : '#13ec6d' }}
                    >
                      {cat.icon}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white">{cat.label}</h3>
                  <p
                    className="text-xs mt-1 uppercase tracking-widest font-bold"
                    style={{ color: '#94a3b8' }}
                  >
                    {cat.sub}
                  </p>
                </div>
                {/* Selection indicator */}
                <div
                  className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
                  style={{ borderColor: isSelected ? '#13ec6d' : '#475569' }}
                >
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#13ec6d' }} />
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
              backgroundColor: '#13ec6d',
              color: '#0a140e',
              boxShadow: '0 20px 25px -5px rgba(19,236,109,0.2)',
            }}
          >
            Get Started
            <span className="material-symbols-outlined font-black transition-transform group-hover:translate-x-1">
              arrow_forward
            </span>
          </button>
          <p className="mt-6 text-sm font-medium" style={{ color: '#64748b' }}>
            You can change these categories or add more later.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-10 text-center">
        <div className="inline-flex items-center gap-2" style={{ color: '#475569' }}>
          <span className="material-symbols-outlined text-sm" style={{ fontSize: '16px' }}>
            security
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest">
            Encrypted Search Protocol Active
          </span>
        </div>
      </footer>
    </div>
  )
}
