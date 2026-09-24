'use client'

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import { brandSlug, type BrandRow } from '@/lib/brand-identity'

/**
 * PAN-136 — create a brand from the point of failure: the operator typed a
 * brand the picker does not hold. The server decides whether it is new; on a
 * near-match it inserts nothing and returns the existing brand(s), which are
 * shown here with the option to pick one instead.
 */
export default function NewBrandDialog({
  open,
  initialName,
  onClose,
  onResolved,
}: {
  open: boolean
  initialName: string
  onClose: () => void
  /** Called with the brand to select: the one just created, or an existing one the operator chose. */
  onResolved: (brand: BrandRow, created: boolean) => void
}) {
  const { t } = useLocale()
  const copy = t.adminBrand
  const titleId = useId()

  const [name, setName] = useState(initialName)
  const [slug, setSlug] = useState(brandSlug(initialName))
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<BrandRow[]>([])

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setSlug(brandSlug(initialName))
    setSlugTouched(false)
    setError(null)
    setMatches([])
  }, [open, initialName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setMatches([])
    try {
      const res = await fetch('/api/admin/product/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      })
      const data = await res.json()
      if (res.status === 201) {
        onResolved(data.brand as BrandRow, true)
        return
      }
      if (res.status === 409 && Array.isArray(data.matches) && data.matches.length > 0) {
        setMatches(data.matches as BrandRow[])
        return
      }
      setError(
        data.field === 'name' ? copy.errorName : data.field === 'slug' ? copy.errorSlug : copy.errorGeneric,
      )
    } catch {
      setError(copy.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      panelClassName="w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-6"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h2 id={titleId} className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
            {copy.dialogTitle}
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {copy.dialogIntro}
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
          {copy.nameLabel}
          <TextField
            type="text"
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value)
              if (!slugTouched) setSlug(brandSlug(e.target.value))
            }}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-normal outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
          {copy.slugLabel}
          <TextField
            type="text"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-mono font-normal outline-none"
          />
        </label>

        {matches.length > 0 && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl p-3 bg-surface-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
              {copy.existsHeading}
            </p>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {copy.existsBody}
            </p>
            {matches.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                  {m.name} <span className="font-mono text-xs" style={{ color: 'var(--muted-foreground)' }}>{m.slug}</span>
                </span>
                <Button
                  variant="secondary"
                  onClick={() => onResolved(m, false)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
                >
                  {fill(copy.useExisting, { name: m.name })}
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--destructive-text)' }}>
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Button
            variant="primary"
            type="submit"
            disabled={submitting || !name.trim() || !slug.trim()}
            className="text-sm font-semibold px-5 py-2.5 rounded-xl disabled:opacity-40"
          >
            {submitting ? copy.creating : copy.create}
          </Button>
          <Button
            variant="secondary"
            onClick={onClose}
            className="text-sm font-semibold px-5 py-2.5 rounded-xl"
          >
            {copy.cancel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
