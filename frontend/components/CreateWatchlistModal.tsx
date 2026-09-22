'use client'

import { useState, useEffect, useId } from 'react'
import { PriceRangeSlider } from '@/components/PriceRangeSlider'
import { Dialog } from '@/components/Dialog'
import { MAX_WATCHLIST_PRICE } from '@/lib/constants'
import { TextField } from '@/components/TextField'

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
  // The question the sheet asks is also what the sheet is FOR, so it serves as
  // the dialog's accessible name rather than inventing a second title nobody
  // sees. Dialog requires the id; it will not render an unnamed dialog.
  const queryLabelId = useId()

  // Sync query when initialQuery changes (e.g. opened from different listing)
  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  const atMax = maxPrice === MAX_WATCHLIST_PRICE

  function handleConfirm() {
    const q = query.trim()
    if (!q || creating) return
    onConfirm(q, atMax ? undefined : maxPrice)
  }

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      labelledBy={queryLabelId}
      panelClassName="w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-6 flex flex-col gap-5"
    >
      {/* Drag handle — mobile only */}
      <div className="md:hidden flex justify-center -mt-1 mb-1">
        <div className="w-10 h-1 rounded-full bg-border" />
      </div>

      {/* Query */}
      <div className="flex flex-col gap-2">
        <label
          id={queryLabelId}
          className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
        >
          Hvad leder du efter?
        </label>
        <TextField
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          placeholder="f.eks. Mac Mini M4, Vintage Eames..."
          autoFocus
          className="w-full rounded-xl px-4 py-3 text-lg font-medium"
        />
      </div>

      {/* Price */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-end">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Maksimum pris
          </label>
          <span className="type-heading">
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
        className="w-full py-4 rounded-2xl font-semibold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
    </Dialog>
  )
}
