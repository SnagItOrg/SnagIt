'use client'

import { useState } from 'react'
import type { Watchlist } from '@/lib/supabase'

interface Props {
  onSave:  (watchlist: Watchlist) => void
  onClose: () => void
}

export function WatchlistCreatorPanel({ onSave, onClose }: Props) {
  const [query,    setQuery]    = useState('')
  const [maxPrice, setMaxPrice] = useState(4500)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const MAX_PRICE = 20000
  const pct = (maxPrice / MAX_PRICE) * 100

  async function handleSave() {
    if (!query.trim()) return
    setSaving(true)
    setError(null)

    const res = await fetch('/api/watchlists', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        query: query.trim(),
        ...(maxPrice > 0 ? { max_price: maxPrice } : {}),
      }),
    })

    if (res.ok) {
      onSave(await res.json() as Watchlist)
    } else {
      const data = await res.json()
      setError(data.error ?? 'Noget gik galt.')
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col" style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-8 py-5 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 className="text-xl font-black tracking-tight">Ny overvågning</h2>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-9 h-9 rounded-xl transition-colors hover:bg-secondary"
          style={{ color: 'var(--muted-foreground)' }}
          aria-label="Luk"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
        </button>
      </div>

      {/* Panel body */}
      <div className="flex-1 flex items-start justify-center px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-xl">
          <div
            className="p-8 rounded-3xl"
            style={{
              backgroundColor: 'var(--card)',
              border:          '1px solid var(--border)',
              boxShadow:       '0 25px 50px -12px rgba(0,0,0,0.4)',
            }}
          >
            <div className="space-y-8">
              {/* Query input */}
              <div className="space-y-3">
                <label
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  Hvad leder du efter?
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--muted-foreground)', fontSize: '22px' }}
                  >
                    search
                  </span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="fx Mac Mini, Eames stol, vintagesynth..."
                    autoFocus
                    className="w-full rounded-2xl pl-14 pr-5 py-4 text-lg font-medium outline-none transition-all placeholder:text-muted-foreground"
                    style={{
                      backgroundColor: 'var(--input-background)',
                      border:          '1px solid var(--border)',
                      color:           'var(--foreground)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </div>
              </div>

              {/* Max price slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Maksimalpris
                  </label>
                  <div className="text-2xl font-black">
                    <span style={{ color: 'var(--foreground)' }}>
                      {maxPrice === MAX_PRICE
                        ? `${maxPrice.toLocaleString('da-DK')}+`
                        : maxPrice.toLocaleString('da-DK')}
                    </span>
                    <span className="text-xs font-bold ml-1" style={{ color: 'var(--muted-foreground)' }}>DKK</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={MAX_PRICE}
                  step={100}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="w-full h-2.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--primary) ${pct}%, var(--muted) ${pct}%)`,
                    border:     '1px solid var(--border)',
                  }}
                />
                <div
                  className="flex justify-between text-[10px] font-bold uppercase tracking-tighter select-none"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  <span>0</span>
                  <span>5.000</span>
                  <span>10.000</span>
                  <span>15.000</span>
                  <span>20.000+</span>
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

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving || !query.trim()}
                className="w-full py-4 rounded-2xl font-black text-lg tracking-tight transition-all flex items-center justify-center gap-2 group disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--primary)',
                  color:           'var(--primary-foreground)',
                }}
              >
                {saving ? '…' : (
                  <>
                    Gem overvågning
                    <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                      arrow_forward
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
