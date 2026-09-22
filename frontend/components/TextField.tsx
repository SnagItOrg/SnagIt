import { forwardRef } from 'react'

/* ==========================================================================
   TextField — one input, nine call sites, no inline style objects.

   Every text input in the product carried the same three lines of inline
   `style` and the same two focus handlers, copied by hand:

       style={{ backgroundColor: 'var(--input-background)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)' }}
       onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
       onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border)' }}

   Twelve inputs across nine files. Beyond the repetition, the blur handler
   restores a hardcoded `var(--border)` rather than whatever the field's own
   resting border was, and it writes to the `style` attribute that React is
   also managing — two owners for one property, and the JS one wins only until
   the next render that touches it.

   The appearance now lives in `.field` in globals.css, where `:focus` is a
   state the cascade already knows about and no JavaScript runs at all. This
   file is the thin part: a className merge and a forwarded ref.

   The `.field` block also drops `transition-all` for `border-color` alone.
   `transition-all` is `transition-property: all` — on a text input that
   includes padding, font-size and width, none of which was the point.

   DELIBERATELY NOT A WRAPPER. No label, no error text, no help text, no
   `<div>` around the input. Every one of the nine call sites arranges its own
   label, icon and layout differently, and several put the input inside a
   relative container with an absolutely-positioned glyph. A component that
   tried to own that structure would have to take a prop for each variation
   and would be configuration pretending to be design. `className` passes
   through, so sizing, radius and placeholder styling stay where they are
   decided — at the call site.
   ========================================================================== */

type Props = React.InputHTMLAttributes<HTMLInputElement>

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`field ${className}`} {...rest} />
})
