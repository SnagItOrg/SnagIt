'use client'

/**
 * The admin live search, and the listing presentation it shares.
 *
 * MOVED, NOT COPIED. This section used to live inside
 * app/admin/product/[slug]/ProductCurationClient.tsx. PAN-31's ratified
 * surface decision puts the search where match curation actually happens —
 * /product/[slug]?review=1 — so the component moved here and BOTH pages import
 * it. There is exactly one implementation; importing it from the curation page
 * instead would drag that whole page into the product bundle.
 *
 * `SOURCE_BADGE`, `fmtNumber`, `fmtPrice` and `MatchedListing` moved with it
 * because the curation page's other sections use them too. They keep their
 * single definition here and are imported back.
 *
 * THREE THINGS THIS COMPONENT NEVER DOES. It never writes while searching —
 * /api/admin/product/[slug]/scrape-platform is read-only. It never attaches a
 * result without an explicit click on that result. And it never learns an
 * alias: the query is offered for saving, and saved only when the operator
 * says so.
 */

import { useState } from 'react'
import { ReassignPanel } from '@/components/admin/ReassignPanel'
import { StatusChip, type MatchReviewStatus } from '@/components/admin/ProductReviewControls'

export type MatchedListing = {
  id: string
  title: string
  price: number | null
  price_dkk: number | null
  currency: string
  country: string | null
  source: string
  location: string | null
  url: string
  image_url: string | null
  is_active: boolean
  scraped_at: string
  is_valid: boolean | null
  rejected_reason: string | null
}

export type ScrapedListingPayload = {
  title: string
  price: number | null
  currency: string
  url: string
  image_url: string | null
  location: string | null
  source: string
  country: string | null
  price_dkk: number | null
}

export type SearchPlatform = 'dba' | 'finn' | 'blocket' | 'kleinanzeigen' | 'reverb' | 'thomann' | 'all'

export const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'dba.dk':         { bg: '#00098A', fg: '#ffffff', label: 'DBA' },
  'finn':           { bg: '#06bffc', fg: '#000000', label: 'Finn' },
  'blocket':        { bg: '#F71414', fg: '#ffffff', label: 'Blocket' },
  'thomann':        { bg: '#002D4C', fg: '#ffffff', label: 'Thomann' },
  'reverb':         { bg: '#EC5A2C', fg: '#ffffff', label: 'Reverb' },
  'kleinanzeigen':  { bg: '#1D4B00', fg: '#ffffff', label: 'Kleinanzeigen' },
}

const SEARCH_PLATFORM_OPTS: Array<{ key: SearchPlatform; label: string; apiValue?: string }> = [
  { key: 'dba', label: 'DBA', apiValue: 'dba' },
  { key: 'finn', label: 'Finn', apiValue: 'finn' },
  { key: 'blocket', label: 'Blocket', apiValue: 'blocket' },
  { key: 'kleinanzeigen', label: 'Kleinanzeigen', apiValue: 'kleinanzeigen' },
  { key: 'reverb', label: 'Reverb', apiValue: 'reverb' },
  { key: 'thomann', label: 'Thomann', apiValue: 'thomann' },
  { key: 'all', label: 'Alle' },
]

// The six sources the pre-pivot search covered. 'Alle' used to send four of
// them, silently dropping Reverb and Thomann from an operator action labelled
// "all platforms".
const ALL_SEARCH_PLATFORMS = SEARCH_PLATFORM_OPTS
  .map((opt) => opt.apiValue)
  .filter((v): v is string => v != null)

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('da-DK').format(Math.round(n))
}

export function fmtPrice(price: number | null, currency: string): string {
  if (price == null) return '—'
  const code = currency.toUpperCase()
  if (code === 'EUR') return `${fmtNumber(price)} €`
  if (code === 'USD') return `$${fmtNumber(price)}`
  if (code === 'GBP') return `£${fmtNumber(price)}`
  return `${fmtNumber(price)} ${code === 'DKK' ? 'kr' : code}`
}

