'use client'

import { useEffect, useState } from 'react'

type Brand = {
  id: string
  name: string
  count: number
}

type SuggestionMember = {
  id: string
  canonical_name: string
  listing_count: number
}

type Group = {
  canonical_name: string
  model_name: string
  suggestions: SuggestionMember[]
  brand_id: string
  category_id: string | null
  exists_in_kg: boolean
  kg_product_id: string | null
  kg_product_slug: string | null
}

type GroupState = Group & {
  // local UI state
  editName: string
  editModel: string
  status: 'pending' | 'approved' | 'rejected' | 'loading' | 'error'
  errorMsg?: string
}

export default function BulkReviewPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)

  const [grouping, setGrouping] = useState(false)
  const [groups, setGroups] = useState<GroupState[]>([])
  const [total, setTotal] = useState(0)

  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    fetch('/api/admin/suggestions/bulk/brands')
      .then(r => r.json())
      .then(d => setBrands(d.brands ?? []))
      .finally(() => setBrandsLoading(false))
  }, [])

  async function handleBrandSelect(brand: Brand) {
    setSelectedBrand(brand)
    setGroups([])
    setGrouping(true)

    const res = await fetch('/api/admin/suggestions/bulk/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_id: brand.id }),
    })

    if (!res.ok) {
      const data = await res.json()
      showToast(data.error ?? 'Fejl ved AI-gruppering')
      setGrouping(false)
      return
    }

    const data = await res.json()
    const grouped: GroupState[] = (data.groups as Group[]).map(g => ({
      ...g,
      editName: g.canonical_name,
      editModel: g.model_name,
      status: 'pending',
    }))
    setGroups(grouped)
    setTotal(data.total)
    setGrouping(false)
  }

  function updateGroup(idx: number, patch: Partial<GroupState>) {
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, ...patch } : g))
  }

  async function approveGroup(idx: number) {
    const g = groups[idx]
    updateGroup(idx, { status: 'loading' })

    const res = await fetch('/api/admin/suggestions/bulk/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonical_name: g.editName.trim(),
        model_name: g.editModel.trim(),
        brand_id: g.brand_id,
        category_id: g.category_id,
        suggestion_ids: g.suggestions.map(s => s.id),
        variant_names: g.suggestions.map(s => s.canonical_name),
      }),
    })

    const data = await res.json()
    if (res.ok) {
      updateGroup(idx, { status: 'approved' })
      showToast(`"${g.editName}" oprettet`)
    } else {
      updateGroup(idx, { status: 'error', errorMsg: data.error ?? 'Fejl' })
    }
  }

  async function rejectGroup(idx: number) {
    const g = groups[idx]
    updateGroup(idx, { status: 'loading' })

    const res = await fetch('/api/admin/suggestions/bulk/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestion_ids: g.suggestions.map(s => s.id) }),
    })

    if (res.ok) {
      updateGroup(idx, { status: 'rejected' })
    } else {
      updateGroup(idx, { status: 'error', errorMsg: 'Fejl ved afvisning' })
    }
  }

  const inputStyle = {
    backgroundColor: 'var(--secondary)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
  }

  const cardStyle = {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
  }

  const pendingCount = groups.filter(g => g.status === 'pending' || g.status === 'error').length
  const doneCount = groups.filter(g => g.status === 'approved' || g.status === 'rejected').length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Bulk review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Vælg et brand — AI grupperer de første 50 pending forslag.
          </p>
        </div>
        {groups.length > 0 && (
          <div className="text-sm text-muted-foreground">
            <span style={{ color: 'var(--foreground)' }} className="font-semibold">{doneCount}</span>
            /{groups.length} behandlet
            {pendingCount > 0 && (
              <span className="ml-2">({pendingCount} tilbage)</span>
            )}
          </div>
        )}
      </div>

      {/* Brand selector */}
      <div className="flex flex-col gap-2 max-w-sm">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brand</label>
        {brandsLoading ? (
          <div className="h-9 rounded-xl bg-muted animate-pulse" />
        ) : (
          <select
            className="text-sm rounded-xl px-3 py-2 outline-none"
            style={inputStyle}
            value={selectedBrand?.id ?? ''}
            onChange={e => {
              const brand = brands.find(b => b.id === e.target.value)
              if (brand) handleBrandSelect(brand)
            }}
          >
            <option value="">Vælg brand…</option>
            {brands.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.count} pending)
              </option>
            ))}
          </select>
        )}
      </div>

      {/* AI grouping in progress */}
      {grouping && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="material-symbols-outlined animate-spin"
              style={{ fontSize: '16px', color: 'var(--primary)' }}
            >
              progress_activity
            </span>
            AI grupperer forslag for {selectedBrand?.name}…
          </div>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Results */}
      {!grouping && groups.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {total} forslag fra {selectedBrand?.name} → {groups.length} grupper
        </div>
      )}

      {!grouping && groups.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.map((g, idx) => {
            const done = g.status === 'approved' || g.status === 'rejected'
            const busy = g.status === 'loading'

            return (
              <div
                key={idx}
                className="rounded-2xl overflow-hidden transition-opacity"
                style={{
                  ...cardStyle,
                  opacity: done ? 0.45 : 1,
                }}
              >
                <div className="px-5 py-4 flex flex-col gap-3">
                  {/* Header: name + model */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                        Kanonisk navn
                      </label>
                      <input
                        value={g.editName}
                        onChange={e => updateGroup(idx, { editName: e.target.value })}
                        disabled={done || busy}
                        className="w-full text-sm font-semibold rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-60"
                        style={inputStyle}
                      />
                    </div>
                    <div className="sm:w-48">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                        model_name
                      </label>
                      <input
                        value={g.editModel}
                        onChange={e => updateGroup(idx, { editModel: e.target.value })}
                        disabled={done || busy}
                        placeholder="fx TR-909"
                        className="w-full text-sm rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-60"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Variants */}
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                      Varianter ({g.suggestions.length})
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {g.suggestions.map(s => (
                        <li key={s.id} className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">•</span>
                          <span className="text-foreground flex-1 min-w-0 truncate">{s.canonical_name}</span>
                          <span className="text-muted-foreground flex-shrink-0">{s.listing_count} annoncer</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* KG status */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Findes i KG:</span>
                    {g.exists_in_kg ? (
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'rgb(180, 120, 10)' }}
                      >
                        Ja — {g.kg_product_slug}
                      </span>
                    ) : (
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(34, 197, 94, 0.12)', color: 'rgb(22, 140, 60)' }}
                      >
                        Nej
                      </span>
                    )}
                  </div>

                  {/* Error */}
                  {g.status === 'error' && g.errorMsg && (
                    <p className="text-xs font-medium" style={{ color: 'rgb(220, 60, 60)' }}>
                      {g.errorMsg}
                    </p>
                  )}

                  {/* Done badge */}
                  {g.status === 'approved' && (
                    <p className="text-xs font-semibold" style={{ color: 'rgb(22, 140, 60)' }}>
                      ✓ Oprettet
                    </p>
                  )}
                  {g.status === 'rejected' && (
                    <p className="text-xs font-medium text-muted-foreground">✗ Afvist</p>
                  )}

                  {/* Actions */}
                  {!done && (
                    <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                      <button
                        type="button"
                        onClick={() => approveGroup(idx)}
                        disabled={busy || !g.editName.trim()}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                      >
                        {busy ? 'Opretter…' : 'Opret + merger alle varianter'}
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectGroup(idx)}
                        disabled={busy}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--secondary)', color: 'var(--muted-foreground)' }}
                      >
                        Afvis gruppe
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
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
