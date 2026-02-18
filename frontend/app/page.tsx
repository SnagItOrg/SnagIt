'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { Listing } from '@/lib/supabase'

export default function Home() {
  const [query, setQuery] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

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

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">SnagIt</h1>
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

      {/* Results */}
      <div className="max-w-3xl mx-auto px-4 py-6">

        {status === 'loading' && (
          <div className="text-center text-sm text-gray-500 py-16">
            Scraping dba.dk…
          </div>
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
                <a
                  key={listing.id}
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-4 rounded-xl bg-white border border-gray-200 p-3 hover:border-blue-400 hover:shadow-sm transition-all"
                >
                  {/* Image */}
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

                  {/* Info */}
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
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
