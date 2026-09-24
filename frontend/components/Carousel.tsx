'use client'

import { Children } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { scrollFade, useScrollEdges } from '@/components/use-scroll-edges'
import { fill } from '@/lib/i18n'
import { Icon } from '@/components/Icon'

/**
 * A horizontal rail with fade edges, navigation, snap and a keyboard path.
 *
 * Astryx's Carousel is the taste reference and not the dependency (PAN-111,
 * option B): nothing is vendored, nothing is installed, and its `xstyle` prop
 * is StyleX, which has no place here. What is borrowed is the reasoning —
 * the 1px measurement tolerance, the page-minus-half-an-item step, the mask
 * rather than an overlay, the padding/scroll-padding pairing, and the decision
 * to keep the buttons mounted and disabled rather than unmounted.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, AND WHY IT IS SHORT
 *
 * There is no keyboard handler. `tabIndex={0}` on an `overflow-x` box is the
 * entire keyboard story: the browser then pans it with the arrow keys, at its
 * own step, and Home/End/PageUp/PageDown come free with it. Astryx has no
 * keydown handler either. Writing one would mean choosing a step that fights
 * scroll-snap and re-implementing four keys the platform already has.
 *
 * There is no `hasLoop`, no `gap` scale and no `padding` scale. Both call
 * sites are the same shelf, so every one of those would be a prop with one
 * value. `hasLoop` in particular has no caller here.
 *
 * SCOPE — this has TWO call sites, not the four PAN-116 counted. The other two
 * were measured and are not carousels:
 *
 *   - `app/page.tsx` ShelfFallback is `aria-hidden` and holds no items. Giving
 *     a loading placeholder a tab stop, an `aria-roledescription` and buttons
 *     that scroll nothing would be worse than leaving it a plain strip. Its
 *     contract is geometric — it must match the shelf's height — and that is
 *     unaffected here, because the gutter is still 24px.
 *   - `app/browse/[root]/page.tsx` is a subcategory FILTER BAR of buttons.
 *     Astryx scopes snap to "a gallery or product list", and a filter chip is
 *     neither; labelling each chip "Slide 3 of 7" would describe a control as
 *     a picture. It also sits inside the content column, so it never had the
 *     gutter defect that motivated the padding pairing.
 *
 * Two identical call sites still justify one component, because what it adds —
 * fade, navigation, snap, ARIA and a keyboard path — exists at neither today.
 * The growth here is capability, not abstraction overhead: the component takes
 * no configuration at all.
 */

/**
 * One card's width, and the reason it is a constant rather than a prop.
 *
 * `ShelfFallback` in `app/page.tsx` declares the same clamp, because a
 * placeholder that is not the shelf's width reintroduces the layout shift the
 * fallback exists to prevent. The two cannot import from each other — this is
 * a `'use client'` module and the fallback is server-rendered, so a shared
 * const would cross the boundary as a client reference rather than a string.
 * Two copies, down from the three that existed before this change.
 */
const ITEM_WIDTH = 'w-[clamp(9.5rem,38vw,12rem)]'

export function Carousel({
  ariaLabel,
  children,
}: {
  ariaLabel: string
  children: React.ReactNode
}) {
  const { t } = useLocale()
  // The edge measurement (tolerance, RTL, no setState per frame) lives in
  // `useScrollEdges`, shared with the sidebar catalogue since PAN-121.
  const { ref: railRef, edges } = useScrollEdges<HTMLDivElement>('x')

  /**
   * A page, less half a card, floored at one card.
   *
   * The half-card is what stops a press from landing on a clean edge with no
   * hint that the rail continues; something stays cut off, which is the
   * affordance the shelf already relies on. The floor keeps the step positive
   * when one card is wider than the viewport.
   *
   * `behavior` is read at press time rather than baked in, because an explicit
   * `behavior: 'smooth'` overrides the `scroll-behavior` a reduced-motion
   * stylesheet would otherwise apply — the one place this scroll could ignore
   * the preference without anyone noticing.
   */
  const page = (direction: 1 | -1) => {
    const el = railRef.current
    if (!el) return
    const first = el.firstElementChild as HTMLElement | null
    const itemWidth = first?.offsetWidth ?? 0
    const amount = Math.max(el.clientWidth - itemWidth * 0.5, itemWidth)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * amount, behavior: reduced ? 'auto' : 'smooth' })
  }

  /**
   * `Children.toArray` drops nulls and booleans, so "Slide 3 of 12" counts
   * what actually rendered rather than the number of child slots written.
   */
  const slides = Children.toArray(children)
  const fade = scrollFade(edges)

  return (
    // aria-roledescription is SPOKEN, so it is copy and obeys the same rule as
    // every other string here — Astryx hardcodes "carousel"/"slide" in English,
    // which a Danish screen-reader user would hear mid-sentence.
    <div className="relative" role="region" aria-label={ariaLabel} aria-roledescription={t.carouselRole}>
      <div
        ref={railRef}
        data-fade={fade}
        tabIndex={0}
        className="carousel-rail flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription={t.carouselSlideRole}
            aria-label={fill(t.carouselSlideLabel, { current: i + 1, total: slides.length })}
            className={`flex-shrink-0 snap-start ${ITEM_WIDTH}`}
          >
            {slide}
          </div>
        ))}
      </div>

      <NavButton side="start" disabled={!edges.start} label={t.carouselPrevious} onClick={() => page(-1)} />
      <NavButton side="end" disabled={!edges.end} label={t.carouselNext} onClick={() => page(1)} />
    </div>
  )
}

/**
 * NOT GREEN, DELIBERATELY. Astryx's own prev/next take `--color-accent`, which
 * is its primary-button fill — and Klup's accent is reserved, exhaustively, for
 * Kup-rating, the "Aktiv" badge and the `under typisk` verdict. A control that
 * pans a shelf is not one of Klup's judgements, so this is the one place the
 * reference is knowingly not followed. It is a raised neutral surface instead.
 *
 * Sitting half over the gutter rather than fully inside it keeps the button off
 * the first card's content while still overlapping the rail it controls.
 */
function NavButton({
  side,
  disabled,
  label,
  onClick,
}: {
  side: 'start' | 'end'
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`carousel-nav absolute top-1/2 -translate-y-1/2 z-10 hidden h-9 w-9 items-center justify-center rounded-full sm:flex ${
        side === 'start' ? 'left-2' : 'right-2'
      }`}
    >
      <Icon name={side === 'start' ? 'chevron_left' : 'chevron_right'} style={{ fontSize: 20 }} />
    </button>
  )
}
