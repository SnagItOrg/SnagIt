'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Watchlist } from '@/lib/supabase'
import { WatchlistBentoCard } from '@/components/WatchlistBentoCard'
import { AddWatchlistCard } from '@/components/AddWatchlistCard'
import { SideNav } from '@/components/SideNav'
import { useLocale } from '@/components/LocaleProvider'

export default function WatchlistsPage() {
  const router = useRouter()
  useLocale()
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/watchlists')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Watchlist[]) => {
        setWatchlists(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleEdit(id: string) {
    router.push(`/watchlists/${id}/edit`)
  }

  return (
    <div className="min-h-screen bg-bg md:flex">
      {/* Sidebar */}
      <SideNav active={'hjem'} onChange={() => router.push('/')} />

      {/* Main content */}
      <div className="flex-1 flex flex-col md:ml-60">
        <main className="flex-1 px-4 pt-6 pb-10 md:px-8 md:pt-8">
          <h1 className="text-2xl font-bold text-text mb-6">Dine Watchlists</h1>

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
