'use client'

import { useState, useEffect, useCallback } from 'react'

type Tier = 'standard' | 'classic' | 'legendary'

type Product = {
  id: string
  slug: string
  canonical_name: string
  tier: Tier
  year_released: number | null
  image_url: string | null
  kg_brand: { name: string } | null
}

const TIER_ORDER: Tier[] = ['standard', 'classic', 'legendary']
const TIER_LABEL: Record<Tier, string> = {
  standard:  'Standard',
  classic:   'Classic',
  legendary: 'Legendary',
}
const TIER_STYLE: Record<Tier, { background: string; color: string }> = {
  standard:  { background: 'var(--secondary)', color: 'var(--muted-foreground)' },
  classic:   { background: 'var(--secondary)', color: 'var(--foreground)' },
  legendary: { background: 'var(--foreground)', color: 'var(--background)' },
}

export default function AdminProductsPage() {
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [yearEditing, setYearEditing] = useState<string | null>(null)
  const [yearDraft, setYearDraft] = useState('')

  const search = useCallback(async (q: string) => {
    setLoading(true)
    const url = q.trim()
      ? `/api/admin/products?q=${encodeURIComponent(q.trim())}`
      : `/api/admin/products?tier=legendary`
    const res = await fetch(url)
    const data = await res.json()
    setProducts(data.products ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    search('')
  }, [search])

  async function cycleTier(product: Product) {
    const currentIdx = TIER_ORDER.indexOf(product.tier)
    const nextTier = TIER_ORDER[(currentIdx + 1) % TIER_ORDER.length]
    setSaving(product.id)
    await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: nextTier }),
    })
    setProducts((prev) =>
      prev.map((p) => p.id === product.id ? { ...p, tier: nextTier } : p)
    )
    setSaving(null)
  }

  async function saveYear(product: Product) {
    const year = parseInt(yearDraft)
    if (isNaN(year) || year < 1900 || year > 2030) { setYearEditing(null); return }
    setSaving(product.id)
    await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year_released: year }),
    })
    setProducts((prev) =>
      prev.map((p) => p.id === product.id ? { ...p, year_released: year } : p)
    )
    setSaving(null)
    setYearEditing(null)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--foreground)' }}>
        Produkter
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--muted-foreground)' }}>
        Sæt tier og årstal. Tom søgning viser legendary-produkter.
      </p>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(query)}
          placeholder="Søg produkt…"
          className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
          style={{
            background: 'var(--input-background)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          }}
        />
        <button
          onClick={() => search(query)}
          className="px-4 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          Søg
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--card)' }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {products.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              {/* Tier badge — click to cycle */}
              <button
                onClick={() => cycleTier(p)}
                disabled={saving === p.id}
                className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-opacity disabled:opacity-50 flex items-center gap-1"
                style={TIER_STYLE[p.tier]}
                title="Klik for at skifte tier"
              >
                {p.tier === 'legendary' && (
                  <span className="material-symbols-outlined" style={{ fontSize: 11 }}>workspace_premium</span>
                )}
                {TIER_LABEL[p.tier]}
              </button>

              {/* Name + brand */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                  {p.canonical_name}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--muted-foreground)' }}>
                  {p.kg_brand?.name ?? '—'} · {p.slug}
                </p>
              </div>

              {/* Year released — click to edit */}
              {yearEditing === p.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    value={yearDraft}
                    onChange={(e) => setYearDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveYear(p); if (e.key === 'Escape') setYearEditing(null) }}
                    className="w-20 rounded-lg px-2 py-1 text-sm text-center outline-none"
                    style={{ background: 'var(--input-background)', border: '1px solid var(--ring)', color: 'var(--foreground)' }}
                    autoFocus
                    placeholder="Årstal"
                  />
                  <button
                    onClick={() => saveYear(p)}
                    className="text-xs px-2 py-1 rounded-lg font-medium"
                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                  >
                    Gem
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setYearEditing(p.id); setYearDraft(String(p.year_released ?? '')) }}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors"
                  style={{ background: 'var(--secondary)', color: p.year_released ? 'var(--foreground)' : 'var(--muted-foreground)' }}
                >
                  {p.year_released ?? '+ År'}
                </button>
              )}
            </div>
          ))}
          {products.length === 0 && !loading && (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--muted-foreground)' }}>
              Ingen produkter fundet.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
