/**
 * The shared route-access authority.
 *
 * Stage 3 WP-1. See docs/stage-3-v1-decision-and-build-plan.md §7.7 and §15.9.
 *
 * ONE classification per routable file, consumed by BOTH `middleware.ts` and
 * the completeness guard in scripts/lib/wp1-route-access.test.ts. There is no
 * second list, so the runtime posture and the test cannot drift into two
 * descriptions that disagree.
 *
 * WHY THE DEFAULT IS PASS-THROUGH. The middleware matcher runs before routing,
 * so it cannot tell an unknown path from a protected one. Deny-by-default
 * therefore answered `307 -> /login` for every unmatched path: a mistyped URL
 * read as a permissions problem, /sitemap.xml was treated as a protected page,
 * and crawlers got a redirect where the honest answer was "this does not
 * exist". Denial is now an explicit classification and everything else falls
 * through to Next.js, which serves only routes that exist.
 *
 * THE HAZARD THAT CREATES. A newly added route is publicly reachable unless
 * someone classifies it here. That is not left to reviewer memory: the guard
 * inventories the filesystem and fails on any routable file with no entry.
 *
 * NO IMPORTS. This module runs in the Edge middleware runtime and in a plain
 * Node test process. It must depend on neither.
 */

export type AccessClass =
  /** Reachable anonymously; content does not depend on catalogue state. */
  | 'public_page'
  /** Reachable anonymously, but WHAT it renders is decided by §3.1. */
  | 'public_page_data_gated'
  /** Requires a session. */
  | 'protected_page'
  /** Requires a session AND user_preferences.is_admin, re-checked in middleware. */
  | 'admin_page'
  /** Reachable anonymously. */
  | 'public_api'
  /** Reachable anonymously, but WHICH ROWS it returns are decided by §3.1. */
  | 'public_api_data_gated'
  /** Requires a session. */
  | 'protected_api'
  /** Admin only, denied at the edge and re-checked in-route. */
  | 'admin_api'
  /** Own credential, no user session: CRON_SECRET header, webhook signature. */
  | 'machine_api'
  /** Next.js metadata route: sitemap, robots, manifest, icons. */
  | 'framework_metadata'

export interface RouteRule {
  /** Normalised route path. Dynamic segments keep their `[param]` form. */
  route: string
  access: AccessClass
  /** True when the route file does not exist yet and a later package adds it. */
  planned?: boolean
  note?: string
}

/**
 * Classes that require a session. Everything else passes through.
 * `admin_page` and `admin_api` are listed here as well as being re-checked
 * against `user_preferences.is_admin` — a session alone is never sufficient.
 */
const AUTHENTICATED_CLASSES: ReadonlySet<AccessClass> = new Set<AccessClass>([
  'protected_page',
  'protected_api',
  'admin_page',
  'admin_api',
])

