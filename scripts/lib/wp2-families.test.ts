/**
 * Stage 3 WP-2 — navigation families, non-canonical isolation, operator copy.
 *
 * Covers the acceptance contract in
 * docs/stage-3-v1-decision-and-build-plan.md, WP-2 §21 tests 1-7 and §4.2.
 *
 * DETERMINISTIC BY CONSTRUCTION. Every assertion reads either the reviewed
 * config in frontend/lib/families.ts, a fixture row, or a file on disk. None
 * touches the network or the database: a test that needed production to pass
 * could not tell a broken contract from an unreachable database, which is the
 * distinction WP-1's failure model exists to preserve.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  CANONICAL_DOMAIN,
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CANONICAL_VISIBILITY,
  type CatalogueStateRow,
} from '../../frontend/lib/catalogue'

import {
  FAMILY_MIN_CANONICAL_CHILDREN,
  NAVIGATION_FAMILIES,
  allFamilyChildSlugs,
  buildFamilyView,
  familyRedirectTarget,
  getFamily,
  isFamilySlug,
  type FamilyChildRow,
} from '../../frontend/lib/families'

import { ROUTE_ACCESS, requiresAuth } from '../../frontend/lib/route-access'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

/** The six V1 families, from build plan §4.2. */
const EXPECTED_FAMILIES = [
  'gibson-les-paul',
  'fender-stratocaster',
  'fender-telecaster',
  'gibson-es-335',
  'fender-jazz-bass',
  'fender-precision-bass',
]

/**
 * Production state of every configured child, SELECT-verified 2026-08-28:
 * all ten are active + supported + qa_only + music. Encoded as a fixture, not
 * queried, so the test is deterministic — the live equivalent is the §16.4
 * data-truth gate.
 */
const QA_ONLY_CHILD: Omit<CatalogueStateRow, 'browse_visibility'> = {
  status: CANONICAL_STATUS,
  support_state: CANONICAL_SUPPORT,
  browse_domain: CANONICAL_DOMAIN,
}

function qaOnlyRow(slug: string): FamilyChildRow {
  return { slug, canonical_name: slug, ...QA_ONLY_CHILD, browse_visibility: 'qa_only' }
}

function canonicalRow(slug: string, name = slug): FamilyChildRow {
  return { slug, canonical_name: name, ...QA_ONLY_CHILD, browse_visibility: CANONICAL_VISIBILITY }
}

function readRepoFile(relative: string): string {
  return readFileSync(join(FRONTEND, relative), 'utf8')
}

/* ------------------------------------------------------------------ *
 * 1. The six families, and only the six
 * ------------------------------------------------------------------ */

test('families: exactly the six V1 families are configured', () => {
  assert.deepEqual(
    NAVIGATION_FAMILIES.map((f) => f.slug).sort(),
    [...EXPECTED_FAMILIES].sort(),
  )
})

test('families: children match the reviewed §6.3 map', () => {
  const expected: Record<string, string[]> = {
    'gibson-les-paul': [
      'gibson-les-paul-custom',
      'gibson-les-paul-standard-50s',
      'gibson-les-paul-standard-60s',
      'gibson-les-paul-studio',
      'gibson-les-paul-special',
    ],
    'fender-telecaster': [
      'fender-telecaster-thinline',
      'fender-telecaster-custom',
      'fender-american-vintage-52-telecaster',
    ],
    'fender-stratocaster': ['fender-american-professional-ii-stratocaster'],
    'gibson-es-335': ['gibson-es-335-dot'],
    'fender-jazz-bass': [],
    'fender-precision-bass': [],
  }
  for (const family of NAVIGATION_FAMILIES) {
    assert.deepEqual([...family.children].sort(), [...expected[family.slug]].sort(), family.slug)
  }
})

