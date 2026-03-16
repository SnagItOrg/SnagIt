'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

type NotifPrefs = {
  email_enabled: boolean
  push_enabled:  boolean
  price_drops:   boolean
  new_listings:  boolean
}

type Watchlist = {
  id:        string
  query:     string
  max_price: number | null
}

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      className="relative flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        width: '44px',
        height: '26px',
        backgroundColor: on ? 'var(--primary)' : 'var(--border)',
      }}
    >
      <span
        className="absolute top-[3px] rounded-full bg-white shadow transition-all duration-200"
        style={{
          width: '20px',
          height: '20px',
          left: on ? '21px' : '3px',
        }}
      />
    </button>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const { t } = useLocale()

  const [email,         setEmail]         = useState<string | null>(null)
  const [prefs,         setPrefs]         = useState<NotifPrefs | null>(null)
  const [watchlists,    setWatchlists]    = useState<Watchlist[]>([])
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [resetSent,     setResetSent]     = useState(false)
  const [resetLoading,  setResetLoading]  = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      setEmail(data.user.email ?? null)
    })

    fetch('/api/notification-preferences')
      .then((r) => r.ok ? r.json() : null)
      .then((data: NotifPrefs | null) => { if (data) setPrefs(data) })
      .catch(() => {})

    fetch('/api/watchlists')
      .then((r) => r.ok ? r.json() : [])
      .then((data: Watchlist[]) => setWatchlists(data))
      .catch(() => {})
  }, [router])

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleToggle(key: keyof NotifPrefs) {
    if (!prefs) return
    const updated = { ...prefs, [key]: !prefs[key] }
    setPrefs(updated)
    await fetch('/api/notification-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: updated[key] }),
    })
  }

  async function handleResetPassword() {
    if (!email) return
    setResetLoading(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/auth/confirm',
    })
    setResetLoading(false)
    setResetSent(true)
  }

  async function handleDeleteWatchlist(id: string) {
    const prev = watchlists
    setWatchlists((w) => w.filter((x) => x.id !== id))
    setDeleting(id)
    const res = await fetch(`/api/watchlists/${id}`, { method: 'DELETE' })
    if (!res.ok) setWatchlists(prev)
    setDeleting(null)
  }

  const cardClass = "rounded-2xl p-6 flex flex-col gap-4"
  const cardStyle = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <div className="min-h-screen bg-bg text-foreground flex">
      <SideNav active="profil" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col px-4 pt-6 pb-24 md:pb-10 md:px-8">
        <div className="w-full max-w-2xl flex flex-col gap-5">

          {/* ── Section 1: Account ─────────────────────────────────────── */}
          <div className={cardClass} style={cardStyle}>
            <div className="flex items-center gap-3">
              <span
                className="material-symbols-outlined flex-shrink-0"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)' }}
              >
                account_circle
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="text-xs text-muted-foreground">{t.email}</p>
                <p className="text-sm font-semibold text-foreground truncate">{email ?? '—'}</p>
              </div>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border)' }} />

            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-sm font-medium w-fit transition-opacity hover:opacity-70"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {t.signOut}
            </button>
          </div>

          {/* ── Section 2: Password ───────────────────────────────────── */}
          <div className={cardClass} style={cardStyle}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--foreground)' }}>
                lock
              </span>
              <h2 className="text-base font-bold text-foreground">{t.changePassword}</h2>
            </div>

            {resetSent ? (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {t.resetLinkSent}{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{email}</span>
              </p>
            ) : (
              <button
                onClick={handleResetPassword}
                disabled={resetLoading}
                className="flex items-center gap-2 text-sm font-medium w-fit transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
                {resetLoading ? '…' : t.sendResetLink}
              </button>
            )}
          </div>

          {/* ── Section 3: Notifications ───────────────────────────────── */}
          <div className={cardClass} style={cardStyle}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--foreground)' }}>
                notifications
              </span>
              <h2 className="text-base font-bold text-foreground">Notifikationer</h2>
            </div>

            {prefs === null ? (
              <div className="flex flex-col gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="flex flex-col gap-1">
                      <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                      <div className="h-2.5 w-48 rounded bg-muted animate-pulse" />
                    </div>
                    <div className="w-11 h-6 rounded-full bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {([
                  { key: 'email_enabled' as const, label: 'Email notifikationer',  desc: 'Modtag emails om nye deals og prisfald' },
                  { key: 'push_enabled'  as const, label: 'Push notifikationer',   desc: 'Modtag push beskeder i browseren', disabled: true },
                  { key: 'price_drops'   as const, label: 'Prisfald',              desc: 'Få besked når prisen falder på gemte produkter' },
                  { key: 'new_listings'  as const, label: 'Nye annoncer',          desc: 'Få besked om nye annoncer der matcher dine søgninger' },
                ] as { key: keyof NotifPrefs; label: string; desc: string; disabled?: boolean }[]).map(({ key, label, desc, disabled }) => (
                  <div key={key}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {label}
                          {disabled && <span className="ml-2 text-xs text-muted-foreground italic">kommer snart</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{desc}</span>
                      </div>
                      <Toggle on={prefs[key]} onToggle={() => handleToggle(key)} disabled={disabled} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 4: Watchlists ──────────────────────────────────── */}
          <div className={cardClass} style={cardStyle}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--foreground)' }}>
                notifications_active
              </span>
              <h2 className="text-base font-bold text-foreground">{t.watchlists}</h2>
            </div>

            {watchlists.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-sm text-muted-foreground">Ingen overvågninger endnu.</p>
                <Link
                  href="/search"
                  className="text-sm font-semibold transition-opacity hover:opacity-70"
                  style={{ color: 'var(--foreground)' }}
                >
                  {t.goToSearch}
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {watchlists.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
                    style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{w.query}</p>
                      {w.max_price != null && (
                        <p className="text-xs text-muted-foreground">
                          maks {w.max_price.toLocaleString('da-DK')} kr
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteWatchlist(w.id)}
                      disabled={deleting === w.id}
                      className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-30"
                      aria-label="Slet overvågning"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted-foreground)' }}>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>

      <BottomNav />
    </div>
  )
}
