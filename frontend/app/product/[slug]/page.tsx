'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { SearchResultCard } from '@/components/SearchResultCard'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { CreateWatchlistModal } from '@/components/CreateWatchlistModal'
import { ListingErrorBoundary } from '@/components/ListingErrorBoundary'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import type { Listing } from '@/lib/supabase'
import type { PricePoint, PriceRange } from '@/app/api/product/[slug]/route'

type Product = {
  id: string
  slug: string
  canonical_name: string
  era: string | null
  thomann_price_dkk: number | null
  thomann_url: string | null
  image_url: string | null
  kg_brand: { name: string; slug: string } | null
}

export default function ProductPage() {
  const params = useParams()
  const slug = params.slug as string

  const [product, setProduct]       = useState<Product | null>(null)
  const [listings, setListings]     = useState<Listing[]>([])
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [priceRange, setPriceRange] = useState<PriceRange | null>(null)
  const [loading, setLoading]       = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [imgError, setImgError]     = useState(false)

  const [showModal,  setShowModal]  = useState(false)
  const [modalQuery, setModalQuery] = useState('')
  const [creating,   setCreating]   = useState(false)

  useEffect(() => {
    fetch(`/api/product/${slug}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then((data) => {
        if (!data) return
        setProduct(data.product)
        setListings(data.listings ?? [])
        setPriceHistory(data.priceHistory ?? [])
        setPriceRange(data.priceRange ?? null)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  function handleCreateWatchlist(listingTitle?: string) {
    const q = listingTitle
      ? (listingTitle.length > 60
          ? listingTitle.slice(0, listingTitle.lastIndexOf(' ', 60) || 60)
          : listingTitle)
      : product?.canonical_name ?? ''
    setModalQuery(q)
    setShowModal(true)
  }

  const handleModalConfirm = useCallback(async (query: string, maxPrice?: number) => {
    setCreating(true)
    const body: Record<string, unknown> = { query }
    if (maxPrice != null && maxPrice > 0) body.max_price = maxPrice
    await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setShowModal(false)
    setCreating(false)
  }, [])

  return (
    <div className="min-h-screen bg-bg text-foreground flex">
      <SideNav active="soeg" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col pb-24 md:pb-6">
        <MobileSearchBar />

        <div className="flex flex-col px-4 pt-2 md:px-8 md:pt-6 max-w-2xl w-full">
          {loading ? (
            <div className="flex flex-col gap-4">
              <div className="h-8 w-2/3 rounded-lg bg-muted animate-pulse" />
              <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
              <div className="h-4 w-1/4 rounded bg-muted animate-pulse" />
            </div>
          ) : notFound || !product ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '48px', color: 'var(--muted-foreground)' }}
              >
                search_off
              </span>
              <p className="text-muted-foreground">Produkt ikke fundet</p>
            </div>
          ) : (
            <>
              {/* Product header */}
              <div className="flex gap-4 mb-6">
                {product.image_url && !imgError && (
                  <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-muted">
                    <Image
                      src={product.image_url}
                      alt={product.canonical_name}
                      width={96}
                      height={96}
                      className="w-full h-full object-cover"
                      onError={() => setImgError(true)}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1 justify-center">
                  {product.kg_brand && (
                    <p className="text-sm text-muted-foreground">{product.kg_brand.name}</p>
                  )}
                  <h1 className="text-xl font-bold text-foreground">{product.canonical_name}</h1>
                  {product.era && (
                    <p className="text-sm text-muted-foreground">{product.era}</p>
                  )}
                  {product.thomann_price_dkk != null && product.thomann_url && (
                    <a
                      href={product.thomann_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--foreground)' }}
                    >
                      Ny pris: {product.thomann_price_dkk.toLocaleString('da-DK')} kr hos Thomann →
                    </a>
                  )}
                </div>
              </div>

              {/* Typisk pris + prishistorik */}
              {(priceRange || priceHistory.length > 0) && (
                <div className="flex flex-col gap-3 mb-6 p-4 rounded-xl bg-muted/40 border border-border">
                  {priceRange && (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Typisk brugtpris</p>
                      <p className="text-lg font-semibold text-foreground">
                        {priceRange.low.toLocaleString('da-DK')} – {priceRange.high.toLocaleString('da-DK')} kr
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Median {priceRange.median.toLocaleString('da-DK')} kr · baseret på {priceRange.count} salg
                      </p>
                    </div>
                  )}
                  {priceHistory.length >= 5 && (
                    <div className="h-24 w-full mt-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={priceHistory} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="sold_at" hide />
                          <YAxis hide domain={['auto', 'auto']} />
                          <Tooltip
                            contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                            formatter={(v: number) => [`${v.toLocaleString('da-DK')} kr`, 'Pris']}
                            labelFormatter={(l: string) => new Date(l).toLocaleDateString('da-DK', { month: 'short', year: 'numeric' })}
                          />
                          <Area
                            type="monotone"
                            dataKey="price"
                            stroke="var(--foreground)"
                            strokeWidth={1.5}
                            fill="url(#priceGrad)"
                            dot={false}
                            activeDot={{ r: 3 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* Active listings */}
              {listings.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {listings.length} {listings.length === 1 ? 'annonce' : 'annoncer'}
                  </p>
                  {listings.map((listing) => (
                    <ListingErrorBoundary key={listing.id} listingId={listing.id}>
                      <SearchResultCard
                        listing={listing}
                        onCreateWatchlist={handleCreateWatchlist}
                        creating={creating}
                        variant="list"
                        thomannImageUrl={product.image_url}
                      />
                    </ListingErrorBoundary>
                  ))}
                </div>
              )}

              {listings.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">
                  Ingen aktive annoncer for dette produkt.
                </p>
              )}
            </>
          )}
        </div>
      </main>

      <BottomNav />

      <CreateWatchlistModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleModalConfirm}
        initialQuery={modalQuery}
        creating={creating}
      />
    </div>
  )
}
