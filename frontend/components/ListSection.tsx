/**
 * ListSection — one list, several kinds of result, and the reader must know
 * which kind they are looking at. PAN-274 (the product wall: Danish listings,
 * then international ones measured against a different market) and PAN-275
 * (a search for "reverb": name matches, facet matches, title matches) are the
 * same problem, and this is the one pattern for both.
 *
 * THE RULE: the first group is the default and carries no header — on the
 * wall the Danish listings, on a SERP the top results. Every later group is
 * introduced by this header, which says what the group is, how many it holds,
 * and — in one line — why it is a different kind from what came before.
 * That is Mobbin's grouped search pattern (top results unlabelled, then
 * "Other", then "Web"), and Krug's: say it once, where the kind changes, not
 * on every row.
 *
 * Shape is Astryx's `Divider` with a `label` (packages/core/src/Divider/
 * Divider.tsx, clone caf5673d): `role="separator"` named through
 * `aria-labelledby`, a small secondary label between two 1px `--color-border`
 * rules. The optional muted region is Astryx's `Section variant="muted"`
 * (Section.tsx): a muted fill, no border, escaping the container's inline
 * padding — see `.list-section-muted` in globals.css. Ours in our tokens.
 *
 * Text carries the meaning. The muted region is a second cue a reader may
 * ignore without losing the point, so colour is never the only signal. Copy
 * is the caller's: `label` and `note` arrive resolved through `t.*`, because
 * the header has no opinion about what the groups are.
 *
 * No 'use client': a pure function of its props, like MarketVerdictBadge.
 */

import { useId, type ReactNode } from 'react'

export function ListSection({
  label,
  count,
  note,
  muted = false,
  children,
}: {
  /** What this group is, already resolved copy. */
  label: string
  /** How many items the group holds; shown after the label. */
  count: number
  /** One line under the header: why this group is a different kind. */
  note?: string
  /** Sit the group on a muted region (`.list-section-muted`). */
  muted?: boolean
  /** The group itself — usually a grid or a list. */
  children: ReactNode
}) {
  const labelId = useId()
  return (
    <>
      <div className="flex flex-col gap-1 pt-2">
        <div role="separator" aria-labelledby={labelId} className="flex items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 border-t border-line" />
          <span id={labelId} className="text-xs font-medium text-ink-secondary">
            {label} · {count}
          </span>
          <span aria-hidden="true" className="h-px flex-1 border-t border-line" />
        </div>
        {note && <p className="text-center text-xs text-ink-muted">{note}</p>}
      </div>
      {muted ? <div className="list-section-muted">{children}</div> : children}
    </>
  )
}
