'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Watchlist } from '@/lib/supabase'
import { WatchlistBentoCard } from '@/components/WatchlistBentoCard'
import { AddWatchlistCard } from '@/components/AddWatchlistCard'
import { SideNav } from '@/components/SideNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { loadOnboarding, clearOnboarding, fireEvent } from '@/lib/onboarding'

export default function WatchlistsPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [loading, setLoading] = useState(true)

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

  function handleEdit(id: string) {
    router.push(`/watchlists/${id}/edit`)
  }

  return (
    <div className="min-h-screen bg-bg md:flex">
      <SideNav active={'hjem'} onChange={() => router.push('/')} />

      <div className="flex-1 flex flex-col md:ml-60">
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
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {watchlists.map((w) => (
                <WatchlistBentoCard key={w.id} watchlist={w} onEdit={handleEdit} />
              ))}
              <AddWatchlistCard />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
