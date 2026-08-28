/**
 * Stage 3 WP-1 — route-posture completeness guard.
 *
 * Implements G1–G8 of docs/stage-3-v1-decision-and-build-plan.md §7.7.
 *
 * WP-1 flipped the middleware default from deny-by-default to pass-through, so
 * that an unknown path returns a real 404 instead of 307 -> /login. That flip
 * silently opened 34 routes — all of /api/admin/** plus /watchlists/[id]/edit.
 * No data was exposed, because every admin route independently returns
 * 401/403, but the edge layer had lapsed and only a full before/after diff
 * caught it.
 *
 * This test makes that diff permanent. It walks the filesystem, normalises
 * every routable file to a route path, and requires an explicit classification
 * in frontend/lib/route-access.ts — the SAME module the middleware imports, so
 * there is no second list to drift.
 *
 * NO ROUTE COUNT IS HARDCODED ANYWHERE. A count passes the moment one route is
 * added and another deleted, which is precisely the case it needs to catch.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
  ROUTE_ACCESS,
  classifyPath,
  isAuthenticatedClass,
  requiresAdmin,
  requiresAuth,
  routePatternToRegExp,
  stripNonUrlSegments,
  type AccessClass,
  type RouteRule,
} from '../../frontend/lib/route-access'

const APP_DIR = join(__dirname, '..', '..', 'frontend', 'app')

/** Next.js metadata files that become routes, and the URL each produces. */
const METADATA_ROUTES: Record<string, string> = {
  sitemap: '/sitemap.xml',
  robots: '/robots.txt',
  manifest: '/manifest.webmanifest',
  icon: '/icon',
  'apple-icon': '/apple-icon',
  'opengraph-image': '/opengraph-image',
  'twitter-image': '/twitter-image',
}

type Discovered = { route: string; file: string; kind: 'page' | 'route' | 'metadata' }

/**
 * Normalise a directory path under app/ into a route path.
 * Route groups `(marketing)` contribute no segment. Dynamic, catch-all and
 * optional catch-all segments keep their bracket form so they match the
 * authority's patterns verbatim.
 */
function dirToRoute(dir: string): string {
  const rel = relative(APP_DIR, dir)
  if (rel === '' || rel === '.') return '/'
  const segments = rel
    .split(sep)
    .filter(Boolean)
    // route groups and parallel/intercepting route markers contribute no URL segment
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .filter((s) => !s.startsWith('@'))
  return segments.length ? '/' + segments.join('/') : '/'
}

function discoverRoutes(dir: string, out: Discovered[] = []): Discovered[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      discoverRoutes(full, out)
      continue
    }

    const stem = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '')
    const base = dirToRoute(dir)

    if (entry.name === 'page.tsx' || entry.name === 'page.ts') {
      out.push({ route: base, file: full, kind: 'page' })
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      out.push({ route: base, file: full, kind: 'route' })
    } else if (stem in METADATA_ROUTES && /\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      const suffix = METADATA_ROUTES[stem]
      out.push({
        route: base === '/' ? suffix : `${base}${suffix}`,
        file: full,
        kind: 'metadata',
      })
    }
  }
  return out
}

const DISCOVERED = discoverRoutes(APP_DIR)
const BY_ROUTE = new Map(ROUTE_ACCESS.map((r) => [r.route, r]))

const ALL_CLASSES: AccessClass[] = [
  'public_page',
  'public_page_data_gated',
  'protected_page',
  'admin_page',
  'public_api',
  'public_api_data_gated',
  'protected_api',
  'admin_api',
  'machine_api',
  'framework_metadata',
]

/** A concrete URL for a route pattern, so classification can be exercised. */
function concreteExample(route: string): string {
  return route
    .split('/')
    .map((seg) => {
      if (/^\[\[\.\.\..+\]\]$/.test(seg)) return 'example'
      if (/^\[\.\.\..+\]$/.test(seg)) return 'example'
      if (/^\[.+\]$/.test(seg)) return 'example'
      return seg
    })
    .join('/')
}

