/**
 * ListSection — one list, several kinds of result, and the reader must know
 * which kind they are looking at. PAN-274 (the product wall: Danish listings,
 * then international ones measured against a different market) and PAN-275
 * (a search for "reverb": name matches, then the catalogue kind) are the same
 * problem, and this is the one pattern for both.
 *
 * THE RULE: the first group is the default and carries no header — on the
 * wall the Danish listings, on a SERP the top results. Every later group is
 * introduced by this header: a short left-aligned name of what the group is
 * and, only where a name is not enough, one line of why it is a different
 * kind. Mobbin's grouped search ("Other", "Web": top results unlabelled, then
 * a plain left-aligned heading per kind, no count, no rules) and Krug's: say
 * it once, where the kind changes, and say as little as possible.
 *
 * PAN-279 (owner, 2026-10-20): the first cut centred the heading between two
 * rules and appended a count ("Samme type · 4"), and nobody had a mental
 * model of that. The header is now Astryx's `CommandPaletteGroup` heading,
 * read not imported (packages/core/src/CommandPalette/CommandPaletteGroup.tsx,
 * clone caf5673d): `role="group"` named by its heading; the heading
 * supporting-size (12px), secondary colour, medium weight, left-aligned, no
 * uppercase, 4px block padding — the same heading DropdownMenuGroup uses. No
 * rule, no fill on the heading: in Mobbin and Astryx the highlight belongs to
 * the selected row, not to the heading. Ours in our tokens.
 *
 * The optional muted region is Astryx's `Section variant="muted"`
 * (Section.tsx): a muted fill, no border, escaping the container's inline
 * padding — see `.list-section-muted` in globals.css. Text carries the
 * meaning; the region is a second cue a reader may ignore. Copy is the
 * caller's: `label` and `note` arrive resolved, because the header has no
 * opinion about what the groups are.
 *
 * No 'use client': a pure function of its props, like MarketVerdictBadge.
 */

import { useId, type ReactNode } from 'react'

export function ListSection({
  label,
  note,
  muted = false,
  children,
}: {
  /** What this group is, already resolved: a kind, or its place in the catalogue. */
  label: string
  /** One line under the heading, only where the label alone leaves a question. */
  note?: string
  /** Sit the group on a muted region (`.list-section-muted`). */
  muted?: boolean
  /** The group itself — usually a grid or a list. */
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-2 pt-2">
      <div className="flex flex-col gap-0.5 py-1">
        <p id={headingId} className="text-xs font-medium text-ink-secondary">
          {label}
        </p>
        {note && <p className="text-xs text-ink-muted">{note}</p>}
      </div>
      {muted ? <div className="list-section-muted">{children}</div> : children}
    </div>
  )
}
