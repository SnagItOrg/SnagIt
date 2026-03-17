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

// ── Auto-rename logic ────────────────────────────────────────────────────────

const YEAR_RE = /\s+\d{4}\s*(-\s*(\d{4}|Present))?.*/i
const COLOR_RE = /\s+-\s+(Black|White|Silver|Blue|Red|Green|Gold|Nickel|Natural|Sunburst|Cherry|Cream|Grey|Gray|Orange|Yellow|Pink|Purple|Brown|Blonde|Tobacco|Arctic|Polar|Alpine|Midnight|Satin|Matte|Gloss|Vintage White|Olympic White|Sonic Blue|Fiesta Red|Surf Green|Lake Placid Blue|Shell Pink|Sea Foam Green|Candy Apple Red|Ice Blue Metallic|Daphne Blue|Desert Sand|Shoreline Gold)$/i
const SLASH_RE = /\s+\/\s+.*/

const DESCRIPTOR_WORDS = new Set([
  'synthesizer', 'workstation', 'composer', 'keyboard', 'controller',
  'sampler', 'machine', 'monitor', 'microphone', 'recorder', 'guitar',
  'bass', 'amplifier', 'amp', 'cabinet', 'pedal', 'effect', 'effects',
  'set', 'module', 'processor', 'mixer', 'interface', 'preamp',
  'compressor', 'equalizer', 'delay', 'reverb', 'chorus', 'phaser',
  'flanger', 'distortion', 'overdrive', 'portable', 'digital', 'analog',
  'programmable', 'polyphonic', 'professional', 'studio', 'tape',
  'rhythm', 'drum', 'multi-effects', 'condenser', 'dynamic',
  'large-diaphragm', 'small-diaphragm', 'tube', 'solid-state',
  'combo', 'head', 'speaker', 'subwoofer', 'active', 'passive',
  'powered', 'unpowered', 'channel', 'stereo', 'mono',
])

const NUM_KEY_RE = /^\d+-key$/i

function cleanProductName(fullName: string, brandName: string): string {
  // Remove brand prefix
  let name = fullName
  if (name.toLowerCase().startsWith(brandName.toLowerCase())) {
    name = name.slice(brandName.length).trim()
  }

  // Strip year patterns and everything after
  name = name.replace(YEAR_RE, '')

  // Strip " - Color" suffixes
  name = name.replace(COLOR_RE, '')

  // Strip everything from " / " onward (category separators)
  name = name.replace(SLASH_RE, '')

  // Strip trailing generic descriptor words
  const words = name.trim().split(/\s+/)
  while (words.length > 1) {
    const last = words[words.length - 1]
    if (DESCRIPTOR_WORDS.has(last.toLowerCase()) || NUM_KEY_RE.test(last)) {
      words.pop()
    } else {
      break
    }
  }

  name = words.join(' ').trim()

  // Strip trailing " -" left over from removed suffixes
  name = name.replace(/\s*-\s*$/, '').trim()

  return name ? `${brandName} ${name}` : fullName
}

// ── Rename modal types ───────────────────────────────────────────────────────

type RenameRow = {
  id: string
  before: string
  after: string
  brandName: string
}

// ── Page component ───────────────────────────────────────────────────────────

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

  // Rename modal state
  const [showRename, setShowRename] = useState(false)
  const [renameRows, setRenameRows] = useState<RenameRow[]>([])
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameSaving, setRenameSaving] = useState(false)

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

  // ── Rename modal ───────────────────────────────────────────────────────────

  async function openRenameModal() {
    setShowRename(true)
    setRenameLoading(true)
    const res = await fetch('/api/admin/suggestions/rename')
    if (!res.ok) { setRenameLoading(false); showToast('Fejl ved hentning'); return }

    const products: Array<{ id: string; canonical_name: string; brand_name: string }> = await res.json()

    // Apply auto-rename and only show rows where the name would change
    const changed: RenameRow[] = []
    for (const p of products) {
      const cleaned = cleanProductName(p.canonical_name, p.brand_name)
      if (cleaned !== p.canonical_name) {
        changed.push({ id: p.id, before: p.canonical_name, after: cleaned, brandName: p.brand_name })
      }
    }
    // Sort by brand then name
    changed.sort((a, b) => a.brandName.localeCompare(b.brandName) || a.before.localeCompare(b.before))
    setRenameRows(changed)
    setRenameLoading(false)
  }

  function updateRenameRow(id: string, value: string) {
    setRenameRows(prev => prev.map(r => r.id === id ? { ...r, after: value } : r))
  }

  function removeRenameRow(id: string) {
    setRenameRows(prev => prev.filter(r => r.id !== id))
  }

  async function saveAllRenames() {
    const toRename = renameRows.filter(r => r.after.trim() && r.after !== r.before)
    if (toRename.length === 0) { showToast('Ingen ændringer'); return }

    setRenameSaving(true)
    const res = await fetch('/api/admin/suggestions/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        renames: toRename.map(r => ({ id: r.id, canonical_name: r.after.trim() })),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      showToast(`${data.updated} produkter omdøbt`)
      setShowRename(false)
    } else {
      showToast('Fejl ved gemning')
    }
    setRenameSaving(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const cardStyle = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">KG Forslag</h1>

      {/* Tabs + Rens navne button */}
      <div className="flex gap-1 items-center">
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
        <div className="flex-1" />
        {tab === 'approved' && (
          <button
            onClick={openRenameModal}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            Rens navne
          </button>
        )}
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

      {/* Rename modal */}
      {showRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div
            className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h2 className="text-base font-bold text-foreground">Rens produktnavne</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {renameRows.length} produkter med foreslåede ændringer
                </p>
              </div>
              <button
                onClick={() => setShowRename(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {renameLoading ? (
                <div className="flex flex-col gap-2 p-6">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : renameRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  Alle produktnavne er allerede rene.
                </p>
              ) : (
                <div className="flex flex-col">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_1fr_36px] gap-3 px-6 py-2 text-xs font-bold text-muted-foreground border-b" style={{ borderColor: 'var(--border)' }}>
                    <span>Før</span>
                    <span>Efter</span>
                    <span />
                  </div>

                  {renameRows.map(r => (
                    <div
                      key={r.id}
                      className="grid grid-cols-[1fr_1fr_36px] gap-3 px-6 py-2 items-center border-b"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span className="text-xs text-muted-foreground truncate" title={r.before}>
                        {r.before}
                      </span>
                      <input
                        value={r.after}
                        onChange={e => updateRenameRow(r.id, e.target.value)}
                        className="text-xs font-medium rounded-lg px-2 py-1.5 outline-none w-full"
                        style={{
                          backgroundColor: 'var(--secondary)',
                          border: '1px solid var(--border)',
                          color: 'var(--foreground)',
                        }}
                      />
                      <button
                        onClick={() => removeRenameRow(r.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Fjern fra liste"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {renameRows.length > 0 && !renameLoading && (
              <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => setShowRename(false)}
                  className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                >
                  Annuller
                </button>
                <button
                  onClick={saveAllRenames}
                  disabled={renameSaving}
                  className="text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  {renameSaving ? 'Gemmer…' : `Gem alle (${renameRows.filter(r => r.after.trim() && r.after !== r.before).length})`}
                </button>
              </div>
            )}
          </div>
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
