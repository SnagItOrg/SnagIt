'use client'

import { useState, useRef, useCallback } from 'react'
import type { Candidate } from '@/app/api/admin/match/candidates/route'
import {
  ALL_SOURCE_KEYS,
  MATCH_SOURCES,
  sourceForStored,
} from '@/lib/admin-match-sources'

type KgProduct = {
  id:             string
  canonical_name: string
  slug:           string
  kg_brand:       { name: string } | null
}

export default function AdminMatchPage() {
  const [query, setQuery]           = useState('')
  const [suggestions, setSuggestions] = useState<KgProduct[]>([])
  const [searching, setSearching]   = useState(false)
  const [product, setProduct]       = useState<KgProduct | null>(null)

  const [sources, setSources]       = useState<Set<string>>(new Set(ALL_SOURCE_KEYS))
  const [loading, setLoading]       = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [approved, setApproved]     = useState<Set<string>>(new Set())
  const [rejected, setRejected]     = useState<Set<string>>(new Set())
  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState<string | null>(null)

  function toggleSource(key: string) {
    setSources((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size > 1) next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // KG product search
  function handleQueryChange(val: string) {
    setQuery(val)
    setSuggestions([])
    if (debounce.current) clearTimeout(debounce.current)
    if (val.trim().length < 2) return
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/match/search?q=${encodeURIComponent(val)}`)
        const data = await res.json() as { products: KgProduct[] }
        setSuggestions(data.products ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  function selectProduct(p: KgProduct) {
    setProduct(p)
    setQuery(p.canonical_name)
    setSuggestions([])
    setCandidates([])
    setApproved(new Set())
    setRejected(new Set())
  }

  const loadCandidates = useCallback(async () => {
    if (!product) return
    setLoading(true)
    setCandidates([])
    try {
      const sourcesParam = Array.from(sources).join(',')
      const res = await fetch(
        `/api/admin/match/candidates?product_id=${product.id}&product_name=${encodeURIComponent(product.canonical_name)}&sources=${sourcesParam}`
      )
      const data = await res.json() as { candidates: Candidate[] }
      setCandidates(data.candidates ?? [])
      setApproved(new Set())
      setRejected(new Set())
    } finally {
      setLoading(false)
    }
  }, [product, sources])

  function toggle(id: string, action: 'approve' | 'reject') {
    if (action === 'approve') {
      setApproved((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      setRejected((prev) => { const next = new Set(prev); next.delete(id); return next })
    } else {
      setRejected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      setApproved((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  // Both verdicts travel together: a rejection is a stored label, not a
  // dismissal, so leaving it in the browser would lose the operator's work.
  async function saveDecisions() {
    if (!product || (approved.size === 0 && rejected.size === 0)) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/match/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.id,
          listing_ids: Array.from(approved),
          rejected_listing_ids: Array.from(rejected),
        }),
      })
      const data = await res.json() as { approved?: number; rejected?: number; error?: string }
      if (data.error) { showToast(`Fejl: ${data.error}`); return }
      showToast(`✅ ${data.approved ?? 0} godkendt · ${data.rejected ?? 0} afvist`)
      // Both verdicts are now stored, so neither returns to the queue.
      setCandidates((prev) => prev.filter((c) => !approved.has(c.id) && !rejected.has(c.id)))
      setApproved(new Set())
      setRejected(new Set())
    } finally {
      setSaving(false)
    }
  }

  const scoreLabel: Record<Candidate['score'], { label: string; color: string; icon: string }> = {
    yes:   { label: 'Relevant',  color: '#16a34a', icon: 'check_circle' },
    maybe: { label: 'Måske',     color: '#d97706', icon: 'help' },
    no:    { label: 'Ikke relevant', color: '#dc2626', icon: 'cancel' },
  }

  // Queued rejections stay visible and muted rather than vanishing on click.
  // The cross now writes a durable label, so the operator has to be able to see
  // what they are about to store — and take it back before saving.
  const visible = candidates

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Match annoncer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Søg et produkt, lad Haiku vurdere kandidater, godkend manuelt.
        </p>
      </div>

      {/* Product search */}
      <div className="relative max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Søg produkt, fx Roland Juno-106…"
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        {searching && (
          <span className="material-symbols-outlined absolute right-3 top-2.5 animate-spin text-muted-foreground" style={{ fontSize: 20 }}>
            progress_activity
          </span>
        )}
        {suggestions.length > 0 && (
          <div className="surface-overlay absolute top-full mt-1 left-0 right-0 rounded-xl z-10 overflow-hidden">
            {suggestions.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProduct(p)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
              >
                <span className="font-medium text-foreground">{p.canonical_name}</span>
                {p.kg_brand && <span className="text-muted-foreground ml-2">{p.kg_brand.name}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {product && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">{product.canonical_name}</span>
              <a
                href={`/product/${product.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                /product/{product.slug} ↗
              </a>
            </div>
            <button
              onClick={loadCandidates}
              disabled={loading}
              className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#002D4C' }}
            >
              {loading ? 'Henter…' : 'Find kandidater'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Kilder:</span>
            {MATCH_SOURCES.map(({ key, label, color }) => {
              const active = sources.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleSource(key)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: active ? color : 'transparent',
                    borderColor: color,
                    color: active ? '#fff' : color,
                    opacity: active ? 1 : 0.5,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Candidate list */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
          <p className="text-xs text-muted-foreground">Haiku vurderer relevans…</p>
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {visible.length} kandidater · {approved.size} godkendt · {rejected.size} afvist
            </p>
            <button
              onClick={saveDecisions}
              disabled={(approved.size === 0 && rejected.size === 0) || saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#16a34a' }}
            >
              {saving ? 'Gemmer…' : `Gem ${approved.size + rejected.size > 0 ? approved.size + rejected.size : ''}`}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {visible.map((c) => {
              const isApproved = approved.has(c.id)
              const isRejected = rejected.has(c.id)
              const s = scoreLabel[c.score]
              const sourceMeta = sourceForStored(c.source)
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-3 p-3 rounded-xl border transition-colors"
                  style={{
                    borderColor: isApproved ? '#16a34a' : isRejected ? '#dc2626' : 'var(--border)',
                    backgroundColor: isApproved ? '#16a34a12' : isRejected ? '#dc262610' : 'var(--card)',
                    opacity: isRejected ? 0.6 : 1,
                  }}
                >
                  {/* Thumbnail, when the source stored one */}
                  {c.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.image_url}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-muted"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg flex-shrink-0 bg-muted flex items-center justify-center">
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--muted-foreground)' }}>
                        image_not_supported
                      </span>
                    </div>
                  )}
                  {/* Haiku score */}
                  <div className="flex flex-col items-center gap-0.5 pt-0.5 min-w-[52px]">
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: s.color }}>
                      {s.icon}
                    </span>
                    <span className="text-[10px] font-medium" style={{ color: s.color }}>{s.label}</span>
                  </div>

                  {/* Listing info */}
                  <div className="flex-1 min-w-0">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground hover:underline truncate block"
                    >
                      {c.title}
                    </a>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.reason}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: sourceMeta?.color ?? 'var(--muted)',
                          color: '#fff',
                        }}
                      >
                        {sourceMeta?.label ?? c.source}
                      </span>

                      {/*
                        The asking price in the currency it was actually listed
                        in. Kleinanzeigen quotes EUR, so rendering the raw number
                        with a "kr" suffix — as this card used to — turned a
                        450 EUR synth into a 450 kr one.
                      */}
                      {c.price != null ? (
                        <span className="text-xs font-medium text-foreground">
                          {c.price.toLocaleString('da-DK')} {c.currency ?? 'DKK'}
                          {c.price_dkk != null && c.currency !== 'DKK' && (
                            <span className="text-muted-foreground font-normal">
                              {' '}≈ {Math.round(c.price_dkk).toLocaleString('da-DK')} kr
                            </span>
                          )}
                        </span>
                      ) : (
                        /* Absence is shown, not filtered: 265 of ~2,141 active
                           Kleinanzeigen rows have no price, and they are still
                           real listings that may belong to this product. */
                        <span className="text-xs font-medium" style={{ color: '#d97706' }}>
                          Ingen pris
                        </span>
                      )}

                      {c.location ? (
                        <span className="text-xs text-muted-foreground truncate">{c.location}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Ingen lokation</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggle(c.id, 'approve')}
                      className="p-1.5 rounded-lg transition-colors hover:bg-secondary"
                      title="Godkend"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: isApproved ? '#16a34a' : 'var(--muted-foreground)' }}>
                        check
                      </span>
                    </button>
                    <button
                      onClick={() => toggle(c.id, 'reject')}
                      className="p-1.5 rounded-lg transition-colors hover:bg-secondary"
                      title="Afvis — gemmes som varigt nej"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: isRejected ? '#dc2626' : 'var(--muted-foreground)' }}>
                        close
                      </span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {!loading && product && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Ingen kandidater fundet. Prøv at klikke &quot;Find kandidater&quot;.
        </p>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg z-50"
          style={{ backgroundColor: '#1a1a1a' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
