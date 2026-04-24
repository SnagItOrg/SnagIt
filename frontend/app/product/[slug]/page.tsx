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
import type { PricePoint, PriceRange, RelatedProduct } from '@/app/api/product/[slug]/route'

type ProductAttributes = {
  description?:     string
  specs?:           Record<string, string | boolean | number>
  history?:         Array<{ year: number; title: string; body: string }>
  external_links?:  Array<{ label: string; url: string }>
  related_products?: Array<{ slug: string; reason: string }>
}

type Product = {
  id: string
  slug: string
  canonical_name: string
  era: string | null
  thomann_price_dkk: number | null
  thomann_url: string | null
  image_url: string | null
  hero_image_url: string | null
  kg_brand: { name: string; slug: string } | null
  attributes: ProductAttributes | null
}

export default function ProductPage() {
  const params = useParams()
  const slug = params.slug as string

  const [product, setProduct]           = useState<Product | null>(null)
  const [listings, setListings]         = useState<Listing[]>([])
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [priceRange, setPriceRange]     = useState<PriceRange | null>(null)
  const [loading, setLoading]           = useState(true)
  const [notFound, setNotFound]         = useState(false)
  const [imgError, setImgError]         = useState(false)

  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([])

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
        setRelatedProducts(data.relatedProducts ?? [])
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
    <div className="min-h-screen bg-background text-foreground flex">
      <SideNav active="soeg" onChange={() => {}} />

      <main className="flex-1 md:pl-60 flex flex-col pb-24 md:pb-10">
        <MobileSearchBar />

        <div className="flex flex-col px-4 pt-4 md:px-8 md:pt-8 max-w-4xl w-full">

          {/* ── Loading skeleton ──────────────────────────────── */}
          {loading ? (
            <div className="grid lg:grid-cols-2 gap-8">
              <div className="aspect-square rounded-2xl bg-muted animate-pulse" />
              <div className="flex flex-col gap-4 pt-2">
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                <div className="h-8 w-3/4 rounded-lg bg-muted animate-pulse" />
                <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                <div className="h-12 w-2/3 rounded-lg bg-muted animate-pulse mt-4" />
                <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                <div className="h-11 w-full rounded-xl bg-muted animate-pulse mt-6" />
              </div>
            </div>
          ) : notFound || !product ? (

            /* ── Not found ──────────────────────────────────── */
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
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
              {/* ── Hero: image + info ────────────────────────── */}
              <div className="grid lg:grid-cols-2 gap-8 mb-10">

                {/* Left — product image */}
                <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted flex-shrink-0">
                  {(product.hero_image_url ?? product.image_url) && !imgError ? (
                    <Image
                      src={(product.hero_image_url ?? product.image_url)!}
                      alt={product.canonical_name}
                      fill
                      className="object-cover"
                      onError={() => setImgError(true)}
                      sizes="(max-width: 1024px) 100vw, 50vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 72, color: 'var(--muted-foreground)' }}
                      >
                        piano
                      </span>
                    </div>
                  )}
                </div>

                {/* Right — product info */}
                <div className="flex flex-col gap-5 lg:justify-center">

                  {/* Brand + name + era */}
                  <div className="flex flex-col gap-1">
                    {product.kg_brand && (
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                        {product.kg_brand.name}
                      </p>
                    )}
                    <h1 className="text-2xl font-bold leading-tight text-foreground">
                      {product.canonical_name}
                    </h1>
                    {product.era && (
                      <p className="text-sm text-muted-foreground">{product.era}</p>
                    )}
                  </div>

                  {/* Typical used price */}
                  {priceRange ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Typisk brugtpris
                      </p>
                      <p className="text-3xl font-bold tracking-tight text-foreground">
                        {priceRange.low.toLocaleString('da-DK')}
                        <span className="text-muted-foreground font-normal mx-2">–</span>
                        {priceRange.high.toLocaleString('da-DK')} kr
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Median {priceRange.median.toLocaleString('da-DK')} kr
                        <span className="mx-1.5">·</span>
                        baseret på {priceRange.count} salg
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Ikke nok prisdata til at beregne typisk pris endnu.
                    </p>
                  )}

                  {/* Thomann new price reference */}
                  {product.thomann_price_dkk != null && product.thomann_url && (
                    <a
                      href={product.thomann_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Ny fra Thomann:{' '}
                      <span className="font-semibold text-foreground">
                        {product.thomann_price_dkk.toLocaleString('da-DK')} kr
                      </span>{' '}
                      →
                    </a>
                  )}

                  {/* Listing count + watchlist CTA */}
                  <div className="flex flex-col gap-2 pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      {listings.length === 0
                        ? 'Ingen aktive annoncer'
                        : `${listings.length} ${listings.length === 1 ? 'aktiv annonce' : 'aktive annoncer'} til salg`}
                    </p>
                    <button
                      onClick={() => handleCreateWatchlist()}
                      className="w-full px-5 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
                      style={{ background: 'var(--foreground)', color: 'var(--background)' }}
                    >
                      + Tilføj til watchlist
                    </button>
                    <p className="text-xs text-muted-foreground text-center">
                      Få besked når nye annoncer dukker op
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Price history ─────────────────────────────── */}
              {priceHistory.length >= 5 && (
                <div className="flex flex-col gap-3 mb-10 p-5 rounded-2xl border border-border">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-foreground">Prishistorik</p>
                    <p className="text-xs text-muted-foreground">{priceHistory.length} salg registreret</p>
                  </div>
                  <div className="h-28 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={priceHistory} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.12} />
                            <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="sold_at" hide />
                        <YAxis hide domain={['auto', 'auto']} />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--background)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(v: any) => [`${Number(v).toLocaleString('da-DK')} kr`, 'Pris']}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          labelFormatter={(l: any) =>
                            new Date(String(l)).toLocaleDateString('da-DK', { month: 'short', year: 'numeric' })
                          }
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
                </div>
              )}

              {/* ── Description ───────────────────────────────── */}
              {product.attributes?.description && (
                <p className="text-foreground/80 leading-relaxed mb-10">
                  {product.attributes.description}
                </p>
              )}

              {/* ── Specs + History — 2-col on desktop ────────── */}
              {(() => {
                const hasSpecs = !!(product.attributes?.specs &&
                  Object.keys(product.attributes.specs).filter((k) => k !== '_source').length > 0)
                const hasHistory = !!(product.attributes?.history && product.attributes.history.length > 0)
                if (!hasSpecs && !hasHistory) return null
                return (
                  <div className={`grid gap-6 mb-10 items-start${hasSpecs && hasHistory ? ' lg:grid-cols-2' : ''}`}>

                    {/* Specs card */}
                    {hasSpecs && (
                      <div className="rounded-2xl border border-border p-6">
                        <p className="text-sm font-semibold text-foreground mb-4">Specifications</p>
                        <dl className="divide-y divide-border">
                          {Object.entries(product.attributes!.specs!)
                            .filter(([k, v]) => k !== '_source' && v !== '' && v !== null && v !== undefined)
                            .map(([key, value]) => (
                              <div key={key} className="flex justify-between gap-4 py-2.5">
                                <dt className="text-sm text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</dt>
                                <dd className="text-sm text-foreground text-right">
                                  {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </div>
                    )}

                    {/* History card */}
                    {hasHistory && (
                      <div className="rounded-2xl border border-border p-6">
                        <p className="text-sm font-semibold text-foreground mb-4">Product History</p>
                        <div className="flex flex-col">
                          {product.attributes!.history!.map((milestone, i) => (
                            <div key={i} className="flex gap-4">
                              <div className="flex flex-col items-center">
                                <div
                                  className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center font-bold"
                                  style={{ background: 'var(--foreground)', color: 'var(--background)', fontSize: 11 }}
                                >
                                  {milestone.year}
                                </div>
                                {i < product.attributes!.history!.length - 1 && (
                                  <div className="w-px flex-1 bg-border my-1" />
                                )}
                              </div>
                              <div className="pb-5 pt-1.5">
                                <p className="text-sm font-semibold text-foreground leading-tight">{milestone.title}</p>
                                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{milestone.body}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )
              })()}

              {/* ── External links ────────────────────────────── */}
              {product.attributes?.external_links && product.attributes.external_links.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-10">
                  {product.attributes.external_links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 14 }}
                      >
                        open_in_new
                      </span>
                      {link.label}
                    </a>
                  ))}
                </div>
              )}

              {/* ── Related products ──────────────────────────── */}
              {relatedProducts.length > 0 && (
                <div className="flex flex-col gap-3 mb-10">
                  <p className="text-sm font-medium text-foreground">Related gear</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {relatedProducts.map((rel) => (
                      <a
                        key={rel.slug}
                        href={`/product/${rel.slug}`}
                        className="flex flex-col gap-2 rounded-xl border border-border overflow-hidden hover:border-foreground/30 transition-colors"
                      >
                        <div className="aspect-square bg-muted relative">
                          {rel.image_url ? (
                            <Image
                              src={rel.image_url}
                              alt={rel.name}
                              fill
                              className="object-cover"
                              sizes="(max-width: 640px) 50vw, 33vw"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 32, color: 'var(--muted-foreground)' }}
                              >
                                piano
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-xs font-medium text-foreground px-3 pb-3 leading-snug">{rel.name}</p>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Active listings ───────────────────────────── */}
              {listings.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-foreground">
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

              {listings.length === 0 && !loading && (
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
