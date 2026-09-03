'use client'

import { Fragment, useMemo, useState } from 'react'
import { ReassignPanel } from '@/components/admin/ReassignPanel'
/**
 * The on-demand search section moved to components/admin so that
 * /product/[slug]?review=1 can render the same implementation (PAN-31).
 * SOURCE_BADGE and the two formatters moved with it and are imported back —
 * one definition, two consumers.
 */
import {
  ScrapeSection,
  SOURCE_BADGE,
  fmtNumber,
  fmtPrice,
  type MatchedListing,
  type ScrapedListingPayload,
} from '@/components/admin/ScrapeSection'
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


export type { MatchedListing, ScrapedListingPayload }

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
