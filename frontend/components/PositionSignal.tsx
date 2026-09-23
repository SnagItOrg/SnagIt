'use client'

import { useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
import type { PositionFilter, PositionSignal as PositionSignalModel } from '@/lib/position-signal'
import { Icon } from '@/components/Icon'

/**
 * PAN-121 — one position signal, in the same place on every public listing
 * surface.
 *
 * The count is not decoration, and the honesty of it is not this component's
 * to guarantee: `buildPositionSignal` derives it from the rendered rows and
 * offers no field a projection total could arrive in. This file only renders
 * what that module computed. See `lib/position-signal.ts` for why.
 *
 * NOT GREEN, AND NOT OPACITY.
 *
 * Green is exhaustive — Kup-rating, the "Aktiv" badge and `under typisk`. An
 * active filter is the visitor's own narrowing, not a Klup judgement about a
 * price, so it may not borrow the accent. The active state is carried by
 * weight, fill and border instead: a filled `--secondary` well, a real border
 * and medium weight against the unfilled surface around it.
 *
 * It is also not carried by transparency. PAN-113's worker measured an
 * `opacity-60` treatment at 2.61:1 — below AA — and replaced it with an
 * unfilled dashed chip that was both quieter and more legible. Every colour
 * here is a full-strength semantic token for the same reason.
 *
 * `onRemoveFilter` is optional, following `SideNav`'s `onChange` (PAN-116):
 * `/family/[slug]` is a server component and has nothing removable, so it
 * mounts this without a handler rather than passing a no-op.
 */
export function PositionSignal({
  signal,
  onRemoveFilter,
}: {
  signal: PositionSignalModel
  onRemoveFilter?: (filter: PositionFilter) => void
}) {
  const { t } = useLocale()

  /**
   * What the last removal removed, for the live region.
   *
   * Removing a filter changes the result set without moving focus, so a screen
   * reader would otherwise be told nothing at all. The chip is a real
   * `<button>`, so Enter and Space already work and focus already lands on it
   * by Tab — the keyboard half needs no JavaScript, only the announcement does.
   */
  const [lastRemoved, setLastRemoved] = useState<string | null>(null)

  const countLabel =
    signal.countKind === 'categories'
      ? fill(signal.count === 1 ? t.positionSignalCategoryOne : t.positionSignalCategoryMany, {
          count: signal.count,
        })
      : fill(signal.count === 1 ? t.positionSignalResultOne : t.positionSignalResultMany, {
          count: signal.count,
        })

  function handleRemove(filter: PositionFilter) {
    setLastRemoved(fill(t.positionSignalFilterRemoved, { label: filter.label }))
    onRemoveFilter?.(filter)
  }

  return (
    <section aria-label={t.positionSignalRegion} className="flex flex-col gap-1.5 py-3">
      {/* THE POSITION LINE — and where PAN-124's breadcrumb goes.

          A breadcrumb and this signal answer different questions: a breadcrumb
          says where you are in the taxonomy and is fixed, while the chips below
          say what is narrowing the set and are removable. Both are legitimate
          on `/browse/[root]`, so the region is a vertical stack rather than one
          flat row: a breadcrumb can replace this scope line without the filters
          moving and without a second bar appearing beside this one.

          Deliberately `text-sm`, not a heading. The failure mode to design out
          is two bars of similar weight competing for the same "where am I" job
          — the `<h1>` above already names the category, so this line anchors
          the filters rather than restating the title. PAN-124 unifies the two
          hand-rolled breadcrumbs that exist today; this ticket moves neither.

          Absent on the two routes whose `<h1>` already IS the scope, so the
          same words do not appear three times down the page. The heading is
          the position line there. */}
      {signal.scope && (
        <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          {signal.scope}
        </p>
      )}

      {/* THE NARROWING LINE — what is filtering, and how many rows that yields. */}
      <div className="flex flex-wrap items-center gap-2">
        {signal.filters.map((filter) => {
          const removable = onRemoveFilter !== undefined
          return (
            <span
              key={filter.id}
              className="inline-flex items-center gap-1 rounded-full pl-3 pr-1 py-1 text-sm font-medium"
              style={{
                background: 'var(--secondary)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            >
              {filter.label}
              {removable && (
                <button
                  type="button"
                  onClick={() => handleRemove(filter)}
                  aria-label={fill(t.positionSignalRemoveFilter, { label: filter.label })}
                  className="inline-flex items-center justify-center rounded-full size-5 transition-colors hover:bg-border"
                  style={{
                    color: 'var(--muted-foreground)',
                    transitionDuration: 'var(--duration-fast)',
                    transitionTimingFunction: 'var(--ease-standard)',
                  }}
                >
                  <Icon name="close" style={{ fontSize: '16px' }} />
                </button>
              )}
            </span>
          )
        })}

        {/* A surface with nothing narrowing it says so, rather than rendering an
            empty bar the visitor has to interpret. */}
        {signal.unfiltered && (
          <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {t.positionSignalUnfiltered}
          </span>
        )}

        <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {'·'} {countLabel}
        </span>
      </div>

      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {lastRemoved ?? ''}
      </span>
    </section>
  )
}
