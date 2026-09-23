'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SearchResultCard } from '@/components/SearchResultCard'
import { useLocale } from '@/components/LocaleProvider'
import { EmptyState } from '@/components/EmptyState'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import type { Listing } from '@/lib/supabase'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { CreateWatchlistModal } from '@/components/CreateWatchlistModal'
import { ToastViewport } from '@/components/Toast'
import { useToast } from '@/lib/use-toast'
import { Icon } from '@/components/Icon'

type SavedRow = {
  listing_id: string
  listing_data: Listing
  thomann_price_dkk: number | null
  thomann_url: string | null
  product_slug: string | null
  thomann_image_url: string | null
}

export default function SavedPage() {
  const router = useRouter()
  const { t } = useLocale()
  const [authed,             setAuthed]           = useState<boolean | null>(null)
  const [rows,               setRows]             = useState<SavedRow[]>([])
  const [loading,            setLoading]          = useState(true)
  const { toasts, showToast, dismissToast } = useToast()
  const [showModal,          setShowModal]        = useState(false)
  const [modalQuery,         setModalQuery]       = useState('')
  const [creating,           setCreating]         = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      const isAuthed = !!data.user
      setAuthed(isAuthed)
      if (isAuthed) loadSaved()
      else setLoading(false)
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

  function handleCreateWatchlist(listingTitle?: string) {
    const q = listingTitle
      ? (listingTitle.length > 60
          ? listingTitle.slice(0, listingTitle.lastIndexOf(' ', 60) || 60)
          : listingTitle)
      : ''
    setModalQuery(q)
    setShowModal(true)
  }

  async function handleModalConfirm(query: string, maxPrice?: number) {
    setCreating(true)
    const body: Record<string, unknown> = { query }
    if (maxPrice != null && maxPrice > 0) body.max_price = maxPrice
    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setShowModal(false)
      showToast(t.watchlistCreated)
    }
    setCreating(false)
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
    <>
      <main className="flex-1 shell-offset-pad flex flex-col pb-24 md:pb-6">
        <MobileSearchBar />
        <div className="shell-wall flex flex-col pt-2 md:pt-6 flex-1">
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
            <EmptyState
              kind="blank"
              icon="bookmark"
              titleAs="h1"
              title={t.savedEmptyHeading}
              body={t.savedEmptySubtext}
              action={{ label: t.goToSearch, onClick: () => router.push('/search') }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            <p className="text-sm text-muted-foreground mb-1">
              {rows.length} {rows.length === 1 ? 'gemt annonce' : 'gemte annoncer'}
            </p>
            <div className="grid-wall grid-wall-lg">
            {rows.map((row) => (
              <ListingErrorBoundary key={row.listing_id} listingId={row.listing_id}>
                <SearchResultCard
                  listing={row.listing_data}
                  onCreateWatchlist={handleCreateWatchlist}
                  creating={creating}
                  variant="list"
                  isSaved={true}
                  onToggleSave={handleToggleSave}
                  thomannPriceDkk={row.thomann_price_dkk}
                  thomannUrl={row.thomann_url}
                  productSlug={row.product_slug}
                  thomannImageUrl={row.thomann_image_url}
                />
              </ListingErrorBoundary>
            ))}
            </div>
          </div>
        )}
        </div>
      </main>


      <CreateWatchlistModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleModalConfirm}
        initialQuery={modalQuery}
        creating={creating}
      />

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

function FakeSavedCard() {
  return (
    <div className="flex gap-3 p-3 rounded-2xl bg-card border border-border">
      <div className="flex-shrink-0 w-20 h-20 rounded-lg bg-muted flex items-center justify-center">
        <Icon name="piano" style={{ fontSize: '28px', color: 'var(--muted-foreground)' }} />
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
