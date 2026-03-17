'use client'

import { useState, useRef, useCallback } from 'react'

type Product = {
  id: string
  canonical_name: string
  msrp_dkk: number | null
  thomann_url: string | null
  kg_brand: { name: string }
}

export default function AdminMsrpPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const res = await fetch(`/api/admin/msrp?q=${encodeURIComponent(q)}`)
      if (res.ok) setResults(await res.json())
      setLoading(false)
    }, 300)
  }, [])

  function handleQueryChange(val: string) {
    setQuery(val)
    search(val)
  }

  async function handleSave(id: string, field: 'msrp_dkk' | 'thomann_url', value: string) {
    setSaving(id)
    const res = await fetch('/api/admin/msrp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    })
    if (res.ok) {
      setResults(prev => prev.map(p => {
        if (p.id !== id) return p
        return {
          ...p,
          [field]: field === 'msrp_dkk'
            ? (value === '' ? null : parseInt(value, 10))
            : (value === '' ? null : value),
        }
      }))
      showToast('Gemt')
    } else {
      showToast('Fejl ved gemning')
    }
    setSaving(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">MSRP & Thomann</h1>

      <input
        type="text"
        value={query}
        onChange={e => handleQueryChange(e.target.value)}
        placeholder="Søg produkt (fx Roland Juno, Fender Strat)..."
        className="w-full rounded-xl px-4 py-3 text-sm outline-none"
        style={{
          backgroundColor: 'var(--secondary)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}
      />

      {loading && (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{results.length} resultater</p>
          {results.map(p => (
            <ProductRow
              key={p.id}
              product={p}
              saving={saving === p.id}
              onSave={handleSave}
            />
          ))}
        </div>
      )}

      {!loading && query.length >= 2 && results.length === 0 && (
        <p className="text-sm text-muted-foreground">Ingen produkter fundet.</p>
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function ProductRow({
  product,
  saving,
  onSave,
}: {
  product: Product
  saving: boolean
  onSave: (id: string, field: 'msrp_dkk' | 'thomann_url', value: string) => void
}) {
  const [msrp, setMsrp] = useState(product.msrp_dkk?.toString() ?? '')
  const [url, setUrl] = useState(product.thomann_url ?? '')

  const cardStyle = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const inputStyle = {
    backgroundColor: 'var(--secondary)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
  }

  return (
    <div className="rounded-xl p-4 flex flex-col gap-2" style={cardStyle}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={{ backgroundColor: 'var(--secondary)', color: 'var(--muted-foreground)' }}>
          {product.kg_brand?.name}
        </span>
        <span className="text-sm font-semibold text-foreground">{product.canonical_name}</span>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex flex-col gap-1 flex-shrink-0" style={{ width: '120px' }}>
          <label className="text-xs text-muted-foreground">MSRP (DKK)</label>
          <input
            type="number"
            value={msrp}
            onChange={e => setMsrp(e.target.value)}
            onBlur={() => {
              if (msrp !== (product.msrp_dkk?.toString() ?? '')) {
                onSave(product.id, 'msrp_dkk', msrp)
              }
            }}
            placeholder="—"
            disabled={saving}
            className="w-full rounded-lg px-3 py-1.5 text-sm outline-none disabled:opacity-40"
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <label className="text-xs text-muted-foreground">Thomann URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onBlur={() => {
              if (url !== (product.thomann_url ?? '')) {
                onSave(product.id, 'thomann_url', url)
              }
            }}
            placeholder="https://www.thomann.dk/..."
            disabled={saving}
            className="w-full rounded-lg px-3 py-1.5 text-sm outline-none disabled:opacity-40 truncate"
            style={inputStyle}
          />
        </div>
      </div>
    </div>
  )
}
