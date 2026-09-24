'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Breadcrumb, BreadcrumbItem } from '@/components/Breadcrumb'
import { MobileSearchBar } from '@/components/MobileSearchBar'
import { ProductCard } from '@/components/ProductCard'
import { useLocale } from '@/components/LocaleProvider'
import { EmptyState } from '@/components/EmptyState'
import { PositionSignal } from '@/components/PositionSignal'
import { buildPositionSignal } from '@/lib/position-signal'
import {
  SUBCATEGORY_GROUPS,
  displaySubcategorySlug,
  isSubcategoryGroup,
} from '@/lib/catalogue-tree'
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
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const debugEnabled = searchParams.get('debug') === '1'

  /**
   * PAN-121 — the subcategory filter lives in the URL now, as `?sub=<slug>`.
   *
   * It was `useState`, and that was the reason the sidebar could not mark where
   * you are: `SideNav` is a sibling component with no access to this page's
   * local state, so the comment on the sidebar's subcategory rows read "there
   * is no honest href to give this row today". With the filter in the URL there
   * is one, and the two surfaces can state the same truth instead of two half
   * ones — which is exactly what the owner's scope change asks for.
   *
   * Three things come free with the move, and each was a real defect: the
   * filtered view is now linkable, the back button now undoes a filter, and a
   * reload no longer silently drops it.
   *
   * `replace`, not `push`, and `scroll: false` — toggling a facet is a
   * refinement of one view, not a new page, and it must not build a back-button
   * trail of every chip the visitor tried.
   */
  const activeSubcat = searchParams.get('sub')

  const setActiveSubcat = useCallback((slug: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (slug) next.set('sub', slug)
    else next.delete('sub')
    const qs = next.toString()
    router.replace(`/browse/${params.root}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [params.root, router, searchParams])

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
    // No `setActiveSubcat(null)` here any more: the URL owns the facet, and a
    // different root is a different URL that carries no `?sub=`. Resetting it
    // from an effect would now mean a router write on every page load.
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

  /**
   * PAN-138 — the chip row is DISPLAY slugs, not leaf slugs. Grouped leaves
   * (analog + digital synths) collapse into one chip, through the same
   * `displaySubcategorySlug` the sidebar tree is built with, so the two cannot
   * disagree about which leaves are one place. A group takes the position of
   * its first member in the API's order; every other chip keeps its own.
   *
   * `activeSub` is `?sub=` resolved the same way, so an old
   * `?sub=analog-synths` link selects the group instead of half of it.
   */
  const activeSub = activeSubcat ? displaySubcategorySlug(params.root, activeSubcat) : null

  /**
   * The label a leaf is shown under: its group's when it has one, its own
   * otherwise. The chip row and the product cards both read it, so a card
   * cannot say "Analoge synths" under a chip that says "Synthesizere".
   */
  function displaySubcategoryLabel(leafSlug: string, name_da: string, name_en: string): string {
    const slug = displaySubcategorySlug(params.root, leafSlug)
    if (isSubcategoryGroup(slug)) return t[SUBCATEGORY_GROUPS[slug].labelKey]
    return locale === 'da' ? name_da : name_en
  }

  const chips: Array<{ slug: string; label: string }> = []
  for (const s of data?.subcategories ?? []) {
    const slug = displaySubcategorySlug(params.root, s.slug)
    if (chips.some((chip) => chip.slug === slug)) continue
    chips.push({ slug, label: displaySubcategoryLabel(s.slug, s.name_da, s.name_en) })
  }

  const filteredProducts = activeSub
    ? (data?.products ?? []).filter(
        (p) => displaySubcategorySlug(params.root, p.subcategory_slug) === activeSub,
      )
    : (data?.products ?? [])

  const categoryName = data?.category
    ? locale === 'da' ? data.category.name_da : data.category.name_en
    : ''

  /**
   * PAN-121 — the position signal.
   *
   * `filteredProducts` and not `data.total_public_products`. The projection
   * total counts the whole root across every page and ignores the subcategory
   * chip entirely; `filteredProducts` is the array three lines below this one
   * maps into cards. PAN-98 is the ticket where those two numbers were allowed
   * to differ — 187 advertised, 75 rendered — so `buildPositionSignal` takes
   * the rows themselves and there is no argument the total could be passed as.
   *
   * The category name comes from the API's `kg_category.name_da` / `name_en`,
   * which is the single label authority since PAN-107.
   */
  const activeChip = activeSub ? chips.find((chip) => chip.slug === activeSub) : undefined

  const positionSignal = buildPositionSignal({
    // No `scope`: `categoryName` is already the <h1> directly above, and
    // already the last crumb of the breadcrumb above that. A third copy made
    // the visitor choose which of three position statements to read.
    renderedRows: filteredProducts,
    filters: activeChip
      ? [{ id: activeChip.slug, kind: 'subcategory' as const, label: activeChip.label }]
      : [],
  })

  return (
    <main className="flex-1 min-w-0 shell-offset pb-24 md:pb-8">
      <MobileSearchBar />

      <div className="shell-wall">

        {/* Breadcrumb (PAN-124) */}
        <Breadcrumb className="pt-4">
          <BreadcrumbItem href="/browse">{t.browseAllCategories}</BreadcrumbItem>
          {!loading && data?.category && <BreadcrumbItem>{categoryName}</BreadcrumbItem>}
        </Breadcrumb>

        {/* Heading */}
        <div className="pt-3 pb-4">
          {loading ? (
            <div className="h-9 w-48 rounded-lg animate-pulse" style={{ background: 'var(--card)' }} />
          ) : (
            <div className="flex items-center justify-between gap-4">
              <h1 className="type-title">
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

        {/* PAN-121 — where you are, and how many rows that yields. The facet
            row below is what names and removes the filter (round 2: one
            anchor, not a chip restating it one line above). */}
        {!loading && !error && data && (
          <PositionSignal signal={positionSignal} filtersShownByPage />
        )}

        {/* Subcategory filter chips. The one in force is where the visitor IS,
            so it takes `--here` (PAN-121) — the same colour the sidebar row
            uses for the same `?sub=`. It used to be
            an inverted solid fill, the loudest thing on the page for the
            quietest fact on it.

            Since round 2 this row is the ONLY statement of the facet, so its
            state has to reach a screen reader too: `aria-pressed` on each
            chip, and "Alle" is the removal. */}
        {!loading && chips.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-none">
            <button
              type="button"
              aria-pressed={activeSub === null}
              onClick={() => setActiveSubcat(null)}
              className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition-colors ${
                activeSub === null ? 'font-semibold' : 'font-medium'
              }`}
              style={{
                background: activeSub === null ? 'var(--here-subtle)' : 'var(--card)',
                color: activeSub === null ? 'var(--here)' : 'var(--foreground)',
                border: `1px solid ${activeSub === null ? 'var(--here-border)' : 'var(--border)'}`,
              }}
            >
              Alle
            </button>
            {chips.map((chip) => (
              <button
                key={chip.slug}
                type="button"
                aria-pressed={activeSub === chip.slug}
                onClick={() => setActiveSubcat(activeSub === chip.slug ? null : chip.slug)}
                className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition-colors ${
                  activeSub === chip.slug ? 'font-semibold' : 'font-medium'
                }`}
                style={{
                  background: activeSub === chip.slug ? 'var(--here-subtle)' : 'var(--card)',
                  color: activeSub === chip.slug ? 'var(--here)' : 'var(--foreground)',
                  border: `1px solid ${activeSub === chip.slug ? 'var(--here-border)' : 'var(--border)'}`,
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Product grid */}
        {loading ? (
          <div className="grid-wall">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ height: '120px', background: 'var(--card)' }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="py-16 text-center">
            <p style={{ color: 'var(--muted-foreground)' }}>{error}</p>
          </div>
        ) : (data?.total_public_products ?? 0) === 0 ? (
          /* PAN-86. A root Klup follows nothing in is not "no results" —
             nothing was searched for. The homepage now sends visitors here
             on purpose, with the card already saying the category is empty,
             so the page has to finish the sentence: what following is, and
             that this category is not covered yet. The filtered-to-nothing
             case below keeps t.noResults, which is the right words for it. */
          <EmptyState
            kind="unfollowed"
            titleAs="h2"
            title={t.browseEmptyCategoryHeading}
            body={t.browseEmptyCategoryBody}
            className="py-16"
          />
        ) : filteredProducts.length === 0 ? (
          <EmptyState kind="blank" title={t.noResults} className="py-16" />
        ) : (
          <div className="grid-wall">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.slug}
                slug={p.slug}
                canonicalName={p.canonical_name}
                brandName={p.brand_name}
                subcategoryName={displaySubcategoryLabel(p.subcategory_slug, p.subcategory_name_da, p.subcategory_name_en)}
                activeListingCount={p.active_listing_count}
                imageUrl={p.image_url}
                tier={p.tier}
              />
            ))}
          </div>
        )}

        {!loading && data?.has_more && (
          <div className="pt-5">
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
  )
}

export default function BrowseCategoryPage() {
  return (
    <Suspense>
      <BrowseCategoryPageInner />
    </Suspense>
  )
}