/* ------------------------------------------------------------------ *
 * G1 — every routable file is classified
 * ------------------------------------------------------------------ */

test('G1: the app directory contains at least the known core routes', () => {
  // A sanity floor, not an expected count: if the walker silently found
  // nothing, every other assertion below would pass vacuously.
  assert.ok(DISCOVERED.length > 0, 'no routable files discovered — the walker is broken')
  for (const required of ['/', '/browse', '/product/[slug]', '/api/product/[slug]']) {
    assert.ok(
      DISCOVERED.some((d) => d.route === required),
      `expected to discover ${required}`,
    )
  }
})

test('G1: every routable file has an explicit access classification', () => {
  const unclassified = DISCOVERED.filter((d) => !BY_ROUTE.has(d.route))
  assert.deepEqual(
    unclassified.map((d) => `${d.route}  (${relative(APP_DIR, d.file)})`),
    [],
    'Unclassified route(s) found.\n' +
      'Every page.tsx, route.ts and metadata route must have an entry in\n' +
      'frontend/lib/route-access.ts. Without one the route is PUBLICLY\n' +
      'REACHABLE, because the middleware default is pass-through.\n' +
      `Available classes: ${ALL_CLASSES.join(' | ')}`,
  )
})

test('G1: no route is classified twice', () => {
  const seen = new Set<string>()
  for (const rule of ROUTE_ACCESS) {
    assert.equal(seen.has(rule.route), false, `${rule.route} is classified more than once`)
    seen.add(rule.route)
  }
})

test('G1: every classification uses a known access class', () => {
  for (const rule of ROUTE_ACCESS) {
    assert.ok(ALL_CLASSES.includes(rule.access), `${rule.route} has unknown class ${rule.access}`)
  }
})

/* ------------------------------------------------------------------ *
 * G2 — normalisation
 * ------------------------------------------------------------------ */

test('G2: route groups, dynamic and catch-all segments normalise correctly', () => {
  assert.equal(routePatternToRegExp('/browse/[root]').test('/browse/pro-audio'), true)
  assert.equal(routePatternToRegExp('/browse/[root]').test('/browse/a/b'), false)
  assert.equal(routePatternToRegExp('/docs/[...path]').test('/docs/a/b/c'), true)
  assert.equal(routePatternToRegExp('/docs/[...path]').test('/docs'), false)
  assert.equal(routePatternToRegExp('/docs/[[...path]]').test('/docs'), true)
  assert.equal(routePatternToRegExp('/docs/[[...path]]').test('/docs/a/b'), true)
  assert.equal(routePatternToRegExp('/').test('/'), true)
  assert.equal(routePatternToRegExp('/').test('/anything'), false)
  // trailing slashes must not change the answer
  assert.equal(routePatternToRegExp('/browse').test('/browse/'), true)
})

test('G2: a static route wins over a dynamic sibling', () => {
  // /admin/products must not be swallowed by /admin/product/[slug].
  assert.equal(classifyPath('/admin/products')?.route, '/admin/products')
  assert.equal(classifyPath('/api/admin/product/new')?.route, '/api/admin/product/new')
  assert.equal(
    classifyPath('/api/admin/product/roland-juno-106/set-price')?.route,
    '/api/admin/product/[slug]/set-price',
  )
})

/* ------------------------------------------------------------------ *
 * G3 / G4 — declared classifications must be EFFECTIVE
 * ------------------------------------------------------------------ */

test('G3: every authenticated classification actually requires auth', () => {
  const failures: string[] = []
  for (const rule of ROUTE_ACCESS) {
    if (!isAuthenticatedClass(rule.access)) continue
    const url = concreteExample(rule.route)
    if (!requiresAuth(url)) failures.push(`${rule.route} (${rule.access}) resolved ${url} as open`)
  }
  assert.deepEqual(failures, [], 'declared-protected routes that are not effectively protected')
})

