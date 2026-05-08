'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

export type ProductHeaderData = {
  id: string
  slug: string
  canonical_name: string
  brand_name: string | null
  tier: string | null
  year_released: number | null
  image_url: string | null
  reverb_csp_id: number | null
}

export type ThomannEntry = {
  thomann_url: string
  canonical_name: string
  price_dkk: number | null
  scraped_at: string
}

export type SynonymRow = {
  id: string
  alias: string
  lang: string
  priority: number
}

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

export type NeighborProduct = {
  slug: string
  canonical_name: string
}

export type CurationData = {
  header: ProductHeaderData
  thomann: ThomannEntry | null
  synonyms: SynonymRow[]
  listings: MatchedListing[]
  prev: NeighborProduct | null
  next: NeighborProduct | null
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

type SearchPlatform = 'dba' | 'finn' | 'blocket' | 'kleinanzeigen' | 'reverb' | 'all'

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'dba.dk':         { bg: '#00098A', fg: '#ffffff', label: 'DBA' },
  'finn':           { bg: '#06bffc', fg: '#000000', label: 'Finn' },
  'blocket':        { bg: '#F71414', fg: '#ffffff', label: 'Blocket' },
  'thomann':        { bg: '#002D4C', fg: '#ffffff', label: 'Thomann' },
  'reverb':         { bg: '#EC5A2C', fg: '#ffffff', label: 'Reverb' },
  'kleinanzeigen':  { bg: '#f5c542', fg: '#000000', label: 'Kleinanzeigen' },
}

const SEARCH_PLATFORM_OPTS: Array<{ key: SearchPlatform; label: string; apiValue?: string }> = [
  { key: 'dba', label: 'DBA', apiValue: 'dba' },
  { key: 'finn', label: 'Finn', apiValue: 'finn' },
  { key: 'blocket', label: 'Blocket', apiValue: 'blocket' },
  { key: 'kleinanzeigen', label: 'Kleinanzeigen', apiValue: 'kleinanzeigen' },
  { key: 'reverb', label: 'Reverb', apiValue: 'reverb' },
  { key: 'all', label: 'Alle' },
]

const COUNTRY_FLAG: Record<string, string> = {
  DK: '🇩🇰', DE: '🇩🇪', SE: '🇸🇪', NO: '🇳🇴', US: '🇺🇸', GB: '🇬🇧', FR: '🇫🇷', NL: '🇳🇱',
}

const FILTER_OPTS: Array<{ key: string; label: string; sources: string[] | null }> = [
  { key: 'all',          label: 'Alle',          sources: null },
  { key: 'dba',          label: 'DBA',           sources: ['dba.dk'] },
  { key: 'reverb',       label: 'Reverb',        sources: ['reverb'] },
  { key: 'kleinanzeigen',label: 'Kleinanzeigen', sources: ['kleinanzeigen'] },
  { key: 'finn',         label: 'Finn',          sources: ['finn'] },
  { key: 'blocket',      label: 'Blocket',       sources: ['blocket'] },
]

const LANG_OPTS = ['da', 'de', 'en', 'sv', 'no']

function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('da-DK').format(Math.round(n))
}

