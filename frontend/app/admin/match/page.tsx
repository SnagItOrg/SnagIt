'use client'

import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Candidate } from '@/app/api/admin/match/candidates/route'
import {
  ALL_SOURCE_KEYS,
  MATCH_SOURCES,
  sourceForStored,
} from '@/lib/admin-match-sources'
import {
  canSave,
  createInitialState,
  decisionCounts,
  isLoadingCandidates,
  isSelectionSettling,
  matchReducer,
  savePayload,
  sourcesDiffer,
  type MatchAction,
  type MatchProduct,
  type MatchState,
} from './match-state'

type Reducer = (s: MatchState<Candidate>, a: MatchAction<Candidate>) => MatchState<Candidate>

function AdminMatchPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const productParam = params.get('product')

  const [state, dispatch] = useReducer(
    matchReducer as Reducer,
    ALL_SOURCE_KEYS,
    createInitialState<Candidate>,
  )

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Aborts the sweep that is no longer wanted. Paired with the request id. */
  const inFlight = useRef<AbortController | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toast, setToast] = useReducer(
    (_: string | null, next: string | null) => next,
    null as string | null,
  )

  const { selectedProduct, candidateRequest, candidates, localDecisions, sourceSelection } = state
  const counts = decisionCounts(state)
  const loading = isLoadingCandidates(state)
  const settling = isSelectionSettling(state)
  const sourcesPending = sourcesDiffer(state)

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  /* ── product search ───────────────────────────────────────────────────── */

  function handleQueryChange(value: string) {
    dispatch({ type: 'search_input_changed', value })
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (value.trim().length < 2) return
    searchDebounce.current = setTimeout(async () => {
      dispatch({ type: 'search_started' })
      try {
        const res = await fetch(`/api/admin/match/search?q=${encodeURIComponent(value)}`)
        if (!res.ok) {
          dispatch({ type: 'search_failed', message: `Søgning fejlede (${res.status})` })
          return
        }
        const data = (await res.json()) as { products: MatchProduct[] }
        dispatch({ type: 'search_results_received', products: data.products ?? [] })
      } catch {
        dispatch({ type: 'search_failed', message: 'Søgning fejlede' })
      }
    }, 300)
  }

  /**
   * Selecting a product writes the slug to the URL and nothing else. The
   * candidate sweep is driven by the effect below, keyed on the request id, so
   * there is exactly one place that can start a request.
   */
  const selectProduct = useCallback(
    (product: MatchProduct) => {
      dispatch({ type: 'product_selected', product })
      router.replace(`/admin/match?product=${encodeURIComponent(product.slug)}`, { scroll: false })
    },
    [router],
  )

  /**
   * Restore the selection from `?product=<slug>` on load, reload and
   * back/forward.
   *
   * Dispatching `product_selected` for a product that is already selected is a
   * no-op on the request counter, so arriving here after a click cannot start a
   * second sweep for the same product.
   */
  useEffect(() => {
    if (!productParam) {
      if (state.selectedProduct) dispatch({ type: 'product_cleared' })
      return
    }
    if (state.selectedProduct?.slug === productParam) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/match/search?q=${encodeURIComponent(productParam)}`)
        if (!res.ok) return
        const data = (await res.json()) as { products: MatchProduct[] }
        const hit = (data.products ?? []).find((p) => p.slug === productParam)
        if (!cancelled && hit) dispatch({ type: 'product_selected', product: hit })
      } catch {
        /* a failed restore leaves the page in its empty state, which is honest */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productParam])

  /* ── candidate sweep ──────────────────────────────────────────────────── */

  const requestId = candidateRequest.id
  const requestProductId = candidateRequest.productId
  const productName = selectedProduct?.canonical_name ?? null
  const sourcesParam = sourceSelection.join(',')

  useEffect(() => {
    if (candidateRequest.status !== 'loading') return
    if (!requestProductId || !productName) return

    // Whatever was in flight belongs to a selection the operator has left.
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    ;(async () => {
      try {
        const res = await fetch(
          `/api/admin/match/candidates?product_id=${requestProductId}` +
            `&product_name=${encodeURIComponent(productName)}` +
            `&sources=${sourcesParam}`,
          { signal: controller.signal },
        )
        if (!res.ok) {
          dispatch({
            type: 'candidates_failed',
            requestId,
            productId: requestProductId,
            message:
              res.status === 401 || res.status === 403
                ? 'Ingen adgang — log ind som admin igen.'
                : `Kunne ikke hente kandidater (${res.status})`,
          })
          return
        }
        const data = (await res.json()) as { candidates: Candidate[] }
        // The reducer re-checks both the id and the product; this dispatch is
        // inert if the operator has moved on.
        dispatch({
          type: 'candidates_received',
          requestId,
          productId: requestProductId,
          candidates: data.candidates ?? [],
        })
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        dispatch({
          type: 'candidates_failed',
          requestId,
          productId: requestProductId,
          message: 'Kunne ikke hente kandidater',
        })
      }
    })()

    return () => controller.abort()
  }, [requestId, requestProductId, productName, sourcesParam, candidateRequest.status])

  useEffect(() => {
    return () => {
      inFlight.current?.abort()
      if (searchDebounce.current) clearTimeout(searchDebounce.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  /* ── save ─────────────────────────────────────────────────────────────── */

  async function saveDecisions() {
    const payload = savePayload(state)
    if (!payload) return
    const submitted = [...payload.listing_ids, ...payload.rejected_listing_ids]
    dispatch({ type: 'save_started' })
    try {
      const res = await fetch('/api/admin/match/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: payload.product_id,
          listing_ids: payload.listing_ids,
          rejected_listing_ids: payload.rejected_listing_ids,
        }),
      })
      const data = (await res.json()) as { approved?: number; rejected?: number; error?: string }
      if (!res.ok || data.error) {
        dispatch({ type: 'save_failed', message: data.error ?? `Kunne ikke gemme (${res.status})` })
        showToast(`Fejl: ${data.error ?? res.status}`)
        return
      }
      dispatch({ type: 'save_succeeded', savedIds: submitted })
      showToast(`✅ ${data.approved ?? 0} godkendt · ${data.rejected ?? 0} afvist`)
    } catch {
      dispatch({ type: 'save_failed', message: 'Kunne ikke gemme' })
      showToast('Fejl: netværk')
    }
  }

  const scoreLabel: Record<Candidate['score'], { label: string; color: string; icon: string }> = {
    yes:   { label: 'Relevant',      color: '#16a34a', icon: 'check_circle' },
    maybe: { label: 'Måske',         color: '#d97706', icon: 'help' },
    no:    { label: 'Ikke relevant', color: '#dc2626', icon: 'cancel' },
  }

  const saveEnabled = canSave(state) && !state.saving
  const listboxId = 'admin-match-suggestions'

  const brandFor = useMemo(
    () => (p: MatchProduct) => (p.kg_brand ? p.kg_brand.name : null),
    [],
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Match annoncer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Søg et produkt, lad Haiku vurdere kandidater, godkend manuelt.
        </p>
      </div>

      {/* Product search */}
      <div className="relative max-w-md">
        <label htmlFor="admin-match-search" className="sr-only">
          Søg produkt
        </label>
        <input
          id="admin-match-search"
          type="text"
          role="combobox"
          aria-expanded={state.searchResults.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={state.searchInput}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') dispatch({ type: 'search_dismissed' })
          }}
          placeholder="Søg produkt, fx Roland Juno-106…"
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        {state.searching && (
          <span
            className="material-symbols-outlined absolute right-3 top-2.5 animate-spin text-muted-foreground"
            style={{ fontSize: 20 }}
            aria-hidden="true"
          >
            progress_activity
          </span>
        )}
        {state.searchResults.length > 0 && (
          <div
            id={listboxId}
            role="listbox"
            className="surface-overlay absolute top-full mt-1 left-0 right-0 rounded-xl z-10 overflow-hidden"
          >
            {state.searchResults.map((p) => (
              <button
                key={p.id}
                role="option"
                aria-selected={selectedProduct?.id === p.id}
                onClick={() => selectProduct(p)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
              >
                <span className="font-medium text-foreground">{p.canonical_name}</span>
                {brandFor(p) && <span className="text-muted-foreground ml-2">{brandFor(p)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedProduct && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col min-w-0">
              {/* The target is stated twice on purpose: the name an operator
                  recognises, and the slug the decision will actually be written
                  against. */}
              <span className="text-sm font-semibold text-foreground">
                Matcher mod: {selectedProduct.canonical_name}
              </span>
              <a
                href={`/product/${selectedProduct.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                /product/{selectedProduct.slug} ↗
              </a>
            </div>
            <button
              onClick={() => dispatch({ type: 'candidates_reload_requested' })}
              disabled={loading}
              className="ml-auto px-3 py-2 rounded-xl text-sm font-medium border text-foreground transition-opacity disabled:opacity-50 hover:bg-secondary"
              style={{ borderColor: sourcesPending ? '#d97706' : 'var(--border)' }}
            >
              {loading ? 'Henter…' : sourcesPending ? 'Genindlæs · kilder ændret' : 'Genindlæs'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Kilder:</span>
            {MATCH_SOURCES.map(({ key, label, color }) => {
              const active = sourceSelection.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => dispatch({ type: 'source_toggled', key })}
                  aria-pressed={active}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all"
                  style={{
                    backgroundColor: active ? color : 'transparent',
                    borderColor: color,
                    color: active ? '#fff' : color,
                    opacity: active ? 1 : 0.5,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Candidate list */}
      {loading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
          <p className="text-xs text-muted-foreground" role="status">
            Haiku vurderer relevans for {selectedProduct?.canonical_name}…
          </p>
        </div>
      )}

      {state.error && !loading && (
        <p className="text-sm" role="alert" style={{ color: 'var(--destructive-text)' }}>
          {state.error}
        </p>
      )}

      {!loading && candidates.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {candidates.length} kandidater · {counts.approved} godkendt · {counts.rejected} afvist
            </p>
            <button
              onClick={saveDecisions}
              disabled={!saveEnabled}
              title={settling ? 'Vent til kandidater er hentet' : undefined}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#16a34a' }}
            >
              {state.saving ? 'Gemmer…' : `Gem ${counts.total > 0 ? counts.total : ''}`}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {candidates.map((c) => {
              const verdict = localDecisions[c.id]
              const isApproved = verdict === 'approved'
              const isRejected = verdict === 'rejected'
              const s = scoreLabel[c.score]
              const sourceMeta = sourceForStored(c.source)
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-3 p-3 rounded-xl border transition-colors"
                  style={{
                    borderColor: isApproved ? '#16a34a' : isRejected ? '#dc2626' : 'var(--border)',
                    backgroundColor: isApproved ? '#16a34a12' : isRejected ? '#dc262610' : 'var(--card)',
                    opacity: isRejected ? 0.6 : 1,
                  }}
                >
                  {/* Thumbnail, when the source stored one */}
                  {c.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.image_url}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-muted"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg flex-shrink-0 bg-muted flex items-center justify-center">
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--muted-foreground)' }}>
                        image_not_supported
                      </span>
                    </div>
                  )}
                  {/* Haiku score */}
                  <div className="flex flex-col items-center gap-0.5 pt-0.5 min-w-[52px]">
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: s.color }}>
                      {s.icon}
                    </span>
                    <span className="text-[10px] font-medium" style={{ color: s.color }}>{s.label}</span>
                  </div>

                  {/* Listing info */}
                  <div className="flex-1 min-w-0">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground hover:underline truncate block"
                    >
                      {c.title}
                    </a>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.reason}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: sourceMeta?.color ?? 'var(--muted)',
                          color: '#fff',
                        }}
                      >
                        {sourceMeta?.label ?? c.source}
                      </span>

                      {/*
                        The asking price in the currency it was actually listed
                        in. Kleinanzeigen quotes EUR, so rendering the raw number
                        with a "kr" suffix — as this card used to — turned a
                        450 EUR synth into a 450 kr one.
                      */}
                      {c.price != null ? (
                        <span className="text-xs font-medium text-foreground">
                          {c.price.toLocaleString('da-DK')} {c.currency ?? 'DKK'}
                          {c.price_dkk != null && c.currency !== 'DKK' && (
                            <span className="text-muted-foreground font-normal">
                              {' '}≈ {Math.round(c.price_dkk).toLocaleString('da-DK')} kr
                            </span>
                          )}
                        </span>
                      ) : (
                        /* Absence is shown, not filtered: 265 of ~2,141 active
                           Kleinanzeigen rows have no price, and they are still
                           real listings that may belong to this product. */
                        <span className="text-xs font-medium" style={{ color: '#d97706' }}>
                          Ingen pris
                        </span>
                      )}

                      {c.location ? (
                        <span className="text-xs text-muted-foreground truncate">{c.location}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Ingen lokation</span>
                      )}
                    </div>
                  </div>

                  {/* Actions — approve and reject remain the primary card actions */}
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => dispatch({ type: 'decision_toggled', listingId: c.id, verdict: 'approved' })}
                      aria-pressed={isApproved}
                      aria-label={`Godkend ${c.title}`}
                      className="p-1.5 rounded-lg transition-colors hover:bg-secondary"
                      title="Godkend"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: isApproved ? '#16a34a' : 'var(--muted-foreground)' }}>
                        check
                      </span>
                    </button>
                    <button
                      onClick={() => dispatch({ type: 'decision_toggled', listingId: c.id, verdict: 'rejected' })}
                      aria-pressed={isRejected}
                      aria-label={`Afvis ${c.title}`}
                      className="p-1.5 rounded-lg transition-colors hover:bg-secondary"
                      title="Afvis — gemmes som varigt nej"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: isRejected ? '#dc2626' : 'var(--muted-foreground)' }}>
                        close
                      </span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {!loading && !state.error && selectedProduct && candidates.length === 0 &&
        candidateRequest.status === 'ready' && (
        <p className="text-sm text-muted-foreground">
          Ingen kandidater tilbage for {selectedProduct.canonical_name} med de valgte kilder.
        </p>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg z-50"
          style={{ backgroundColor: '#1a1a1a' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

export default function AdminMatchPage() {
  return (
    <Suspense>
      <AdminMatchPageInner />
    </Suspense>
  )
}