export const ROUTE_ACCESS: readonly RouteRule[] = [
  /* ---------------- public pages ---------------- */
  { route: '/', access: 'public_page' },
  { route: '/browse', access: 'public_page' },
  { route: '/browse/[root]', access: 'public_page' },
  { route: '/search', access: 'public_page' },
  { route: '/login', access: 'public_page' },
  { route: '/signup', access: 'public_page' },
  { route: '/auth/callback', access: 'public_page', note: 'OAuth + magic-link callback; no session yet by definition' },
  { route: '/auth/confirm', access: 'public_page' },
  { route: '/watchlists', access: 'public_page', note: 'renders an anonymous teaser' },
  { route: '/saved', access: 'public_page', note: 'renders an anonymous teaser' },
  { route: '/onboarding/step1', access: 'public_page', note: 'retired; 308 to /' },
  { route: '/onboarding/step2', access: 'public_page', note: 'retired; 308 to /' },
  { route: '/onboarding/step3', access: 'public_page', note: 'retired; 308 to /' },
  { route: '/onboarding/step4', access: 'public_page', note: 'pre-existing redirect stub' },

  /* ---------------- data-gated public surfaces ---------------- */
  {
    route: '/product/[slug]',
    access: 'public_page_data_gated',
    note: 'reachable by anyone; app/product/[slug]/layout.tsx applies §3.1 and 404s otherwise',
  },
  {
    route: '/api/product/[slug]',
    access: 'public_api_data_gated',
    note: 'reachable by anyone; the route applies §3.1 and 404s otherwise',
  },
  {
    route: '/family/[slug]',
    access: 'public_page_data_gated',
    note: 'WP-2. noindex and unlisted while it has zero canonical children (§4.2)',
  },

  /* ---------------- planned public pages ---------------- */
  { route: '/om-data', access: 'public_page', planned: true, note: 'WP-3' },
  { route: '/privatliv', access: 'public_page', note: 'WP-5 privacy route (§12.4.5); public in every consent state' },
  { route: '/sitemap.xml', access: 'framework_metadata', planned: true, note: 'WP-3 adds app/sitemap.ts' },

  /* ---------------- protected pages ---------------- */
  { route: '/profile', access: 'protected_page' },
  {
    route: '/watchlists/[id]/edit',
    access: 'protected_page',
    note: 'was denied by the old deny-by-default rule; must stay explicit',
  },

  /* ---------------- admin pages ---------------- */
  { route: '/admin', access: 'admin_page' },
  { route: '/admin/cleanup', access: 'admin_page' },
  { route: '/admin/match', access: 'admin_page' },
  { route: '/admin/msrp', access: 'admin_page' },
  { route: '/admin/product/[slug]', access: 'admin_page' },
  { route: '/admin/product/new', access: 'admin_page' },
  { route: '/admin/products', access: 'admin_page' },
  { route: '/admin/suggestions', access: 'admin_page' },
  { route: '/admin/suggestions/bulk', access: 'admin_page' },
  { route: '/admin/users', access: 'admin_page' },
  { route: '/intel', access: 'admin_page', note: 'private founder tool; never in navigation' },

  /* ---------------- public APIs ---------------- */
  { route: '/api/browse', access: 'public_api', note: 'debug payload remains admin-gated in-route' },
  { route: '/api/browse/[root]', access: 'public_api' },
  { route: '/api/discover', access: 'public_api', note: 'filters to the canonical set in SQL' },
  { route: '/api/brands', access: 'public_api' },
  { route: '/api/price-observations', access: 'public_api' },
  {
    route: '/api/search/resolve',
    access: 'public_api_data_gated',
    note: 'reachable by anyone; returns only entities passing §3.1, re-checked live per request',
  },

  /* ---------------- protected APIs ----------------
   * `/api/scrape` used to sit here. WP-4 DELETED the route: it ran four live
   * marketplace scrapes and upserted into `listings`, its only caller was
   * `/search`, and once search became a resolver it had none. Retaining it
   * behind generic authenticated access would have left any signed-in visitor
   * able to drive scraper and database load with free text. Admin curation is
   * unaffected — it calls /api/admin/product/[slug]/scrape-platform and
   * .../scrape-kleinanzeigen, which are separate routes and remain admin_api. */
  { route: '/api/watchlists', access: 'protected_api' },
  { route: '/api/watchlists/[id]', access: 'protected_api' },
  { route: '/api/watchlists/[id]/listings', access: 'protected_api' },
  { route: '/api/saved-listings', access: 'protected_api' },
  { route: '/api/notification-preferences', access: 'protected_api' },
  { route: '/api/preferences', access: 'protected_api' },
  { route: '/api/price-history', access: 'protected_api', note: 'no caller today (audit F-21)' },
  { route: '/api/market-price', access: 'protected_api', note: 'no caller today (audit F-21)' },

  /* ---------------- admin APIs ----------------
   * All of these ALSO enforce requireAdminInRoute(). The edge classification
   * is defence in depth: an admin route that forgets its in-route check must
   * still fail closed. */
  { route: '/api/admin/me', access: 'admin_api' },
  { route: '/api/admin/msrp', access: 'admin_api' },
  { route: '/api/admin/products', access: 'admin_api' },
  { route: '/api/admin/products/[id]', access: 'admin_api' },
  { route: '/api/admin/users', access: 'admin_api' },
  { route: '/api/admin/users/[id]', access: 'admin_api' },
  { route: '/api/admin/suggestions', access: 'admin_api' },
  { route: '/api/admin/suggestions/[id]', access: 'admin_api' },
  { route: '/api/admin/suggestions/bulk/approve', access: 'admin_api' },
  { route: '/api/admin/suggestions/bulk/brands', access: 'admin_api' },
  { route: '/api/admin/suggestions/bulk/group', access: 'admin_api' },
  { route: '/api/admin/suggestions/bulk/merge', access: 'admin_api' },
  { route: '/api/admin/suggestions/bulk/reject', access: 'admin_api' },
  { route: '/api/admin/cleanup', access: 'admin_api' },
  { route: '/api/admin/cleanup/brands', access: 'admin_api' },
  { route: '/api/admin/cleanup/inactivate', access: 'admin_api' },
  { route: '/api/admin/cleanup/keep', access: 'admin_api' },
  { route: '/api/admin/cleanup/merge', access: 'admin_api' },
  { route: '/api/admin/cleanup/self-clean', access: 'admin_api' },
  { route: '/api/admin/match/approve', access: 'admin_api' },
  { route: '/api/admin/match/candidates', access: 'admin_api' },
  { route: '/api/admin/match/search', access: 'admin_api' },
  { route: '/api/admin/product/brands', access: 'admin_api' },
  { route: '/api/admin/product/new', access: 'admin_api' },
  { route: '/api/admin/product/subcategories', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/reassign-match', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/reject-match', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/save-listing', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/scrape-kleinanzeigen', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/scrape-platform', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/set-price', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/synonym', access: 'admin_api' },
  { route: '/api/admin/product/[slug]/synonym/[id]', access: 'admin_api' },

  /* ---------------- machine APIs ----------------
   * No user session exists for these by construction. They authenticate with
   * their own credential in-route: CRON_SECRET, and the Supabase webhook
   * signature. Putting them behind the session gate would break them. */
  { route: '/api/cron/scrape', access: 'machine_api', note: 'dormant; the Vercel cron feature is disabled' },
  { route: '/api/webhooks/auth', access: 'machine_api' },
]

/**
 * Strip the segments that contribute no URL path.
 *
 * Route groups `(marketing)`, parallel slots `@modal` and the private folder
 * convention `_internal` all exist in the filesystem but never appear in a URL.
 * The guard's filesystem normaliser already dropped them; this makes the
 * RUNTIME matcher agree, so a classification written for a grouped route
 * cannot silently fail to match the URL it governs.
 */
export function stripNonUrlSegments(route: string): string {
  const segments = route
    .split('/')
    .filter(Boolean)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .filter((s) => !s.startsWith('@'))
  return segments.length ? '/' + segments.join('/') : '/'
}

/** Compile a route pattern into a matcher. Exported for the guard. */
export function routePatternToRegExp(route: string): RegExp {
  const normalised = stripNonUrlSegments(route)
  if (normalised === '/') return /^\/$/
  const body = normalised
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/.+)?' // optional catch-all
      if (/^\[\.\.\..+\]$/.test(segment)) return '/.+' // catch-all
      if (/^\[.+\]$/.test(segment)) return '/[^/]+' // dynamic
      return '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${body}/?$`)
}

