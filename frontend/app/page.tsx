'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Listing, Watchlist } from '@/lib/supabase'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { isDbaListingUrl } from '@/lib/scrapers/dba-listing'
import { ListingCard } from '@/components/ListingCard'
import { WatchlistCard } from '@/components/WatchlistCard'
import { WatchlistListings } from '@/components/WatchlistListings'
import { BottomNav, type NavTab } from '@/components/BottomNav'
import { SideNav } from '@/components/SideNav'
import { useLocale } from '@/components/LocaleProvider'
import type { Locale } from '@/lib/i18n'

export default function Home() {
  const router = useRouter()
  const { locale, setLocale, t } = useLocale()
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
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
      if (!res.ok) throw new Error(data.error ?? t.searchFailed)
      setListings(data.listings ?? [])
      setSearchStatus('done')
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : t.unknownError)
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
      setWatchlistError(data.error ?? t.addWatchlistError)
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
    <div className="min-h-screen bg-bg md:flex">
      {/* Desktop sidebar — hidden on mobile */}
      <SideNav active={activeTab} onChange={setActiveTab} />

      {/* Main content */}
      <div className="flex-1 flex flex-col md:ml-60">
        {/* Mobile header — hidden on md+ */}
        <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-4 border-b border-white/10 bg-bg">
          <span className="text-lg font-bold tracking-tight text-primary">Klup</span>
          <div className="flex items-center gap-1">
            {/* Language toggle */}
            {(['da', 'en'] as Locale[]).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className="text-xs font-medium px-2 py-1 rounded-md transition-colors"
                style={{
                  color: locale === l ? 'var(--color-primary)' : 'rgba(255,255,255,0.4)',
                  backgroundColor: locale === l ? 'rgba(19,236,109,0.1)' : 'transparent',
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
            <button
              onClick={handleLogout}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-text-muted hover:text-text ml-1"
            >
              {t.logout}
            </button>
          </div>
        </header>

        {/* Page content — bottom padding for mobile nav, none on desktop */}
        <main className="flex-1 pb-[88px] md:pb-8">

          {/* ── Hjem / Overvågninger ── */}
          {(activeTab === 'hjem' || activeTab === 'overvaagninger') && (
            <section className="max-w-md mx-auto px-4 pt-5 flex flex-col gap-4 md:max-w-2xl lg:max-w-4xl">
              <div>
                <h2 className="text-base font-semibold text-text mb-0.5">{t.watchlists}</h2>
                <p className="text-xs text-text-muted">{t.watchlistsDescription}</p>
              </div>

              {/* Add form */}
              <form onSubmit={handleAddWatchlist} className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={watchlistQuery}
                    onChange={(e) => setWatchlistQuery(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="flex-1 rounded-xl border border-white/10 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                  />
                  <button
                    type="submit"
                    disabled={addingWatchlist}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] glow-primary disabled:opacity-60 disabled:cursor-not-allowed bg-primary"
                    style={{ color: 'var(--color-bg)' }}
                  >
                    {addingWatchlist ? '…' : t.add}
                  </button>
                </div>

                {watchlistQuery && (
                  <p className="text-xs text-text-muted pl-1">
                    {inputIsUrl ? t.monitoringListing : t.monitoringSearch}
                  </p>
                )}

                {watchlistError && (
                  <p className="text-xs text-red-400 pl-1">{watchlistError}</p>
                )}
              </form>

              {/* Watchlist items */}
              {watchlistsLoading ? (
                <div className="flex flex-col gap-2 md:grid md:grid-cols-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="animate-pulse rounded-2xl bg-surface border border-white/10 h-[72px]" />
                  ))}
                </div>
              ) : watchlists.length === 0 ? (
                <div className="rounded-2xl bg-surface border border-white/10 px-4 py-8 text-center">
                  <p className="text-sm text-text-muted">{t.noWatchlists}</p>
                  <p className="text-xs text-text-muted mt-1">{t.noWatchlistsHint}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 md:grid md:grid-cols-2">
                  {watchlists.map((w) => (
                    <div key={w.id} className="flex flex-col">
                      <WatchlistCard
                        watchlist={w}
                        onDelete={handleDeleteWatchlist}
                        onExpand={() => setExpandedId(expandedId === w.id ? null : w.id)}
                        isExpanded={expandedId === w.id}
                      />
                      {expandedId === w.id && <WatchlistListings watchlistId={w.id} />}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── Søg ── */}
          {activeTab === 'soeg' && (
            <section className="max-w-md mx-auto px-4 pt-5 flex flex-col gap-4 md:max-w-2xl lg:max-w-4xl">
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.searchInputPlaceholder}
                  autoFocus
                  className="flex-1 rounded-xl border border-white/10 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                />
                <button
                  type="submit"
                  disabled={searchStatus === 'loading'}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97] glow-primary disabled:opacity-60 bg-primary"
                  style={{ color: 'var(--color-bg)' }}
                >
                  {searchStatus === 'loading' ? '…' : t.search}
                </button>
              </form>

              {searchStatus === 'loading' && (
                <p className="text-center text-sm text-text-muted py-12">{t.fetchingListings}</p>
              )}

              {searchStatus === 'error' && (
                <div className="rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                  {searchError}
                </div>
              )}

              {searchStatus === 'done' && listings.length === 0 && (
                <p className="text-center text-sm text-text-muted py-12">
                  {t.noListingsFound} &ldquo;{query}&rdquo;
                </p>
              )}

              {searchStatus === 'done' && listings.length > 0 && (
                <>
                  <p className="text-xs text-text-muted">
                    {listings.length} {t.resultsFor} &ldquo;{query}&rdquo;
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
              <p className="text-sm font-medium text-text">{t.comingSoon}</p>
              <p className="text-xs text-text-muted mt-1">{t.comingSoonHint}</p>
            </div>
          )}
        </main>

        {/* Bottom nav — mobile only */}
        <BottomNav active={activeTab} onChange={setActiveTab} />
      </div>
    </div>
  )
}
