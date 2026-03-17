'use client'

import { useEffect, useState, useCallback } from 'react'

type Suggestion = {
  id: string
  canonical_name: string
  brand_name: string | null
  listing_count: number
  status: string
  reviewed_at: string | null
  created_at: string
}

type Tab = 'pending' | 'approved' | 'rejected'

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Godkendt' },
  { key: 'rejected', label: 'Afvist' },
]

const PAGE_SIZE = 50

export default function AdminSuggestionsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [rows, setRows] = useState<Suggestion[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async (status: Tab, off: number) => {
    setLoading(true)
    const res = await fetch(`/api/admin/suggestions?status=${status}&offset=${off}&limit=${PAGE_SIZE}`)
    if (res.ok) {
      const data = await res.json()
      setRows(data.suggestions)
      setTotal(data.total)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load(tab, offset)
  }, [tab, offset, load])

  function handleTabChange(t: Tab) {
    setTab(t)
    setOffset(0)
  }

  function startEdit(s: Suggestion) {
    setEditingId(s.id)
    setEditName(s.canonical_name)
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    setActionLoading(id)
    const res = await fetch(`/api/admin/suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonical_name: editName.trim() }),
    })
    if (res.ok) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, canonical_name: editName.trim() } : r))
      showToast('Navn opdateret')
    }
    setEditingId(null)
    setActionLoading(null)
  }

  async function handleApprove(s: Suggestion) {
    setActionLoading(s.id)
    const res = await fetch(`/api/admin/suggestions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', canonical_name: s.canonical_name }),
    })
    if (res.ok) {
      setRows(prev => prev.filter(r => r.id !== s.id))
      setTotal(prev => prev - 1)
      showToast(`"${s.canonical_name}" godkendt`)
    } else {
      const data = await res.json()
      showToast(data.error ?? 'Fejl')
    }
    setActionLoading(null)
  }

  async function handleReject(s: Suggestion) {
    setActionLoading(s.id)
    const res = await fetch(`/api/admin/suggestions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    })
    if (res.ok) {
      setRows(prev => prev.filter(r => r.id !== s.id))
      setTotal(prev => prev - 1)
      showToast('Afvist')
    }
    setActionLoading(null)
  }

  const cardStyle = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">KG Forslag</h1>

      {/* Tabs */}
      <div className="flex gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{
              color: tab === t.key ? 'var(--foreground)' : 'var(--muted-foreground)',
              backgroundColor: tab === t.key ? 'var(--secondary)' : 'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="text-xs text-muted-foreground self-center ml-2">
          {total} total
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Ingen {tab === 'pending' ? 'ventende' : tab === 'approved' ? 'godkendte' : 'afviste'} forslag.
        </p>
      ) : (
        <>
          {/* Header */}
          <div className="hidden md:grid grid-cols-[1fr_140px_80px_120px] gap-2 px-4 text-xs font-bold text-muted-foreground">
            <span>Produkt</span>
            <span>Brand</span>
            <span className="text-right">Annoncer</span>
            <span className="text-right">Handlinger</span>
          </div>

          {/* Rows */}
          <div className="flex flex-col gap-1">
            {rows.map(s => (
              <div
                key={s.id}
                className="rounded-xl px-4 py-3 md:grid md:grid-cols-[1fr_140px_80px_120px] md:items-center flex flex-col gap-2"
                style={cardStyle}
              >
                {/* Name (editable) */}
                <div className="min-w-0">
                  {editingId === s.id ? (
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={() => saveEdit(s.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(s.id); if (e.key === 'Escape') setEditingId(null) }}
                      autoFocus
                      className="w-full text-sm font-medium rounded-lg px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(s)}
                      className="text-sm font-medium text-foreground truncate text-left w-full hover:underline"
                      title="Klik for at redigere"
                    >
                      {s.canonical_name}
                    </button>
                  )}
                </div>

                {/* Brand */}
                <span className="text-xs text-muted-foreground truncate">
                  {s.brand_name ?? '—'}
                </span>

                {/* Count */}
                <span className="text-xs text-muted-foreground md:text-right">
                  {s.listing_count}
                </span>

                {/* Actions */}
                <div className="flex gap-1.5 md:justify-end">
                  {tab === 'pending' ? (
                    <>
                      <button
                        onClick={() => handleApprove(s)}
                        disabled={actionLoading === s.id}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                      >
                        Godkend
                      </button>
                      <button
                        onClick={() => handleReject(s)}
                        disabled={actionLoading === s.id}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--secondary)', color: 'var(--muted-foreground)' }}
                      >
                        Afvis
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      {s.reviewed_at
                        ? new Date(s.reviewed_at).toLocaleDateString('da-DK')
                        : '—'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
                className="text-sm font-medium px-3 py-1.5 rounded-lg disabled:opacity-30"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
              >
                Forrige
              </button>
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} af {total}
              </span>
              <button
                onClick={() => setOffset(o => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                className="text-sm font-medium px-3 py-1.5 rounded-lg disabled:opacity-30"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
              >
                Næste
              </button>
            </div>
          )}
        </>
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