function fmtPrice(price: number | null, currency: string): string {
  if (price == null) return '—'
  const code = currency.toUpperCase()
  if (code === 'EUR') return `${fmtNumber(price)} €`
  if (code === 'USD') return `$${fmtNumber(price)}`
  if (code === 'GBP') return `£${fmtNumber(price)}`
  return `${fmtNumber(price)} ${code === 'DKK' ? 'kr' : code}`
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

export default function ProductCurationClient({ data }: { data: CurationData }) {
  const { header, thomann, prev, next } = data

  const [synonyms, setSynonyms] = useState<SynonymRow[]>(data.synonyms)
  const [listings, setListings] = useState<MatchedListing[]>(data.listings)
  const [filter, setFilter] = useState<string>('all')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const filteredListings = useMemo(() => {
    const opt = FILTER_OPTS.find((f) => f.key === filter)
    if (!opt || opt.sources == null) return listings
    return listings.filter((l) => opt.sources!.includes(l.source))
  }, [filter, listings])

  return (
    <div className="flex flex-col gap-8">
      {/* Section 1 — header */}
      <ProductHeader
        header={header}
        thomann={thomann}
        prev={prev}
        next={next}
      />

      {/* Section 2 — synonyms */}
      <SynonymSection
        slug={header.slug}
        synonyms={synonyms}
        onAdd={(row) => {
          setSynonyms((prev) =>
            [...prev, row].sort((a, b) =>
              a.priority - b.priority || a.alias.localeCompare(b.alias),
            ),
          )
          showToast('Synonym tilføjet')
        }}
        onDelete={(id) => {
          setSynonyms((prev) => prev.filter((s) => s.id !== id))
          showToast('Synonym slettet')
        }}
      />

      {/* Section 3 — on-demand search */}
      <ScrapeSection
        slug={header.slug}
        defaultQuery={header.canonical_name}
        productId={header.id}
        onMoved={(name) => showToast(`Listing gemt og flyttet til ${name}`)}
        onSaved={(listing) => {
          setListings((prev) => {
            if (prev.some((l) => l.id === listing.id)) return prev
            return [listing, ...prev].sort((a, b) => {
              const ap = a.price_dkk
              const bp = b.price_dkk
              if (ap == null && bp == null) return 0
              if (ap == null) return 1
              if (bp == null) return -1
              return ap - bp
            })
          })
          showToast('Listing gemt og matchet')
        }}
      />

      {/* Section 4 — matched listings */}
      <MatchedListingsSection
        slug={header.slug}
        filter={filter}
        onFilterChange={setFilter}
        listings={filteredListings}
        totalCount={listings.length}
        onReject={(listingId) => {
          setListings((prev) => prev.filter((l) => l.id !== listingId))
          showToast('Match flagged som ugyldig')
        }}
        onSetPrice={(listingId, priceDkk) => {
          setListings((prev) =>
            prev.map((l) => l.id === listingId ? { ...l, price_dkk: priceDkk } : l),
          )
        }}
        onReassign={(listingId, opts) => {
          setListings((prev) => prev.filter((l) => l.id !== listingId))
          showToast(opts.created
            ? 'Nyt produkt oprettet og listing flyttet'
            : `Listing flyttet til ${opts.productName}`)
        }}
      />

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Section 1 — header ──────────────────────────────────────────────────────
function ProductHeader({
  header,
  thomann,
  prev,
  next,
}: {
  header: ProductHeaderData
  thomann: ThomannEntry | null
  prev: NeighborProduct | null
  next: NeighborProduct | null
}) {
  return (
    <section className="flex flex-col gap-3">
      {/* Navigation */}
      <div className="flex items-center justify-between text-xs">
        {prev ? (
          <Link
            href={`/admin/product/${prev.slug}`}
            className="hover:underline"
            style={{ color: 'var(--muted-foreground)' }}
          >
            ← {prev.canonical_name}
          </Link>
        ) : (
          <span style={{ color: 'var(--muted-foreground)' }}>← (første)</span>
        )}
        {next ? (
          <Link
            href={`/admin/product/${next.slug}`}
            className="hover:underline"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {next.canonical_name} →
          </Link>
        ) : (
          <span style={{ color: 'var(--muted-foreground)' }}>(sidste) →</span>
        )}
      </div>

      <div
        className="flex gap-5 p-4 rounded-2xl"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div
          className="shrink-0 rounded-xl overflow-hidden"
          style={{
            width: 160,
            height: 160,
            background: 'var(--secondary)',
          }}
        >
          {header.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={header.image_url}
              alt={header.canonical_name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
                image
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <h1
            className="text-2xl font-bold leading-tight"
            style={{ color: 'var(--foreground)' }}
          >
            {header.canonical_name}
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {[header.brand_name, header.year_released].filter(Boolean).join(' · ') ||
              '—'}
          </p>

          <div className="flex flex-wrap gap-2 mt-1">
            {header.tier === 'legendary' && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider"
                style={{ background: 'var(--foreground)', color: 'var(--background)' }}
              >
                LEGENDARY
              </span>
            )}
            {header.reverb_csp_id != null && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
              >
                CSP {header.reverb_csp_id}
              </span>
            )}
          </div>

          <div className="mt-2 text-sm">
            {thomann && thomann.price_dkk != null ? (
              <span style={{ color: 'var(--foreground)' }}>
                Nypris: <strong>{fmtNumber(thomann.price_dkk)} kr</strong>{' '}
                <a
                  href={thomann.thomann_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  → Thomann
                </a>
              </span>
            ) : (
              <span style={{ color: 'var(--muted-foreground)' }}>Ingen nypris</span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Section 2 — synonyms ────────────────────────────────────────────────────
function SynonymSection({
  slug,
  synonyms,
  onAdd,
  onDelete,
}: {
  slug: string
  synonyms: SynonymRow[]
  onAdd: (row: SynonymRow) => void
  onDelete: (id: string) => void
}) {
  const [alias, setAlias] = useState('')
  const [lang, setLang] = useState('da')
  const [priority, setPriority] = useState('5')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = alias.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/product/${slug}/synonym`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: trimmed,
          lang,
          priority: parseInt(priority, 10) || 5,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Kunne ikke tilføje synonym')
        return
      }
      onAdd({
        id: data.id,
        alias: data.alias,
        lang: data.lang,
        priority: data.priority,
      })
      setAlias('')
      setPriority('5')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/product/${slug}/synonym/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) onDelete(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <h2 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
        Søgeord / Synonymer
      </h2>

      {synonyms.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          Ingen synonymer endnu.
        </p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
          {synonyms.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: 'var(--foreground)' }}
                >
                  {s.alias}
                </span>
                <span
                  className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md"
                  style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
                >
                  {s.lang}
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  prio {s.priority}
                </span>
              </div>
              <button
                onClick={() => handleDelete(s.id)}
                disabled={busy}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-40"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'rgb(239,68,68)' }}
              >
                Slet
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-2 pt-2 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Alias
          </label>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="fx jp-8, jupiter 8"
            className="text-sm px-3 py-2 rounded-xl"
            style={{
              background: 'var(--secondary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Sprog
          </label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl"
            style={{
              background: 'var(--secondary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            {LANG_OPTS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 w-24">
          <label
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Prioritet
          </label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl"
            style={{
              background: 'var(--secondary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !alias.trim()}
          className="text-xs font-semibold px-4 py-2 rounded-xl disabled:opacity-40"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          Tilføj
        </button>
      </form>

      {error && (
        <p className="text-xs" style={{ color: 'rgb(239,68,68)' }}>
          {error}
        </p>
      )}
    </section>
  )
}

// ─── Section 3 — on-demand search ────────────────────────────────────────────
function ScrapeSection({
  slug,
  defaultQuery,
  productId,
  onSaved,
  onMoved,
}: {
  slug: string
  defaultQuery: string
  productId: string
  onSaved: (listing: MatchedListing) => void
  onMoved?: (productName: string) => void
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [platform, setPlatform] = useState<SearchPlatform>('dba')
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<ScrapedListingPayload[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reassignState, setReassignState] = useState<{ listingUrl: string; listingId: string } | null>(null)

  const selectedPlatformLabel =
    SEARCH_PLATFORM_OPTS.find((opt) => opt.key === platform)?.label ?? 'DBA'

  const selectedPlatforms =
    platform === 'all'
      ? ['dba', 'finn', 'blocket', 'kleinanzeigen']
      : [SEARCH_PLATFORM_OPTS.find((opt) => opt.key === platform)?.apiValue ?? 'dba']

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setSearching(true)
    setError(null)
    setResults([])
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

      {error && (
        <p className="text-xs" style={{ color: 'rgb(239,68,68)' }}>
          {error}
        </p>
      )}

      {results.length === 0 && !searching && !error && (
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
            return (
              <li key={r.url} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
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
                      disabled={saving || saved || movePanelOpen}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
                      style={{
                        background: saved ? 'var(--secondary)' : 'var(--primary)',
                        color: saved ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
                      }}
                    >
                      {saved ? 'Gemt ✓' : saving ? 'Gemmer…' : 'Gem listing'}
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

// ─── Section 4 — matched listings ────────────────────────────────────────────
function MatchedListingsSection({
  slug,
  filter,
  onFilterChange,
  listings,
  totalCount,
  onReject,
  onSetPrice,
  onReassign,
}: {
  slug: string
  filter: string
  onFilterChange: (f: string) => void
  listings: MatchedListing[]
  totalCount: number
  onReject: (listingId: string) => void
  onSetPrice: (listingId: string, priceDkk: number) => void
  onReassign: (listingId: string, opts: { productName: string; created?: boolean }) => void
}) {
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reassigningId, setReassigningId] = useState<string | null>(null)

  async function handleReject(listing: MatchedListing) {
    setRejectingId(listing.id)
    try {
      const res = await fetch(`/api/admin/product/${slug}/reject-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listing.id }),
      })
      if (res.ok) onReject(listing.id)
    } finally {
      setRejectingId(null)
    }
  }

  return (
    <section
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
          Matchede listings ({totalCount})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTER_OPTS.map((o) => {
            const active = filter === o.key
            return (
              <button
                key={o.key}
                onClick={() => onFilterChange(o.key)}
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{
                  background: active ? 'var(--foreground)' : 'var(--secondary)',
                  color: active ? 'var(--background)' : 'var(--muted-foreground)',
                }}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {listings.length === 0 ? (
        <p className="text-xs py-4" style={{ color: 'var(--muted-foreground)' }}>
          Ingen listings matcher det valgte filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ color: 'var(--foreground)' }}>
            <thead>
              <tr
                className="text-[10px] font-semibold uppercase tracking-wider text-left"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2">Titel</th>
                <th className="px-2 py-2 text-right">Pris</th>
                <th className="px-2 py-2 text-right">DKK</th>
                <th className="px-2 py-2">Sted</th>
                <th className="px-2 py-2 text-right">Dage</th>
                <th className="px-2 py-2"></th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const badge =
                  SOURCE_BADGE[l.source] ?? {
                    bg: 'var(--secondary)',
                    fg: 'var(--foreground)',
                    label: l.source,
                  }
                const flag = l.country ? COUNTRY_FLAG[l.country] ?? '' : ''
                const dimmed = !l.is_active
                const rejecting = rejectingId === l.id
                const reassigning = reassigningId === l.id
                return (
                  <Fragment key={l.id}>
                  <tr
                    className="border-t"
                    style={{
                      borderColor: 'var(--border)',
                      opacity: dimmed ? 0.5 : 1,
                    }}
                  >
                    <td className="px-2 py-2">
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-2 py-2">{flag}</td>
                    <td className="px-2 py-2">
                      <span style={{ color: 'var(--foreground)' }}>
                        {truncate(l.title, 60)}
                      </span>
                      {!l.is_active && (
                        <span
                          className="ml-2 text-[10px] uppercase"
                          style={{ color: 'var(--muted-foreground)' }}
                        >
                          inaktiv
                        </span>
                      )}
                    </td>
                    <td
                      className="px-2 py-2 text-right font-mono"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {fmtPrice(l.price, l.currency)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <PriceDkkCell
                        listingId={l.id}
                        priceDkk={l.price_dkk}
                        slug={slug}
                        onSaved={(n) => onSetPrice(l.id, n)}
                      />
                    </td>
                    <td
                      className="px-2 py-2"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {l.location ?? '—'}
                    </td>
                    <td
                      className="px-2 py-2 text-right font-mono"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {daysSince(l.scraped_at)}d
                    </td>
                    <td className="px-2 py-2">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs hover:underline"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        Link →
                      </a>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setReassigningId(reassigning ? null : l.id)}
                          className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                          style={{
                            background: reassigning ? 'var(--foreground)' : 'var(--secondary)',
                            color: reassigning ? 'var(--background)' : 'var(--muted-foreground)',
                          }}
                        >
                          Flyt til →
                        </button>
                        <button
                          onClick={() => handleReject(l)}
                          disabled={rejecting}
                          className="text-[10px] font-semibold px-2 py-1 rounded-lg disabled:opacity-40"
                          style={{
                            background: 'rgba(239,68,68,0.12)',
                            color: 'rgb(239,68,68)',
                          }}
                        >
                          {rejecting ? '…' : 'Bad match'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {reassigning && (
                    <tr style={{ borderColor: 'var(--border)' }}>
                      <td colSpan={9} className="px-2 py-2">
                        <ReassignPanel
                          slug={slug}
                          listingId={l.id}
                          onSuccess={(opts) => {
                            setReassigningId(null)
                            onReassign(l.id, opts)
                          }}
                          onCancel={() => setReassigningId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ─── PriceDkkCell — inline-editable DKK price ───────────────────────────────
function PriceDkkCell({
  listingId,
  priceDkk,
  slug,
  onSaved,
}: {
  listingId: string
  priceDkk: number | null
  slug: string
  onSaved: (priceDkk: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft(priceDkk != null ? String(Math.round(priceDkk)) : '')
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setDraft('')
  }

  async function submit() {
    const n = parseInt(draft, 10)
    if (!Number.isFinite(n) || n <= 0) { cancel(); return }
    if (priceDkk != null && n === Math.round(priceDkk)) { cancel(); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/product/${slug}/set-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, price_dkk: n }),
      })
      if (res.ok) {
        onSaved(n)
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); void submit() }
    if (e.key === 'Escape') { cancel() }
  }

  if (editing) {
    return (
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={handleKeyDown}
        placeholder="DKK"
        disabled={saving}
        autoFocus
        className="w-24 text-right text-xs px-2 py-1 rounded-lg font-mono outline-none"
        style={{
          background: 'var(--input-background)',
          border: '1px solid var(--ring)',
          color: 'var(--foreground)',
        }}
      />
    )
  }

  if (priceDkk != null) {
    return (
      <button
        onClick={startEdit}
        className="text-xs font-mono hover:underline"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {fmtNumber(priceDkk)} kr
      </button>
    )
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <span style={{ color: 'var(--muted-foreground)' }}>—</span>
      <button
        onClick={startEdit}
        className="text-[10px] hover:underline"
        style={{ color: 'var(--muted-foreground)' }}
      >
        Sæt pris
      </button>
    </div>
  )
}

// ─── ReassignPanel — inline UI for moving a listing to another product ─────
type ProductSearchResult = {
  id: string
  slug: string
  canonical_name: string
  tier: string
}

type ReassignSuccessOpts = { productName: string; created?: boolean }

function ReassignPanel({
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

  async function reassignTo(targetSlug: string, productName: string, created = false) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/product/${slug}/reassign-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, target_slug: targetSlug }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Kunne ikke flytte listing')
        return
      }
      onSuccess({ productName, created })
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
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Søg produkt..."
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
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: 'transparent', color: 'var(--muted-foreground)' }}
        >
          Annuller
        </button>
      </div>

      {trimmed.length >= 2 && (
        <ul className="flex flex-col gap-1">
          {searching && (
            <li className="text-[11px] px-2" style={{ color: 'var(--muted-foreground)' }}>
              Søger…
            </li>
          )}
          {!searching && results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => reassignTo(p.slug, p.canonical_name)}
                disabled={submitting}
                className="w-full flex items-center justify-between gap-2 text-sm px-3 py-2 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--card)', color: 'var(--foreground)' }}
              >
                <span className="truncate">{p.canonical_name}</span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0"
                  style={{
                    background: p.tier === 'legendary' ? 'var(--foreground)' : 'var(--secondary)',
                    color: p.tier === 'legendary' ? 'var(--background)' : 'var(--muted-foreground)',
                  }}
                >
                  {p.tier}
                </span>
              </button>
            </li>
          ))}
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

      {error && (
        <p className="text-xs" style={{ color: 'rgb(239,68,68)' }}>{error}</p>
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
