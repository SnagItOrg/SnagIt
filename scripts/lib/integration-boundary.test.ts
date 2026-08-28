/**
 * Stage 3 V1 integration — the boundaries that only exist once the packages
 * are combined.
 *
 * WP-1, WP-2, WP-4 and WP-5 each verify themselves. This suite verifies the
 * seams: the properties that are true of every package alone and can still be
 * false of the four together. Every assertion here corresponds to a registered
 * integration point in `docs/stage-3-integration-handoff-notes.md` §3, or to a
 * defect found while integrating them.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import { ROUTE_ACCESS, classifyPath } from '../../frontend/lib/route-access'

const REPO = join(__dirname, '..', '..')
const FRONTEND = join(REPO, 'frontend')

/* ── Point 1: the root test script is a union, not a replacement ─────────── */

test('integration: every package suite is registered exactly once', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const suites = pkg.scripts.test.split(/\s+/).filter((t) => t.endsWith('.test.ts'))

  assert.deepEqual(
    [...suites].sort(),
    [
      'scripts/lib/baseline.test.ts',
      'scripts/lib/integration-boundary.test.ts',
      'scripts/lib/matcher-integrity.test.ts',
      'scripts/lib/wp1-catalogue.test.ts',
      'scripts/lib/wp1-public-contract.test.ts',
      'scripts/lib/wp1-route-access.test.ts',
      'scripts/lib/wp2-families.test.ts',
      'scripts/lib/wp4-search.test.ts',
      'scripts/lib/wp4a-boundary.test.ts',
      'scripts/lib/wp5-consent-analytics.test.ts',
    ],
    'a package suite was dropped or duplicated by a merge resolution',
  )
  assert.equal(suites.length, new Set(suites).size, 'a suite is listed twice')
  for (const suite of suites) {
    assert.ok(existsSync(join(REPO, suite)), `registered but missing: ${suite}`)
  }
})

test('integration: no script was lost resolving the package.json conflicts', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  // Two cherry-picks conflicted on this file. A resolution that took one side
  // wholesale would silently drop the other's work and, more quietly, could
  // drop unrelated operational scripts.
  assert.equal(Object.keys(pkg.scripts).length, 33, 'the script count moved')
  for (const required of [
    'test',
    'typecheck',
    'validate-activation',
    'report-match-backlog',
    'import-kg',
  ]) {
    assert.ok(pkg.scripts[required], `missing script: ${required}`)
  }
})

/* ── Point 2: route-access reconciliation ────────────────────────────────── */

test('integration: the three packages\' route classifications all survived', () => {
  const byRoute = new Map(ROUTE_ACCESS.map((r) => [r.route, r]))

  const privatliv = byRoute.get('/privatliv')
  assert.equal(privatliv?.access, 'public_page', 'WP-5 lost its privacy route')
  assert.equal(privatliv?.planned, undefined, '/privatliv exists; planned must be dropped')

  const family = byRoute.get('/family/[slug]')
  assert.equal(family?.access, 'public_page_data_gated', 'WP-2 family route misclassified')
  assert.equal(family?.planned, undefined, '/family/[slug] exists; planned must be dropped')

  const resolve = byRoute.get('/api/search/resolve')
  assert.equal(resolve?.access, 'public_api_data_gated', 'WP-4 lost its resolver route')

  // WP-4 deleted /api/scrape. A classification for a route that no longer
  // exists would fail WP-1's completeness guard, and its presence would
  // suggest the unauthenticated write path came back.
  assert.equal(byRoute.has('/api/scrape'), false, '/api/scrape must carry no classification')
  assert.equal(existsSync(join(FRONTEND, 'app', 'api', 'scrape')), false, '/api/scrape route file survives')
  assert.equal(classifyPath('/api/scrape'), null, '/api/scrape must classify as unknown')
})

/* ── Point 3: the regenerated index ──────────────────────────────────────── */

test('integration: the index covers 48 supported identities and 6 families', () => {
  const index = JSON.parse(
    readFileSync(join(FRONTEND, 'data', 'klup-search-index.json'), 'utf8'),
  ) as { products: Array<{ slug: string }>; families: Array<{ slug: string }> }

  assert.equal(index.products.length, 48, 'the supported cohort is 48')
  assert.equal(index.families.length, 6, 'WP-2 landed six navigation families')
  assert.equal(
    new Set(index.products.map((p) => p.slug)).size,
    48,
    'a product slug is indexed twice',
  )
  assert.deepEqual(
    index.families.map((f) => f.slug).sort(),
    NAVIGATION_FAMILIES.map((f) => f.slug).sort(),
    'the artefact families and the reviewed families disagree',
  )
  // Visibility must not be baked in: the runtime gate stays authoritative, so a
  // qa_only -> public promotion is searchable without a regeneration and a deploy.
  const raw = readFileSync(join(FRONTEND, 'data', 'klup-search-index.json'), 'utf8')
  assert.equal(raw.includes('browse_visibility'), false, 'visibility must not be in the artefact')
})

/* ── The defect integration created: private slugs in the client bundle ──── */

const FAMILY_CHILD_SLUGS = NAVIGATION_FAMILIES.flatMap((f) => f.children)

function clientChunks(): string[] {
  const dir = join(FRONTEND, '.next', 'static')
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.js')) out.push(full)
    }
  }
  walk(dir)
  return out
}

