'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { useLocale } from '@/components/LocaleProvider'

interface Category {
  id: string
  slug: string
  name_da: string
  name_en: string
  product_count: number
  image_url: string
}

export default function BrowsePage() {
  const { t, locale } = useLocale()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/browse')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <SideNav active="hjem" onChange={() => {}} />

      <main className="md:ml-60 pb-24 md:pb-8">
        <MobileSearchBar />

        <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8">
          <h1
            className="text-3xl md:text-4xl font-semibold"
            style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
          >
            {t.browseHeading}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {t.browseSubtext}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ height: '200px', background: 'var(--card)' }}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 md:px-8">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/browse/${cat.slug}`}
                className="relative rounded-xl overflow-hidden group"
                style={{ height: '200px', display: 'block' }}
              >
                {/* Background image */}
                <div
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    backgroundImage: `url(${cat.image_url})`,
                    background: `url(${cat.image_url}) center/cover, var(--card)`,
                  }}
                />
                {/* Dark gradient overlay */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
                  }}
                />
                {/* Text */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p
                    className="text-lg font-semibold leading-tight text-white"
                    style={{ fontFamily: '"DM Serif Display", serif' }}
                  >
                    {locale === 'da' ? cat.name_da : cat.name_en}
                  </p>
                  {cat.product_count > 0 && (
                    <p className="text-xs text-white/70 mt-0.5">
                      {cat.product_count} {t.browseProducts}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
