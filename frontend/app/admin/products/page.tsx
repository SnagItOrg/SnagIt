'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

import { Toast } from '@/components/Toast'
import { useToast } from '@/lib/use-toast'

/**
 * Mirrors `ExposureState` / `SupportState` in `lib/catalogue.ts` as TYPES only.
 * That module is server-only — a client module may not reach catalogue
 * eligibility by value import — so the effective state is computed by
 * /api/admin/products and arrives here as a string.
 */
type ExposureState = 'live_in_browse' | 'page_only' | 'unsupported' | 'inactive' | 'hidden'
type SupportState = 'known' | 'reserve' | 'supported'

type Tier = 'standard' | 'classic' | 'legendary'
type BrowseVisibility = 'public' | 'qa_only' | 'hidden'

type Product = {
  id: string
  slug: string
  canonical_name: string
  tier: Tier
  status: string
  support_state: SupportState
  browse_visibility: BrowseVisibility
  subcategory_id: string | null
  /** Derived by `browse_product_projection`, not stored on the product. */
  taxonomy_state: string | null
  browse_domain: string | null
  /** Derived server-side by `effectiveExposure`. */
  exposure: ExposureState
  year_released: number | null
  image_url: string | null
  kg_brand: { name: string } | null
}

type Subcategory = { id: string; name: string; parent_name: string | null; classifies: boolean }

/**
 * The one publication vocabulary the normal workflow exposes.
 *
 * PAN-22. `known / reserve / supported` and `public / qa_only / hidden` are
 * internal axes, and showing both let a product read "Public" while its page
 * answered 404. The operator now picks an outcome; the server derives the
 * axes in a single atomic transition.
 */
type PublicationAction = 'public' | 'qa' | 'hidden'

const PUBLICATION_ORDER: PublicationAction[] = ['public', 'qa', 'hidden']

const PUBLICATION_LABEL: Record<PublicationAction, string> = {
  public: 'Public',
  qa:     'QA',
  hidden: 'Hidden',
}

/** Which action a row is currently AT, derived from its effective exposure. */
function currentAction(p: Product): PublicationAction | null {
  if (p.browse_visibility === 'hidden') return 'hidden'
  if (p.exposure === 'live_in_browse' || p.exposure === 'page_only') return 'public'
  if (p.support_state === 'supported' && p.browse_visibility === 'qa_only') return 'qa'
  return null
}

/**
 * The effective state, and the ONE gate to fix next.
 *
 * `Public` is deliberately not a label here. It is a value of one axis out of
 * four, and using it as a status is what made the list claim 35 exposed
 * products where 14 have a page.
 */
const EXPOSURE_LABEL: Record<ExposureState, string> = {
  live_in_browse: 'Live i browse',
  page_only:      'Kun produktside',
  unsupported:    'Blokeret: ikke understøttet',
  inactive:       'Blokeret: inaktiv',
  hidden:         'Skjult',
}

const EXPOSURE_BLOCKER: Record<ExposureState, string | null> = {
  live_in_browse: null,
  page_only:      'Mangler taxonomy — vælg en underkategori for at komme i browse.',
  unsupported:    'Support er ikke “supported” — produktsiden svarer 404.',
  inactive:       'Identiteten er inaktiv — intet vises.',
  hidden:         'Browse visibility er ikke “public”.',
}

const EXPOSURE_STYLE: Record<ExposureState, { background: string; color: string }> = {
  live_in_browse: { background: 'var(--foreground)', color: 'var(--background)' },
  page_only:      { background: 'var(--secondary)', color: 'var(--foreground)' },
  unsupported:    { background: 'rgba(239,68,68,0.12)', color: 'rgb(239,68,68)' },
  inactive:       { background: 'rgba(239,68,68,0.12)', color: 'rgb(239,68,68)' },
  hidden:         { background: 'var(--secondary)', color: 'var(--muted-foreground)' },
}

