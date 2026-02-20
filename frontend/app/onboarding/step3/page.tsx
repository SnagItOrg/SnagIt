'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const MAX = 20000

export default function Step3() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [maxPrice, setMaxPrice] = useState(4500)
  const [fuzzy, setFuzzy] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pct = (maxPrice / MAX) * 100

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim() }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      setSubmitting(false)
      return
    }

    // Mark onboarding complete
    localStorage.setItem('klup-onboarding-done', '1')
    router.push('/')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#102218', color: '#f1f5f9' }}>
      {/* Header */}
      <header className="w-full py-8 px-6 lg:px-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3" style={{ color: '#13ec6d' }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}
            >
              <span className="material-symbols-outlined">radar</span>
            </div>
            <h2 className="text-xl font-black tracking-tight">Klup.dk</h2>
          </div>
          {/* Step dots */}
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: 'rgba(19,236,109,0.2)' }} />
            <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: 'rgba(19,236,109,0.2)' }} />
            <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: '#13ec6d' }} />
            <span className="ml-4 text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
              Step 3 of 3
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center p-6 lg:p-10 -mt-12">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              Set your first{' '}
              <span style={{ color: '#13ec6d' }}>Snag-Alert</span>
            </h1>
            <p className="text-lg" style={{ color: '#94a3b8' }}>
              Tell us what you're hunting for and we'll scan the markets 24/7.
            </p>
          </div>

          <div
            className="p-8 md:p-12 rounded-3xl shadow-2xl"
            style={{
              backgroundColor: '#1a2e22',
              border: '1px solid #326748',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
            }}
          >
            <form onSubmit={handleSubmit} className="space-y-10">
              {/* Search input */}
              <div className="space-y-4">
                <label className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
                  What are you looking for?
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-2xl"
                    style={{ color: '#13ec6d', fontSize: '24px' }}
                  >
                    search
                  </span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Mac Mini M4, Vintage Eames, etc."
                    className="w-full rounded-2xl pl-14 pr-6 py-5 text-xl font-medium outline-none transition-all"
                    style={{
                      backgroundColor: '#102218',
                      border: '2px solid #326748',
                      color: '#f1f5f9',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#13ec6d' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#326748' }}
                  />
                </div>
              </div>

              {/* Price range */}
              <div className="space-y-6">
                <div className="flex justify-between items-end">
                  <label className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
                    Maximum Price
                  </label>
                  <div className="text-3xl font-black text-white">
                    <span style={{ color: '#13ec6d', marginRight: '4px' }}>
                      {maxPrice.toLocaleString('da-DK')}
                    </span>
                    <span className="text-sm font-bold" style={{ color: '#64748b' }}>DKK</span>
                  </div>
                </div>
                <div className="relative px-2">
                  <input
                    type="range"
                    min={0}
                    max={MAX}
                    step={100}
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(Number(e.target.value))}
                    className="w-full h-3 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #13ec6d ${pct}%, #102218 ${pct}%)`,
                      border: '1px solid #326748',
                    }}
                  />
                  <div
                    className="flex justify-between mt-4 text-[10px] font-bold uppercase tracking-tighter"
                    style={{ color: '#475569' }}
                  >
                    <span>0 DKK</span>
                    <span>5.000</span>
                    <span>10.000</span>
                    <span>15.000</span>
                    <span>20.000+</span>
                  </div>
                </div>
              </div>

              {/* Fuzzy matching toggle */}
              <div
                className="flex items-center justify-between p-4 rounded-2xl border"
                style={{ backgroundColor: 'rgba(16,34,24,0.5)', borderColor: 'rgba(50,103,72,0.5)' }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(19,236,109,0.1)', color: '#13ec6d' }}
                  >
                    <span className="material-symbols-outlined">auto_awesome</span>
                  </div>
                  <div>
                    <p className="font-bold text-sm text-white">Fuzzy Matching</p>
                    <p className="text-xs" style={{ color: '#64748b' }}>
                      Include similar items and variations
                    </p>
                  </div>
                </div>
                {/* Toggle */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fuzzy}
                    onChange={(e) => setFuzzy(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div
                    className="w-12 h-6 rounded-full transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-5 after:w-5 after:transition-all relative"
                    style={{ backgroundColor: fuzzy ? '#13ec6d' : '#334155' }}
                  />
                </label>
              </div>

              {error && (
                <div className="rounded-xl px-4 py-3 text-sm text-red-400" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !query.trim()}
                className="w-full py-6 rounded-2xl font-black text-xl tracking-tight transition-all flex items-center justify-center gap-3 group disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: '#13ec6d',
                  color: '#102218',
                  boxShadow: '0 20px 25px -5px rgba(19,236,109,0.2)',
                }}
              >
                {submitting ? 'Setting up…' : 'Start Hunting'}
                {!submitting && (
                  <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                    bolt
                  </span>
                )}
              </button>
            </form>
          </div>

          <div className="mt-8 text-center">
            <button
              onClick={() => router.push('/')}
              className="text-sm font-semibold transition-colors hover:text-white"
              style={{ color: '#64748b' }}
            >
              I'll do this later
            </button>
          </div>
        </div>
      </main>

      {/* Bottom accent line */}
      <div
        className="fixed bottom-0 left-0 w-full h-1"
        style={{ background: 'linear-gradient(to right, transparent, rgba(19,236,109,0.2), transparent)' }}
      />
    </div>
  )
}
