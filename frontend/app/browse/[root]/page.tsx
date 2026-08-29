'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { ProductCard } from '@/components/ProductCard'
import { useLocale } from '@/components/LocaleProvider'
import type { BrowseLeafResponse } from '@/lib/browse'

interface Category {
  id: string
  slug: string
  name_da: string
  name_en: string
}

interface Subcategory {
  id: string
  slug: string
  name_da: string
  name_en: string
}

interface Product {
  slug: string
  canonical_name: string
  image_url: string | null
  tier: 'standard' | 'classic' | 'legendary'
  brand_name: string
  subcategory_name_da: string
  subcategory_name_en: string
  subcategory_slug: string
  active_listing_count: number
}

interface BrowseData {
  category: Category
  subcategories: Subcategory[]
  products: Product[]
  page: number
  page_size: number
  total_public_products: number
  has_more: boolean
  debug?: BrowseLeafResponse['debug']
}

function BrowseCategoryPageInner() {
  const params = useParams<{ root: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t, locale } = useLocale()
  const [data, setData] = useState<BrowseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeSubcat, setActiveSubcat] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const debugEnabled = searchParams.get('debug') === '1'

  useEffect(() => {
    fetch('/api/admin/me')
      .then(async (r) => {
        if (!r.ok) return
        const d = await r.json() as { isAdmin?: boolean }
        if (d.isAdmin) setIsAdmin(true)
      })
      .catch(() => {})
  }, [])

  function toggleDebug() {
    router.push(debugEnabled
      ? `/browse/${params.root}`
      : `/browse/${params.root}?debug=1`)
  }

  const fetchPage = useCallback(async (page: number, append: boolean) => {
    if (!params.root) return
    const qs = new URLSearchParams({
      page: String(page),
      page_size: '48',
    })
    if (debugEnabled) qs.set('debug', '1')
    const res = await fetch(`/api/browse/${params.root}?${qs.toString()}`)
    const next = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(next?.error ?? 'Failed to load browse category')
    }
    setData((prev) => {
      if (!append || !prev) return next
      return {
        ...next,
        products: [...prev.products, ...(next.products ?? [])],
        debug: prev.debug ?? next.debug,
      }
    })
  }, [debugEnabled, params.root])

  useEffect(() => {
    if (!params.root) return
    setActiveSubcat(null)
    setLoading(true)
    setError(null)
    fetchPage(1, false)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load browse category'
        setError(message)
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [fetchPage, params.root, debugEnabled])

  async function handleLoadMore() {
    if (!data?.has_more || loadingMore) return
    setLoadingMore(true)
    try {
      await fetchPage(data.page + 1, true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load more products'
      setError(message)
    }
    setLoadingMore(false)
  }

  const filteredProducts = activeSubcat
    ? (data?.products ?? []).filter((p) => p.subcategory_slug === activeSubcat)
    : (data?.products ?? [])

  const categoryName = data?.category
    ? locale === 'da' ? data.category.name_da : data.category.name_en
    : ''

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <SideNav active="hjem" onChange={() => {}} />

      <main className="md:ml-60 pb-24 md:pb-8">
        <MobileSearchBar />

        {/* Breadcrumb */}
        <div className="px-4 pt-4 md:px-8">
          <Link
            href="/browse"
            className="text-sm"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t.browseAllCategories}
          </Link>
          {!loading && data?.category && (
            <span className="text-sm mx-1.5" style={{ color: 'var(--muted-foreground)' }}>/</span>
          )}
          {!loading && data?.category && (
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {categoryName}
            </span>
          )}
        </div>

        {/* Heading */}
        <div className="px-4 pt-3 pb-4 md:px-8">
          {loading ? (
            <div className="h-9 w-48 rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
          ) : (
            <div className="flex items-center justify-between gap-4">
              <h1
                className="text-3xl md:text-4xl font-semibold"
                style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
              >
                {categoryName}
              </h1>
              {isAdmin && (
                <button
                  onClick={toggleDebug}
                  className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
                  style={debugEnabled
                    ? { background: 'var(--foreground)', color: 'var(--background)', border: '1px solid var(--border)' }
                    : { background: 'var(--secondary)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }
                  }
                >
                  Debug mode: {debugEnabled ? 'ON' : 'OFF'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Subcategory filter chips */}
        {!loading && (data?.subcategories ?? []).length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-4 md:px-8 scrollbar-none">
            <button
              onClick={() => setActiveSubcat(null)}
              className="shrink-0 text-sm font-medium px-3.5 py-1.5 rounded-full transition-colors"
              style={{
                background: activeSubcat === null ? 'var(--foreground)' : 'var(--card)',
                color: activeSubcat === null ? 'var(--background)' : 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              Alle
            </button>
            {(data?.subcategories ?? []).map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSubcat(activeSubcat === s.slug ? null : s.slug)}
                className="shrink-0 text-sm font-medium px-3.5 py-1.5 rounded-full transition-colors"
                style={{
                  background: activeSubcat === s.slug ? 'var(--foreground)' : 'var(--card)',
                  color: activeSubcat === s.slug ? 'var(--background)' : 'var(--foreground)',
                  border: '1px solid var(--border)',
                }}
              >
                {locale === 'da' ? s.name_da : s.name_en}
              </button>
            ))}
          </div>
        )}

        {/* Product grid */}
        {loading ? (
          <div className="grid-fluid gap-3 px-4 md:px-8">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ height: '120px', background: 'var(--card)' }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="px-4 md:px-8 py-16 text-center">
            <p style={{ color: 'var(--muted-foreground)' }}>{error}</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="px-4 md:px-8 py-16 text-center">
            <p style={{ color: 'var(--muted-foreground)' }}>{t.noResults}</p>
          </div>
        ) : (
          <div className="grid-fluid gap-3 px-4 md:px-8">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.slug}
                slug={p.slug}
                canonicalName={p.canonical_name}
                brandName={p.brand_name}
                subcategoryName={locale === 'da' ? p.subcategory_name_da : p.subcategory_name_en}
                activeListingCount={p.active_listing_count}
                imageUrl={p.image_url}
                tier={p.tier}
              />
            ))}
          </div>
        )}

        {!loading && data?.has_more && (
          <div className="px-4 md:px-8 pt-5">
            <button
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
            >
              {loadingMore ? (locale === 'da' ? 'Henter…' : 'Loading…') : (locale === 'da' ? 'Vis flere' : 'Load more')}
            </button>
          </div>
        )}

        {!!data?.debug && (
          <div className="px-4 md:px-8 pt-8">
            <details
              open
              className="rounded-2xl border p-4"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              <summary className="cursor-pointer text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                Browse audit
              </summary>
              <pre
                className="mt-4 text-xs overflow-x-auto whitespace-pre-wrap"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {JSON.stringify(data.debug, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}

export default function BrowseCategoryPage() {
  return (
    <Suspense>
      <BrowseCategoryPageInner />
    </Suspense>
  )
}
