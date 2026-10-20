/**
 * The seam in the listing wall — PAN-274.
 *
 * The API orders the wall home market first (`homeMarketFirst`, PAN-266), so
 * the wall already changes market once, from Danish listings to everything
 * else. Each badge is measured inside its own population (C2), which is why
 * a Danish "Typisk · 500 kr" could sit one card above a Reverb "Under typisk
 * · ca. 507 kr" with nothing saying the market had changed — the basis lived
 * in a tooltip, and a tooltip never fires on touch. This says it once, where
 * the market changes, instead of on every card below.
 *
 * Shape is Astryx's `Divider` with a `label` (packages/core/src/Divider/
 * Divider.tsx, clone caf5673d): `role="separator"` named through
 * `aria-labelledby`, a small secondary label between two 1px `--color-border`
 * rules. Ours in our tokens — `--border-subtle` for the rules, `text-ink-
 * secondary` for the label. The line under it is Klup's: Astryx leaves the
 * meaning of the regions to the call site, and the meaning here is the one
 * thing the reader needs.
 *
 * The line names Reverb when every listing below is Reverb (the common case)
 * and the listing's own market otherwise — a Kleinanzeigen row below is
 * measured against German asking prices, and the line must not say Reverb.
 * Text, not colour, carries this: the tinted region behind the cards
 * (`.wall-away`) is supportive and can be ignored without losing the point.
 *
 * No 'use client': a pure function of its props, like MarketVerdictBadge.
 */

import { useId } from 'react'
import { fill } from '@/lib/i18n'

export function WallSeam({
  count,
  allReverb,
  t,
}: {
  /** Listings below the seam. */
  count: number
  /** True when every listing below the seam is a Reverb listing. */
  allReverb: boolean
  t: Record<string, string>
}) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-1 pt-2">
      <div role="separator" aria-labelledby={labelId} className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 border-t border-line" />
        <span id={labelId} className="text-xs font-medium text-ink-secondary">
          {fill(t.wallSeamLabel, { count })}
        </span>
        <span aria-hidden="true" className="h-px flex-1 border-t border-line" />
      </div>
      <p className="text-center text-xs text-ink-muted">
        {allReverb ? t.wallSeamReverb : t.wallSeamOwnMarket}
      </p>
    </div>
  )
}
