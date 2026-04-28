'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useLocale } from '@/components/LocaleProvider'
import { ProductCard } from '@/components/ProductCard'
import type { DiscoverProduct } from '@/app/api/discover/route'

export default function LandingPage() {
  const router = useRouter()
  const { t, locale } = useLocale()
  const [query, setQuery] = useState('')
  const [legendary, setLegendary] = useState<DiscoverProduct[]>([])
  const [popular, setPopular] = useState<DiscoverProduct[]>([])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/watchlists')
    })
    fetch('/api/discover').then((r) => r.json()).then((d) => {
      setLegendary(d.legendary ?? [])
      setPopular(d.popular ?? [])
    })
  }, [router])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      {/* Logo */}
      <header className="px-6 py-5 flex items-center">
        <div className="flex items-center gap-3" style={{ color: 'var(--foreground)' }}>
          <div
            className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--secondary)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
          </div>
          <span className="text-xl font-black tracking-tight">Klup.dk</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col pb-16">
        {/* Search section */}
        <div className="flex flex-col items-center text-center px-6 pt-12 pb-10">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <h1 className="font-black text-5xl md:text-7xl text-foreground tracking-tight">
              {t.headline}
            </h1>
            <p className="text-lg mt-3 text-muted-foreground">
              {t.subheadline}
            </p>
            <form onSubmit={handleSubmit} className="w-full mt-8">
              <div className="relative w-full">
                <span
                  className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ fontSize: '22px', color: 'var(--muted-foreground)' }}
                >
                  search
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.searchInputPlaceholder}
                  className="w-full rounded-2xl pl-14 pr-6 py-4 text-lg text-foreground outline-none transition-all"
                  style={{
                    backgroundColor: 'var(--input-background)',
                    border: '1px solid var(--border)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="w-full mt-3 rounded-2xl px-8 py-4 text-lg font-black transition-opacity hover:opacity-90 active:opacity-100"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {t.search}
              </button>
            </form>
          </div>
        </div>

        {/* Legendary gear carousel */}
        {legendary.length > 0 && (
          <section className="mb-10">
            <div className="px-6 mb-4 flex items-baseline gap-3">
              <h2
                className="text-xl font-semibold"
                style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
              >
                {t.discoverLegendaryHeading}
              </h2>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {t.discoverLegendarySubtext}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto px-6 pb-2 scrollbar-none">
              {legendary.map((p) => (
                <div key={p.slug} className="flex-shrink-0 w-44">
                  <ProductCard
                    slug={p.slug}
                    canonicalName={p.canonical_name}
                    brandName={p.brand_name}
                    subcategoryName=""
                    activeListingCount={p.active_listing_count}
                    imageUrl={p.image_url}
                    tier="legendary"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Popular right now carousel */}
        {popular.length > 0 && (
          <section className="mb-10">
            <div className="px-6 mb-4 flex items-baseline gap-3">
              <h2
                className="text-xl font-semibold"
                style={{ fontFamily: '"DM Serif Display", serif', color: 'var(--foreground)' }}
              >
                {t.discoverPopularHeading}
              </h2>
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                {t.discoverPopularSubtext}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto px-6 pb-2 scrollbar-none">
              {popular.map((p) => (
                <div key={p.slug} className="flex-shrink-0 w-44">
                  <ProductCard
                    slug={p.slug}
                    canonicalName={p.canonical_name}
                    brandName={p.brand_name}
                    subcategoryName=""
                    activeListingCount={p.active_listing_count}
                    imageUrl={p.image_url}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="pb-8 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <span>{t.alreadyHaveAccount}</span>
        <Link
          href="/login"
          className="font-semibold transition-colors text-muted-foreground hover:text-foreground"
        >
          {t.signIn}
        </Link>
      </footer>
    </div>
  )
}
