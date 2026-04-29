'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { ProductCard } from '@/components/ProductCard'
import { useLocale } from '@/components/LocaleProvider'

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
}

export default function BrowseCategoryPage() {
  const params = useParams<{ root: string }>()
  const { t, locale } = useLocale()
  const [data, setData] = useState<BrowseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSubcat, setActiveSubcat] = useState<string | null>(null)

  useEffect(() => {
    if (!params.root) return
    fetch(`/api/browse/${params.root}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [params.root])

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
            <h1
              className="text-3xl md:text-4xl font-semibold"
              style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
            >
              {categoryName}
            </h1>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-8">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ height: '120px', background: 'var(--card)' }}
              />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="px-4 md:px-8 py-16 text-center">
            <p style={{ color: 'var(--muted-foreground)' }}>{t.noResults}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-8">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.slug}
                slug={p.slug}
                canonicalName={p.canonical_name}
                brandName={p.brand_name}
                subcategoryName={locale === 'da' ? p.subcategory_name_da : p.subcategory_name_en}
                activeListingCount={p.active_listing_count}
                imageUrl={p.image_url}
              />
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
