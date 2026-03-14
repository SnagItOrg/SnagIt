# Klup Frontend — Claude Guidelines

## Copy & i18n
- ALL user-facing text must use `t.key` from `lib/i18n.ts` — never hardcode Danish or English strings in components
- When adding new copy, add the key to BOTH `da` and `en` sections in `lib/i18n.ts`
- Component files must never contain raw Danish strings

## Design system
- Never use hardcoded color values — always use CSS custom properties (`var(--token)`)
- Follow the sparse accent rule: `var(--accent)` only for Kup-rating and Aktiv badge
- Reference design.panter.media for component patterns

## API routes
- Always use `createSupabaseServerClient` (not browser client) in API routes
- Always gate routes with `getUser()` — return 401 if no session
- Never log PII
