'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { useLocale } from '@/components/LocaleProvider'
import type { BrowseRootResponse } from '@/lib/browse'

interface Category {
  id: string
  slug: string
  name_da: string
  name_en: string
  product_count: number
  image_url: string
}

interface BrowseRootData {
  categories: Category[]
  debug?: BrowseRootResponse['debug']
}

function BrowsePageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t, locale } = useLocale()
  const debugEnabled = searchParams.get('debug') === '1'
  const [data, setData] = useState<BrowseRootData>({ categories: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

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
    router.push(debugEnabled ? '/browse' : '/browse?debug=1')
  }

  useEffect(() => {
    const url = debugEnabled ? '/api/browse?debug=1' : '/api/browse'
    setError(null)
    fetch(url)
      .then(async (r) => {
        const payload = await r.json().catch(() => null)
        if (!r.ok) {
          throw new Error(payload?.error ?? 'Failed to load browse categories')
        }
        return payload
      })
      .then((d) => setData({ categories: d?.categories ?? [], debug: d?.debug }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load browse categories'
        setError(message)
        setData({ categories: [] })
      })
      .finally(() => setLoading(false))
  }, [debugEnabled])

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <SideNav active="hjem" onChange={() => {}} />

      <main className="md:ml-60 pb-24 md:pb-8">
        <MobileSearchBar />

        <div className="shell-wall">

          <div className="pt-6 pb-4 md:pt-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="type-title">
                {t.browseHeading}
              </h1>
              <p className="mt-1 type-meta">
                {t.browseSubtext}
              </p>
            </div>
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

          {loading ? (
            <div className="grid-wall">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl animate-pulse"
                  style={{ height: '200px', background: 'var(--card)' }}
                />
              ))}
            </div>
          ) : error ? (
            <div className="py-12">
              <div
                className="rounded-2xl border p-4 text-sm"
                style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                {error}
              </div>
            </div>
          ) : (
            <div className="grid-wall">
              {data.categories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/browse/${cat.slug}${debugEnabled ? '?debug=1' : ''}`}
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
                    <p className="type-card-title text-lg text-white">
                      {locale === 'da' ? cat.name_da : cat.name_en}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {data.debug && (
            <div className="pt-8">
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
        </div>
      </main>

      <BottomNav />
    </div>
  )
}

export default function BrowsePage() {
  return (
    <Suspense>
      <BrowsePageInner />
    </Suspense>
  )
}
