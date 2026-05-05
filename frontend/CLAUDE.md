# Klup Frontend — Claude Guidelines

## Copy & i18n
- ALL user-facing text must use `t.key` from `lib/i18n.ts` — never hardcode Danish or English strings in components
- When adding new copy, add the key to BOTH `da` and `en` sections in `lib/i18n.ts`
- Component files must never contain raw Danish strings

## Design system
- Never use hardcoded color values — always use CSS custom properties (`var(--token)`)
- Follow the sparse accent rule: `var(--accent)` only for Kup-rating and Aktiv badge
- Reference design.panter.media for component patterns

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
| Kleinanzeigen  | `#f5c542`  | black      |                                           |

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