test('families: no family slug is a canonical product, and no child is a family', () => {
  const children = allFamilyChildSlugs()
  for (const family of NAVIGATION_FAMILIES) {
    // A family that were also its own child would make /family/<slug> link to
    // /product/<slug>, which 308s straight back here.
    assert.equal(children.has(family.slug), false, `${family.slug} is both family and child`)
    assert.equal(family.children.includes(family.slug), false)
  }
})

test('families: aliases never carry a bare model number or a sub-brand (§4.3)', () => {
  for (const family of NAVIGATION_FAMILIES) {
    for (const alias of family.aliases) {
      assert.equal(/^\d+$/.test(alias.trim()), false, `bare numeric alias "${alias}"`)
      assert.equal(/squier|epiphone/i.test(alias), false, `sub-brand alias "${alias}"`)
      assert.equal(alias, alias.toLowerCase(), `alias must be normalised: "${alias}"`)
    }
  }
})

/* ------------------------------------------------------------------ *
 * 2. The six redirects (acceptance test 1)
 * ------------------------------------------------------------------ */

test('redirects: each of the six legacy /product URLs maps to its family route', () => {
  for (const slug of EXPECTED_FAMILIES) {
    assert.equal(familyRedirectTarget(`/product/${slug}`), `/family/${slug}`)
  }
  assert.equal(EXPECTED_FAMILIES.length, 6)
})

test('redirects: nothing else is redirected', () => {
  for (const path of [
    '/product/roland-juno-106',          // canonical product — must render
    '/product/gibson-les-paul-custom',   // a family CHILD is not a family
    '/product/arp-2600',                 // public but unsupported — 404, not a redirect
    '/product/',                         // no slug
    '/product/gibson-les-paul/extra',    // deeper path
    '/family/gibson-les-paul',           // the target itself, never a source
    '/browse',
    '/',
  ]) {
    assert.equal(familyRedirectTarget(path), null, path)
  }
})

test('redirects: middleware issues 308 and derives the map from lib/families', () => {
  const middleware = readRepoFile('middleware.ts')
  assert.match(middleware, /familyRedirectTarget/)
  assert.match(middleware, /NextResponse\.redirect\(new URL\(familyTarget, request\.url\), 308\)/)
  // A second literal list is how a redirect map and its routes drift apart.
  for (const slug of EXPECTED_FAMILIES) {
    assert.equal(middleware.includes(slug), false, `middleware must not restate "${slug}"`)
  }
})

/* ------------------------------------------------------------------ *
 * 3. Canonical-child filtering (the binding rule of §4.2)
 * ------------------------------------------------------------------ */

test('children: a qa_only child is rendered NOWHERE — not even as a name', () => {
  const family = getFamily('gibson-les-paul')!
  const view = buildFamilyView(family, family.children.map(qaOnlyRow))
  assert.deepEqual(view.children, [])
  assert.equal(view.published, false)
})

test('children: every non-canonical axis is independently disqualifying', () => {
  const family = getFamily('gibson-es-335')!
  const slug = family.children[0]
  for (const broken of [
    { ...canonicalRow(slug), status: 'inactive' },
    { ...canonicalRow(slug), support_state: 'known' },
    { ...canonicalRow(slug), support_state: 'reserve' },
    { ...canonicalRow(slug), browse_visibility: 'qa_only' },
    { ...canonicalRow(slug), browse_visibility: 'hidden' },
    { ...canonicalRow(slug), browse_domain: 'danish-modern' },
    { ...canonicalRow(slug), support_state: null },   // fail-closed on a partial row
    { ...canonicalRow(slug), browse_domain: null },
  ]) {
    assert.deepEqual(buildFamilyView(family, [broken as FamilyChildRow]).children, [])
  }
})

test('children: a missing row is not canonical, and extra rows cannot smuggle a child in', () => {
  const family = getFamily('fender-stratocaster')!
  assert.deepEqual(buildFamilyView(family, []).children, [])
  // A canonical row for a slug that is NOT a configured child must be ignored.
  const view = buildFamilyView(family, [canonicalRow('roland-juno-106', 'Roland Juno-106')])
  assert.deepEqual(view.children, [])
})