export function ScrapeSection({
  slug,
  defaultQuery,
  productId,
  onSaved,
  onMoved,
  onStatus,
  knownListings,
}: {
  slug: string
  defaultQuery: string
  productId: string
  onSaved: (listing: MatchedListing) => void
  onMoved?: (productName: string) => void
  /** Optional: a host that has a toast reports attachment and alias outcomes. */
  onStatus?: (message: string) => void
  /**
   * Listing URL -> review status, for listings ALREADY attached to this
   * product. Live search re-finds what scheduled ingestion already has, so
   * without this an approved listing came back looking exactly like a new one
   * and still offered "Gem listing" — inviting the operator to re-decide
   * something they had already decided. The host supplies it because the host
   * already holds the matched set; nothing new is fetched.
   */
  knownListings?: Record<string, MatchReviewStatus>
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [platform, setPlatform] = useState<SearchPlatform>('dba')
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<ScrapedListingPayload[]>([])
  const [failedSources, setFailedSources] = useState<string[]>([])
  /** The query that was actually run — the only thing offered as an alias. */
  const [lastQuery, setLastQuery] = useState<string | null>(null)
  const [aliasState, setAliasState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reassignState, setReassignState] = useState<{ listingUrl: string; listingId: string } | null>(null)

  const selectedPlatformLabel =
    SEARCH_PLATFORM_OPTS.find((opt) => opt.key === platform)?.label ?? 'DBA'

  const selectedPlatforms =
    platform === 'all'
      ? ALL_SEARCH_PLATFORMS
      : [SEARCH_PLATFORM_OPTS.find((opt) => opt.key === platform)?.apiValue ?? 'dba']

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setSearching(true)
    setError(null)
    setResults([])
    setFailedSources([])
    setLastQuery(null)
    setAliasState('idle')
    setAliasError(null)
    setSavedUrls(new Set())
    try {
      const res = await fetch(`/api/admin/product/${slug}/scrape-platform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, platforms: selectedPlatforms }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Søgning fejlede')
        return
      }
      setResults((data.listings ?? []) as ScrapedListingPayload[])
      setFailedSources((data.failedSources ?? []) as string[])
      setLastQuery(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Søgning fejlede')
    } finally {
      setSearching(false)
    }
  }

  async function handleSave(listing: ScrapedListingPayload) {
    setSavingId(listing.url)
    try {
      const res = await fetch(`/api/admin/product/${slug}/save-listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Kunne ikke gemme listing')
        return
      }
      setSavedUrls((prev) => {
        const next = new Set(prev)
        next.add(listing.url)
        return next
      })
      onStatus?.(`"${listing.title}" er knyttet til produktet.`)
      onSaved({
        id: data.listing_id,
        title: listing.title,
        price: listing.price,
        price_dkk: listing.price_dkk,
        currency: listing.currency,
        country: listing.country,
        source: listing.source,
        location: listing.location,
        url: listing.url,
        image_url: listing.image_url,
        is_active: true,
        scraped_at: new Date().toISOString(),
        is_valid: true,
        rejected_reason: null,
      })
    } finally {
      setSavingId(null)
    }
  }

  async function handleMoveStart(listing: ScrapedListingPayload) {
    // Toggle off if this row's panel is already open
    if (reassignState?.listingUrl === listing.url) {
      setReassignState(null)
      return
    }
    setSavingId(listing.url)
    setError(null)
    try {
      const res = await fetch(`/api/admin/product/${slug}/save-listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Kunne ikke gemme listing')
        return
      }
      setReassignState({ listingUrl: listing.url, listingId: data.listing_id })
    } finally {
      setSavingId(null)
    }
  }

  /**
   * SAVE THE QUERY AS AN ALIAS — EXPLICIT, NEVER AUTOMATIC.
   *
   * Searching and attaching never learn anything. When a query turns out to be
   * the one that finds this product on the marketplaces, the operator can say
   * so, and only then. It reuses the existing synonym seam
   * (POST /api/admin/product/[slug]/synonym) rather than writing `synonym`
   * from a second place.
   *
   * The route answers a duplicate alias with the raw Postgres message, so the
   * response body is deliberately not rendered: a repeat save is presented as
   * state, not as a database error.
   */
  async function handleSaveAlias() {
    if (!lastQuery || aliasState !== 'idle') return
    setAliasState('saving')
    setAliasError(null)
    try {
      const res = await fetch(`/api/admin/product/${slug}/synonym`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: lastQuery, lang: 'da', priority: 5 }),
      })
      if (!res.ok) {
        setAliasError('Kunne ikke gemme søgeordet — findes det allerede?')
        setAliasState('idle')
        return
      }
      setAliasState('saved')
      onStatus?.(`"${lastQuery}" er gemt som søgeord for dette produkt.`)
    } catch {
      setAliasError('Kunne ikke gemme søgeordet.')
      setAliasState('idle')
    }
  }

  // productId is unused on the wire (server resolves it from slug) but kept on
  // the props contract so the section is self-contained.
  void productId

  return (
    <section
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <h2 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
        {platform === 'all'
          ? 'Søg på alle platforme nu'
          : `Søg på ${selectedPlatformLabel} nu`}
      </h2>

      <div className="flex flex-wrap gap-1.5">
        {SEARCH_PLATFORM_OPTS.map((opt) => {
          const active = platform === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setPlatform(opt.key)}
              className="text-xs font-semibold px-3 py-1 rounded-full"
              style={{
                background: active ? 'var(--foreground)' : 'var(--secondary)',
                color: active ? 'var(--background)' : 'var(--muted-foreground)',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Fritekstsøgning på markedspladserne"
          placeholder="Søg efter hvad som helst — eller indsæt et DBA-, Thomann- eller Reverb-link"
          className="flex-1 text-sm px-3 py-2 rounded-xl"
          style={{
            background: 'var(--secondary)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {searching ? 'Søger…' : 'Søg'}
        </button>
      </form>

      {lastQuery && (
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <span>Virkede søgningen?</span>
          <button
            type="button"
            onClick={() => void handleSaveAlias()}
            disabled={aliasState !== 'idle'}
            className="font-semibold px-3 py-1 rounded-lg disabled:opacity-60"
            style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
          >
            {aliasState === 'saved'
              ? 'Gemt som søgeord ✓'
              : aliasState === 'saving'
                ? 'Gemmer…'
                : `Gem “${lastQuery}” som søgeord`}
          </button>
          {aliasError && <span style={{ color: 'rgb(239,68,68)' }}>{aliasError}</span>}
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: 'rgb(239,68,68)' }}>
          {error}
        </p>
      )}

      {failedSources.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          Svarede ikke: {failedSources.map((s) => SEARCH_PLATFORM_OPTS.find((o) => o.apiValue === s)?.label ?? s).join(', ')}.
          {results.length > 0 && ' Øvrige resultater vises nedenfor.'}
        </p>
      )}

      {results.length === 0 && failedSources.length === 0 && !searching && !error && (
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          Indtast en søgning og tryk Søg. Resultater vises her.
        </p>
      )}

      {results.length > 0 && (
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
          {results.map((r) => {
            const saved = savedUrls.has(r.url)
            const saving = savingId === r.url
            const badge =
              SOURCE_BADGE[r.source] ?? {
                bg: 'var(--secondary)',
                fg: 'var(--foreground)',
                label: r.source,
              }
            const movePanelOpen = reassignState?.listingUrl === r.url
            const known = knownListings?.[r.url]
            return (
              <li key={r.url} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <div
                      className="shrink-0 overflow-hidden rounded-lg"
                      style={{ width: 56, height: 56, background: 'var(--secondary)' }}
                    >
                      {r.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.image_url}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                        />
                      )}
                    </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                      {known && <StatusChip status={known} />}
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium truncate hover:underline"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {r.title}
                    </a>
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {fmtPrice(r.price, r.currency)}
                      {r.price_dkk != null && (
                        <> · ≈ {fmtNumber(r.price_dkk)} kr</>
                      )}
                      {r.location && <> · {r.location}</>}
                    </p>
                  </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => void handleMoveStart(r)}
                      disabled={saving}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
                      style={{
                        background: movePanelOpen ? 'var(--foreground)' : 'var(--secondary)',
                        color: movePanelOpen ? 'var(--background)' : 'var(--muted-foreground)',
                      }}
                    >
                      {saving ? 'Gemmer…' : 'Flyt til →'}
                    </button>
                    <button
                      onClick={() => handleSave(r)}
                      disabled={saving || saved || movePanelOpen || known != null}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
                      style={{
                        background: saved || known ? 'var(--secondary)' : 'var(--primary)',
                        color: saved || known ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
                      }}
                    >
                      {known ? 'Allerede tilknyttet' : saved ? 'Gemt ✓' : saving ? 'Gemmer…' : 'Gem listing'}
                    </button>
                  </div>
                </div>
                {movePanelOpen && reassignState && (
                  <ReassignPanel
                    slug={slug}
                    listingId={reassignState.listingId}
                    onSuccess={({ productName, created }) => {
                      setReassignState(null)
                      setResults((prev) => prev.filter((l) => l.url !== r.url))
                      setSavedUrls((prev) => { const n = new Set(prev); n.add(r.url); return n })
                      onMoved?.(productName)
                      void created
                    }}
                    onCancel={() => setReassignState(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

