'use client'

/**
 * "Match med andet produkt" — moving a listing to the product it really is.
 *
 * Extracted verbatim from app/admin/product/[slug]/ProductCurationClient.tsx so
 * the public product page's review mode can reuse it. It was not rewritten: a
 * second KG search or a second canonical-product picker would be two ways to
 * make the same decision, and they would drift. The admin curation page imports
 * it from here now, so both surfaces share one search, one create-product path
 * and one call to /api/admin/product/[slug]/reassign-match.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { useLocale } from '@/components/LocaleProvider'

// ─── ReassignPanel — inline UI for moving a listing to another product ─────
type ProductSearchResult = {
  id: string
  slug: string
  canonical_name: string
  tier: string
}

export type ReassignSuccessOpts = { productName: string; created?: boolean }

export function ReassignPanel({
  slug,
  listingId,
  onSuccess,
  onCancel,
}: {
  slug: string
  listingId: string
  onSuccess: (opts: ReassignSuccessOpts) => void
  onCancel: () => void
}) {
  const { t } = useLocale()
  const [searchValue, setSearchValue] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'search' | 'create'>('search')

  const panelRef = useRef<HTMLDivElement | null>(null)

  // ESC to cancel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Click-outside to cancel. Defer attachment by a tick so the click that
  // opened the panel does not immediately close it.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!panelRef.current) return
      if (panelRef.current.contains(e.target as Node)) return
      onCancel()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [onCancel])

  // Debounced search
  useEffect(() => {
    if (mode === 'create') return
    const v = searchValue.trim()
    if (v.length === 0) { setResults([]); return }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/products?q=${encodeURIComponent(v)}`)
        const data = await res.json()
        setResults(((data.products ?? []) as ProductSearchResult[]).slice(0, 8))
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchValue, mode])

  /**
   * SELECTION IS NOT COMMITMENT.
   *
   * Every result used to be a submit button: one click on a search result wrote
   * the move. There was no confirmation step, no read-back of the destination,
   * and a mis-click was a database write that had to be undone by hand.
   *
   * Nielsen #5 (error prevention) prefers removing the error-prone condition to
   * warning about it, and Krug's satisficing — users click the first reasonable
   * option rather than the best one — makes a one-click write on a fuzzy search
   * result exactly the wrong affordance. So a click now only selects; the write
   * lives behind a button that names its own destination ("Flyt til Roland
   * Juno-6"), which is the last thing the operator reads before committing.
   */
  const [selected, setSelected] = useState<ProductSearchResult | null>(null)

  async function reassignTo(targetSlug: string, productName: string, created = false) {
    // One request per intent. Without this, a double-click fires two POSTs.
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/product/${slug}/reassign-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, target_slug: targetSlug }),
      })
      if (!res.ok) {
        // The route already translates database failures into human sentences;
        // this fallback only covers a response that carries no body at all.
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t.adminReview.saveFailed)
        return
      }
      onSuccess({ productName, created })
    } catch {
      setError(t.adminReview.saveFailed)
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'create') {
    return (
      <div ref={panelRef}>
        <InlineNewProductForm
          initialCanonicalName={searchValue.trim()}
          onCancel={() => setMode('search')}
          onCreated={(newSlug, name) => reassignTo(newSlug, name, true)}
        />
      </div>
    )
  }

  const trimmed = searchValue.trim()

  return (
    <div
      ref={panelRef}
      className="flex flex-col gap-2 p-3 rounded-xl"
      style={{ background: 'var(--secondary)', border: '1px solid var(--border)' }}
      data-testid="reassign-panel"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={searchValue}
          onChange={(e) => { setSearchValue(e.target.value); setSelected(null) }}
          placeholder={t.adminReview.searchPlaceholder}
          disabled={submitting}
          className="flex-1 text-sm px-3 py-2 rounded-lg outline-none disabled:opacity-50"
          style={{
            background: 'var(--input-background)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        />
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          data-testid="reassign-cancel"
          className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
          style={{ background: 'transparent', color: 'var(--muted-foreground)' }}
        >
          {t.adminReview.cancel}
        </button>
      </div>

      {trimmed.length >= 2 && (
        <ul className="flex flex-col gap-1" role="radiogroup" aria-label={t.adminReview.selectPrompt}>
          {searching && (
            <li className="text-[11px] px-2" style={{ color: 'var(--muted-foreground)' }}>
              Søger…
            </li>
          )}
          {!searching && results.map((p) => {
            // The product under review is the one link we can prove already
            // exists without another round trip. Offering it as a destination
            // would be offering a move to where the listing already is.
            const alreadyLinked = p.slug === slug
            const isSelected = selected?.slug === p.slug
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => { if (!alreadyLinked) setSelected(p) }}
                  disabled={submitting || alreadyLinked}
                  data-testid={`reassign-option-${p.slug}`}
                  /*
                    WRAPS, NEVER TRUNCATES. At 360px `truncate` cut the name to
                    "Roland Ju…", which is unreadable precisely where it matters
                    most: Roland Juno-6 and Roland ju-06 are different
                    instruments that share that prefix. The operator must see
                    the full canonical name before committing a write, so the
                    row wraps and the badge moves to a second line instead.
                  */
                  className="w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm px-3 py-2 rounded-lg text-left disabled:opacity-40"
                  style={{
                    background: 'var(--card)',
                    color: 'var(--foreground)',
                    // Selection is shown with the neutral foreground token.
                    // Green is reserved for Kup ratings and "Aktiv" badges.
                    border: isSelected ? '1px solid var(--foreground)' : '1px solid transparent',
                  }}
                >
                  <span className="min-w-0 break-words">{p.canonical_name}</span>
                  {alreadyLinked ? (
                    <span className="text-[10px] shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                      {t.adminReview.alreadyLinked}
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0"
                      style={{
                        background: p.tier === 'legendary' ? 'var(--foreground)' : 'var(--secondary)',
                        color: p.tier === 'legendary' ? 'var(--background)' : 'var(--muted-foreground)',
                      }}
                    >
                      {p.tier}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
          {!searching && results.length === 0 && (
            <li>
              <button
                type="button"
                onClick={() => setMode('create')}
                disabled={submitting}
                className="w-full text-sm px-3 py-2 rounded-lg text-left disabled:opacity-40"
                style={{ background: 'var(--card)', color: 'var(--foreground)' }}
              >
                Opret nyt produkt: <strong>{trimmed}</strong>
              </button>
            </li>
          )}
        </ul>
      )}

      {/*
        The commit step. Disabled until something is selected, and it states the
        destination rather than a generic verb, so the operator confirms the
        specific move rather than "OK".
      */}
      {trimmed.length >= 2 && (
        <button
          type="button"
          onClick={() => { if (selected) void reassignTo(selected.slug, selected.canonical_name) }}
          disabled={!selected || submitting}
          data-testid="reassign-confirm"
          className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--foreground)', color: 'var(--background)' }}
        >
          {submitting
            ? t.adminReview.moving
            : selected
              ? t.adminReview.confirmMove.replace('{product}', selected.canonical_name)
              : t.adminReview.selectPrompt}
        </button>
      )}

      {error && (
        <p role="alert" className="text-xs" style={{ color: 'rgb(239,68,68)' }} data-testid="reassign-error">
          {error}
        </p>
      )}
    </div>
  )
}


// ─── InlineNewProductForm — mini form for inline product creation ──────────
type BrandOption = { id: string; name: string }
type CreateTier = 'legendary' | 'classic' | 'standard'

function slugifySimple(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function deriveModelName(canonicalName: string, brandName: string | null): string {
  const trimmed = canonicalName.trim()
  if (!brandName) return trimmed
  const lcCanonical = trimmed.toLowerCase()
  const lcBrand = brandName.trim().toLowerCase()
  if (lcCanonical.startsWith(lcBrand + ' ')) {
    return trimmed.slice(brandName.length).trim()
  }
  return trimmed
}

function InlineNewProductForm({
  initialCanonicalName,
  onCancel,
  onCreated,
}: {
  initialCanonicalName: string
  onCancel: () => void
  onCreated: (newSlug: string, canonicalName: string) => Promise<void> | void
}) {
  const [brands, setBrands] = useState<BrandOption[]>([])
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [brandSearch, setBrandSearch] = useState('')
  const [brandId, setBrandId] = useState<string | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)

  const [canonicalName, setCanonicalName] = useState(initialCanonicalName)
  const [modelName, setModelName] = useState('')
  const [modelTouched, setModelTouched] = useState(false)
  const [tier, setTier] = useState<CreateTier>('legendary')
  const [year, setYear] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/product/brands')
      .then((r) => r.json())
      .then((d) => setBrands((d.brands ?? []) as BrandOption[]))
      .finally(() => setBrandsLoading(false))
  }, [])

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brandId, brands],
  )

  useEffect(() => {
    if (modelTouched) return
    setModelName(deriveModelName(canonicalName, selectedBrand?.name ?? null))
  }, [canonicalName, selectedBrand, modelTouched])

  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase()
    if (!q) return brands
    return brands.filter((b) => b.name.toLowerCase().includes(q))
  }, [brandSearch, brands])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!brandId || !canonicalName.trim() || !modelName.trim()) {
      setError('Brand, navn og model er påkrævede')
      return
    }
    setSubmitting(true)
    setError(null)

    const body: Record<string, unknown> = {
      canonical_name: canonicalName.trim(),
      slug: slugifySimple(canonicalName.trim()),
      model_name: modelName.trim(),
      brand_id: brandId,
      tier,
      status: 'active',
    }
    const yearTrimmed = year.trim()
    if (yearTrimmed) body.year_released = parseInt(yearTrimmed, 10)

    try {
      const res = await fetch('/api/admin/product/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (res.status === 409) {
        setError('Slug findes allerede. Justér navnet.')
        return
      }
      if (!res.ok) {
        setError(data.error ?? 'Kunne ikke oprette produkt')
        return
      }

      await onCreated(data.slug, canonicalName.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 p-3 rounded-xl"
      style={{ background: 'var(--secondary)', border: '1px solid var(--border)' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
        Opret nyt produkt
      </p>

      {/* Brand searchable select */}
      <div className="relative">
        {selectedBrand ? (
          <div
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <span style={{ color: 'var(--foreground)' }}>{selectedBrand.name}</span>
            <button
              type="button"
              onClick={() => { setBrandId(null); setBrandSearch('') }}
              className="text-[10px]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Skift brand
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={brandSearch}
              onChange={(e) => { setBrandSearch(e.target.value); setBrandOpen(true) }}
              onFocus={() => setBrandOpen(true)}
              onBlur={() => setTimeout(() => setBrandOpen(false), 150)}
              placeholder={brandsLoading ? 'Loading brands…' : 'Vælg brand'}
              disabled={brandsLoading}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none disabled:opacity-50"
              style={{
                background: 'var(--input-background)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            />
            {brandOpen && filteredBrands.length > 0 && (
              <div
                className="absolute z-30 left-0 right-0 mt-1 rounded-lg overflow-hidden max-h-48 overflow-y-auto"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
              >
                {filteredBrands.slice(0, 30).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setBrandId(b.id); setBrandSearch(''); setBrandOpen(false) }}
                    className="w-full text-left text-sm px-3 py-1.5 hover:opacity-80"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <input
        type="text"
        value={canonicalName}
        onChange={(e) => setCanonicalName(e.target.value)}
        placeholder="Canonical name (Brand + Model)"
        className="text-sm px-3 py-2 rounded-lg outline-none"
        style={{
          background: 'var(--input-background)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
        }}
      />

      <input
        type="text"
        value={modelName}
        onChange={(e) => { setModelName(e.target.value); setModelTouched(true) }}
        placeholder="Model name"
        className="text-sm px-3 py-2 rounded-lg outline-none"
        style={{
          background: 'var(--input-background)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
        }}
      />

      <div className="flex flex-wrap gap-2">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as CreateTier)}
          className="text-sm px-3 py-2 rounded-lg outline-none"
          style={{
            background: 'var(--input-background)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        >
          <option value="legendary">Legendary</option>
          <option value="classic">Classic</option>
          <option value="standard">Standard</option>
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Årstal (valgfri)"
          min={1900}
          max={2030}
          className="w-32 text-sm px-3 py-2 rounded-lg outline-none"
          style={{
            background: 'var(--input-background)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        />
      </div>

      {error && (
        <p className="text-xs" style={{ color: 'rgb(239,68,68)' }}>{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !brandId || !canonicalName.trim() || !modelName.trim()}
          className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {submitting ? 'Opretter…' : 'Opret og flyt'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
          style={{ background: 'transparent', color: 'var(--muted-foreground)' }}
        >
          Tilbage
        </button>
      </div>
    </form>
  )
}