test('G4: every public classification is effectively open', () => {
  const failures: string[] = []
  for (const rule of ROUTE_ACCESS) {
    if (isAuthenticatedClass(rule.access)) continue
    const url = concreteExample(rule.route)
    if (requiresAuth(url)) failures.push(`${rule.route} (${rule.access}) resolved ${url} as protected`)
  }
  assert.deepEqual(failures, [], 'declared-public routes that are effectively protected')
})

test('G3: admin classes require admin on top of a session', () => {
  for (const rule of ROUTE_ACCESS) {
    if (rule.access !== 'admin_api' && rule.access !== 'admin_page') continue
    const url = concreteExample(rule.route)
    assert.equal(requiresAuth(url), true, `${rule.route} must require a session`)
    assert.equal(requiresAdmin(url), true, `${rule.route} must require is_admin`)
  }
})

/* ------------------------------------------------------------------ *
 * G5 — forward declarations stay honest
 * ------------------------------------------------------------------ */

test('G5: a classification with no route file must be marked planned', () => {
  const discoveredRoutes = new Set(DISCOVERED.map((d) => d.route))
  const orphans = ROUTE_ACCESS.filter((r) => !discoveredRoutes.has(r.route) && !r.planned)
  assert.deepEqual(
    orphans.map((r) => r.route),
    [],
    'classified but no route file on disk — mark planned: true, or remove the entry',
  )
})

test('G5: a planned route must NOT already exist on disk', () => {
  const discoveredRoutes = new Set(DISCOVERED.map((d) => d.route))
  const stale = ROUTE_ACCESS.filter((r) => r.planned && discoveredRoutes.has(r.route))
  assert.deepEqual(
    stale.map((r) => r.route),
    [],
    'route now exists — drop planned: true so the classification is load-bearing',
  )
})

/* ------------------------------------------------------------------ *
 * G6 — unknown URLs pass through to Next.js
 * ------------------------------------------------------------------ */

test('G6: filesystem-nonexistent URLs classify as null and pass through', () => {
  const unknown = [
    '/nonexistent-page-xyz',
    '/product',
    '/api/does-not-exist',
    '/admin-not-really',
    '/browse/root/deeper/still',
    '/onboarding',
  ]
  for (const url of unknown) {
    assert.equal(classifyPath(url), null, `${url} should match no route`)
    assert.equal(requiresAuth(url), false, `${url} must pass through, not redirect to /login`)
  }
})

test('G6: passing through is what produces a real 404', () => {
  // app/not-found.tsx must exist, or an unmatched path renders Next's
  // unstyled default and the pass-through default becomes a regression.
  assert.ok(existsSync(join(APP_DIR, 'not-found.tsx')), 'app/not-found.tsx is required')
})

/* ------------------------------------------------------------------ *
 * G7 — named invariants that must never regress
 * ------------------------------------------------------------------ */

test('G7: every /api/admin/** route is classified admin_api', () => {
  const adminRoutes = DISCOVERED.filter((d) => d.route.startsWith('/api/admin/'))
  assert.ok(adminRoutes.length > 0, 'expected admin API routes to exist')
  for (const d of adminRoutes) {
    const rule = BY_ROUTE.get(d.route)
    assert.ok(rule, `${d.route} is unclassified`)
    assert.equal(rule!.access, 'admin_api', `${d.route} must be admin_api`)
    assert.equal(requiresAuth(concreteExample(d.route)), true)
  }
})

test('G7: /watchlists/[id]/edit is protected while /watchlists stays public', () => {
  assert.equal(BY_ROUTE.get('/watchlists/[id]/edit')?.access, 'protected_page')
  assert.equal(requiresAuth('/watchlists/abc/edit'), true)

  assert.equal(BY_ROUTE.get('/watchlists')?.access, 'public_page')
  assert.equal(requiresAuth('/watchlists'), false)
})

