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
| Primary action | `--primary` · `--primary-hover` · `--primary-active` · `--primary-foreground` — apply as `.button-primary` (or `<Button variant="primary">`), never a hand-rolled fill |
| Accent | `--accent` · `--accent-hover` · `--accent-text` · `--accent-subtle` · `--accent-border` · `--accent-foreground` |
| Destructive | `--destructive` · `--destructive-hover` · `--destructive-text` · `--destructive-subtle` · `--destructive-border` · `--destructive-foreground` |
| You are here | `--here` · `--here-subtle` · `--here-border` — see "Design rules" for the exhaustive list of uses |
| Sidebar zones | `--zone-catalogue` · `--zone-yours` — aliases onto the neutral ramp, SideNav only |
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

1. `SideNav` — the current node: a catalogue root or kind row (on a product
   page, the node that holds the product), or a top-level item (Søg, Katalog,
   Gemt, Alerts, Profil) when it is the location. Text, icon, 2px rail and
   `--here-subtle` fill.
2. `Breadcrumb` — the current crumb, the one carrying `aria-current="page"`.
3. `/browse/[root]` — the subcategory facet chip in force (`Alle` when none is),
   and the attribute facet chip(s) in force (PAN-140: Type · Elektronik ·
   Karakteristik). Both rows are the page-rendered form of use 4.
4. `PositionSignal` — the active filter chip(s).
5. `BottomNav` — the active tab's icon and label.
6. The admin nav (`app/admin/layout.tsx`, PAN-171) — the current tool, with
   the same weight step and filled icon as `SideNav`.

**Never** on a button, on a link that is not the current location, on a hover or
focus state (focus is `--ring`), on a price or verdict badge, on `SourceBadge`,
or next to green on the same element. **Never on a selected toggle** — the
locale switch, the theme toggle, the admin debug chip: selection is not
location, and they stay neutral (`--secondary` / `--foreground`). A location
mark is never colour alone: it always carries a weight step too, so it survives
grayscale. The list is exhaustive; extending it is a product-owner call.

**The sidebar's zones are told apart by grey, never by hue** (PAN-121).
Two tones of the one neutral family: `--zone-catalogue` (the sidebar surface)
and `--zone-yours` recessed for Dit Klup and the utilities — a tinted region
reads as a place. **Rows get no fill at rest**: fill means selected, so in the
sidebar it belongs to `--here` alone (round 3 retired the grey category row,
which read as clicked). A root is semibold `--text-primary` with a chevron;
its kinds hang off a 1px `--border-subtle` guide line. `--here` must stay AA on
both zones — measured: text 7.00 / 6.36 light, 8.09 / 8.84 dark; on its own
tint 6.00 / 5.47 light, 6.07 / 6.93 dark (tightest: 5.47, Gemt in light). Pick
a new tone from the ramp only after re-measuring those pairs.

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

## Analytics (PostHog)

EU cloud only, loaded only after consent, off outside `NEXT_PUBLIC_VERCEL_ENV=production`.
The authority is `KlupEventMap` in `lib/analytics.ts`: an event that is not
declared there is dropped by `before_send`. Always emit through `track()`;
never import `posthog-js` or call `usePostHog()`. Render `<TrackView>` for a
page-view event, which fires once per view even under strict mode.

| Event | Fired from | Properties |
|---|---|---|
| `$pageview` | every route (`PostHogPageView`) | `path_template`, `$current_url` with only `page` and `sub` kept |
| `search_submitted` / `search_resolved` / `search_unsupported` | `/search` | `query_norm` and the resolution; names and shapes are frozen for the dashboards |
| `demand_signal_submitted` | `/search`, unsupported outcome | `has_email` only, never the address |
| `product_viewed` | `/product/[slug]`, once the data has loaded | `product_slug`, `category_root`, `kind`, `has_price_band` |
| `family_viewed` | `/family/[slug]` | `family_slug` |
| `filter_applied` | `/browse/[root]`, when a chip is switched on | `root`, `sub`, `facet_key`, `facet_value` |
| `listing_outbound_clicked` | "Se annonce" on a listing card: **the core value signal** | `source`, `country`, `product_slug`, `price_dkk_bucket` (a band, never the price) |
| `listing_saved` | product page, after the save is accepted | `source`, `product_slug` |
| `watchlist_created` | every creation path, after the server accepts it | `origin`, `product_slug`, `has_max_price` (never the query) |
| `signup_completed` | `/watchlists`, when the email link confirmed a **new** account | `method` |
| `price_check_result` | `/tjek-prisen`, when a pasted link is answered | `state`, `source` (never the link) |
| `price_check_guess` | `/tjek-prisen`, when the guess row is answered | `shown`, `picked` (0, 1, 2 or `none`) |
| `feedback_sent` | the feedback sheet, after the route accepted it | `kind`, `surface` (never the text or the email) |
| `price_tip_sent` | the "Giv os et tip" sheet (PAN-256), after the route accepted it | `surface` (never the price, the name, the text or the email) |

Every event also carries `klup_schema_version`, `app_env`, `surface`, `locale`,
`is_internal` and `internal_role`. `$identify` sends the Supabase user id only.
No PII: no email, no free text beyond `query_norm`, no user id beyond PostHog's
own. The retired `search_performed` and `listing_clicked` are dropped on the wire.

## Intel dashboard (/intel)
- Private, admin-gated. Listed in the admin nav, and its header links back
  to Admin and to klup.dk (PAN-171: the owner reversed the earlier
  no-navigation rule, because a page reachable only by typing its URL is lost)
- Dark theme only: `#0a0a0a` background, `#13ec6d` accent allowed here
  (exception to sparse accent rule — intel is a private tool)
- Monospace font for all numbers
- No public Klup chrome (sidebar, bottom nav) on this surface — the thin header
  is its only navigation
