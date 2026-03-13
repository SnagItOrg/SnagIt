'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Listing } from '@/lib/supabase'
import { SearchResultCard } from '@/components/SearchResultCard'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

type SortKey = 'newest' | 'price_asc' | 'price_desc'

type Category = {
  id: string
  slug: string
  name_da: string
  name_en: string
}

type Brand = {
  id: string
  slug: string
  name: string
  category_id: string
}

function sortListings(listings: Listing[], sort: SortKey): Listing[] {
  const copy = [...listings]
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
  // newest: sort by scraped_at desc (default)
  return copy.sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime())
}

function SearchPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { t } = useLocale()

  const [inputValue,   setInputValue]   = useState(() => params.get('q') ?? '')
  const [maxPrice,     setMaxPrice]     = useState<number | ''>('')
  const [sort,         setSort]         = useState<SortKey>('newest')
  const [listings,     setListings]     = useState<Listing[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [searched,     setSearched]     = useState(false)
  const [creating,         setCreating]         = useState(false)
  const [toast,            setToast]            = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [categories,       setCategories]       = useState<Category[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [brands,           setBrands]           = useState<Brand[]>([])
  const [selectedBrand,    setSelectedBrand]    = useState<Brand | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [showFilters,      setShowFilters]      = useState(false)
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
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? t.searchFailed)
        setListings([])
      } else {
        const data = await res.json()
        setListings(data.listings ?? [])
        setSelectedPlatform(null)
      }
    } catch {
      setError(t.unknownError)
      setListings([])
    }
    setLoading(false)
  }

  // Fire on mount: search if ?q= present, always load brands
  useEffect(() => {
    const q = params.get('q')
    if (q) void runSearch(q)
    fetch('/api/brands')
      .then((r) => r.ok ? r.json() : { categories: [], brands: [] })
      .then((data: { categories: Category[]; brands: Brand[] }) => {
        setCategories(data.categories ?? [])
        setBrands(data.brands ?? [])
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

    setCreating(true)
    let q: string
    if (listingTitle) {
      // Truncate at last word boundary before 60 chars
      q = listingTitle.length > 60
        ? (listingTitle.lastIndexOf(' ', 60) > 0
            ? listingTitle.slice(0, listingTitle.lastIndexOf(' ', 60))
            : listingTitle.slice(0, 60))
        : listingTitle
    } else {
      q = inputValue.trim() || (params.get('q') ?? '')
    }
    const body: Record<string, unknown> = { query: q }
    if (maxPrice !== '' && maxPrice > 0) body.max_price = maxPrice

    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      showToast(t.watchlistCreated)
    } else {
      const data = await res.json()
      showToast(data.error ?? t.addWatchlistError)
    }
    setCreating(false)
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
    listings
      .filter((l) => maxPrice === '' || maxPrice <= 0 || l.price == null || l.price <= (maxPrice as number))
      .filter((l) => !selectedBrand || l.title.toLowerCase().includes(selectedBrand.name.toLowerCase()))
      .filter((l) => !selectedPlatform || normalisePlatform(l) === selectedPlatform),
    sort,
  )

  const currentQuery = params.get('q') ?? inputValue

  return (
    <div className="min-h-screen bg-bg md:flex">
      <SideNav active={'soeg'} onChange={() => {}} />

      <div className="flex-1 min-w-0 flex flex-col md:ml-60">
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
              <>
                {/* Row 2: max price + sort */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t.maxPrice}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="—"
                        className="w-24 rounded-lg px-2 py-1 text-xs outline-none text-right"
                        style={{
                          backgroundColor: 'var(--input-background)',
                          border: '1px solid var(--border)',
                          color: 'var(--foreground)',
                        }}
                      />
                      <span
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        kr
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {([
                      { key: 'newest',     label: t.sortNewest },
                      { key: 'price_asc',  label: t.sortPriceLow },
                      { key: 'price_desc', label: t.sortPriceHigh },
                    ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSort(key)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                        style={{
                          backgroundColor: sort === key ? 'var(--secondary)' : 'transparent',
                          color: sort === key ? 'var(--foreground)' : 'var(--muted-foreground)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Platform chips — only when multiple platforms in results */}
                {platformsInResults.length > 1 && (
                  <div className="flex gap-2 flex-wrap">
                    {platformsInResults.map((p) => {
                      const isSelected = selectedPlatform === p
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setSelectedPlatform(isSelected ? null : p)}
                          className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap"
                          style={{
                            backgroundColor: isSelected ? 'var(--secondary)' : 'transparent',
                            color:           isSelected ? 'var(--foreground)' : 'var(--muted-foreground)',
                            border:          '1px solid var(--border)',
                          }}
                        >
                          {platformLabel[p] ?? p}
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
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
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add_alert</span>
                  {t.createWatchlist}
                </button>
              </div>

              {/* Mobile: list */}
              <div className="flex flex-col gap-3 md:hidden">
                {filtered.map((listing) => (
                  <SearchResultCard
                    key={listing.id}
                    listing={listing}
                    onCreateWatchlist={handleCreateWatchlist}
                    creating={creating}
                    onToast={showToast}
                    variant="list"
                  />
                ))}
              </div>

              {/* Desktop: 4-col grid */}
              <div className="hidden md:grid md:grid-cols-4 md:gap-4">
                {filtered.map((listing) => (
                  <SearchResultCard
                    key={listing.id}
                    listing={listing}
                    onCreateWatchlist={handleCreateWatchlist}
                    creating={creating}
                    onToast={showToast}
                    variant="grid"
                  />
                ))}
              </div>
            </>
          ) : (
            // Initial state: no search yet
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)', opacity: 0.4 }}
              >
                manage_search
              </span>
              <p className="text-sm text-muted-foreground">
                {t.searchInputPlaceholder}
              </p>
            </div>
          )}
        </main>
      </div>

      <BottomNav />

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
