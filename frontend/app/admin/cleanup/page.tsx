'use client'

import { useEffect, useState, useCallback } from 'react'

type BrandOption = {
  name: string
  slug: string
  count: number
}

type Candidate = {
  id: string
  slug: string
  canonical_name: string
  sim: number
}

type CleanupItem = {
  id: string
  slug: string
  canonical_name: string
  brand_name: string
  flags: string[]
  listing_match_count: number
  candidates: Candidate[]
}

type ItemState = CleanupItem & {
  status: 'pending' | 'loading' | 'done' | 'error'
  doneLabel?: string
  errorMsg?: string
}

const FLAG_LABEL: Record<string, string> = {
  has_year:              'year',
  has_condition_word:    'condition',
  has_language_qualifier:'language',
  duplicated_brand:      'dup-brand',
  too_long:              'too long',
}

function computeCleanName(name: string): string {
  // Remove consecutive duplicate first word (e.g. "JoMox JoMox Moonwind" → "JoMox Moonwind")
  const deduped = name.replace(/^(\S+)\s+\1(\s+)/i, '$1$2')
  // Strip trailing colour/finish suffix (e.g. " - Black", " - Vintage White")
  const stripped = deduped.replace(
    /\s+-\s+(Black|White|Silver|Red|Blue|Green|Gold|Natural|Sunburst|Cream|Vintage White)\s*$/i,
    '',
  )
  return stripped.trim()
}

