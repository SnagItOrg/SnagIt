'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { useLocale } from '@/components/LocaleProvider'
import { PositionSignal } from '@/components/PositionSignal'
import { buildPositionSignal } from '@/lib/position-signal'
import type { BrowseRootResponse } from '@/lib/browse'

interface Category {
  id: string
  slug: string
  name_da: string
  name_en: string
  product_count: number
  image_url: string | null
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

      <main className="shell-offset pb-24 md:pb-8">
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

          {/* PAN-121 — the catalogue root is the one surface with nothing
              narrowing it, so the signal says so rather than rendering an empty
              bar. The number counts the tiles actually rendered below. */}
          {!loading && !error && (
            <PositionSignal
              signal={buildPositionSignal({
                scope: t.positionSignalAllCategories,
                renderedRows: data.categories,
                countKind: 'categories',
              })}
            />
          )}

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
                  /* The tile's own surface, which used to be the second layer
                     of the `background` shorthand. It is what a root with no
                     image resolves to, and what shows while one loads. */
                  style={{ height: '200px', display: 'block', background: 'var(--card)' }}
                >
                  {/* PAN-103 — `next/image`, the same way the homepage shelf
                      renders these very images. As a CSS `background-image`
                      the browser had no srcset to choose from, so a 390px
                      phone fetched byte-for-byte what a 1440px desktop did.

                      Measured track widths rather than a device guess: the
                      wall is 1-up and near full-bleed below 30rem (328-398px),
                      2-up at 640 (298px), and from 48rem up the sidebar caps
                      it at 271px at its widest — so 17rem is the ceiling, not
                      a viewport fraction. */}
                  {cat.image_url && (
                    <Image
                      src={cat.image_url}
                      alt=""
                      fill
                      className="object-cover transition-transform duration-medium group-hover:scale-105"
                      sizes="(max-width: 30rem) 95vw, (max-width: 48rem) 50vw, 17rem"
                    />
                  )}
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
