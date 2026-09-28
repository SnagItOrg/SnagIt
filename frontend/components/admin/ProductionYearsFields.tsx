'use client'

import { useId } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import {
  formatProductionYears,
  validateProductionYears,
  type ProductionYearsRefusal,
  type YearField,
} from '@/lib/production-years'

/**
 * PAN-137 — "Årstal" and "Udgået", side by side, for /admin/product/new and
 * /admin/product/[slug]. Controlled: the parent owns the two strings, submits
 * them, and hands back the refusal to show.
 *
 * TEXT, NOT `type="number"`. A number input hands script `''` for content it
 * cannot parse (Chrome, for "Discontinued"), which is the same silent drop by
 * another route. A text input with `inputMode="numeric"` keeps the numeric
 * keypad and gives `parseYear` exactly what was typed, so a bad year is
 * refused out loud. `maxLength={4}` is the four-digit limit, enforced where it
 * is claimed.
 *
 * The preview line states what the public label will say, so "empty means
 * still in production" is visible before it is saved, not learned after.
 */
export function ProductionYearsFields({
  released,
  discontinued,
  onReleasedChange,
  onDiscontinuedChange,
  discontinuedEnabled,
  refusal,
}: {
  released: string
  discontinued: string
  onReleasedChange: (value: string) => void
  onDiscontinuedChange: (value: string) => void
  /** False until migration 059 is applied and the flag is on: no Udgået input. */
  discontinuedEnabled: boolean
  refusal: ProductionYearsRefusal | null
}) {
  const { t } = useLocale()
  const id = useId()
  const errorId = `${id}-error`

  const current = validateProductionYears({
    year_released: released,
    year_discontinued: discontinuedEnabled ? discontinued : null,
  })
  const preview = current.ok
    ? formatProductionYears(current.year_released, discontinuedEnabled ? current.year_discontinued : undefined)
    : null

  function input(field: YearField, value: string, onChange: (v: string) => void, label: string, placeholder: string) {
    const invalid = refusal?.field === field
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-${field}`}
          className="text-xs font-semibold"
          style={{ color: invalid ? 'var(--destructive-text)' : 'var(--foreground)' }}
        >
          {label}
        </label>
        <input
          id={`${id}-${field}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="w-28 rounded-xl px-4 py-2.5 text-sm tabular-nums outline-none"
          style={{
            background: 'var(--input-background)',
            border: `1px solid ${invalid ? 'var(--destructive-border)' : 'var(--border)'}`,
            color: 'var(--foreground)',
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-3">
        {input('year_released', released, onReleasedChange, t.adminYears.released, t.adminYears.releasedPlaceholder)}
        {discontinuedEnabled && (
          <>
            <span aria-hidden="true" className="pb-2.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>–</span>
            {input('year_discontinued', discontinued, onDiscontinuedChange, t.adminYears.discontinued, t.adminYears.discontinuedPlaceholder)}
          </>
        )}
      </div>
      {refusal ? (
        <p id={errorId} role="alert" className="text-xs" style={{ color: 'var(--destructive-text)' }}>
          {t.adminYears[refusal.code]}
        </p>
      ) : preview ? (
        <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
          {fill(t.adminYears.preview, { years: preview })}
        </p>
      ) : null}
      {discontinuedEnabled && (
        <p className="text-[11px] max-w-md" style={{ color: 'var(--muted-foreground)' }}>
          {t.adminYears.hint}
        </p>
      )}
    </div>
  )
}
