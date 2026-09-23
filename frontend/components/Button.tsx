import type { ButtonHTMLAttributes } from 'react'

/* ==========================================================================
   Button — the colour contract, owned in one place.

   PAN-123. 64 raw `<button>` elements on the public surface carried 53
   distinct className+style signatures. 44 of them (69%) were one-offs. That
   is not a design system with drift; it is 64 independent decisions.

   WHAT THIS COMPONENT OWNS, AND WHY IT IS ONLY THAT

   Exactly one axis had ZERO divergence across the whole surface, and it is
   the axis that matters most:

     - 17 of 17 primary buttons expressed their fill as the same inline pair,
       `backgroundColor: var(--primary)` + `color: var(--primary-foreground)`.
       Byte-identical, every one.
     - 10 of 10 secondary buttons used `background: var(--secondary)` with
       `border: 1px solid var(--border)`. Their text colour appeared to split
       three ways — `--foreground`, `--secondary-foreground`, a ternary — but
       `globals.css` aliases the first two onto `var(--text-primary)`. Two
       names, one value.

   Every OTHER axis diverged, and diverged badly. Within the 17 primary
   buttons alone: 2 radii, 7 vertical paddings, 4 horizontal paddings, 5 font
   sizes, 2 weights, 5 width idioms, 4 transition idioms, 3 disabled
   opacities, and `min-h-[44px]` present on 6 and absent on 11. Eleven axes.
   The shared `Combobox` was declined at seven.

   So this component owns COLOUR and refuses SHAPE. A `size` or `radius` scale
   here would be one of two bad things: a prop per signature — the same 64
   decisions wearing a type — or a silent visual change, which is what PAN-126
   refused when `Icon` shipped with no size scale because its 63 call sites
   carried 16 font sizes. Shape rides on `className`, exactly as `Dialog`'s
   `panelClassName` already does in this repo: the caller owns its shape, this
   file owns its contract.

   THERE IS NO `style` PROP, and that is the point.

   `frontend/CLAUDE.md` makes green exhaustive — Kup-rating, "Aktiv", `under
   typisk` — and never a button fill. A `style` escape hatch would let any
   caller write `backgroundColor: '#13ec6d'` and the rule would be back to
   being a review comment. With `style` omitted from the type and `variant` a
   closed union, a green button is not discouraged here. It is unrepresentable.
   (This is the `Breadcrumb`/`Icon` test from PAN-124 and PAN-126: if a
   combination is always wrong, do not make it expressible.)

   THERE IS NO `href`, for the same reason. A control whose only job is to go
   somewhere is a `<Link>` — an `href` here would make "button that navigates"
   authorable, and that is an accessibility defect, not a styling choice.

   THERE ARE ONLY TWO VARIANTS. Not because two is elegant, but because two is
   what the call sites agreed on. `destructive` has four call sites and three
   different treatments (filled, outlined, bare text); `ghost` has ten call
   sites and five different colour mechanisms. Naming either one would be
   inventing agreement that does not exist. They stay raw until somebody
   decides what they look like, and that is a design decision with a real
   before/after, not a refactor.

   `type` DEFAULTS TO `'button'`. A `<button>` with no `type` inside a `<form>`
   submits it, which is a footgun 38 of the 64 were exposed to. Every call site
   that genuinely submits passes `type="submit"` explicitly; that was checked
   per site during the migration, not assumed.

   Disabled STYLING is not here either — the surface used `opacity-30`, `-40`
   and `-50` with no rule. `disabled` passes through as the native attribute;
   the dimming stays in `className` until someone picks one number.

   Focus needs nothing from this file: `globals.css` sets `:focus-visible`
   `outline` with `!important` as a floor that no utility can suppress.
   ========================================================================== */

type Variant = 'primary' | 'secondary'

/** The whole contract. Two variants, colour only — never geometry. */
const VARIANT_STYLE: Record<Variant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--primary)',
    color: 'var(--primary-foreground)',
  },
  secondary: {
    backgroundColor: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
    border: '1px solid var(--border)',
  },
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
  /**
   * Required. There is no default: "reserve primary for the single most
   * important action in the view" is a decision, and a default would let it
   * be made by omission.
   */
  variant: Variant
}

export function Button({ variant, type = 'button', ...rest }: Props) {
  return <button type={type} style={VARIANT_STYLE[variant]} {...rest} />
}