export default function CleanupPage() {
  const [items, setItems] = useState<ItemState[]>([])
  const [totalPending, setTotalPending] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [brands, setBrands] = useState<BrandOption[]>([])
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null)
  const perPage = 20

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // Fetch brand list once on mount
  useEffect(() => {
    fetch('/api/admin/cleanup/brands')
      .then((r) => r.json())
      .then((d) => setBrands(d.brands ?? []))
  }, [])

  const loadPage = useCallback(async (p: number, brand: string | null) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), per_page: String(perPage) })
    if (brand) params.set('brand_slug', brand)
    const res = await fetch(`/api/admin/cleanup?${params}`)
    const data = await res.json()
    setItems((data.items ?? []).map((item: CleanupItem) => ({ ...item, status: 'pending' })))
    setTotalPending(data.total_pending ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPage(page, selectedBrand)
  }, [page, selectedBrand, loadPage])

  function handleBrandChange(slug: string | null) {
    setSelectedBrand(slug)
    setPage(0)
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const first = items.find((it) => it.status === 'pending')
      if (!first) return
      if (e.key === 'm') { void handleMerge(first, 0); return }
      if (e.key === 'i') { void handleInactivate(first.id); return }
      if (e.key === 'k') { void handleKeep(first.id); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  function updateItem(id: string, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  async function handleMerge(item: ItemState, candidateIdx: number) {
    const candidate = item.candidates[candidateIdx]
    if (!candidate) return
    updateItem(item.id, { status: 'loading' })
    const res = await fetch('/api/admin/cleanup/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirty_id: item.id, clean_id: candidate.id }),
    })
    if (res.ok) {
      updateItem(item.id, { status: 'done', doneLabel: `→ ${candidate.canonical_name}` })
      setTotalPending((n) => Math.max(0, n - 1))
      showToast(`Merged → ${candidate.canonical_name}`)
    } else {
      const d = await res.json()
      updateItem(item.id, { status: 'error', errorMsg: d.error ?? 'Merge failed' })
    }
  }

  async function handleInactivate(id: string) {
    updateItem(id, { status: 'loading' })
    const res = await fetch('/api/admin/cleanup/inactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      updateItem(id, { status: 'done', doneLabel: 'Inactivated' })
      setTotalPending((n) => Math.max(0, n - 1))
      showToast('Inactivated')
    } else {
      const d = await res.json()
      updateItem(id, { status: 'error', errorMsg: d.error ?? 'Failed' })
    }
  }

  async function handleKeep(id: string) {
    updateItem(id, { status: 'loading' })
    const res = await fetch('/api/admin/cleanup/keep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      updateItem(id, { status: 'done', doneLabel: 'Kept as-is' })
      setTotalPending((n) => Math.max(0, n - 1))
      showToast('Marked as clean')
    } else {
      const d = await res.json()
      updateItem(id, { status: 'error', errorMsg: d.error ?? 'Failed' })
    }
  }

  async function handleSelfClean(item: ItemState) {
    const cleanName = computeCleanName(item.canonical_name)
    updateItem(item.id, { status: 'loading' })
    const res = await fetch('/api/admin/cleanup/self-clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirty_id: item.id, clean_name: cleanName }),
    })
    if (res.ok) {
      updateItem(item.id, { status: 'done', doneLabel: `→ ${cleanName} (new)` })
      setTotalPending((n) => Math.max(0, n - 1))
      showToast(`Created and merged → ${cleanName}`)
    } else {
      const d = await res.json()
      updateItem(item.id, { status: 'error', errorMsg: d.error ?? 'Self-clean failed' })
    }
  }

  const doneOnPage = items.filter((it) => it.status === 'done').length
  const totalPages = Math.ceil(totalPending / perPage)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
            KG Cleanup Queue
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {totalPending} pending · Shortcuts: <kbd className="font-mono">m</kbd> merge ·{' '}
            <kbd className="font-mono">i</kbd> inactivate · <kbd className="font-mono">k</kbd> keep
          </p>
        </div>
        {totalPending > 0 && (
          <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Page {page + 1} / {totalPages || 1}
          </div>
        )}
      </div>

      {/* Brand filter */}
      {brands.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold" style={{ color: 'var(--muted-foreground)' }}>
            Brand
          </label>
          <select
            value={selectedBrand ?? ''}
            onChange={(e) => handleBrandChange(e.target.value || null)}
            className="text-sm px-3 py-1.5 rounded-xl"
            style={{
              background: 'var(--secondary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name} ({b.count})
              </option>
            ))}
          </select>
          {selectedBrand && (
            <button
              onClick={() => handleBrandChange(null)}
              className="text-xs px-2 py-1 rounded-lg"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Clear ×
            </button>
          )}
        </div>
      )}

      {/* Progress bar */}
      {totalPending > 0 && (
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--secondary)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              background: 'var(--primary)',
              width: `${Math.round((doneOnPage / items.length) * 100)}%`,
            }}
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: 'var(--card)' }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
          Queue empty. Run <code>npm run populate-cleanup-queue</code> on panter first.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const done = item.status === 'done'
            const busy = item.status === 'loading'
            const cleanName = computeCleanName(item.canonical_name)
            const canSelfClean = item.candidates.length === 0 && cleanName !== item.canonical_name

            return (
              <div
                key={item.id}
                className="rounded-2xl overflow-hidden transition-opacity"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  opacity: done ? 0.4 : 1,
                }}
              >
                <div className="px-5 py-4 flex flex-col gap-3">
                  {/* Name + brand */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                        {item.canonical_name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                        {item.brand_name} · {item.slug}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.listing_match_count > 0 && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
                        >
                          {item.listing_match_count} matches
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Flag badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {item.flags.map((f) => (
                      <span
                        key={f}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(220,60,60,0.12)', color: 'rgb(200,50,50)' }}
                      >
                        {FLAG_LABEL[f] ?? f}
                      </span>
                    ))}
                  </div>

                  {/* Candidates */}
                  {item.candidates.length > 0 && !done && (
                    <div className="flex flex-col gap-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                        Clean parent candidates
                      </p>
                      {item.candidates.map((c, ci) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                          style={{ background: 'var(--secondary)' }}
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-medium truncate" style={{ color: 'var(--foreground)' }}>
                              {c.canonical_name}
                            </span>
                            <span className="text-[10px] ml-2" style={{ color: 'var(--muted-foreground)' }}>
                              {Math.round(c.sim * 100)}% match
                            </span>
                          </div>
                          <button
                            onClick={() => void handleMerge(item, ci)}
                            disabled={busy}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 disabled:opacity-40"
                            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                          >
                            Merge →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Self-clean suggestion */}
                  {canSelfClean && !done && (
                    <div
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                      style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'rgb(59,130,246)' }}>
                          No candidates — use cleaned name
                        </p>
                        <span className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                          {cleanName}
                        </span>
                      </div>
                      <button
                        onClick={() => void handleSelfClean(item)}
                        disabled={busy}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 disabled:opacity-40"
                        style={{ background: 'rgb(59,130,246)', color: '#fff' }}
                      >
                        Use this name →
                      </button>
                    </div>
                  )}

                  {/* Done / error state */}
                  {done && (
                    <p className="text-xs font-semibold" style={{ color: 'rgb(22,140,60)' }}>
                      ✓ {item.doneLabel}
                    </p>
                  )}
                  {item.status === 'error' && (
                    <p className="text-xs font-medium" style={{ color: 'rgb(220,60,60)' }}>
                      {item.errorMsg}
                    </p>
                  )}

                  {/* Actions */}
                  {!done && (
                    <div
                      className="flex flex-wrap gap-2 pt-2 border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {item.candidates.length > 0 && (
                        <button
                          onClick={() => void handleMerge(item, 0)}
                          disabled={busy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
                          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                          {busy ? 'Working…' : 'Merge into top'}
                        </button>
                      )}
                      <button
                        onClick={() => void handleInactivate(item.id)}
                        disabled={busy}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
                      >
                        Inactivate
                      </button>
                      <button
                        onClick={() => void handleKeep(item.id)}
                        disabled={busy}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
                      >
                        Keep as-is
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-sm px-4 py-2 rounded-xl disabled:opacity-30"
            style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
          >
            ← Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-sm px-4 py-2 rounded-xl disabled:opacity-30"
            style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
          >
            Next →
          </button>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
