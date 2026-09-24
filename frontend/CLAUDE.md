# Klup Frontend — Claude Guidelines

## Copy & i18n
- ALL user-facing text must use `t.key` from `lib/i18n.ts` — never hardcode Danish or English strings in components
- When adding new copy, add the key to BOTH `da` and `en` sections in `lib/i18n.ts`
- Component files must never contain raw Danish strings

## Design system
- Never use hardcoded color values — always use CSS custom properties (`var(--token)`)
- Follow the sparse accent rule: green only for Klup's own judgements — Kup-rating, Aktiv badge, `under typisk` verdict. See "Design rules — non-negotiable" for the exhaustive list
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
| You are here | `--here` · `--here-subtle` · `--here-border` — see "Design rules" for the exhaustive list of uses |
| Sidebar zones | `--zone-catalogue` · `--zone-group` · `--zone-yours` — aliases onto the neutral ramp, SideNav only |
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
push the bias back up — green is the only brand pigment, violet `--here` is the
only wayfinding pigment, and a blue cast would read as a third colour.

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

**Green accent `#13ec6d` belongs to Klup's OWN judgements**, and to nothing
else. Exactly three uses are permitted: Kup-rating stars, "Aktiv" badges, and
the `under typisk` verdict badge. **Never** on buttons, navigation, or any
other UI element — in particular not on a marketplace's own number, such as the
`-X%` discount badge.
(Exception: `/intel` private dashboard — see Intel dashboard section.)

The `under typisk` use was added by product-owner decision (PAN-63), reversing
the earlier blanket ban that PAN-54 honoured and PAN-59 enforced. A verdict
that a price sits below its own market is Klup's judgement, the same class of
statement as the Kup-rating. Accepted consequence: when the Kup-rating ships,
green will carry two related meanings on the same surface. `typical` and `over`
stay neutral and destructive respectively. Do not read this as a general
loosening — the list is exhaustive, and extending it is a product-owner call.

**Violet `--here` marks where the visitor IS, and nothing else** (PAN-121). One
colour for the current location, repeated at every place that states it, so a
visitor learns it once. Exactly these uses are permitted:

1. `SideNav` — the current node: a catalogue branch, subcategory or product row,
   or a top-level item (Søg, Katalog, Gemt, Alerts, Profil) when it is the
   location. Text, icon, 2px rail and `--here-subtle` fill.
2. `Breadcrumb` — the current crumb, the one carrying `aria-current="page"`.
3. `/browse/[root]` — the subcategory facet chip in force (`Alle` when none is).
4. `PositionSignal` — the active filter chip(s).
5. `BottomNav` — the active tab's icon and label.

**Never** on a button, on a link that is not the current location, on a hover or
focus state (focus is `--ring`), on a price or verdict badge, on `SourceBadge`,
or next to green on the same element. **Never on a selected toggle** — the
locale switch, the theme toggle, the admin debug chip: selection is not
location, and they stay neutral (`--secondary` / `--foreground`). A location
mark is never colour alone: it always carries a weight step too, so it survives
grayscale. The list is exhaustive; extending it is a product-owner call.

**The sidebar's zones are told apart by grey, never by hue** (PAN-121 round 2).
Three tones of the one neutral family: `--zone-catalogue` (the sidebar surface),
`--zone-group` one step deeper for a row that holds products (a catalogue
root), and `--zone-yours` recessed for Dit Klup and the utilities. `--here`
must stay AA on all three — measured: text 7.00 / 5.45 / 6.36 in light and
8.09 / 6.69 / 8.84 in dark; on its own tint over the group tone, 4.72 light
and 4.92 dark, the tightest pair. Pick a new tone from the ramp only after
re-measuring that pair.

Why violet: every other hue is already spoken for — green is Klup's judgement,
red is destructive, blue is the focus ring and the DBA/Thomann badges, cyan is
Finn, orange is Reverb. Nearest neighbour is the DBA badge at CIEDE2000 ΔE 17
(a solid navy pill with white text, never a tint), so the two do not read as
one sign.

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