test('children: canonical children render in reviewed order with their display name', () => {
  const family = getFamily('gibson-les-paul')!
  const rows = [
    qaOnlyRow('gibson-les-paul-custom'),
    canonicalRow('gibson-les-paul-studio', 'Gibson Les Paul Studio'),
    canonicalRow('gibson-les-paul-special', 'Gibson Les Paul Special'),
  ]
  const view = buildFamilyView(family, rows)
  assert.deepEqual(view.children, [
    { slug: 'gibson-les-paul-studio', label: 'Gibson Les Paul Studio' },
    { slug: 'gibson-les-paul-special', label: 'Gibson Les Paul Special' },
  ])
})

test('children: the config can hold no price, listing or count, at any depth', () => {
  const forbidden = /price|band|listing|count|median|aggregate/i
  for (const family of NAVIGATION_FAMILIES) {
    for (const key of Object.keys(family)) assert.equal(forbidden.test(key), false, key)
  }
  const view = buildFamilyView(getFamily('gibson-les-paul')!, [])
  for (const key of Object.keys(view)) assert.equal(forbidden.test(key), false, key)
  for (const child of buildFamilyView(
    getFamily('gibson-es-335')!,
    [canonicalRow('gibson-es-335-dot')],
  ).children) {
    assert.deepEqual(Object.keys(child).sort(), ['label', 'slug'])
  }
})

/* ------------------------------------------------------------------ *
 * 4. Empty-family behaviour and the indexability transition
 * ------------------------------------------------------------------ */

test('empty: all six families are empty on today’s production state', () => {
  // Every configured child is supported+qa_only (SELECT, 2026-08-28).
  for (const family of NAVIGATION_FAMILIES) {
    const view = buildFamilyView(family, family.children.map(qaOnlyRow))
    assert.deepEqual(view.children, [], family.slug)
    assert.equal(view.published, false, family.slug)
  }
})

test('indexability: publishing ONE child flips the family, with no code change', () => {
  const family = getFamily('fender-telecaster')!
  const before = buildFamilyView(family, family.children.map(qaOnlyRow))
  assert.equal(before.published, false)
  assert.equal(before.children.length, 0)

  // Exactly one row changes: browse_visibility qa_only -> public.
  const after = buildFamilyView(family, [
    canonicalRow('fender-telecaster-thinline', 'Fender Telecaster Thinline'),
    qaOnlyRow('fender-telecaster-custom'),
    qaOnlyRow('fender-american-vintage-52-telecaster'),
  ])
  assert.equal(after.published, true)
  assert.deepEqual(after.children, [
    { slug: 'fender-telecaster-thinline', label: 'Fender Telecaster Thinline' },
  ])
})

test('indexability: one threshold drives index, sitemap, nav and search together', () => {
  assert.equal(FAMILY_MIN_CANONICAL_CHILDREN, 1)
  const page = readRepoFile('app/family/[slug]/page.tsx')
  // robots.index is the view's own `published`, never a second rule.
  assert.match(page, /robots:\s*\{\s*index:\s*view\.published,\s*follow:\s*true\s*\}/)
})

test('empty: a family with no configured children can never become published', () => {
  for (const slug of ['fender-jazz-bass', 'fender-precision-bass']) {
    const family = getFamily(slug)!
    assert.equal(family.children.length, 0)
    assert.equal(buildFamilyView(family, [canonicalRow('anything')]).published, false)
  }
})

/* ------------------------------------------------------------------ *
 * 5. The route renders no price, no feed, no count, no CTA
 * ------------------------------------------------------------------ */

