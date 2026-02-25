'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { SideNav } from '@/components/SideNav'
import { useLocale } from '@/components/LocaleProvider'
import { PriceRangeSlider } from '@/components/PriceRangeSlider'

const BG   = '#102218'
const SURF = '#1a2e22'
const BORD = '#326748'
const PRI  = '#13ec6d'
const MAX_PRICE = 20000

export default function EditWatchlistPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { t } = useLocale()

  const [query,    setQuery]    = useState('')
  const [minPrice, setMinPrice] = useState(0)
  const [maxPrice, setMaxPrice] = useState(4500)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/watchlists/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        setQuery(data.query ?? '')
        setMinPrice(data.min_price ?? 0)
        setMaxPrice(data.max_price ?? 4500)
        setLoading(false)
      })
      .catch(() => {
        setError('Kunne ikke hente overvågning.')
        setLoading(false)
      })
  }, [params.id])

  async function handleDeleteWatchlist() {
    if (!window.confirm('Er du sikker?')) return
    const res = await fetch(`/api/watchlists/${params.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/watchlists')
  }

  async function handleSave() {
    if (!query.trim()) return
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/watchlists/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), min_price: minPrice > 0 ? minPrice : null, max_price: maxPrice }),
    })

    if (res.ok) {
      router.push('/watchlists')
    } else {
      const data = await res.json()
      setError(data.error ?? 'Noget gik galt.')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg md:flex">
      <SideNav active={'hjem'} onChange={() => router.push('/watchlists')} />

      <div className="flex-1 flex flex-col md:ml-60">
        <main className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-2xl">
            {/* Heading */}
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4" style={{ color: '#f1f5f9' }}>
                Rediger{' '}
                <span style={{ color: PRI }}>Overvågning</span>
              </h1>
              <p className="text-lg" style={{ color: '#94a3b8' }}>
                Opdater hvad du jager efter, og juster din maksimalpris.
              </p>
            </div>

            {loading ? (
              <div className="rounded-3xl animate-pulse bg-surface border border-white/10 h-80" />
            ) : (
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
                        Prisgrænse
                      </label>
                      <div className="text-2xl font-black">
                        <span style={{ color: PRI }}>
                          {minPrice > 0 ? `${minPrice.toLocaleString('da-DK')} – ` : ''}
                          {maxPrice === MAX_PRICE
                            ? `${maxPrice.toLocaleString('da-DK')}+`
                            : maxPrice.toLocaleString('da-DK')}
                        </span>
                        <span className="text-sm font-bold ml-1" style={{ color: '#64748b' }}>DKK</span>
                      </div>
                    </div>
                    <div className="px-1">
                      <PriceRangeSlider
                        minPrice={minPrice}
                        maxPrice={maxPrice}
                        maxValue={MAX_PRICE}
                        bg={BG}
                        border={BORD}
                        onChange={(min, max) => { setMinPrice(min); setMaxPrice(max) }}
                      />
                      <div
                        className="flex justify-between mt-6 text-[10px] font-bold uppercase tracking-tighter select-none"
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

                  {error && (
                    <div
                      className="rounded-xl px-4 py-3 text-sm text-red-400"
                      style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                      {error}
                    </div>
                  )}

                  {/* Save button */}
                  <button
                    onClick={handleSave}
                    disabled={saving || !query.trim()}
                    className="w-full py-6 rounded-2xl font-black text-xl tracking-tight transition-all flex items-center justify-center gap-3 group disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: PRI,
                      color: BG,
                      boxShadow: query.trim() ? '0 20px 25px -5px rgba(19,236,109,0.2)' : undefined,
                    }}
                  >
                    {saving ? '…' : (
                      <>
                        Gem ændringer
                        <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                          arrow_forward
                        </span>
                      </>
                    )}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={handleDeleteWatchlist}
                    className="w-full py-3 rounded-xl text-sm font-medium transition-colors border border-red-500/30 text-red-400 hover:border-red-500/60"
                  >
                    Slet overvågning
                  </button>
                </div>
              </div>
            )}

            {/* Footer actions */}
            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={() => router.push('/watchlists')}
                className="flex items-center gap-2 font-bold transition-colors hover:text-white"
                style={{ color: '#64748b' }}
              >
                <span className="material-symbols-outlined">arrow_back</span>
                Tilbage
              </button>
            </div>
          </div>
        </main>

        <footer className="py-10 text-center">
          <div className="inline-flex items-center gap-2" style={{ color: '#475569' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{t.securityNote}</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
