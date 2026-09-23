import type { CSSProperties } from 'react'

/**
 * ONE MATERIAL SYMBOLS ICON — always hidden from assistive technology.
 *
 * The ligature name is real text. `<span class="material-symbols-outlined">
 * open_in_new</span>` renders a glyph, but what the accessibility tree sees is
 * the word `open_in_new`, and it joins the accessible name of whatever
 * contains it. Before this component the external links on a product page
 * computed as *"open_in_new Wikipedia"*, measured in Chromium's accessibility
 * tree, not inferred.
 *
 * THERE IS NO PROP THAT UNHIDES THE ICON, and that is deliberate. The obvious
 * escape hatch — a `decorative={false}` for the icon-only control whose icon
 * *is* its label — can only ever produce a bad name. The ligature is a machine
 * token from Google's icon set (`more_vert`, `north_east`), it is English on a
 * Danish-first surface, and `lib/i18n.ts` owns user-facing copy. An icon-only
 * control gets `aria-label` on the *control*, from `t`. So the unhidden case
 * is not rare here — it is wrong here, and a prop for it would only let the
 * wrong thing be chosen. `aria-hidden` is unconditional.
 *
 * THERE IS NO SIZE SCALE, for the opposite reason: the call sites do not
 * agree. The 63 public icon spans this replaced carried 16 distinct font
 * sizes — 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72 —
 * written variously as `18` and `'18px'`. Collapsing that into a named scale
 * would be a visual change wearing a refactoring's clothes, and this ticket
 * promises no visual change. `style` passes through; a scale is a separate,
 * schedulable decision with a real before/after to show.
 *
 * Colour rides on `style` for the same reason. Tokens only — `var(--…)`,
 * never a literal — and green stays off icons entirely: `frontend/CLAUDE.md`
 * lists the three permitted uses and an icon is not among them.
 */
export function Icon({
  name,
  className,
  style,
}: {
  /** Material Symbols ligature, e.g. `open_in_new`. */
  name: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden="true"
      className={
        className
          ? `material-symbols-outlined ${className}`
          : 'material-symbols-outlined'
      }
      style={style}
    >
      {name}
    </span>
  )
}