test('G7: /product/** and /api/product/** are publicly reachable AND data-gated', () => {
  const page = BY_ROUTE.get('/product/[slug]')
  const api = BY_ROUTE.get('/api/product/[slug]')
  assert.equal(page?.access, 'public_page_data_gated')
  assert.equal(api?.access, 'public_api_data_gated')
  assert.equal(requiresAuth('/product/roland-juno-106'), false)
  assert.equal(requiresAuth('/api/product/roland-juno-106'), false)
})

test('G7: the server-side product gate exists', () => {
  // Reachability without the gate is a soft 404 on 3,976 slugs. The data-gated
  // classification is only truthful while this file is present (§15.8).
  assert.ok(
    existsSync(join(APP_DIR, 'product', '[slug]', 'layout.tsx')),
    'app/product/[slug]/layout.tsx is the server-side eligibility gate and must exist ' +
      'unless WP-3 has folded it into the server shell under §15.8 H1-H7',
  )
})

test('G7: machine APIs are not put behind the session gate', () => {
  // /api/cron/* has no user session by construction. `/api/webhooks/auth` was
  // the other machine API; S2 deleted it rather than give it a credential.
  for (const url of ['/api/cron/scrape']) {
    assert.equal(requiresAuth(url), false, `${url} authenticates with its own credential`)
  }
})