const TIER_ORDER: Tier[] = ['standard', 'classic', 'legendary']
const TIER_LABEL: Record<Tier, string> = {
  standard:  'Standard',
  classic:   'Classic',
  legendary: 'Legendary',
}
const TIER_STYLE: Record<Tier, { background: string; color: string }> = {
  standard:  { background: 'var(--secondary)', color: 'var(--muted-foreground)' },
  classic:   { background: 'var(--secondary)', color: 'var(--foreground)' },
  legendary: { background: 'var(--foreground)', color: 'var(--background)' },
}

export default function AdminProductsPage() {
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [yearEditing, setYearEditing] = useState<string | null>(null)
  const [yearDraft, setYearDraft] = useState('')
  const [toast, showToast] = useToast()
  const [subcategories, setSubcategories] = useState<Subcategory[] | null>(null)
  const [subcatError, setSubcatError] = useState<string | null>(null)
  const [taxEditing, setTaxEditing] = useState<string | null>(null)

  const search = useCallback(async (q: string) => {
    setLoading(true)
    const url = q.trim()
      ? `/api/admin/products?q=${encodeURIComponent(q.trim())}`
      : `/api/admin/products?tier=legendary`
    const res = await fetch(url)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // "Ingen produkter fundet" must never stand in for a failed request.
      setProducts([])
      setSubcatError(null)
      showToast(data.error ? `Kunne ikke hente produkter: ${data.error}` : 'Kunne ikke hente produkter.')
      setLoading(false)
      return
    }
    setProducts(data.products ?? [])
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    search('')
  }, [search])

  /**
   * The subcategory source, loaded once. An empty list or a failed fetch is
   * reported as an error — "ingen resultater" would hide a broken endpoint.
   */
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/product/subcategories')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
        return body
      })
      .then((body: { subcategories?: Subcategory[] }) => {
        if (cancelled) return
        const list = body.subcategories ?? []
        if (list.length === 0) { setSubcatError('Underkategorier kunne ikke hentes (tom liste).'); return }
        setSubcategories(list)
      })
      .catch((e: Error) => { if (!cancelled) setSubcatError(`Underkategorier kunne ikke hentes: ${e.message}`) })
    return () => { cancelled = true }
  }, [])


  /**
   * One product, one field, one request — through the existing PATCH route, so
   * its axis/intent rules, its validation and its before/after manifest all
   * still apply. No bulk action exists here on purpose.
   */
  async function patchProduct(
    product: Product,
    body: Record<string, unknown>,
    patch: Partial<Product>,
    successText: string,
  ) {
    setSaving(product.id)
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.message ?? data.error ?? 'Kunne ikke gemme.')
        return false
      }
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...patch } : p)))
      showToast(successText)
      // Exposure is derived from four axes and a view; re-read it rather than
      // predict it, so the badge can never claim a state the data does not have.
      void search(query)
      return true
    } catch {
      showToast('Kunne ikke gemme. Prøv igen.')
      return false
    } finally {
      setSaving(null)
    }
  }


  async function setSubcategory(product: Product, subcategoryId: string) {
    const chosen = subcategories?.find((c) => c.id === subcategoryId)
    const ok = await patchProduct(
      product,
      { subcategory_id: subcategoryId, intent: ['taxonomy'] },
      // `taxonomy_state` is derived by the view, so it is re-read rather than
      // guessed: a successful write is only `classified` if the root maps.
      { subcategory_id: subcategoryId, taxonomy_state: chosen?.classifies ? 'classified' : null },
      `${product.canonical_name}: underkategori sat til ${chosen?.name ?? '—'}.`,
    )
    if (ok) setTaxEditing(null)
  }

  async function cycleTier(product: Product) {
    const currentIdx = TIER_ORDER.indexOf(product.tier)
    const nextTier = TIER_ORDER[(currentIdx + 1) % TIER_ORDER.length]
    setSaving(product.id)
    await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // `monitoring` is the PATCH route's declaration token for the tier axis —
      // a historical name kept because FIELD_AXIS is that route's axis mapping,
      // which Stage 3 WP-2 may not change (build plan §15.2). Declaring it does
      // NOT change marketplace monitoring: tier stopped being a scraper selector
      // in 04B, and the query sets live in data/klup-source-monitoring.json.
      // Sending ['metadata'] here today would be rejected as `undeclared_axis`.
      // Renaming the axis on both sides is the bounded follow-up recorded in the
      // WP-2 hand-off.
      body: JSON.stringify({ tier: nextTier, intent: ['monitoring'] }),
    })
    setProducts((prev) =>
      prev.map((p) => p.id === product.id ? { ...p, tier: nextTier } : p)
    )
    showToast(`${product.canonical_name}: tier sat til ${TIER_LABEL[nextTier]}.`)
    setSaving(null)
  }

  /**
   * One action, one request, one atomic server-side transition.
   *
   * The client sends the OUTCOME and never the axes: the server owns the
   * mapping, so a partial state cannot exist between two client calls. On
   * success `patchProduct` re-reads the list, so the badge shows the server's
   * effective exposure rather than a predicted one.
   */
  async function setPublication(product: Product, action: PublicationAction) {
    await patchProduct(
      product,
      { publication: action },
      {},
      `${product.canonical_name}: ${PUBLICATION_LABEL[action]}.`,
    )
  }

  async function saveYear(product: Product) {
    const year = parseInt(yearDraft)
    if (isNaN(year) || year < 1900 || year > 2030) { setYearEditing(null); return }
    setSaving(product.id)
    await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year_released: year }),
    })
    setProducts((prev) =>
      prev.map((p) => p.id === product.id ? { ...p, year_released: year } : p)
    )
    setSaving(null)
    setYearEditing(null)
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
          Produkter
        </h1>
        <Link
          href="/admin/product/new"
          className="text-sm font-semibold px-4 py-2 rounded-xl"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          + Nyt produkt
        </Link>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--muted-foreground)' }}>
        Sæt tier, support, browse visibility, underkategori og årstal. Statusmærket viser
        den faktiske eksponering — ikke en enkelt databaseværdi. Tom søgning viser
        legendary-produkter. Tier er redaktionelt og ændrer ikke overvågning.
      </p>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(query)}
          placeholder="Søg produkt…"
          className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
          style={{
            background: 'var(--input-background)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          }}
        />
        <button
          onClick={() => search(query)}
          className="px-4 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          Søg
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--card)' }} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {products.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-2 px-4 py-3 rounded-xl"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              {/* Name first, on its own line. With four axis badges the old
                  single-row layout collapsed the name to "F…" at 360px, which
                  is the one thing the operator needs to identify the row. */}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                  {p.canonical_name}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--muted-foreground)' }}>
                  {p.kg_brand?.name ?? '—'} · {p.slug}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
              {/* Tier badge — click to cycle */}
              <button
                onClick={() => cycleTier(p)}
                disabled={saving === p.id}
                className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-opacity disabled:opacity-50 flex items-center gap-1"
                style={TIER_STYLE[p.tier]}
                title="Klik for at skifte tier (redaktionelt — ændrer ikke overvågning)"
              >
                {p.tier === 'legendary' && (
                  <span className="material-symbols-outlined" style={{ fontSize: 11 }}>workspace_premium</span>
                )}
                {TIER_LABEL[p.tier]}
              </button>

              {/* The single publication control. Three outcomes, one request
                  each. The internal axes are not offered here. */}
              <div
                className="shrink-0 flex items-center rounded-full overflow-hidden"
                style={{ border: '1px solid var(--border)' }}
                data-testid={`publication-${p.slug}`}
                role="group"
                aria-label="Publicering"
              >
                {PUBLICATION_ORDER.map((action) => {
                  const active = currentAction(p) === action
                  return (
                    <button
                      key={action}
                      onClick={() => setPublication(p, action)}
                      disabled={saving === p.id || active}
                      aria-pressed={active}
                      className="text-[11px] font-semibold px-2.5 py-1 transition-opacity disabled:opacity-100"
                      style={active
                        ? { background: 'var(--foreground)', color: 'var(--background)' }
                        : { background: 'transparent', color: 'var(--muted-foreground)' }}
                      title={action === 'public'
                        ? 'Offentlig produktside og browse. Kræver en music-underkategori.'
                        : action === 'qa'
                          ? 'Kun synlig for en admin-session.'
                          : 'Skjuler produktet. Support, matches og overvågning bevares.'}
                    >
                      {PUBLICATION_LABEL[action]}
                    </button>
                  )
                })}
              </div>

              {/* Year released — click to edit */}
              {yearEditing === p.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    value={yearDraft}
                    onChange={(e) => setYearDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveYear(p); if (e.key === 'Escape') setYearEditing(null) }}
                    className="w-20 rounded-lg px-2 py-1 text-sm text-center outline-none"
                    style={{ background: 'var(--input-background)', border: '1px solid var(--ring)', color: 'var(--foreground)' }}
                    autoFocus
                    placeholder="Årstal"
                  />
                  <button
                    onClick={() => saveYear(p)}
                    className="text-xs px-2 py-1 rounded-lg font-medium"
                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                  >
                    Gem
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setYearEditing(p.id); setYearDraft(String(p.year_released ?? '')) }}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors"
                  style={{ background: 'var(--secondary)', color: p.year_released ? 'var(--foreground)' : 'var(--muted-foreground)' }}
                >
                  {p.year_released ?? '+ År'}
                </button>
              )}
              </div>

              {/* Effective exposure, and the single gate to fix next. */}
              {(() => {
                const state = p.exposure
                const blocker = EXPOSURE_BLOCKER[state]
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      data-testid={`exposure-${p.slug}`}
                      className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={EXPOSURE_STYLE[state]}
                    >
                      {EXPOSURE_LABEL[state]}
                    </span>
                    {blocker && (
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {blocker}
                      </span>
                    )}

                    {/* Taxonomy, editable here so the blocker can be fixed on
                        the screen that reports it. */}
                    {taxEditing === p.id ? (
                      subcatError ? (
                        <span role="alert" className="text-xs" style={{ color: 'rgb(239,68,68)' }}>
                          {subcatError}
                        </span>
                      ) : (
                        <select
                          autoFocus
                          disabled={saving === p.id || subcategories === null}
                          defaultValue={p.subcategory_id ?? ''}
                          onChange={(e) => e.target.value && setSubcategory(p, e.target.value)}
                          data-testid={`subcategory-${p.slug}`}
                          className="text-xs rounded-lg px-2 py-1 outline-none"
                          style={{ background: 'var(--input-background)', border: '1px solid var(--ring)', color: 'var(--foreground)' }}
                        >
                          <option value="">{subcategories === null ? 'Henter…' : 'Vælg underkategori…'}</option>
                          {(subcategories ?? []).map((c) => (
                            <option key={c.id} value={c.id} disabled={!c.classifies}>
                              {c.parent_name ? `${c.parent_name} › ${c.name}` : c.name}
                              {c.classifies ? '' : ' (mapper ikke)'}
                            </option>
                          ))}
                        </select>
                      )
                    ) : (
                      <button
                        onClick={() => { setTaxEditing(p.id); if (subcatError) showToast(subcatError) }}
                        disabled={saving === p.id}
                        className="text-xs px-2.5 py-1 rounded-lg disabled:opacity-50"
                        style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
                      >
                        {p.taxonomy_state === 'classified' ? 'Skift underkategori' : '+ Underkategori'}
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
          ))}
          {products.length === 0 && !loading && (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--muted-foreground)' }}>
              Ingen produkter fundet.
            </p>
          )}
        </div>
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}
