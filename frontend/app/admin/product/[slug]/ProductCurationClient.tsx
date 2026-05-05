'use client'

import { useMemo, useState } from 'react'
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

const SOURCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'dba.dk':         { bg: '#00098A', fg: '#ffffff', label: 'DBA' },
  'finn':           { bg: '#06bffc', fg: '#000000', label: 'Finn' },
  'blocket':        { bg: '#F71414', fg: '#ffffff', label: 'Blocket' },
  'thomann':        { bg: '#002D4C', fg: '#ffffff', label: 'Thomann' },
  'reverb':         { bg: '#EC5A2C', fg: '#ffffff', label: 'Reverb' },
  'kleinanzeigen':  { bg: '#f5c542', fg: '#000000', label: 'Kleinanzeigen' },
}

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
}: {
  slug: string
  defaultQuery: string
  productId: string
  onSaved: (listing: MatchedListing) => void
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<ScrapedListingPayload[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setSearching(true)
    setError(null)
    setResults([])
    setSavedUrls(new Set())
    try {
      const res = await fetch(`/api/admin/product/${slug}/scrape-kleinanzeigen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
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

  // productId is unused on the wire (server resolves it from slug) but kept on
  // the props contract so the section is self-contained.
  void productId

  return (
    <section
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <h2 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
        Søg på Kleinanzeigen nu
      </h2>

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
            return (
              <li key={r.url} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex flex-col gap-0.5">
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
                <button
                  onClick={() => handleSave(r)}
                  disabled={saving || saved}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-40"
                  style={{
                    background: saved ? 'var(--secondary)' : 'var(--primary)',
                    color: saved ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
                  }}
                >
                  {saved ? 'Gemt ✓' : saving ? 'Gemmer…' : 'Gem listing'}
                </button>
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
}: {
  slug: string
  filter: string
  onFilterChange: (f: string) => void
  listings: MatchedListing[]
  totalCount: number
  onReject: (listingId: string) => void
}) {
  const [rejectingId, setRejectingId] = useState<string | null>(null)

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
                return (
                  <tr
                    key={l.id}
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
                    <td
                      className="px-2 py-2 text-right font-mono"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {l.price_dkk != null ? `${fmtNumber(l.price_dkk)} kr` : '—'}
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