test('route: the family page imports and computes nothing price-shaped', () => {
  const page = readRepoFile('app/family/[slug]/page.tsx')
  for (const forbidden of [
    'price-band',
    'listing_product_match',
    'active_listing_count',
    'priceRange',
    'PriceHistory',
    'watchlist',
    'Watchlist',
  ]) {
    assert.equal(page.includes(forbidden), false, `family route must not reference ${forbidden}`)
  }
  // It reads exactly two tables, both for eligibility only.
  const tables = [...page.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]).sort()
  assert.deepEqual(tables, ['browse_product_projection', 'kg_product'])
})

test('route: the demand control is present on the empty state only', () => {
  const page = readRepoFile('app/family/[slug]/page.tsx')
  assert.match(page, /data-demand-control="family"/)
  assert.match(page, /t\.demandCta/)
  assert.match(page, /children\.length === 0 && \(/)
  // No analytics emission in WP-2: the analytics module is WP-5's and the
  // consent boundary deploys first. Assert the absence of an IMPORT and of a
  // call, not of the word — the file explains in prose why it emits nothing.
  assert.equal(/^import .*analytics/m.test(page), false, 'family route must not import analytics')
  assert.equal(/\btrack\(/.test(page), false, 'family route must not emit events')
  assert.equal(/posthog\.|usePostHog/i.test(page), false)
})

test('route: unknown family slugs 404 rather than rendering an empty family', () => {
  assert.equal(getFamily('gibson-flying-v'), null)
  assert.equal(isFamilySlug('gibson-flying-v'), false)
  const page = readRepoFile('app/family/[slug]/page.tsx')
  assert.match(page, /if \(!view\) notFound\(\)/)
  // A slug that is not a family is also not redirected INTO the family route.
  assert.equal(familyRedirectTarget('/product/gibson-flying-v'), null)
})

/* ------------------------------------------------------------------ *
 * 6. Navigation exclusion, and no public surface links to a 404
 * ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|json)$/.test(entry)) out.push(full)
  }
  return out
}

test('navigation: an empty family is reachable ONLY by the legacy 308s (§4.2 rule 1)', () => {
  // The permitted inbound paths are the six legacy /product URLs and a direct
  // URL. Anything that LINKS to /family — a card, a shelf, a nav item, a
  // sitemap entry — would list a route that is noindex and has nothing to show.
  const linkers: string[] = []
  const redirectors: string[] = []

  for (const file of [...walk(join(FRONTEND, 'app')), ...walk(join(FRONTEND, 'components'))]) {
    if (file.includes(join('app', 'family'))) continue          // the route itself
    const rel = file.replace(FRONTEND, 'frontend')
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('/family/')) continue
      const isRedirect = /permanentRedirect\(|NextResponse\.redirect\(|familyRedirectTarget/.test(line)
      const isComment = /^\s*(\*|\/\/)/.test(line)
      if (isRedirect) redirectors.push(rel)
      else if (!isComment) linkers.push(`${rel}: ${line.trim()}`)
    }
  }

  assert.deepEqual(
    linkers,
    [],
    'an empty family must be absent from homepage, browse, navigation, sitemap and search',
  )
  // And the redirect sources are exactly the legacy product surfaces.
  assert.deepEqual(
    [...new Set(redirectors)].sort(),
    [
      'frontend/app/api/product/[slug]/route.ts',
      'frontend/app/product/[slug]/layout.tsx',
    ],
  )
})

test('navigation: the family route links only to /browse and to canonical children', () => {
  const page = readRepoFile('app/family/[slug]/page.tsx')
  const hrefs = [...page.matchAll(/href=(?:\{`|["'])([^"'`]+)/g)].map((m) => m[1])
  assert.equal(hrefs.length > 0, true, 'expected at least one link')
  for (const href of hrefs) {
    const ok = href === '/browse' || href === '/product/${child.slug}'
    assert.equal(ok, true, `unexpected outbound href on a family page: ${href}`)
  }
  // Every /product/ link is built from a RenderableChild, which by construction
  // passed isCanonical() — so no rendered link can resolve to a 404.
  assert.match(page, /href=\{`\/product\/\$\{child\.slug\}`\}/)
})

test('route-access: /family/[slug] is classified, reachable and no longer planned', () => {
  const rule = ROUTE_ACCESS.find((r) => r.route === '/family/[slug]')
  assert.ok(rule, '/family/[slug] must have a classification')
  assert.equal(rule!.access, 'public_page_data_gated')
  assert.equal(rule!.planned, undefined, 'the route now exists on disk')
  assert.equal(requiresAuth('/family/gibson-les-paul'), false)
})

/* ------------------------------------------------------------------ *
 * 7. Operator copy (acceptance tests 6 and 7)
 * ------------------------------------------------------------------ */

test('operator copy: the promotion API no longer claims tier drives monitoring', () => {
  const route = readRepoFile('app/api/admin/products/[id]/route.ts')
  for (const stale of [
    'implicit selector',
    'implicit scraper selector',
    'implicit query selector',
    'MONITORING EXPANDS',
    'MONITORING SHRINKS',
    'MONITORING_SELECTOR_TIERS',
    'SOURCES_SELECTING_ON_TIER',
  ]) {
    assert.equal(route.includes(stale), false, `stale monitoring copy: "${stale}"`)
  }
  assert.match(route, /MONITORING UNCHANGED: tier is not a scraper selector/)
  assert.match(route, /data\/klup-source-monitoring\.json/)
})

test('operator copy: the write path itself is untouched', () => {
  const route = readRepoFile('app/api/admin/products/[id]/route.ts')
  // Axis mapping, validation, intent requirement, dryRun and manifest keys are
  // WP-2-forbidden. Assert each is still exactly as WP-1 left it.
  assert.match(route, /tier:\s+'monitoring',/)
  assert.match(route, /const mustDeclare: Axis\[\] = \['visibility', 'monitoring'\]/)
  assert.match(route, /const dryRun = req\.nextUrl\.searchParams\.get\('dryRun'\) === '1'/)
  assert.match(route, /error: 'undeclared_axis'/)
  assert.match(route, /error: 'inactive_product_cannot_be_supported'/)
  for (const key of ['axes_touched', 'axis_semantics', 'unchanged_axes', 'monitoring_boundary']) {
    assert.match(route, new RegExp(`${key}:`), key)
  }
})

test('operator copy: the admin UI declares an axis the API still requires', () => {
  const page = readRepoFile('app/admin/products/page.tsx')
  // Sending ['metadata'] would be rejected as undeclared_axis while FIELD_AXIS
  // maps tier -> 'monitoring', and that mapping is WP-2-forbidden. The token
  // stays; the operator-visible copy is corrected instead.
  assert.match(page, /intent: \['monitoring'\]/)
  assert.match(page, /ændrer ikke overvågning/)
  assert.match(page, /NOT change marketplace monitoring/)
})

test('vercel.json: untouched — the crons block survives and nothing was added', () => {
  // WP-2 makes NO change to this file. Removing the crons block would be a
  // deployment-affecting edit, and Stage 3 makes none; adding a comment to a
  // Vercel config is also a change to a deployment input, which is why the
  // warning WP-2 briefly carried here was withdrawn in cross-package review.
  // The cron's disabled state lives at Vercel project level, not in the repo.
  const parsed = JSON.parse(readRepoFile('vercel.json')) as Record<string, unknown>
  assert.deepEqual(Object.keys(parsed), ['crons'], 'no property may be added to vercel.json')
  assert.equal(Array.isArray(parsed.crons), true, 'the crons block must NOT be removed')
  assert.equal((parsed.crons as unknown[]).length, 1)
  assert.deepEqual((parsed.crons as Array<Record<string, unknown>>)[0], {
    path: '/api/cron/scrape',
    schedule: '*/10 * * * *',
  })
})
