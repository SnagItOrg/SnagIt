'use client'

import { useState, useEffect } from 'react'
import { PriceRangeSlider } from '@/components/PriceRangeSlider'
import { MAX_WATCHLIST_PRICE } from '@/lib/constants'

interface Props {
  isOpen:        boolean
  onClose:       () => void
  onConfirm:     (query: string, maxPrice?: number) => void
  initialQuery?: string
  creating:      boolean
}

export function CreateWatchlistModal({ isOpen, onClose, onConfirm, initialQuery = '', creating }: Props) {
  const [query,    setQuery]    = useState(initialQuery)
  const [maxPrice, setMaxPrice] = useState(50000)

  // Sync query when initialQuery changes (e.g. opened from different listing)
  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  if (!isOpen) return null

  const atMax = maxPrice === MAX_WATCHLIST_PRICE

  function handleConfirm() {
    const q = query.trim()
    if (!q || creating) return
    onConfirm(q, atMax ? undefined : maxPrice)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Sheet / modal */}
      <div className="fixed bottom-0 left-0 right-0 md:inset-0 md:flex md:items-center md:justify-center z-50 pointer-events-none">
        <div
          className="pointer-events-auto w-full md:max-w-lg bg-card border border-border rounded-t-2xl md:rounded-2xl p-6 flex flex-col gap-5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle — mobile only */}
          <div className="md:hidden flex justify-center -mt-1 mb-1">
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>

          {/* Query */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Hvad leder du efter?
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              placeholder="f.eks. Mac Mini M4, Vintage Eames..."
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-lg font-medium outline-none transition-all"
              style={{
                backgroundColor: 'var(--input-background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
          </div>

          {/* Price */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-end">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Maksimum pris
              </label>
              <span className="text-lg font-black text-foreground">
                {atMax
                  ? <>100K+ <span className="text-sm font-bold text-muted-foreground">DKK</span></>
                  : <>{maxPrice.toLocaleString('da-DK')} <span className="text-sm font-bold text-muted-foreground">DKK</span></>
                }
              </span>
            </div>
            <PriceRangeSlider
              minPrice={0}
              maxPrice={maxPrice}
              maxValue={MAX_WATCHLIST_PRICE}
              mode="single"
              onChange={(_, max) => setMaxPrice(max)}
            />
            <div
              className="flex justify-between text-[10px] font-bold uppercase tracking-tighter select-none mt-1"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <span>0</span>
              <span>25k</span>
              <span>50k</span>
              <span>75k</span>
              <span>100k+</span>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={handleConfirm}
            disabled={!query.trim() || creating}
            className="w-full py-4 rounded-2xl font-black text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {creating ? '…' : 'Start jagten ⚡'}
          </button>

          <button
            onClick={onClose}
            className="text-xs text-muted-foreground text-center w-full transition-opacity hover:opacity-70"
          >
            Jeg gør det senere
          </button>
        </div>
      </div>
    </>
  )
}
