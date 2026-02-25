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

export default function WatchlistsPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [watchlists,   setWatchlists]   = useState<Watchlist[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showCreator,  setShowCreator]  = useState(false)
  const [toast,        setToast]        = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void loadWatchlists()
    void syncOnboarding()
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
            <h1 className="text-2xl font-bold text-text mb-6">{t.watchlists}</h1>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-2xl bg-surface border border-white/10"
                    style={{ aspectRatio: '4/3' }}
                  />
                ))}
              </div>
            ) : watchlists.length === 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
                  <AddWatchlistCard onOpen={() => setShowCreator(true)} />
                </div>
                <div className="flex flex-col items-center gap-3 text-center py-8">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '56px', color: 'var(--color-primary)', opacity: 0.4 }}
                  >
                    travel_explore
                  </span>
                  <p className="text-base font-semibold text-text">{t.emptyStateHeading}</p>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{t.emptyStateSubtext}</p>
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

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50"
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-bg)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
