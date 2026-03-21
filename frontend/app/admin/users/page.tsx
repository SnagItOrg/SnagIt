'use client'

import { useEffect, useState } from 'react'

type User = {
  id: string
  email: string | null
  created_at: string
  watchlist_count: number
  saved_count: number
}

type UserDetail = {
  watchlists: Array<{ id: string; query: string; max_price: number | null; created_at: string; active: boolean }>
  saved: Array<{ listing_id: string; listing_data: { title: string; price: number | null; source: string }; created_at: string }>
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/users')
      .then(r => r.json())
      .then((data: User[]) => setUsers(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function selectUser(id: string) {
    if (selectedId === id) { setSelectedId(null); return }
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    const res = await fetch(`/api/admin/users/${id}`)
    if (res.ok) setDetail(await res.json())
    setDetailLoading(false)
  }

  async function handleDelete(id: string, email: string | null) {
    if (!confirm(`Slet bruger ${email ?? id}? Denne handling kan ikke fortrydes.`)) return
    setActionLoading(id)
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setUsers(u => u.filter(x => x.id !== id))
      if (selectedId === id) setSelectedId(null)
      showToast('Bruger slettet')
    } else {
      showToast('Fejl ved sletning')
    }
    setActionLoading(null)
  }

  async function handleResetPassword(id: string) {
    setActionLoading(id)
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset-password' }),
    })
    if (res.ok) showToast('Reset-link sendt')
    else showToast('Fejl ved afsendelse')
    setActionLoading(null)
  }

  const cardStyle = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">Brugere ({users.length})</h1>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {users.map(u => (
            <div key={u.id}>
              <button
                onClick={() => selectUser(u.id)}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-colors hover:bg-secondary"
                style={selectedId === u.id ? { ...cardStyle } : {}}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{u.email ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString('da-DK')}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                  <span>{u.watchlist_count} overvågninger</span>
                  <span>{u.saved_count} gemte</span>
                </div>
                <span
                  className="material-symbols-outlined text-muted-foreground transition-transform"
                  style={{ fontSize: '18px', transform: selectedId === u.id ? 'rotate(180deg)' : 'none' }}
                >
                  expand_more
                </span>
              </button>

              {selectedId === u.id && (
                <div className="ml-4 mt-1 mb-3 rounded-xl p-4 flex flex-col gap-4" style={cardStyle}>
                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResetPassword(u.id)}
                      disabled={actionLoading === u.id}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                      style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                    >
                      Send reset-link
                    </button>
                    <button
                      onClick={() => handleDelete(u.id, u.email)}
                      disabled={actionLoading === u.id}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                      style={{ backgroundColor: 'var(--destructive, #dc2626)', color: 'white' }}
                    >
                      Slet bruger
                    </button>
                  </div>

                  {detailLoading ? (
                    <div className="h-20 rounded-lg bg-muted animate-pulse" />
                  ) : detail ? (
                    <>
                      {/* Watchlists */}
                      <div>
                        <p className="text-xs font-bold text-muted-foreground mb-2">
                          Overvågninger ({detail.watchlists.length})
                        </p>
                        {detail.watchlists.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Ingen</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {detail.watchlists.map(w => (
                              <div key={w.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--secondary)' }}>
                                <span className="text-foreground font-medium truncate flex-1">{w.query}</span>
                                {w.max_price != null && (
                                  <span className="text-muted-foreground">maks {w.max_price.toLocaleString('da-DK')} kr</span>
                                )}
                                {!w.active && (
                                  <span className="text-muted-foreground italic">inaktiv</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Saved */}
                      <div>
                        <p className="text-xs font-bold text-muted-foreground mb-2">
                          Gemte annoncer ({detail.saved.length})
                        </p>
                        {detail.saved.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Ingen</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {detail.saved.slice(0, 20).map(s => (
                              <div key={s.listing_id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--secondary)' }}>
                                <span className="text-foreground font-medium truncate flex-1">
                                  {s.listing_data?.title ?? s.listing_id}
                                </span>
                                {s.listing_data?.price != null && (
                                  <span className="text-muted-foreground">
                                    {s.listing_data.price.toLocaleString('da-DK')} kr
                                  </span>
                                )}
                                <span className="text-muted-foreground">{s.listing_data?.source}</span>
                              </div>
                            ))}
                            {detail.saved.length > 20 && (
                              <p className="text-xs text-muted-foreground">+{detail.saved.length - 20} mere</p>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ))}
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
