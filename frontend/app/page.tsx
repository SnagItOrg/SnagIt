'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Listing, Watchlist } from '@/lib/supabase'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { isDbaListingUrl } from '@/lib/scrapers/dba-listing'
import { ListingCard } from '@/components/ListingCard'
import { WatchlistCard } from '@/components/WatchlistCard'
import { BottomNav, type NavTab } from '@/components/BottomNav'

export default function Home() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<NavTab>('hjem')

  // Manual search
  const [query, setQuery] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)

  // Watchlists
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [watchlistQuery, setWatchlistQuery] = useState('')
  const [watchlistsLoading, setWatchlistsLoading] = useState(true)
  const [addingWatchlist, setAddingWatchlist] = useState(false)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)

  useEffect(() => { loadWatchlists() }, [])

  async function loadWatchlists() {
    setWatchlistsLoading(true)
    const res = await fetch('/api/watchlists')
    if (res.ok) setWatchlists(await res.json())
    setWatchlistsLoading(false)
  }

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearchStatus('loading')
    setSearchError(null)
    setListings([])

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Søgning mislykkedes')
      setListings(data.listings ?? [])
      setSearchStatus('done')
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Ukendt fejl')
      setSearchStatus('error')
    }
  }

  async function handleAddWatchlist(e: React.FormEvent) {
    e.preventDefault()
    if (!watchlistQuery.trim()) return
    setAddingWatchlist(true)
    setWatchlistError(null)

    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: watchlistQuery.trim() }),
    })
    const data = await res.json()

    if (!res.ok) {
      setWatchlistError(data.error ?? 'Kunne ikke tilføje overvågning')
    } else {
      setWatchlists((prev) => [data, ...prev])
      setWatchlistQuery('')
    }
    setAddingWatchlist(false)
  }

  async function handleDeleteWatchlist(id: string) {
    await fetch(`/api/watchlists/${id}`, { method: 'DELETE' })
    setWatchlists((prev) => prev.filter((w) => w.id !== id))
  }

  const inputIsUrl = isDbaListingUrl(watchlistQuery)

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-4 border-b border-white/10"
        style={{ backgroundColor: 'var(--color-dark-bg)' }}
      >
        <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--color-primary)' }}>
          Klup
        </span>
        <button
          onClick={handleLogout}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          Log ud
        </button>
      </header>

      {/* Content — leave room for bottom nav (72px) */}
      <main className="flex-1 pb-[88px]">

        {/* ── Hjem / Overvågninger ── */}
        {(activeTab === 'hjem' || activeTab === 'overvaagninger') && (
          <section className="max-w-xl mx-auto px-4 pt-5 flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-text mb-0.5">Overvågninger</h2>
              <p className="text-xs text-text-muted">
                Vi tjekker dba.dk hvert 10. minut og sender dig en email ved nye annoncer.
              </p>
            </div>

            {/* Add form */}
            <form onSubmit={handleAddWatchlist} className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={watchlistQuery}
                  onChange={(e) => setWatchlistQuery(e.target.value)}
                  placeholder="Søg eller indsæt link fra dba.dk"
                  className="flex-1 rounded-xl border border-gray-200 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                />
                <button
                  type="submit"
                  disabled={addingWatchlist}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] glow-primary disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-dark-bg)' }}
                >
                  {addingWatchlist ? '…' : 'Tilføj'}
                </button>
              </div>

              {watchlistQuery && (
                <p className="text-xs text-text-muted pl-1">
                  {inputIsUrl
                    ? '🔗 Vi overvåger denne annonce for ændringer'
                    : '🔍 Vi søger efter nye annoncer med dette søgeord'}
                </p>
              )}

              {watchlistError && (
                <p className="text-xs text-red-500 pl-1">{watchlistError}</p>
              )}
            </form>

            {/* Watchlist items */}
            {watchlistsLoading ? (
              <p className="text-xs text-text-muted text-center py-6">Henter...</p>
            ) : watchlists.length === 0 ? (
              <div className="rounded-2xl bg-surface border border-gray-100 px-4 py-8 text-center">
                <p className="text-sm text-text-muted">Ingen overvågninger endnu.</p>
                <p className="text-xs text-text-muted mt-1">Tilføj en søgning ovenfor for at komme i gang.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {watchlists.map((w) => (
                  <WatchlistCard key={w.id} watchlist={w} onDelete={handleDeleteWatchlist} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Søg ── */}
        {activeTab === 'soeg' && (
          <section className="max-w-xl mx-auto px-4 pt-5 flex flex-col gap-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Søg efter alt… (f.eks. iphone, sofa, cykel)"
                autoFocus
                className="flex-1 rounded-xl border border-gray-200 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
              />
              <button
                type="submit"
                disabled={searchStatus === 'loading'}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] glow-primary disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-dark-bg)' }}
              >
                {searchStatus === 'loading' ? '…' : 'Søg'}
              </button>
            </form>

            {searchStatus === 'loading' && (
              <p className="text-center text-sm text-text-muted py-12">Henter annoncer fra dba.dk…</p>
            )}

            {searchStatus === 'error' && (
              <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                {searchError}
              </div>
            )}

            {searchStatus === 'done' && listings.length === 0 && (
              <p className="text-center text-sm text-text-muted py-12">
                Ingen annoncer fundet for &ldquo;{query}&rdquo;
              </p>
            )}

            {searchStatus === 'done' && listings.length > 0 && (
              <>
                <p className="text-xs text-text-muted">
                  {listings.length} resultater for &ldquo;{query}&rdquo;
                </p>
                <div className="flex flex-col gap-2">
                  {listings.map((l) => <ListingCard key={l.id} listing={l} />)}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Gemt / Profil (placeholder) ── */}
        {(activeTab === 'gemt' || activeTab === 'profil') && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
            <p className="text-2xl mb-2">🚧</p>
            <p className="text-sm font-medium text-text">Kommer snart</p>
            <p className="text-xs text-text-muted mt-1">Denne funktion er ikke klar endnu.</p>
          </div>
        )}
      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  )
}
