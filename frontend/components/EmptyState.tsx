import Link from 'next/link'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/Button'

/* ==========================================================================
   EmptyState — the consumer-facing "there is nothing here" primitive.

   WHY THIS EXISTS, AND WHY IT IS NOT ONE COMPONENT WITH NoDataState

   `components/data-display/NoDataState.tsx` already answers this question for
   operator surfaces: monospace, left-aligned, dashed border, no icon, no
   action, a four-value `reason` union. That aesthetic is deliberate — /intel
   and the chart frames are instrument panels and read as data, not as product.
   Merging the two would force one of them to lose its voice. They stay two,
   and this comment is the record of that decision.

   THE THREE KINDS ARE NOT COSMETIC

   Klup's empty states mean three different things, and before this component
   they were indistinguishable — every one of them was a muted sentence in a
   centred column. An empty state that reads as a failure when it is actually
   a promise is the specific failure mode this component exists to prevent.

     blank        Nothing yet, and that is fine. A new watchlist, no saved
                  listings, a search nobody has typed into. The caller supplies
                  the glyph, because the right glyph is the surface's own
                  object — a bookmark on /saved, a magnifier on /search.

     monitoring   Klup is watching and has nothing to say YET. PAN-93 made this
                  a first-class state: "Vi overvåger danske annoncer for denne
                  model, men ingen er gennemgået endnu." This is the one that
                  must never read as failure. Its glyph is fixed — an open eye,
                  at full muted ink rather than the dimmed value `blank` gets.

     unfollowed   The category is outside what Klup follows today. PAN-86's
                  "Ikke fulgt endnu". Coverage is a boundary, not a defect, and
                  the boundary moves. Fixed `radar` glyph, also undimmed.

   The kinds are separated by GLYPH and by OPACITY, never by colour. Green is
   reserved for Klup's own judgements (frontend/CLAUDE.md, exhaustive list) and
   an empty state is not one, so the sparse-accent rule forbids it here. Two
   non-colour channels is also what makes the distinction survive a
   greyscale screenshot and a colour-vision deficiency.

   `action` is optional on all three kinds ON PURPOSE. It is tempting to make
   `unfollowed` require one — "following is the product" — but following a
   *category* is not a feature that exists, and a required prop would have made
   the component invent a button with nowhere to go.

   COPY

   `title` and `body` are whole sentences. This component cannot concatenate,
   cannot join a fragment to a noun, and offers no slot where a caller could.
   That is the point: `da` and `en` differ in word order, and a third locale
   will differ again. Anything variable arrives already interpolated through
   `fill()` in `lib/i18n.ts`, so a placeholder can move anywhere in the
   sentence without touching this file.

   MOTION

   None. Empty states do not animate; the action inherits the token default
   (`--duration-fast` / `--ease-standard`) like every other control.
   ========================================================================== */

type Action =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick: () => void; href?: never }

type Common = {
  /** A whole sentence from i18n. Never a fragment. */
  title: string
  /** A whole second sentence from i18n. Never a fragment. */
  body?: string
  /**
   * Heading level for `title`. Defaults to `p`, because most empty states are
   * a section inside a page that already has its heading. `/saved` is the
   * exception: there the empty state IS the page, and rendering its title as a
   * paragraph would leave that state with no `h1` at all. The prop exists to
   * keep document structure a property of the page rather than of this file.
   */
  titleAs?: 'h1' | 'h2' | 'p'
  /**
   * `region` — a centred column that owns a slice of the page.
   * `inline`  — a left-aligned line that sits inside a block that has its own
   *             heading, such as the Danish-market panel on a product page.
   *             Actions are not rendered in this layout; an inline empty state
   *             is a statement, not a place to act.
   */
  layout?: 'region' | 'inline'
  action?: Action
  className?: string
}

type Props =
  // `icon` is optional on `blank` alone. A filtered-to-nothing result wants a
  // quiet line, not a 48px glyph, and `blank` is the kind whose whole character
  // is that it does not assert itself. The other two own their glyph, because
  // the glyph is how they stay legible as something other than failure.
  | (Common & { kind: 'blank'; icon?: string })
  | (Common & { kind: 'monitoring'; icon?: never })
  | (Common & { kind: 'unfollowed'; icon?: never })

/** Glyph and ink weight per kind. `blank` defers its glyph to the caller. */
const KIND = {
  blank: { icon: null, opacity: 0.4 },
  monitoring: { icon: 'visibility', opacity: 1 },
  unfollowed: { icon: 'radar', opacity: 1 },
} as const

function ActionControl({ action }: { action: Action }) {
  const className =
    'min-h-[44px] rounded-xl px-5 text-sm font-semibold transition-opacity hover:opacity-90 ' +
    'inline-flex items-center justify-center'
  const style = {
    backgroundColor: 'var(--primary)',
    color: 'var(--primary-foreground)',
  }

  if (action.href) {
    return (
      <Link href={action.href} className={className} style={style}>
        {action.label}
      </Link>
    )
  }
  return (
    <Button variant="primary" onClick={action.onClick} className={className}>
      {action.label}
    </Button>
  )
}

export function EmptyState(props: Props) {
  const { title, body, layout = 'region', action, titleAs: Title = 'p', className = '' } = props
  const kind = KIND[props.kind]
  const icon = props.kind === 'blank' ? props.icon : kind.icon

  if (layout === 'inline') {
    return (
      <div className={`flex items-start gap-2 ${className}`}>
        {icon && (
          <Icon
            name={icon}
            className="shrink-0"
            style={{ fontSize: '18px', color: 'var(--text-muted)', opacity: kind.opacity }}
          />
        )}
        <div className="flex flex-col gap-1">
          <p className="type-body-secondary">{title}</p>
          {body && <p className="type-meta">{body}</p>}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center max-w-sm mx-auto ${className}`}
    >
      {icon && (
        <Icon
          name={icon}
          style={{ fontSize: '48px', color: 'var(--text-muted)', opacity: kind.opacity }}
        />
      )}
      <Title className="text-base font-semibold text-foreground text-balance">{title}</Title>
      {/* No `type-measure` here. 68ch is a measure for left-aligned prose; a
          centred paragraph that long is hard to track back to the next line.
          The container's own `max-w-sm` is ~45ch at this size and is the
          measure — stating both would leave the wider one inert. */}
      {body && <p className="type-body-secondary">{body}</p>}
      {action && (
        <div className="mt-2">
          <ActionControl action={action} />
        </div>
      )}
    </div>
  )
}
