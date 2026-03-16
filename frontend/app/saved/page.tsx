'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { SearchResultCard } from '@/components/SearchResultCard'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import type { Listing } from '@/lib/supabase'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'

type SavedRow = {
  listing_id: string
  listing_data: Listing
}

export default function SavedPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [authed,   setAuthed]   = useState<boolean | null>(null)
  const [rows,     setRows]     = useState<SavedRow[]>([])
  const [loading,  setLoading]  = useState(false)
  const [toast,    setToast]    = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      const isAuthed = !!data.user
      setAuthed(isAuthed)
      if (isAuthed) loadSaved()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSaved() {
    setLoading(true)
    const res = await fetch('/api/saved-listings')
    if (res.ok) {
      const data: SavedRow[] = await res.json()
      setRows(data)
    }
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleToggleSave(listing: Listing) {
    const prevRows = rows
    setRows((r) => r.filter((row) => row.listing_id !== listing.id))

    const res = await fetch('/api/saved-listings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listing_id: listing.id }),
    })
    if (!res.ok) {
      setRows(prevRows)
    } else {
      showToast(t.listingUnsaved)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-foreground flex">
      <SideNav active="gemt" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col px-4 pt-6 pb-24 md:pb-6 md:px-8">
        {authed === false ? (
          /* Teaser for unauthenticated visitors */
          <div className="flex flex-col items-center justify-center flex-1">
            <div className="w-full max-w-sm flex flex-col gap-4">
              <div className="pointer-events-none select-none opacity-60" style={{ filter: 'blur(3px)' }}>
                <FakeSavedCard />
              </div>
              <div
                className="rounded-2xl p-6 flex flex-col gap-3 text-center"
                style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
              >
                <h2 className="text-xl font-black text-foreground">{t.savedTeaserHeading}</h2>
                <button
                  onClick={() => router.push('/login')}
                  className="w-full rounded-2xl py-4 px-8 font-black text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  {t.savedTeaserCta}
                </button>
              </div>
            </div>
          </div>
        ) : loading ? (
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
        ) : rows.length === 0 ? (
          /* Empty state for authenticated users with no saved listings */
          <div className="flex flex-col items-center justify-center flex-1">
            <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '72px', color: 'var(--muted-foreground)' }}
              >
                bookmark
              </span>
              <h1 className="text-xl font-bold text-foreground">{t.savedEmptyHeading}</h1>
              <p className="text-sm text-muted-foreground">{t.savedEmptySubtext}</p>
              <button
                onClick={() => router.push('/search')}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-colors bg-primary text-bg hover:bg-primary/90"
              >
                {t.goToSearch}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-w-2xl w-full">
            <p className="text-sm text-muted-foreground mb-1">
              {rows.length} {rows.length === 1 ? 'gemt annonce' : 'gemte annoncer'}
            </p>
            {rows.map((row) => (
              <ListingErrorBoundary key={row.listing_id} listingId={row.listing_id}>
                <SearchResultCard
                  listing={row.listing_data}
                  onCreateWatchlist={() => {}}
                  creating={false}
                  onToast={showToast}
                  variant="list"
                  isSaved={true}
                  onToggleSave={handleToggleSave}
                />
              </ListingErrorBoundary>
            ))}
          </div>
        )}
      </main>

      <BottomNav />

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

function FakeSavedCard() {
  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-card border border-border">
      <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-muted flex items-center justify-center">
        <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--muted-foreground)' }}>
          piano
        </span>
      </div>
      <div className="flex-1 flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">Roland Juno-106</p>
        <p className="text-base font-black" style={{ color: 'var(--foreground)' }}>4.500 kr</p>
        <p className="text-[11px] text-muted-foreground">Typisk 4.200–5.800 kr</p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="px-1.5 py-0.5 rounded bg-muted">dba.dk</span>
          <span>·</span>
          <span>3t siden</span>
          <span>·</span>
          <span>København</span>
        </div>
      </div>
    </div>
  )
}
