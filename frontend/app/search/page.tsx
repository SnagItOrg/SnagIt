'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Listing } from '@/lib/supabase'
import { SearchResultCard } from '@/components/SearchResultCard'
import { CreateWatchlistModal } from '@/components/CreateWatchlistModal'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { platformList } from '@/lib/platforms'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'

type SortKey = 'relevance' | 'newest' | 'oldest' | 'price_asc' | 'price_desc'

function sortListings(listings: Listing[], sort: SortKey): Listing[] {
  const copy = [...listings]
  if (sort === 'relevance') return copy // preserve server interleave order
  if (sort === 'price_asc') {
    return copy.sort((a, b) => {
      if (a.price == null && b.price == null) return 0
      if (a.price == null) return 1
      if (b.price == null) return -1
      return a.price - b.price
    })
  }
  if (sort === 'price_desc') {
    return copy.sort((a, b) => {
      if (a.price == null && b.price == null) return 0
      if (a.price == null) return 1
      if (b.price == null) return -1
      return b.price - a.price
    })
  }
  if (sort === 'oldest') {
    return copy.sort((a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime())
  }
  return copy.sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime())
}

function SearchPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { t, locale } = useLocale()

  const [inputValue,   setInputValue]   = useState(() => params.get('q') ?? '')
  const [sort,         setSort]         = useState<SortKey>('relevance')
  const [listings,     setListings]     = useState<Listing[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [searched,     setSearched]     = useState(false)
  const [creating,             setCreating]             = useState(false)
  const [toast,                setToast]                = useState<string | null>(null)
  const [showWatchlistModal,   setShowWatchlistModal]   = useState(false)
  const [watchlistModalQuery,  setWatchlistModalQuery]  = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [showFilters,      setShowFilters]      = useState(false)
  const [savedListingIds,  setSavedListingIds]  = useState<Set<string>>(new Set())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  async function runSearch(query: string) {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setSearched(true)

    try {
      const res = await fetch(`/api/scrape?q=${encodeURIComponent(q)}`)
      if (!res.ok) {
        setError(t.searchFailed)
        setListings([])
      } else {
        const data = await res.json()
        const results: Listing[] = data.listings ?? []
        setListings(results)
        setSelectedPlatform(null)
      }
    } catch {
      setError(t.unknownError)
      setListings([])
    }
    setLoading(false)
  }

  // Fire on mount: search if ?q= present + load saved listing ids
  useEffect(() => {
    const q = params.get('q')
    if (q) void runSearch(q)

    fetch('/api/saved-listings')
      .then((r) => r.ok ? r.json() : [])
      .then((rows: { listing_id: string }[]) => {
        setSavedListingIds(new Set(rows.map((r) => r.listing_id)))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const q = inputValue.trim()
    if (!q) return
    router.replace(`/search?q=${encodeURIComponent(q)}`)
    void runSearch(q)
  }

  async function handleCreateWatchlist(listingTitle?: string) {
    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    let q: string
    if (listingTitle) {
      q = listingTitle.length > 60
        ? (listingTitle.lastIndexOf(' ', 60) > 0
            ? listingTitle.slice(0, listingTitle.lastIndexOf(' ', 60))
            : listingTitle.slice(0, 60))
        : listingTitle
    } else {
      q = inputValue.trim() || (params.get('q') ?? '')
    }
    setWatchlistModalQuery(q)
    setShowWatchlistModal(true)
  }

  async function handleModalConfirm(query: string, modalMaxPrice?: number) {
    setCreating(true)
    const body: Record<string, unknown> = { query }
    if (modalMaxPrice != null && modalMaxPrice > 0) body.max_price = modalMaxPrice

    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      setShowWatchlistModal(false)
      showToast(t.watchlistCreated)
    } else {
      const data = await res.json()
      showToast(data.error ?? t.addWatchlistError)
    }
    setCreating(false)
  }

  async function handleToggleSave(listing: Listing) {
    const alreadySaved = savedListingIds.has(listing.id)
    const prev = new Set(savedListingIds)

    if (alreadySaved) {
      setSavedListingIds(new Set(Array.from(savedListingIds).filter((id) => id !== listing.id)))
      const res = await fetch('/api/saved-listings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listing.id }),
      })
      if (!res.ok) { setSavedListingIds(prev); return }
      showToast(t.listingUnsaved)
    } else {
      setSavedListingIds(new Set(Array.from(savedListingIds).concat(listing.id)))
      try {
        const res = await fetch('/api/saved-listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listing_id: listing.id, listing_data: listing }),
        })
        if (!res.ok) { setSavedListingIds(prev); return }
        showToast(t.listingSaved)
      } catch {
        setSavedListingIds(prev)
      }
    }
  }

  // Platforms present in current results
  function normalisePlatform(l: Listing): string {
    const p = l.platform ?? l.source ?? ''
    if (p === 'reverb') return 'reverb'
    if (p === 'facebook' || p === 'fb') return 'facebook'
    return 'dba'
  }
  const platformsInResults: string[] = listings.length > 0
    ? Array.from(new Set(listings.map(normalisePlatform)))
    : []

  const platformLabel: Record<string, string> = { reverb: 'Reverb', dba: 'DBA', facebook: 'Facebook' }

  // Client-side filter + sort
  const filtered = sortListings(
    listings.filter((l) => !selectedPlatform || normalisePlatform(l) === selectedPlatform),
    sort,
  )

  const currentQuery = params.get('q') ?? inputValue

  return (
    <div className="min-h-screen bg-bg md:flex">
      <SideNav active={'soeg'} onChange={() => {}} />

      <div className="flex-1 min-w-0 flex flex-col md:ml-60">
        {/* Page header */}
        <div className="px-4 pt-6 pb-2 md:px-8">
          <h1 className="text-xl font-black text-foreground">{t.searchPageHeading}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.searchPageSubtext.replace('{platforms}', platformList(locale))}</p>
        </div>

        {/* Sticky search bar */}
        <div className="sticky top-0 z-30 w-full bg-bg border-b border-border px-4 py-3 md:px-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            {/* Row 1: search input + filter toggle */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span
                  className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ fontSize: '18px', color: 'var(--muted-foreground)' }}
                >
                  search
                </span>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={t.searchInputPlaceholder}
                  className="w-full rounded-xl pl-9 pr-4 py-2.5 text-sm font-medium outline-none transition-all placeholder:opacity-40"
                  style={{
                    backgroundColor: 'var(--input-background)',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
                style={showFilters
                  ? { backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--foreground)' }
                  : { backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }
                }
                aria-label="Filtre"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>tune</span>
              </button>
            </div>

            {/* Expanded filter panel */}
            {showFilters && (
              <div className="flex gap-2 flex-wrap mt-1">
                {/* Platform select */}
                <div className="relative inline-flex items-center">
                  <select
                    value={selectedPlatform ?? ''}
                    onChange={(e) => setSelectedPlatform(e.target.value || null)}
                    className="appearance-none rounded-xl px-3 py-2 pr-8 text-sm outline-none cursor-pointer min-w-[140px]"
                    style={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    <option value="">Alle platforme</option>
                    {(platformsInResults.length > 0 ? platformsInResults : ['dba', 'reverb', 'facebook']).map((p) => (
                      <option key={p} value={p}>{platformLabel[p] ?? p}</option>
                    ))}
                  </select>
                  <span
                    className="material-symbols-outlined absolute right-2 pointer-events-none"
                    style={{ fontSize: '18px', color: 'var(--muted-foreground)' }}
                  >
                    expand_more
                  </span>
                </div>

                {/* Sort select */}
                <div className="relative inline-flex items-center">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="appearance-none rounded-xl px-3 py-2 pr-8 text-sm outline-none cursor-pointer min-w-[140px]"
                    style={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    <option value="relevance">Relevans</option>
                    <option value="newest">{t.sortNewest}</option>
                    <option value="oldest">Ældste først</option>
                    <option value="price_asc">{t.sortPriceLow}</option>
                    <option value="price_desc">{t.sortPriceHigh}</option>
                  </select>
                  <span
                    className="material-symbols-outlined absolute right-2 pointer-events-none"
                    style={{ fontSize: '18px', color: 'var(--muted-foreground)' }}
                  >
                    expand_more
                  </span>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Main content */}
        <main className="flex-1 px-4 pt-5 pb-10 md:px-8">
          {loading ? (
            <>
              <div className="h-4 w-40 rounded bg-muted animate-pulse mb-4" />
              <div className="flex flex-col gap-3">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="flex gap-3 p-3 rounded-2xl bg-card border border-border animate-pulse"
                    style={{ height: '104px' }}
                  >
                    <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-muted" />
                    <div className="flex-1 flex flex-col gap-2 py-1">
                      <div className="h-3 w-3/4 rounded bg-muted" />
                      <div className="h-4 w-1/3 rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : error ? (
            <div
              className="rounded-xl px-4 py-3 text-sm text-red-400 mt-4"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              {error}
            </div>
          ) : searched && filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)', opacity: 0.4 }}
              >
                search_off
              </span>
              <p className="text-sm text-muted-foreground">
                {t.noResults}
              </p>
            </div>
          ) : searched ? (
            <>
              {/* Result count + watchlist CTA */}
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <p className="text-sm text-muted-foreground">
                  {filtered.length} {t.resultsFor}{' '}
                  <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                    &ldquo;{currentQuery}&rdquo;
                  </span>
                </p>
                <button
                  onClick={() => handleCreateWatchlist()}
                  disabled={creating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--border)', color: 'var(--secondary-foreground)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>notifications</span>
                  {t.createWatchlist}
                </button>
              </div>

              {/* Mobile: list */}
              <div className="flex flex-col gap-3 md:hidden">
                {filtered.map((listing) => (
                  <ListingErrorBoundary key={listing.id} listingId={listing.id}>
                    <SearchResultCard
                      listing={listing}
                      onCreateWatchlist={handleCreateWatchlist}
                      creating={creating}

                      variant="list"
                      isSaved={savedListingIds.has(listing.id)}
                      onToggleSave={handleToggleSave}

                    />
                  </ListingErrorBoundary>
                ))}
              </div>

              {/* Desktop: 4-col grid */}
              <div className="hidden md:grid md:grid-cols-4 md:gap-4">
                {filtered.map((listing) => (
                  <ListingErrorBoundary key={listing.id} listingId={listing.id}>
                    <SearchResultCard
                      listing={listing}
                      onCreateWatchlist={handleCreateWatchlist}
                      creating={creating}

                      variant="grid"
                      isSaved={savedListingIds.has(listing.id)}
                      onToggleSave={handleToggleSave}

                    />
                  </ListingErrorBoundary>
                ))}
              </div>
            </>
          ) : (
            // Initial state: no search yet
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-sm mx-auto">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)', opacity: 0.4 }}
              >
                manage_search
              </span>
              <p className="text-base font-semibold text-foreground">{t.searchEmptyHeading}</p>
              <p className="text-sm text-muted-foreground">{t.searchEmptySubtext.replace('{platforms}', platformList(locale))}</p>
            </div>
          )}
        </main>
      </div>

      <BottomNav />

      <CreateWatchlistModal
        isOpen={showWatchlistModal}
        onClose={() => setShowWatchlistModal(false)}
        onConfirm={handleModalConfirm}
        initialQuery={watchlistModalQuery}
        creating={creating}
      />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50 transition-all"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  )
}
