'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePostHog } from 'posthog-js/react'
import { SideNav } from '@/components/SideNav'
import { BottomNav } from '@/components/BottomNav'
import { useLocale } from '@/components/LocaleProvider'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { getFamily } from '@/lib/families'
import {
  demandSignalPayload,
  type DemandSignalPayload,
  searchResolvedPayload,
  searchSubmittedPayload,
  searchUnsupportedPayload,
  type SearchCandidate,
  type SearchInputMethod,
  type SearchOutcome,
  type SearchResolvedPayload,
  type SearchSubmittedPayload,
  type SearchUnsupportedPayload,
} from '@/lib/search-resolver'

/**
 * Restricted catalogue search.
 *
 * Stage 3 WP-4. See docs/stage-3-v1-decision-and-build-plan.md §8.2.
 *
 * SEARCH IS A RESOLVER, NOT A RESULT PAGE. This page asks "which Klup entity do
 * you mean?" and renders exactly one of the resolver's outcomes. What it no
 * longer does, deliberately:
 *
 *   - call `/api/scrape`. Every submitted query used to run four live
 *     marketplace scrapes through an unauthenticated write endpoint;
 *   - render a listing grid — mobile list and desktop 4-column;
 *   - offer five source-toggle chips or a five-way sort control, both of which
 *     only make sense for a generic SERP;
 *   - offer a free-text "Opret overvågning" button, which created a watchlist
 *     from whatever the visitor happened to type;
 *   - claim "Vi søger på {platforms} samtidig".
 *
 * None of that is compatible with a curated catalogue, and the last two
 * actively misdescribed what Klup does.
 */

type ResolveResponse = SearchOutcome | { error: string }

function isOutcome(value: ResolveResponse): value is SearchOutcome {
  return typeof (value as SearchOutcome).outcome === 'string'
}

/** `?demand=family:<slug>` — the only form of the parameter that is honoured. */
const DEMAND_FAMILY_PREFIX = 'family:'

/**
 * Build the unsupported outcome for a family-originated demand capture.
 *
 * WP-2's family route renders no children while it has no canonical ones, and
 * sends the visitor here to register that they wanted it. The interesting
 * property is what this must NOT do: it must not resolve the family term,
 * because resolving `Gibson Les Paul` would navigate straight back to
 * `/family/gibson-les-paul` and bounce the visitor between two pages. So the
 * outcome is constructed locally, never fetched, and carries no navigation.
 *
 * The label comes from `lib/families.ts` when the slug is a real family. An
 * unknown slug still produces a valid demand capture — a fabricated URL should
 * not be able to break the page — it simply has nothing nicer to display than
 * the slug itself.
 */
function familyDemandOutcome(familySlug: string): SearchOutcome {
  const family = getFamily(familySlug)
  const term = family?.label ?? familySlug.replace(/-/g, ' ')
  return {
    outcome: 'unsupported',
    resolution: 'unsupported',
    resolutionClass: 'unsupported',
    queryNorm: term.toLowerCase(),
    rawTokenCount: term.split(/\s+/).filter(Boolean).length,
    navigateTo: null,
    navigateKind: null,
    navigateSlug: null,
    autoNavigated: false,
    candidates: [],
    suggestions: [],
    viaSynonym: false,
  }
}

/**
 * The analytics seam.
 *
 * WP-5 owns `lib/analytics.ts`, the consent gate and the tracker mounting, and
 * WP-4 may not write those files. Until WP-5 lands, events go through the
 * PostHog client the app already provides — which WP-5's provider will gate, so
 * consent is honoured without WP-4 owning any of it.
 *
 * INTEGRATION (bounded, one function body): replace the call below with
 * `track(event, props)` from `@/lib/analytics`. Nothing else on this page
 * changes, because every payload is built by a typed helper in
 * `lib/search-resolver.ts` against WP-5's `KlupEventMap` shapes — so the swap
 * is a substitution, not a migration, and no call site ever passes an email
 * address.
 */
/**
 * The four WP-5 events this page is allowed to emit, with their exact payloads.
 *
 * Deliberately shaped like WP-5's own `track<E extends KlupEventName>(event: E,
 * properties: KlupEventMap[E])`, so the integration is a substitution rather
 * than a migration — and so this page CANNOT emit an event outside the
 * taxonomy or an event with the wrong payload. There is no `Record<string,
 * unknown>` escape hatch and no cast: an undeclared property is a compile
 * error here exactly as it will be after the swap.
 */
