'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import type { Listing, Watchlist } from '@/lib/supabase'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function Home() {
  const router = useRouter()

  // Manual search state
  const [query, setQuery] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Watchlist state
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [watchlistQuery, setWatchlistQuery] = useState('')
  const [watchlistsLoading, setWatchlistsLoading] = useState(true)
  const [addingWatchlist, setAddingWatchlist] = useState(false)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)

  useEffect(() => {
    loadWatchlists()
  }, [])

  async function loadWatchlists() {
    setWatchlistsLoading(true)
    const res = await fetch('/api/watchlists')
    if (res.ok) {
      setWatchlists(await res.json())
    }
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

    setStatus('loading')
    setError(null)
    setListings([])

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scrape failed')
      setListings(data.listings ?? [])
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
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
      setWatchlistError(data.error ?? 'Failed to add watchlist')
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

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-bold text-gray-900">SnagIt</h1>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Sign out
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">Find deals on dba.dk</p>

          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for anything… (e.g. iphone, sofa, cykel)"
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-8">
        {/* Manual search results */}
        <section>
          {status === 'loading' && (
            <div className="text-center text-sm text-gray-500 py-16">Scraping dba.dk…</div>
          )}

          {status === 'error' && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {status === 'done' && listings.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-16">
              No listings found for &ldquo;{query}&rdquo;
            </div>
          )}

          {status === 'done' && listings.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mb-4">
                {listings.length} results for &ldquo;{query}&rdquo;
              </p>
              <div className="flex flex-col gap-3">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            </>
          )}
        </section>

        {/* Watchlists */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Watchlists</h2>
          <p className="text-xs text-gray-400 mb-4">
            The cron job scrapes these queries every 10 minutes and saves new listings automatically.
          </p>

          {/* Add watchlist form */}
          <form onSubmit={handleAddWatchlist} className="flex gap-2 mb-4">
            <input
              type="text"
              value={watchlistQuery}
              onChange={(e) => setWatchlistQuery(e.target.value)}
              placeholder="Query to watch (e.g. macbook, nintendo switch)"
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={addingWatchlist}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addingWatchlist ? 'Adding…' : 'Add'}
            </button>
          </form>

          {watchlistError && (
            <p className="text-xs text-red-600 mb-3">{watchlistError}</p>
          )}

          {watchlistsLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : watchlists.length === 0 ? (
            <p className="text-xs text-gray-400">No watchlists yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {watchlists.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-lg bg-white border border-gray-200 px-4 py-3"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-900">{w.query}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(w.created_at).toLocaleDateString('da-DK')}
                    </span>
                    {w.active && (
                      <span className="ml-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        active
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteWatchlist(w.id)}
                    className="text-xs text-gray-400 hover:text-red-500 ml-4"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-4 rounded-xl bg-white border border-gray-200 p-3 hover:border-blue-400 hover:shadow-sm transition-all"
    >
      <div className="w-20 h-20 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={80}
            height={80}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
            No image
          </div>
        )}
      </div>
      <div className="flex flex-col justify-center min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{listing.title}</p>
        {listing.price != null ? (
          <p className="text-sm font-semibold text-blue-600 mt-0.5">
            {listing.price.toLocaleString('da-DK')} {listing.currency}
          </p>
        ) : (
          <p className="text-sm text-gray-400 mt-0.5">Price not listed</p>
        )}
        {listing.location && (
          <p className="text-xs text-gray-400 mt-1">{listing.location}</p>
        )}
      </div>
    </a>
  )
}