test('integration: no private catalogue slug reaches a client bundle', (t) => {
  const chunks = clientChunks()
  if (chunks.length === 0) {
    const required = process.env.KLUP_REQUIRE_LIVE_VERIFICATION === '1'
    assert.equal(required, false, 'no production build to scan, and verification was required')
    t.skip('no frontend/.next build to scan (run `npm run build` first)')
    return
  }

  const blob = chunks.map((c) => readFileSync(c, 'utf8')).join('\n')
  const leaked = FAMILY_CHILD_SLUGS.filter((slug) =>
    new RegExp(`(?<![A-Za-z0-9-])${slug}(?![A-Za-z0-9-])`).test(blob),
  )

  assert.deepEqual(
    leaked,
    [],
    'private supported slugs are readable from a client bundle. `lib/families.ts` ' +
      'must not be reachable at runtime from a client component — see lib/search-contract.ts',
  )

  // The artefact itself carries all 48 supported slugs and is server-only.
  assert.equal(
    blob.includes('kg_product WHERE status=active'),
    false,
    'the search-index artefact was bundled into the client',
  )
})

test('integration: the client search page cannot reach the family children', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  assert.ok(page.startsWith("'use client'"), 'the search page is a client component')
  assert.equal(
    /from '@\/lib\/families'/.test(page),
    false,
    'a client component must not import the module holding private child slugs',
  )
  // WP-4a removed the need for a label module entirely: WP-2's family form
  // already submits `?q=<family label>`, so the term arrives in the URL.
  assert.equal(
    existsSync(join(FRONTEND, 'lib', 'family-labels.ts')),
    false,
    'the interim label module is redundant once ?q= carries the term',
  )
  assert.equal(
    /from '@\/lib\/search-resolver'/.test(page),
    false,
    'the client must import only the client-safe contract',
  )
  assert.match(page, /from '@\/lib\/search-contract'/)

  // The indirect edge is what actually leaked: search-resolver -> search-index
  // -> families. It must stay type-only, which is erased at build time.
  const index = readFileSync(join(FRONTEND, 'lib', 'search-index.ts'), 'utf8')
  assert.match(index, /import type \{ NavigationFamily \} from '\.\/families'/)
  assert.equal(
    /^import \{[^}]*NAVIGATION_FAMILIES/m.test(index),
    false,
    'search-index.ts must not import family values at runtime',
  )
})

/* ── Point 4: one taxonomy, connected through the real generic ───────────── */

/**
 * Strip comments before asserting on code.
 *
 * These files DESCRIBE the escape hatches they refuse to use — "an `as any`
 * would have compiled, and would have destroyed the only thing this seam is
 * for" — so a naive substring scan reports the explanation as the violation.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('integration: the analytics seam is WP-5 track(), with no second taxonomy', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  const pageCode = code(page)

  assert.match(pageCode, /import \{ track \} from '@\/lib\/analytics'/)
  assert.match(pageCode, /function useEmit\(\) \{\s*return track\s*\}/)
  assert.equal(pageCode.includes('usePostHog'), false, 'the page must not touch the SDK')
  assert.equal(pageCode.includes('posthog'), false, 'the page must not touch the SDK')
  assert.equal(pageCode.includes('SearchEventMap'), false, 'a second event map survives')

  const contract = readFileSync(join(FRONTEND, 'lib', 'search-contract.ts'), 'utf8')
  assert.match(contract, /import type \{ KlupEventMap \} from '\.\/analytics'/)
  const resolver = readFileSync(join(FRONTEND, 'lib', 'search-resolver.ts'), 'utf8')

  // No cast or suppression anywhere in the seam, and no untyped payload in the
  // page. The resolver's own Supabase row cast is server-side and unrelated,
  // so the loose-record rule is asserted where a payload is actually built.
  for (const escape of ['as never', 'as any', '@ts-ignore', '@ts-expect-error']) {
    assert.equal(code(resolver).includes(escape), false, `"${escape}" is not permitted`)
    assert.equal(pageCode.includes(escape), false, `"${escape}" is not permitted`)
  }
  assert.equal(pageCode.includes('Record<string, unknown>'), false, 'no untyped payload escape')

  for (const escape of ['as never', 'as any', '@ts-ignore', '@ts-expect-error', 'Record<string, unknown>']) {
    assert.equal(code(contract).includes(escape), false, `"${escape}" is not permitted in the contract`)
  }
  // One taxonomy: the contract derives, it does not restate.
  for (const derived of [
    "export type SearchSubmittedPayload = KlupEventMap['search_submitted']",
    "export type SearchResolvedPayload = KlupEventMap['search_resolved']",
    "export type SearchUnsupportedPayload = KlupEventMap['search_unsupported']",
    "export type DemandSignalPayload = KlupEventMap['demand_signal_submitted']",
    "export type SearchEntrySurface = KlupEventMap['search_submitted']['entry_surface']",
    "export type TaxonomyResolution = KlupEventMap['search_resolved']['resolution']",
  ]) {
    assert.ok(contract.includes(derived), `not derived from the taxonomy: ${derived}`)
  }
})

/* ── Point 5: the family demand marker survives both packages ────────────── */

test('integration: demand=family:<slug> is produced and honoured', () => {
  const familyPage = readFileSync(join(FRONTEND, 'app', 'family', '[slug]', 'page.tsx'), 'utf8')
  assert.match(familyPage, /name="demand" value=\{`family:\$\{family\.slug\}`\}/)
  assert.match(familyPage, /action="\/search"/)

  const search = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  assert.match(search, /DEMAND_FAMILY_PREFIX = 'family:'/)
  assert.match(search, /demandParam\.startsWith\(DEMAND_FAMILY_PREFIX\)/)
  // The demand outcome must never navigate back to the family it came from.
  const builder = search.slice(
    search.indexOf('function familyDemandOutcome'),
    search.indexOf('function useEmit'),
  )
  assert.ok(builder.includes('navigateTo: null'))
  assert.ok(builder.includes('autoNavigated: false'))
  assert.equal(builder.includes('router.push'), false)
})
