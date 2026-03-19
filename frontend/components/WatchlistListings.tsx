'use client'

import { useState, useEffect } from 'react'
import type { Listing } from '@/lib/supabase'
import { ListingCard } from '@/components/ListingCard'
import { useLocale } from '@/components/LocaleProvider'

interface PaginatedResult {
  listings: Listing[]
  total: number
  page: number
  limit: number
  totalPages: number
}

interface Props {
  watchlistId: string
}

export function WatchlistListings({ watchlistId }: Props) {
  const { t } = useLocale()
  const [data, setData] = useState<PaginatedResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/watchlists/${watchlistId}/listings?page=${page}&limit=10`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [watchlistId, page])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 mt-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse rounded-2xl bg-card border border-border h-24" />
        ))}
      </div>
    )
  }

  if (!data || data.listings.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">{t.noListingsYet}</p>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {data.listings.map((l) => <ListingCard key={l.id} listing={l} />)}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="text-xs font-medium px-3 py-1.5 min-h-[44px] rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t.previous}
          </button>
          <span className="text-xs text-muted-foreground">
            {t.page} {data.page} {t.of} {data.totalPages}
          </span>
          <button
            disabled={page === data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs font-medium px-3 py-1.5 min-h-[44px] rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t.next}
          </button>
        </div>
      )}
    </div>
  )
}