const COMPILED: ReadonlyArray<{ rule: RouteRule; pattern: RegExp; urlRoute: string }> =
  ROUTE_ACCESS.map((rule) => ({
    rule,
    pattern: routePatternToRegExp(rule.route),
    urlRoute: stripNonUrlSegments(rule.route),
  }))

/**
 * Classify a concrete pathname, or null when it matches no known route.
 *
 * A null result is not an error: it means the filesystem has no such route, so
 * Next.js will render app/not-found.tsx and answer 404. Static segments are
 * preferred over dynamic ones so `/admin/products` cannot be swallowed by
 * `/admin/product/[slug]`.
 */
export function classifyPath(pathname: string): RouteRule | null {
  const clean = pathname.split('?')[0].split('#')[0]
  let dynamicHit: RouteRule | null = null

  for (const { rule, pattern, urlRoute } of COMPILED) {
    if (!pattern.test(clean)) continue
    if (!urlRoute.includes('[')) return rule
    if (!dynamicHit) dynamicHit = rule
  }

  return dynamicHit
}

/** True when a pathname requires an authenticated session. */
export function requiresAuth(pathname: string): boolean {
  const rule = classifyPath(pathname)
  return rule ? AUTHENTICATED_CLASSES.has(rule.access) : false
}

/** True for the two admin classes, which need is_admin on top of a session. */
export function requiresAdmin(pathname: string): boolean {
  const rule = classifyPath(pathname)
  return rule ? rule.access === 'admin_page' || rule.access === 'admin_api' : false
}

export function isAuthenticatedClass(access: AccessClass): boolean {
  return AUTHENTICATED_CLASSES.has(access)
}