test('G7: no admin surface is classified as public', () => {
  for (const d of DISCOVERED) {
    if (!d.route.startsWith('/admin') && !d.route.startsWith('/api/admin')) continue
    const rule = BY_ROUTE.get(d.route)!
    assert.equal(
      isAuthenticatedClass(rule.access),
      true,
      `${d.route} is an admin surface classified ${rule.access}`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * G8 — the posture is not a substitute for in-route checks
 * ------------------------------------------------------------------ */

test('G8: admin routes keep their own in-route authorisation', () => {
  // Defence in depth: the classification is the edge layer, requireAdminInRoute
  // is the route layer. Neither is allowed to be the only one.
  const helper = join(__dirname, '..', '..', 'frontend', 'lib', 'admin-auth.ts')
  assert.ok(existsSync(helper), 'lib/admin-auth.ts must exist')

  // S1. This test used to stop at "the helper exists", which is exactly the
  // gap that let six /api/admin/cleanup/** routes ship with a check for A
  // SESSION and no check for `is_admin` — any signed-in visitor satisfied
  // them, and they inactivate, merge and insert kg_product rows. The edge
  // denied them, so nothing was reachable; the route layer was simply absent.
  // Every admin_api route file must now call the helper itself.
  const adminRoutes = DISCOVERED.filter(
    (d) => d.kind === 'route' && d.route.startsWith('/api/admin/'),
  )
  assert.ok(adminRoutes.length >= 30, 'admin route discovery looks wrong')

  // The remaining admin routes that still rely on the edge alone. This patch's
  // scope was the six cleanup routes the security review named; these thirteen
  // are a pre-existing, separately-scheduled gap. They are PINNED rather than
  // ignored: the list may shrink, and a fourteenth fails here immediately, so
  // a newly added admin route cannot join them silently.
  const KNOWN_EDGE_ONLY = [
    '/api/admin/match/approve',
    '/api/admin/match/candidates',
    '/api/admin/match/search',
    '/api/admin/msrp',
    '/api/admin/suggestions',
    '/api/admin/suggestions/[id]',
    '/api/admin/suggestions/bulk/approve',
    '/api/admin/suggestions/bulk/brands',
    '/api/admin/suggestions/bulk/group',
    '/api/admin/suggestions/bulk/merge',
    '/api/admin/suggestions/bulk/reject',
    '/api/admin/users',
    '/api/admin/users/[id]',
  ]
  const unguarded = adminRoutes
    .filter((d) => !/requireAdminInRoute\(\)|getCurrentAdminState\(\)/.test(readFileSync(d.file, 'utf8')))
    .map((d) => d.route)
    .sort()
  const unexpected = unguarded.filter((r) => !KNOWN_EDGE_ONLY.includes(r))
  assert.deepEqual(unexpected, [], 'admin route with no in-route authorisation')
  assert.ok(
    unguarded.length <= KNOWN_EDGE_ONLY.length,
    'the edge-only admin set may shrink, never grow',
  )

  // The six the security review named, pinned by name so a regression on any
  // one of them fails with its own path rather than as a count.
  for (const route of [
    '/api/admin/cleanup',
    '/api/admin/cleanup/brands',
    '/api/admin/cleanup/inactivate',
    '/api/admin/cleanup/keep',
    '/api/admin/cleanup/merge',
    '/api/admin/cleanup/self-clean',
  ]) {
    const found = adminRoutes.find((d) => d.route === route)
    assert.ok(found, `${route} must exist and be discovered`)
    const src = readFileSync(found!.file, 'utf8')
    assert.match(src, /requireAdminInRoute\(\)/, `${route} must call requireAdminInRoute()`)
    // Authorisation before body parsing, before a client, before any work.
    const guardAt = src.indexOf('await requireAdminInRoute()')
    for (const later of ['await req.json()', 'getSupabaseAdmin()']) {
      const at = src.indexOf(later)
      if (at === -1) continue
      assert.ok(guardAt < at, `${route}: authorisation must run before ${later}`)
    }
  }
})

test('G8: data-gated routes are gated by the catalogue predicate, not by posture', () => {
  const gated: RouteRule[] = ROUTE_ACCESS.filter(
    (r) => r.access === 'public_page_data_gated' || r.access === 'public_api_data_gated',
  )
  assert.ok(gated.length > 0)
  for (const rule of gated) {
    // Reachable by anyone...
    assert.equal(requiresAuth(concreteExample(rule.route)), false)
    // ...and therefore obliged to say how the content is decided.
    assert.ok(rule.note && rule.note.length > 0, `${rule.route} must document its gate`)
  }
})

/* ------------------------------------------------------------------ *
 * M1 — INDEPENDENT SECURITY REFERENCE
 *
 * Everything above proves the implementation agrees with ITSELF: it reads
 * ROUTE_ACCESS and asks requiresAuth(), which reads ROUTE_ACCESS through
 * AUTHENTICATED_CLASSES. Downgrade a route from admin_api to public_api and
 * every assertion above still passes, because both sides moved together.
 *
 * These assertions compare the resolved class against a human-reviewed literal
 * in frontend/lib/route-posture-reference.json, and NEVER route the comparison
 * through requiresAuth() or AUTHENTICATED_CLASSES. A downgrade must be made in
 * two places, one of which exists only to be read in review.
 * ------------------------------------------------------------------ */

import REFERENCE from '../../frontend/lib/route-posture-reference.json'

const EXPECTED: Record<string, string> = REFERENCE.expected

test('M1: every security-sensitive route matches the reviewed reference class', () => {
  const drift: string[] = []
  for (const [route, expected] of Object.entries(EXPECTED)) {
    const actual = BY_ROUTE.get(route)?.access ?? '(unclassified)'
    if (actual !== expected) {
      drift.push(`${route}: reference expects "${expected}", implementation has "${actual}"`)
    }
  }
  assert.deepEqual(
    drift,
    [],
    'ROUTE POSTURE DRIFT.\n' +
      'A security-sensitive route no longer matches the reviewed reference in\n' +
      'frontend/lib/route-posture-reference.json. If the change is intended,\n' +
      'update that file in the same commit and say why in the PR — it exists so\n' +
      'that a downgrade cannot pass review unnoticed.',
  )
})

test('M1: the reference resolves through the live matcher, not just the table', () => {
  // Guards against a classification that is present but unreachable — e.g. a
  // pattern the runtime matcher fails to match because of segment handling.
  const unresolved: string[] = []
  for (const [route, expected] of Object.entries(EXPECTED)) {
    const resolved = classifyPath(concreteExample(route))
    if (!resolved) unresolved.push(`${route}: classifyPath resolved nothing`)
    else if (resolved.access !== expected) {
      unresolved.push(`${route}: matcher resolved "${resolved.access}", reference expects "${expected}"`)
    }
  }
  assert.deepEqual(unresolved, [], 'reference routes that do not resolve to their expected class')
})

test('M1: no admin-prefixed route may fall outside the reference', () => {
  // Catches "downgrade by omission": deleting the reference entry instead of
  // changing it. Every discovered admin surface must be pinned.
  const missing = DISCOVERED.filter(
    (d) => REFERENCE.adminPrefixes.some((p) => d.route.startsWith(p + '/') || d.route === p),
  )
    .map((d) => d.route)
    .filter((r) => !(r in EXPECTED))
  assert.deepEqual(missing, [], 'admin surfaces missing from the reviewed reference')
})

test('M1: reference session/admin expectations hold independently', () => {
  // Asserted from the reference's own literal class lists, not from
  // AUTHENTICATED_CLASSES, so emptying that set cannot make this pass.
  const sessionClasses = new Set(REFERENCE.mustRequireSession)
  const adminClasses = new Set(REFERENCE.mustRequireAdmin)
  const failures: string[] = []

  for (const [route, expected] of Object.entries(EXPECTED)) {
    const url = concreteExample(route)
    if (sessionClasses.has(expected) && !requiresAuth(url)) {
      failures.push(`${route} (${expected}) must require a session`)
    }
    if (adminClasses.has(expected) && !requiresAdmin(url)) {
      failures.push(`${route} (${expected}) must require is_admin`)
    }
    if (!sessionClasses.has(expected) && requiresAuth(url)) {
      failures.push(`${route} (${expected}) must NOT require a session`)
    }
  }
  assert.deepEqual(failures, [], 'reference expectations not honoured by the runtime')
})

test('M1: every reference route still exists on disk or is explicitly planned', () => {
  const discovered = new Set(DISCOVERED.map((d) => d.route))
  const stale = Object.keys(EXPECTED).filter((route) => {
    if (discovered.has(route)) return false
    return !ROUTE_ACCESS.find((r) => r.route === route)?.planned
  })
  assert.deepEqual(stale, [], 'reference pins a route that no longer exists — remove it deliberately')
})

/* ------------------------------------------------------------------ *
 * E3 — route groups must normalise the same way at runtime and on disk
 * ------------------------------------------------------------------ */

test('E3: route groups and parallel slots are stripped by the runtime matcher', () => {
  assert.equal(stripNonUrlSegments('/(marketing)/about'), '/about')
  assert.equal(stripNonUrlSegments('/(shop)/(promo)/deals'), '/deals')
  assert.equal(stripNonUrlSegments('/@modal/photo'), '/photo')
  assert.equal(stripNonUrlSegments('/(group)'), '/')
  assert.equal(stripNonUrlSegments('/'), '/')

  // A classification written for a grouped route must match the real URL.
  assert.equal(routePatternToRegExp('/(marketing)/about').test('/about'), true)
  assert.equal(routePatternToRegExp('/(marketing)/about').test('/(marketing)/about'), false)
  assert.equal(routePatternToRegExp('/(shop)/product/[slug]').test('/product/juno-106'), true)

  // ...and the dynamic-vs-static preference must survive stripping.
  assert.equal(routePatternToRegExp('/(g)/admin/products').test('/admin/products'), true)
})

test('E3: the filesystem normaliser and the runtime matcher agree', () => {
  // Both sides drop the same segment kinds. Asserted on every discovered route.
  for (const d of DISCOVERED) {
    assert.equal(
      stripNonUrlSegments(d.route),
      d.route,
      `${d.route} was not normalised by the filesystem walker`,
    )
  }
})
