'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Brand = { id: string; name: string }
type Subcategory = { id: string; name: string; parent_name: string | null }
type Tier = 'legendary' | 'classic' | 'standard'
type Status = 'active' | 'inactive'

const TIERS: Tier[] = ['legendary', 'classic', 'standard']
const TIER_LABEL: Record<Tier, string> = {
  legendary: 'Legendary',
  classic: 'Classic',
  standard: 'Standard',
}

function slugify(s: string): string {
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

export default function NewProductForm() {
  const router = useRouter()

  const [brands, setBrands] = useState<Brand[]>([])
  const [subcategories, setSubcategories] = useState<Subcategory[]>([])
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [subcatsLoading, setSubcatsLoading] = useState(true)

  const [brandId, setBrandId] = useState<string>('')
  const [brandSearch, setBrandSearch] = useState('')
  const [brandOpen, setBrandOpen] = useState(false)

  const [canonicalName, setCanonicalName] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelTouched, setModelTouched] = useState(false)
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  const [tier, setTier] = useState<Tier>('legendary')
  const [yearReleased, setYearReleased] = useState('')
  const [status, setStatus] = useState<Status>('active')

  const [subcategoryId, setSubcategoryId] = useState<string>('')
  const [subcatSearch, setSubcatSearch] = useState('')
  const [subcatOpen, setSubcatOpen] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brandId, brands],
  )
  const selectedSubcat = useMemo(
    () => subcategories.find((c) => c.id === subcategoryId) ?? null,
    [subcategoryId, subcategories],
  )

  useEffect(() => {
    fetch('/api/admin/product/brands')
      .then((r) => r.json())
      .then((d) => setBrands((d.brands ?? []) as Brand[]))
      .finally(() => setBrandsLoading(false))

    fetch('/api/admin/product/subcategories')
      .then((r) => r.json())
      .then((d) => setSubcategories((d.subcategories ?? []) as Subcategory[]))
      .finally(() => setSubcatsLoading(false))
  }, [])

  // Auto-derive slug from canonical_name unless user has edited it.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(canonicalName))
  }, [canonicalName, slugTouched])

  // Auto-derive model_name from canonical_name minus brand unless user typed it.
  useEffect(() => {
    if (!modelTouched) setModelName(deriveModelName(canonicalName, selectedBrand?.name ?? null))
  }, [canonicalName, selectedBrand, modelTouched])

  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase()
    if (!q) return brands
    return brands.filter((b) => b.name.toLowerCase().includes(q))
  }, [brandSearch, brands])

  const filteredSubcats = useMemo(() => {
    const q = subcatSearch.trim().toLowerCase()
    if (!q) return subcategories
    return subcategories.filter((c) => {
      const label = `${c.parent_name ?? ''} ${c.name}`.toLowerCase()
      return label.includes(q)
    })
  }, [subcatSearch, subcategories])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setFieldError(null)

    const body: Record<string, unknown> = {
      canonical_name: canonicalName.trim(),
      slug: slug.trim(),
      model_name: modelName.trim(),
      brand_id: brandId,
      tier,
      status,
    }
    const yearTrimmed = yearReleased.trim()
    if (yearTrimmed) body.year_released = parseInt(yearTrimmed, 10)
    if (subcategoryId) body.subcategory_id = subcategoryId

    try {
      const res = await fetch('/api/admin/product/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (res.status === 409) {
        setError('Slug already exists. Choose a different name.')
        return
      }
      if (!res.ok) {
        if (data.field) setFieldError(data.field)
        setError(data.error ?? 'Could not create product')
        return
      }

      router.push(`/admin/product/${data.slug}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const submitDisabled =
    submitting ||
    !canonicalName.trim() ||
    !slug.trim() ||
    !modelName.trim() ||
    !brandId

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            Nyt produkt
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            Opret manuelt en ny KG-post. Brug kun til ægte produkter — ikke listings-titler.
          </p>
        </div>
        <Link
          href="/admin/products"
          className="text-xs font-semibold px-3 py-2 rounded-xl"
          style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
        >
          ← Produkter
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Brand */}
        <Field
          label="Brand"
          required
          highlight={fieldError === 'brand_id'}
        >
          <SearchableSelect
            placeholder={brandsLoading ? 'Loading brands…' : 'Vælg brand…'}
            search={brandSearch}
            onSearchChange={(v) => { setBrandSearch(v); setBrandOpen(true) }}
            open={brandOpen}
            onOpenChange={setBrandOpen}
            selectedLabel={selectedBrand?.name ?? null}
            onClear={() => { setBrandId(''); setBrandSearch('') }}
            options={filteredBrands.map((b) => ({
              key: b.id,
              label: b.name,
              onSelect: () => {
                setBrandId(b.id)
                setBrandSearch('')
                setBrandOpen(false)
              },
            }))}
            disabled={brandsLoading}
          />
        </Field>

        {/* Canonical name */}
        <Field
          label="Canonical name"
          required
          helper="Always Brand + Model. Example: Roland Juno-60"
          highlight={fieldError === 'canonical_name'}
        >
          <input
            type="text"
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            placeholder="Roland Juno-60"
            className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              background: 'var(--input-background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
        </Field>

        {/* Model name */}
        <Field
          label="Model name"
          required
          helper="Short model token used for matching. Example: Juno-60"
          highlight={fieldError === 'model_name'}
        >
          <input
            type="text"
            value={modelName}
            onChange={(e) => { setModelName(e.target.value); setModelTouched(true) }}
            placeholder="Juno-60"
            className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              background: 'var(--input-background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
          {modelTouched && (
            <button
              type="button"
              onClick={() => {
                setModelTouched(false)
                setModelName(deriveModelName(canonicalName, selectedBrand?.name ?? null))
              }}
              className="text-[11px] mt-1 self-start"
              style={{ color: 'var(--muted-foreground)' }}
            >
              ↻ auto-derive again
            </button>
          )}
        </Field>

        {/* Slug */}
        <Field
          label="Slug"
          required
          highlight={fieldError === 'slug'}
        >
          <input
            type="text"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }}
            placeholder="roland-juno-60"
            className="w-full rounded-xl px-4 py-2.5 text-sm font-mono outline-none"
            style={{
              background: 'var(--input-background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
          <p className="text-[11px] mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Preview: <span className="font-mono">klup.dk/product/{slug || '…'}</span>
            {slugTouched && (
              <button
                type="button"
                onClick={() => { setSlugTouched(false); setSlug(slugify(canonicalName)) }}
                className="ml-2"
                style={{ color: 'var(--muted-foreground)' }}
              >
                ↻ auto-derive
              </button>
            )}
          </p>
        </Field>

        {/* Tier */}
        <Field label="Tier" required highlight={fieldError === 'tier'}>
          <div className="flex gap-2">
            {TIERS.map((t) => {
              const active = tier === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className="flex-1 text-sm font-semibold px-3 py-2 rounded-xl"
                  style={{
                    background: active ? 'var(--foreground)' : 'var(--secondary)',
                    color: active ? 'var(--background)' : 'var(--muted-foreground)',
                  }}
                >
                  {TIER_LABEL[t]}
                </button>
              )
            })}
          </div>
        </Field>

        {/* Year released */}
        <Field label="Year released" highlight={fieldError === 'year_released'}>
          <input
            type="number"
            value={yearReleased}
            onChange={(e) => setYearReleased(e.target.value)}
            placeholder="1982"
            min={1900}
            max={2030}
            className="w-32 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              background: 'var(--input-background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          />
        </Field>

        {/* Status */}
        <Field label="Status" highlight={fieldError === 'status'}>
          <div className="flex gap-2">
            {(['active', 'inactive'] as Status[]).map((s) => {
              const active = status === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className="text-sm font-semibold px-4 py-2 rounded-xl"
                  style={{
                    background: active ? 'var(--foreground)' : 'var(--secondary)',
                    color: active ? 'var(--background)' : 'var(--muted-foreground)',
                  }}
                >
                  {s === 'active' ? 'Aktiv' : 'Inaktiv'}
                </button>
              )
            })}
          </div>
        </Field>

        {/* Subcategory */}
        <Field
          label="Subcategory"
          highlight={fieldError === 'subcategory_id'}
          helper="Vælg leaf-kategori (parent → child)."
        >
          <SearchableSelect
            placeholder={subcatsLoading ? 'Loading subcategories…' : 'Vælg subcategory…'}
            search={subcatSearch}
            onSearchChange={(v) => { setSubcatSearch(v); setSubcatOpen(true) }}
            open={subcatOpen}
            onOpenChange={setSubcatOpen}
            selectedLabel={
              selectedSubcat
                ? `${selectedSubcat.parent_name ?? '—'} → ${selectedSubcat.name}`
                : null
            }
            onClear={() => { setSubcategoryId(''); setSubcatSearch('') }}
            options={filteredSubcats.map((c) => ({
              key: c.id,
              label: `${c.parent_name ?? '—'} → ${c.name}`,
              onSelect: () => {
                setSubcategoryId(c.id)
                setSubcatSearch('')
                setSubcatOpen(false)
              },
            }))}
            disabled={subcatsLoading}
          />
        </Field>

        {error && (
          <p className="text-sm" style={{ color: 'rgb(239,68,68)' }}>
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitDisabled}
            className="text-sm font-semibold px-5 py-2.5 rounded-xl disabled:opacity-40"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {submitting ? 'Opretter…' : 'Opret produkt'}
          </button>
          <Link
            href="/admin/products"
            className="text-sm font-semibold px-5 py-2.5 rounded-xl"
            style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
          >
            Annuller
          </Link>
        </div>
      </form>
    </div>
  )
}

// ─── Field wrapper ───────────────────────────────────────────────────────────
function Field({
  label,
  required,
  helper,
  highlight,
  children,
}: {
  label: string
  required?: boolean
  helper?: string
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-xs font-semibold"
        style={{ color: highlight ? 'rgb(239,68,68)' : 'var(--foreground)' }}
      >
        {label}
        {required && (
          <span style={{ color: 'rgb(239,68,68)', marginLeft: 4 }}>*</span>
        )}
      </label>
      {children}
      {helper && (
        <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
          {helper}
        </p>
      )}
    </div>
  )
}

// ─── Searchable select ───────────────────────────────────────────────────────
function SearchableSelect({
  placeholder,
  search,
  onSearchChange,
  open,
  onOpenChange,
  selectedLabel,
  onClear,
  options,
  disabled,
}: {
  placeholder: string
  search: string
  onSearchChange: (v: string) => void
  open: boolean
  onOpenChange: (v: boolean) => void
  selectedLabel: string | null
  onClear: () => void
  options: { key: string; label: string; onSelect: () => void }[]
  disabled?: boolean
}) {
  if (selectedLabel) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-xl px-4 py-2.5"
        style={{
          background: 'var(--input-background)',
          border: '1px solid var(--border)',
        }}
      >
        <span className="text-sm" style={{ color: 'var(--foreground)' }}>
          {selectedLabel}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-xs"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Skift
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onFocus={() => onOpenChange(true)}
        onBlur={() => setTimeout(() => onOpenChange(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl px-4 py-2.5 text-sm outline-none disabled:opacity-50"
        style={{
          background: 'var(--input-background)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}
      />
      {open && options.length > 0 && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 rounded-xl overflow-hidden max-h-60 overflow-y-auto"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
          }}
        >
          {options.slice(0, 50).map((o) => (
            <button
              key={o.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={o.onSelect}
              className="w-full text-left text-sm px-4 py-2 hover:opacity-80"
              style={{ color: 'var(--foreground)' }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {open && options.length === 0 && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 rounded-xl px-4 py-3 text-xs"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--muted-foreground)',
          }}
        >
          Ingen resultater
        </div>
      )}
    </div>
  )
}
