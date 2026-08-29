# Klup Frontend — Claude Guidelines

## Copy & i18n
- ALL user-facing text must use `t.key` from `lib/i18n.ts` — never hardcode Danish or English strings in components
- When adding new copy, add the key to BOTH `da` and `en` sections in `lib/i18n.ts`
- Component files must never contain raw Danish strings

## Design system
- Never use hardcoded color values — always use CSS custom properties (`var(--token)`)
- Follow the sparse accent rule: `var(--accent)` only for Kup-rating and Aktiv badge
- Reference design.panter.media for component patterns

### Tokens — `app/globals.css`

Literal colours are written **once**, in the `--ramp-*` block. Everything else
is an alias. Add a semantic alias; never add a second literal.

| Group | Tokens |
|---|---|
| Canvas / surfaces | `--canvas` · `--surface-1` · `--surface-2` · `--surface-3` · `--surface-raised` |
| Borders | `--border-subtle` · `--border-strong` |
| Text | `--text-primary` · `--text-secondary` · `--text-muted` |
| Accent | `--accent` · `--accent-hover` · `--accent-text` · `--accent-subtle` · `--accent-border` · `--accent-foreground` |
| Destructive | `--destructive` · `--destructive-hover` · `--destructive-text` · `--destructive-subtle` · `--destructive-border` · `--destructive-foreground` |
| Focus | `--ring` · `--ring-width` · `--ring-offset-width` |
| Elevation | `--rim` · `--shadow-1..3` · `--elevation-card` / `-raised` / `-overlay` |

Tailwind exposes these as `bg-canvas`, `bg-surface-1..3`, `bg-surface-raised`,
`border-line` / `border-line-strong`, `text-ink` / `-secondary` / `-muted`,
`text-accent-text`, `bg-destructive-subtle`, and `shadow-card` / `-raised` /
`-overlay`. Legacy names (`--background`, `--card`, `--muted-foreground`, …)
are aliases onto the same ramp and keep working.

**Neutrals are near-neutral with a slight cool bias**, calibrated against
Linear's ramp: B runs only 2–7 above R on surfaces and 9–13 on text and
borders. Do not introduce an achromatic `#1a1a1a`-style neutral, and do not
push the bias back up — green is the only pigment in the system, and a blue
cast reads as a second brand colour.

**Elevation is downward.** `--rim` (the illuminated top edge) composes first,
then a tight contact shadow and a wider cast. No symmetric glow, no
glassmorphism, no decorative gradient.

**Green is damped in dark mode** (`#16d96b`, not `#13ec6d`) because the brand
green halates against the dark canvas. Both are the Aktiv/Kup-rating colour;
the light theme keeps the brand value.

**Focus is a floor.** `:focus-visible` sets `outline` with `!important` in
`globals.css` so a `focus:outline-none` utility can never suppress the keyboard
ring. Components may add their own box-shadow ring on top.

**Destructive states use the destructive tokens.** No raw `red-*` utilities.
(The saved/favourite heart in `SearchResultCard` is a saved-state signal, not a
destructive action, and is deliberately not a destructive token.)

## Design rules — non-negotiable

**Green accent `#13ec6d`:** ONLY on Kup-rating stars and "Aktiv" badges.
**Never** on buttons, navigation, or any other UI element.
(Exception: `/intel` private dashboard — see Intel dashboard section.)

**Typography:** DM Serif Display for headlines, Inter for body.

**Price history / prishistorik:**
- ONLY on `/saved` and product pages
- NEVER on SERP (search results) — cross-variant averaging is misleading

**Kup-score:** Hidden in UI. Will be revealed when there is sufficient per-variant price history data. Do not remove the logic, just keep it hidden.

## Brand badges (source indicators)

Source-specific badge colors used on listing cards and any surface that shows
listing provenance. Match these exactly — do not swap or approximate.

| Source         | Background | Foreground | Notes                                     |
|---             |---         |---         |---                                        |
| DBA            | `#00098A`  | white      |                                           |
| Finn.no        | `#06bffc`  | black      |                                           |
| Blocket.se     | `#F71414`  | white      |                                           |
| Thomann        | `#002D4C`  | white      |                                           |
| Reverb         | `#EC5A2C`  | white      | unconfirmed — verify against brand guide  |
| Kleinanzeigen  | `#1D4B00`  | white      |                                           |

## API routes
- Always use `createSupabaseServerClient` (not browser client) in API routes
- Always gate routes with `getUser()` — return 401 if no session
- Never log PII

## Intel dashboard (/intel)
- Private, admin-gated — do not add to navigation
- Dark theme only: `#0a0a0a` background, `#13ec6d` accent allowed here
  (exception to sparse accent rule — intel is a private tool)
- Monospace font for all numbers
- No Klup branding on this surface
