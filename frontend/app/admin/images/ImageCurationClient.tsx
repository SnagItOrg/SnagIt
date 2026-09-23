'use client'

import { useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'

export type ImageRow = {
  slug: string
  name: string
  /** `hero_image_url ?? image_url` — what the product page actually renders. */
  currentImage: string | null
  /** True when a human has already curated a hero for this product. */
  isCurated: boolean
  isPublic: boolean
  provenanceSourceUrl: string | null
}

type RowState = {
  url: string
  status: 'idle' | 'saving' | 'saved' | 'error'
  message: string | null
  previewBroken: boolean
}

const EMPTY: RowState = { url: '', status: 'idle', message: null, previewBroken: false }

export default function ImageCurationClient({ rows }: { rows: ImageRow[] }) {
  const { t } = useLocale()
  const c = t.adminImages

  const [state, setState] = useState<Record<string, RowState>>({})
  const [images, setImages] = useState<Record<string, string>>({})

  function rowState(slug: string): RowState {
    return state[slug] ?? EMPTY
  }

  function patch(slug: string, next: Partial<RowState>) {
    setState((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? EMPTY), ...next } }))
  }

  /**
   * The route answers a machine-readable `error` code precisely so the reason
   * can be said in the operator's language rather than echoed from the server.
   */
  function messageFor(code: unknown, fallback: string): string {
    switch (code) {
      case 'invalid_url':
        return c.errorInvalidUrl
      case 'unreachable':
        return c.errorUnreachable
      case 'not_an_image':
        return c.errorNotAnImage
      case 'too_large':
        return c.errorTooLarge
      case 'too_small':
        return c.errorTooSmall
      case 'storage_failed':
        return c.errorStorage
      default:
        return fallback || c.errorGeneric
    }
  }

  async function save(slug: string) {
    const url = rowState(slug).url.trim()
    if (!url) return
    patch(slug, { status: 'saving', message: null })

    try {
      const res = await fetch(`/api/admin/product/${encodeURIComponent(slug)}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url: url }),
      })
      const body = (await res.json()) as {
        error?: unknown
        message?: string
        hero_image_url?: string
      }

      if (!res.ok || !body.hero_image_url) {
        patch(slug, { status: 'error', message: messageFor(body.error, body.message ?? '') })
        return
      }

      // The stored URL carries a cache-busting stamp, so swapping it in shows
      // the new picture rather than the CDN's copy of the old one.
      setImages((prev) => ({ ...prev, [slug]: body.hero_image_url! }))
      patch(slug, { status: 'saved', message: null, url: '', previewBroken: false })
    } catch {
      patch(slug, { status: 'error', message: c.errorGeneric })
    }
  }

  const missing = rows.filter((r) => (images[r.slug] ?? r.currentImage) === null)
  const present = rows.filter((r) => (images[r.slug] ?? r.currentImage) !== null)

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--foreground)' }}>
        {c.title}
      </h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        {c.intro}
      </p>
      <p className="mt-1 text-sm font-medium" style={{ color: 'var(--foreground)' }}>
        {fill(c.summary, { missing: missing.length, total: rows.length })}
      </p>
      <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {c.heroNote}
      </p>

      {missing.length > 0 && (
        <Section heading={c.missingHeading}>
          {missing.map((row) => (
            <Row
              key={row.slug}
              row={row}
              image={images[row.slug] ?? row.currentImage}
              state={rowState(row.slug)}
              patch={patch}
              save={save}
              c={c}
            />
          ))}
        </Section>
      )}

      {present.length > 0 && (
        <Section heading={c.hasImageHeading}>
          {present.map((row) => (
            <Row
              key={row.slug}
              row={row}
              image={images[row.slug] ?? row.currentImage}
              state={rowState(row.slug)}
              patch={patch}
              save={save}
              c={c}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2
        className="text-xs font-bold uppercase tracking-wider mb-3"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {heading}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

type Copy = ReturnType<typeof useLocale>['t']['adminImages']

function Row({
  row,
  image,
  state,
  patch,
  save,
  c,
}: {
  row: ImageRow
  image: string | null
  state: RowState
  patch: (slug: string, next: Partial<RowState>) => void
  save: (slug: string) => void
  c: Copy
}) {
  const pasted = state.url.trim()
  const busy = state.status === 'saving'

  return (
    <div
      className="rounded-xl p-4 flex flex-col md:flex-row gap-4"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Current image, or the gap it leaves */}
      <Thumb src={image} alt={row.name} label={c.currentImage} missingLabel={c.missingBadge} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm" style={{ color: 'var(--foreground)' }}>
            {row.name}
          </span>
          {row.isCurated && <Badge>{c.curatedBadge}</Badge>}
          {!row.isPublic && <Badge>qa_only</Badge>}
        </div>
        <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
          {row.slug}
        </div>
        {row.provenanceSourceUrl && (
          <div className="text-xs mt-1 truncate" style={{ color: 'var(--muted-foreground)' }}>
            {c.sourceLabel}: {row.provenanceSourceUrl}
          </div>
        )}

        <label className="block mt-3">
          <span className="sr-only">{c.pasteLabel}</span>
          <input
            type="url"
            value={state.url}
            disabled={busy}
            placeholder={c.pastePlaceholder}
            onChange={(e) =>
              patch(row.slug, {
                url: e.target.value,
                status: 'idle',
                message: null,
                previewBroken: false,
              })
            }
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{
              backgroundColor: 'var(--background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
        </label>

        {state.message && (
          <p
            className="mt-2 text-xs font-medium"
            style={{ color: 'var(--destructive-text, var(--foreground))' }}
            role="alert"
          >
            {state.message}
          </p>
        )}

        {state.status === 'saved' && (
          <p className="mt-2 text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
            {c.saved}
          </p>
        )}

        {pasted && (
          <div className="mt-3 flex items-start gap-3">
            {/* What the pasted address actually shows — the point of the flow */}
            <Thumb
              src={pasted}
              alt={c.preview}
              label={c.preview}
              missingLabel={c.previewFailed}
              onError={() => patch(row.slug, { previewBroken: true })}
              broken={state.previewBroken}
            />
            <div className="flex-1">
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {c.attachesTo}: <span style={{ color: 'var(--foreground)' }}>{row.name}</span>
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(row.slug)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{
                    backgroundColor: 'var(--foreground)',
                    color: 'var(--background)',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? c.saving : c.confirm}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => patch(row.slug, { ...EMPTY })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--secondary)',
                    color: 'var(--foreground)',
                  }}
                >
                  {c.cancel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: 'var(--secondary)', color: 'var(--muted-foreground)' }}
    >
      {children}
    </span>
  )
}

/**
 * A thumbnail that states the absence instead of rendering a blank square.
 * "No image" and "that address is not an image" are different sentences, and
 * the operator needs to be able to tell them apart at a glance.
 */
function Thumb({
  src,
  alt,
  label,
  missingLabel,
  onError,
  broken,
}: {
  src: string | null
  alt: string
  label: string
  missingLabel: string
  onError?: () => void
  broken?: boolean
}) {
  const show = src && !broken
  return (
    <div className="flex-shrink-0">
      <div
        className="rounded-lg overflow-hidden flex items-center justify-center text-center"
        style={{
          width: 120,
          height: 90,
          backgroundColor: 'var(--secondary)',
          border: '1px solid var(--border)',
        }}
      >
        {show ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            onError={onError}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span className="text-[10px] px-1" style={{ color: 'var(--muted-foreground)' }}>
            {missingLabel}
          </span>
        )}
      </div>
      {/* The caption names which box this is. When the box is empty it already
          says so in words, and stacking "Mangler billede" under "Nuværende
          billede" reads as two contradictory labels rather than one state. */}
      {src && (
        <div className="text-[10px] mt-1 text-center" style={{ color: 'var(--muted-foreground)' }}>
          {label}
        </div>
      )}
    </div>
  )
}
