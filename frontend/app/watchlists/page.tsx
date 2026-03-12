'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Watchlist } from '@/lib/supabase'
import { WatchlistBentoCard } from '@/components/WatchlistBentoCard'
import { AddWatchlistCard } from '@/components/AddWatchlistCard'
import { WatchlistCreatorPanel } from '@/components/WatchlistCreatorPanel'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { loadOnboarding, clearOnboarding, fireEvent } from '@/lib/onboarding'
import { Toast } from '@/components/Toast'

export default function WatchlistsPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [authed,       setAuthed]       = useState<boolean | null>(null)
  const [watchlists,   setWatchlists]   = useState<Watchlist[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showCreator,  setShowCreator]  = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      const loggedIn = !!data.user
      setAuthed(loggedIn)
      if (loggedIn) {
        void loadWatchlists()
        void syncOnboarding()
        void createPendingWatchlist()
      } else {
        setLoading(false)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadWatchlists() {
    setLoading(true)
    const res = await fetch('/api/watchlists')
    if (res.ok) setWatchlists(await res.json())
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // Sync onboarding data saved anonymously before sign-up.
  async function syncOnboarding() {
    const saved = loadOnboarding()
    if (!saved.query && !saved.categories?.length && !saved.brands?.length) return

    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    try {
      await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: saved.categories ?? [],
          brands: saved.brands ?? [],
          onboarding_completed: true,
        }),
      })
      if (saved.query) {
        const res = await fetch('/api/watchlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: saved.query,
            ...(saved.min_price && saved.min_price > 0 ? { min_price: saved.min_price } : {}),
            ...(saved.max_price && saved.max_price > 0 ? { max_price: saved.max_price } : {}),
          }),
        })
        if (res.ok) {
          const created = await res.json()
          setWatchlists((prev) => [created, ...prev])
        }
      }
      fireEvent('onboarding_complete', { method: 'email' })
      clearOnboarding()
    } catch (err) {
      console.error('[onboarding sync] error:', err)
    }
  }

  async function createPendingWatchlist() {
    const raw = localStorage.getItem('pending_watchlist')
    if (!raw) return
    try {
      const { query, max_price } = JSON.parse(raw) as { query: string; max_price: number | null }
      if (!query) return
      const body: Record<string, unknown> = { query }
      if (max_price != null && max_price > 0) body.max_price = max_price
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const created = await res.json()
        setWatchlists((prev) => [created, ...prev])
        showToast(t.watchlistCreated)
      }
    } catch {
      // ignore — pending intent will be cleaned up regardless
    } finally {
      localStorage.removeItem('pending_watchlist')
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/watchlists/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setWatchlists((prev) => prev.filter((w) => w.id !== id))
      showToast(t.watchlistDeleted)
    }
  }

  return (
    <div className="min-h-screen bg-bg md:flex">
      <SideNav active={'hjem'} onChange={() => router.push('/')} />

      <div className="flex-1 flex flex-col md:ml-60">
        {showCreator ? (
          <WatchlistCreatorPanel
            onSave={(w) => { setWatchlists((prev) => [w, ...prev]); setShowCreator(false) }}
            onClose={() => setShowCreator(false)}
          />
        ) : (
          <main className="flex-1 px-4 pt-6 pb-10 md:px-8 md:pt-8">
            <h1 className="text-2xl font-bold text-foreground mb-6">{t.watchlists}</h1>

            {loading ? (
              /* Skeleton — shown while auth resolves and while watchlists load */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-2xl bg-card border border-border"
                    style={{ aspectRatio: '4/3' }}
                  />
                ))}
              </div>
            ) : authed === false ? (
              /* Teaser for unauthenticated visitors */
              <div className="w-full max-w-sm mx-auto flex flex-col gap-4">
                {/* Blurred card — visible above CTA */}
                <div className="pointer-events-none select-none opacity-60" style={{ filter: 'blur(3px)' }}>
                  <FakeWatchlistCard />
                </div>

                {/* CTA section below — not an overlay */}
                <div
                  className="rounded-2xl p-6 flex flex-col gap-3 text-center"
                  style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
                >
                  <h2 className="text-xl font-black text-foreground">{t.watchlistTeaserHeading}</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t.watchlistTeaserSubtext}
                  </p>
                  <button
                    onClick={() => router.push('/login')}
                    className="w-full rounded-2xl py-4 px-8 font-black text-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                  >
                    {t.watchlistTeaserCta}
                  </button>
                </div>
              </div>
            ) : watchlists.length === 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
                  <AddWatchlistCard onOpen={() => setShowCreator(true)} />
                </div>
                <div className="flex flex-col items-center gap-3 text-center py-8">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '56px', color: 'var(--muted-foreground)', opacity: 0.6 }}
                  >
                    travel_explore
                  </span>
                  <p className="text-base font-semibold text-foreground">{t.emptyStateHeading}</p>
                  <p className="text-sm text-muted-foreground">{t.emptyStateSubtext}</p>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <AddWatchlistCard onOpen={() => setShowCreator(true)} />
                {watchlists.map((w) => (
                  <WatchlistBentoCard key={w.id} watchlist={w} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </main>
        )}
      </div>

      <BottomNav />

      {toast && <Toast message={toast} />}
    </div>
  )
}

function FakeWatchlistCard() {
  return (
    <div
      className="relative flex flex-col rounded-2xl border border-border/60 bg-card"
      style={{ aspectRatio: '4/3' }}
    >
      {/* Image area */}
      <div className="relative flex-1 overflow-hidden rounded-t-2xl" style={{ backgroundColor: 'var(--card)' }}>
        <div className="w-full h-full flex items-center justify-center">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: '56px', color: 'var(--muted-foreground)' }}
          >
            piano
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2 border-t border-border/40">
        <p className="text-sm font-bold text-foreground truncate mb-1.5">Roland Jupiter-8</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-xs font-black px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--secondary-foreground)' }}
          >
            +2 NYE
          </span>
          <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Max 18.000 kr
          </span>
          <span className="text-xs text-muted-foreground">dba.dk</span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80' }}
          >
            🟢 Godt kup
          </span>
        </div>
      </div>
    </div>
  )
}