type SearchEventMap = {
  search_submitted: SearchSubmittedPayload
  search_resolved: SearchResolvedPayload
  search_unsupported: SearchUnsupportedPayload
  demand_signal_submitted: DemandSignalPayload
}

function useEmit() {
  const posthog = usePostHog()
  return useCallback(
    <E extends keyof SearchEventMap>(event: E, properties: SearchEventMap[E]) => {
      posthog?.capture(event, properties)
    },
    [posthog],
  )
}

function SearchPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { t } = useLocale()
  const emit = useEmit()

  const initialQuery = params.get('q') ?? ''

  // `?demand=family:<slug>` arrives from an empty WP-2 family route.
  const demandParam = params.get('demand') ?? ''
  const demandFamilySlug = demandParam.startsWith(DEMAND_FAMILY_PREFIX)
    ? demandParam.slice(DEMAND_FAMILY_PREFIX.length).trim()
    : ''

  const familyPrefill = demandFamilySlug ? (getFamily(demandFamilySlug)?.label ?? '') : ''
  const [inputValue, setInputValue] = useState(
    // The field is pre-filled with the family term so the visitor can refine it
    // into a real search instead of retyping what they just clicked away from.
    initialQuery || familyPrefill,
  )
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  /** The family term the field was seeded with, so an unedited submit is honest. */
  const prefillSeed = useRef<string>('')
  /** Guards against a stale response overwriting a newer one. */
  const requestSeq = useRef(0)

  /**
   * Everything the visitor may click, in render order, so the keyboard and the
   * pointer traverse exactly the same set.
   */
  const options: SearchCandidate[] = useMemo(() => {
    if (!outcome) return []
    return outcome.candidates.length > 0 ? outcome.candidates : outcome.suggestions
  }, [outcome])

  const runSearch = useCallback(
    async (rawQuery: string, inputMethod: SearchInputMethod) => {
      const q = rawQuery.trim()
      if (q.length === 0) return

      const seq = ++requestSeq.current
      setLoading(true)
      setError(null)
      setActiveIndex(-1)

      // `entry_surface` is 'search' because this page IS the search surface;
      // the landing field and the mobile bar route here and are WP-3's to
      // instrument with their own surface value.
      emit('search_submitted', searchSubmittedPayload(q, 'search', inputMethod))

      const startedAt = Date.now()
      try {
        const res = await fetch(`/api/search/resolve?q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
        })
        const latencyMs = Date.now() - startedAt
        const data = (await res.json()) as ResolveResponse
        if (seq !== requestSeq.current) return

        if (!res.ok || !isOutcome(data)) {
          setOutcome(null)
          setError(t.searchFailed)
          return
        }

        setOutcome(data)

        // A family hit is an `accepted_alias` whose `product_slug` is null: it
        // resolved to a navigation concept, not to a priced identity.
        emit('search_resolved', searchResolvedPayload(data, latencyMs))

        // Emitted for every non-resolving outcome — unsupported, no-result and
        // dangerous-blocked alike — with the declared `resolution_class` telling
        // them apart. The builder returns null for the two outcomes that did
        // resolve, which is how this knows not to emit.
        const unsupported = searchUnsupportedPayload(data)
        if (unsupported) emit('search_unsupported', unsupported)

        // Exact and accepted-alias hits navigate. Nothing else ever does: a
        // dangerous term and an ambiguous term both land on the candidate set,
        // which is guardrail G1.
        if (data.navigateTo) {
          router.push(data.navigateTo)
        }
      } catch {
        if (seq !== requestSeq.current) return
        setOutcome(null)
        setError(t.unknownError)
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [emit, router, t.searchFailed, t.unknownError],
  )

  // Resolve on mount when the URL already carries ?q=, so a shared or
  // bookmarked search link behaves the same as a typed one.
  //
  // Demand mode takes precedence and does NOT resolve. Resolving the family
  // term would navigate straight back to the family the visitor just left.
  useEffect(() => {
    if (demandFamilySlug.length > 0) {
      prefillSeed.current = familyPrefill.trim()
      const built = familyDemandOutcome(demandFamilySlug)
      setOutcome(built)
      const unsupported = searchUnsupportedPayload(built)
      if (unsupported) emit('search_unsupported', unsupported)
      return
    }
    // Arrived with ?q= already set, so the query came from the URL, not from
    // this visitor's keyboard.
    if (initialQuery.trim().length > 0) void runSearch(initialQuery, 'url_param')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const q = inputValue.trim()
    if (q.length === 0) return
    router.replace(`/search?q=${encodeURIComponent(q)}`)
    // A family-prefilled term submitted UNCHANGED came from the URL, so it is
    // reported as `url_param`. The moment the visitor edits it, it is theirs
    // and becomes `typed`. Calling the untouched prefill "typed" would inflate
    // manual search intent with clicks that happened on a family page.
    const method: SearchInputMethod = q === prefillSeed.current ? 'url_param' : 'typed'
    void runSearch(q, method)
  }

  /**
   * Keyboard traversal over the candidate set.
   *
   * ArrowDown/ArrowUp move, Enter opens the highlighted option or submits when
   * nothing is highlighted, Escape clears the highlight. Without this the
   * disambiguation screen — the one outcome that deliberately refuses to choose
   * for the visitor — would be reachable only with a pointer.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      router.push(options[activeIndex].href)
    } else if (e.key === 'Escape') {
      setActiveIndex(-1)
    }
  }

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const showCandidates = outcome !== null && outcome.candidates.length > 0
  const showUnsupported =
    outcome !== null && (outcome.outcome === 'unsupported' || outcome.outcome === 'no_result')

  return (
    <div className="min-h-screen bg-bg md:flex">
      <SideNav active="soeg" onChange={() => {}} />

      <div className="flex-1 min-w-0 flex flex-col md:ml-60">
        <div className="px-4 pt-6 pb-2 md:px-8">
          <h1 className="text-xl font-black text-foreground">{t.searchPageHeading}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.searchPageSubtext}</p>
        </div>

        <div className="sticky top-0 z-30 w-full bg-bg border-b border-border px-4 py-3 md:px-8">
          <form onSubmit={handleSubmit} role="search">
            <label htmlFor="klup-search" className="sr-only">
              {t.searchPageHeading}
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ fontSize: '18px', color: 'var(--muted-foreground)' }}
              >
                search
              </span>
              <input
                id="klup-search"
                ref={inputRef}
                type="search"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t.searchInputPlaceholder}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="klup-search-options"
                aria-activedescendant={
                  activeIndex >= 0 ? `klup-search-option-${activeIndex}` : undefined
                }
                // 16px minimum (text-base): anything smaller makes iOS Safari
                // zoom the viewport on focus and the visitor loses the page.
                className="w-full rounded-xl pl-9 pr-4 py-3 text-base font-medium outline-none transition-all placeholder:opacity-50"
                style={{
                  backgroundColor: 'var(--input-background)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              />
            </div>
            <button
              type="submit"
              className="mt-2 w-full min-h-[44px] rounded-xl px-5 text-sm font-semibold transition-opacity hover:opacity-90 md:w-auto md:px-6"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {t.search}
            </button>
          </form>
        </div>

        <main className="flex-1 px-4 pt-5 pb-24 md:px-8 md:pb-10">
          <div aria-live="polite" aria-atomic="true">
            {loading ? (
              <div className="flex flex-col gap-3 max-w-2xl">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-2xl bg-card border border-border animate-pulse"
                  />
                ))}
              </div>
            ) : error ? (
              <div
                className="rounded-xl px-4 py-3 text-sm max-w-2xl"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: 'var(--foreground)',
                }}
              >
                {error}
              </div>
            ) : showCandidates ? (
              <section className="max-w-2xl">
                <h2 className="text-base font-semibold text-foreground mb-3">
                  {t.searchAmbiguousHeading}
                </h2>
                <CandidateList
                  id="klup-search-options"
                  listRef={listRef}
                  options={outcome!.candidates}
                  activeIndex={activeIndex}
                />
              </section>
            ) : showUnsupported ? (
              <UnsupportedPanel outcome={outcome!} listRef={listRef} activeIndex={activeIndex} />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-sm mx-auto">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined"
                  style={{ fontSize: '48px', color: 'var(--muted-foreground)', opacity: 0.4 }}
                >
                  manage_search
                </span>
                <p className="text-base font-semibold text-foreground">{t.searchEmptyHeading}</p>
                <p className="text-sm text-muted-foreground">{t.searchEmptySubtext}</p>
              </div>
            )}
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  )
}

/**
 * NO CLICK EVENT IS EMITTED HERE, DELIBERATELY.
 *
 * The only declared card-click event is `discovery_product_clicked`, whose
 * `shelf` union is `followed | recent | browse_grid | related`. A search
 * disambiguation is none of those. Labelling it `browse_grid` or `related`
 * would put search clicks into browse and product-page reports and quietly
 * corrupt every shelf metric derived from them — a measurement gap is
 * recoverable, a poisoned taxonomy is not.
 *
 * V1 therefore accepts the gap. Direct and automatic resolution is still fully
 * measured by `search_resolved` (`auto_navigated`, `resolution`,
 * `candidate_count`), and adding a search shelf value is WP-5's decision, not
 * WP-4's to take by inventing an enum member.
 */
function CandidateList({
  id,
  options,
  activeIndex,
  listRef,
}: {
  id: string
  options: SearchCandidate[]
  activeIndex: number
  listRef: React.RefObject<HTMLUListElement>
}) {
  return (
    <ul id={id} ref={listRef} role="listbox" className="flex flex-col gap-2">
      {options.map((option, i) => (
        <li
          key={option.href}
          id={`klup-search-option-${i}`}
          role="option"
          aria-selected={i === activeIndex}
        >
          <Link
            href={option.href}
            className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 min-h-[56px] transition-colors hover:bg-secondary"
            style={{
              background: i === activeIndex ? 'var(--secondary)' : 'var(--card)',
              borderColor: i === activeIndex ? 'var(--ring)' : 'var(--border)',
            }}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground truncate">
                {option.label}
              </span>
              <span className="block text-xs text-muted-foreground truncate">{option.brand}</span>
            </span>
            <span
              aria-hidden="true"
              className="material-symbols-outlined shrink-0"
              style={{ fontSize: 18, color: 'var(--muted-foreground)' }}
            >
              chevron_right
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * The unsupported screen.
 *
 * Three things, in order: an honest statement that Klup does not follow this,
 * the nearest products it does follow, and a single control to register that
 * someone wanted it. No empty SERP and no generic listing list, ever.
 */
function UnsupportedPanel({
  outcome,
  listRef,
  activeIndex,
}: {
  outcome: SearchOutcome
  listRef: React.RefObject<HTMLUListElement>
  activeIndex: number
}) {
  const { t } = useLocale()
  const emit = useEmit()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submitDemand(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const address = email.trim()

    // The e-mail address goes to Supabase through the existing magic-link path
    // — a user-initiated service request — and NEVER to PostHog. The analytics
    // payload carries a boolean (build plan §8.5, §12.2).
    if (address.length > 0) {
      try {
        const supabase = createSupabaseBrowserClient()
        await supabase.auth.signInWithOtp({
          email: address,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${window.location.origin}/auth/confirm`,
          },
        })
      } catch {
        // A failed send must not lose the demand signal; it is still recorded.
      }
    }

    emit('demand_signal_submitted', demandSignalPayload(outcome, address))

    setBusy(false)
    setSent(true)
  }

  return (
    <section className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t.searchNotFollowedHeading}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t.searchNotFollowedBody}</p>
      </div>

      {outcome.suggestions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">{t.searchNearestHeading}</h3>
          <CandidateList
            id="klup-search-options"
            listRef={listRef}
            options={outcome.suggestions}
            activeIndex={activeIndex}
          />
        </div>
      )}

      <div
        className="rounded-2xl border p-4"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        {sent ? (
          <p className="text-sm font-semibold text-foreground">{t.demandThanks}</p>
        ) : open ? (
          <form onSubmit={submitDemand} className="flex flex-col gap-2">
            <label htmlFor="klup-demand-email" className="text-sm font-semibold text-foreground">
              {t.demandCta}
            </label>
            <input
              id="klup-demand-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              className="w-full rounded-xl px-3 py-3 text-base outline-none"
              style={{
                backgroundColor: 'var(--input-background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[44px] rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {t.sendLoginLink}
            </button>
            <p className="text-[11px] text-center text-muted-foreground">{t.noPasswordNeeded}</p>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 min-h-[44px] text-sm font-semibold text-foreground"
          >
            <span aria-hidden="true" className="material-symbols-outlined" style={{ fontSize: 18 }}>
              notifications
            </span>
            {t.demandCta}
          </button>
        )}
      </div>
    </section>
  )
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  )
}
