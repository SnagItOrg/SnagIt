/**
 * Stage 3 WP-4a — the restricted-search client/server module boundary.
 *
 * THE DEFECT THIS LOCKS OUT. `app/search/page.tsx` is a client component. It
 * imported `lib/search-resolver.ts` for its analytics payload builders, and
 * that module value-imports `lib/search-index.ts` — the build artefact holding
 * all 48 supported identities, 34 of them UNPUBLISHED, which throws at module
 * scope in a browser. The import edge alone was the bug: the bundler pulled the
 * private artefact into a public chunk, and the guard then blanked `/search`
 * with a hydration failure. The guard was correct. The boundary was not.
 *
 * The fix is a split, not a weakening: `lib/search-contract.ts` holds what a
 * browser may see, `lib/search-resolver.ts` keeps resolution and grows a guard
 * of its own, and `/api/search/resolve` stays the only runtime crossing.
 *
 * These tests are deterministic: they read the repository, walk the import
 * graph, and run modules in a child process. Two of them additionally inspect
 * build output or a running server, and each states explicitly when it has not
 * been able to verify — never silently.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'

const ROOT = join(__dirname, '..', '..')
/** The reviewed WP-4 tip this package branches from and must not disturb. */
const WP4_TIP = '6980129e7fdd8e5c8cf05892ca325fe0aa1991fc'
const FRONTEND = join(ROOT, 'frontend')

/* ------------------------------------------------------------------ *
 * Shared: a value-import graph over the frontend
 * ------------------------------------------------------------------ */

/** Modules the browser must never reach, at any import depth. */
const SERVER_ONLY = [
  'lib/search-index.ts',
  'lib/search-resolver.ts',
  'lib/families.ts',
  'lib/catalogue.ts',
  'lib/supabase-admin.ts',
  'data/klup-search-index.json',
]

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkFiles(full, out)
    else if (/\.(tsx?|json)$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Every import specifier in a file, split into value and type-only edges.
 *
 * TYPE-ONLY EDGES ARE ERASED AT COMPILE TIME and cannot pull a module into a
 * bundle, so treating them as reachability would make the assertion
 * unfalsifiable in the wrong direction — it would forbid the client from even
 * naming an outcome type. Both `import type { X } from` and an all-`type`
 * specifier list count as erased; a default or namespace import never does.
 */
export function importEdges(source: string): { value: string[]; typeOnly: string[] } {
  const value: string[] = []
  const typeOnly: string[] = []

  const re = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g
  for (const m of source.matchAll(re)) {
    const isTypeKeyword = Boolean(m[1])
    const clause = m[2] ?? ''
    const spec = m[3]

    if (isTypeKeyword) {
      typeOnly.push(spec)
      continue
    }
    const braced = clause.match(/\{([\s\S]*)\}/)
    const hasNonBraced = clause.replace(/\{[\s\S]*\}/, '').replace(/[,\s]/g, '').length > 0
    if (braced && !hasNonBraced) {
      const names = braced[1].split(',').map((n) => n.trim()).filter(Boolean)
      if (names.length > 0 && names.every((n) => n.startsWith('type '))) {
        typeOnly.push(spec)
        continue
      }
    }
    value.push(spec)
  }

  // `export { x } from './y'` is a value re-export and is a real edge.
  for (const m of source.matchAll(/export\s+(type\s+)?\{[\s\S]*?\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) typeOnly.push(m[2])
    else value.push(m[2])
  }

  return { value, typeOnly }
}

/** Resolve an import specifier to a repo-relative frontend path, or null. */
function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(FRONTEND, spec.slice(2))
  else if (spec.startsWith('.')) base = resolvePath(dirname(fromFile), spec)
  else return null // a package, not our code

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate.replace(`${FRONTEND}/`, '')
    }
  }
  return null
}

function isClientModule(source: string): boolean {
  return /^\s*(['"])use client\1/m.test(source.split('\n').slice(0, 5).join('\n'))
}

/** Value-import closure from a set of entry files, as repo-relative paths. */
function valueClosure(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>() // module -> path taken to reach it
  const queue: Array<{ file: string; path: string[] }> = entries.map((f) => ({
    file: f,
    path: [f.replace(`${FRONTEND}/`, '')],
  }))

  while (queue.length > 0) {
    const { file, path } = queue.shift()!
    if (!existsSync(file) || !/\.tsx?$/.test(file)) continue
    const { value } = importEdges(readFileSync(file, 'utf8'))
    for (const spec of value) {
      const target = resolveSpec(file, spec)
      if (!target) continue
      if (seen.has(target)) continue
      seen.set(target, [...path, target])
      queue.push({ file: join(FRONTEND, target), path: [...path, target] })
    }
  }
  return seen
}

const CLIENT_ENTRIES = [...walkFiles(join(FRONTEND, 'app')), ...walkFiles(join(FRONTEND, 'components'))]
  .filter((f) => /\.tsx?$/.test(f))
  .filter((f) => isClientModule(readFileSync(f, 'utf8')))

/* ------------------------------------------------------------------ *
 * 1. No 'use client' module can reach the server search index
 * ------------------------------------------------------------------ */

test('boundary: the client entry set is non-empty and includes /search', () => {
  // A walker that found nothing would pass every assertion below vacuously.
  assert.ok(CLIENT_ENTRIES.length > 5, `expected many client modules, found ${CLIENT_ENTRIES.length}`)
  assert.ok(
    CLIENT_ENTRIES.some((f) => f.endsWith(join('app', 'search', 'page.tsx'))),
    '/search must still be a client component',
  )
})

test('boundary: no client module has a VALUE-import path to a server-only module', () => {
  const offenders: string[] = []
  for (const entry of CLIENT_ENTRIES) {
    const closure = valueClosure([entry])
    for (const forbidden of SERVER_ONLY) {
      const path = closure.get(forbidden)
      if (path) offenders.push(path.join(' -> '))
    }
  }
  assert.deepEqual(offenders, [], 'a client module can reach server-only catalogue state')
})

test('boundary: /search reaches only client-safe modules of our own', () => {
  const page = CLIENT_ENTRIES.find((f) => f.endsWith(join('app', 'search', 'page.tsx')))!
  const closure = [...valueClosure([page]).keys()].sort()
  // Whitelist, not blacklist: a new edge has to be added here deliberately.
  const allowed = new Set([
    'lib/search-contract.ts',
    'lib/model-key.ts',
    'lib/query-normalizer.ts',
    'lib/supabase-browser.ts',
    'lib/i18n.ts',
    // INTEGRATION: WP-5's analytics entry point and the two pure modules it
    // reads. `/search` reaches them through `track()`, which is the whole point
    // of the seam. None touches the catalogue: `consent.ts` is a preference
    // store and `route-access.ts` is the classification table the middleware
    // already ships. WP-4a could not list them — WP-5 did not exist on its base.
    'lib/analytics.ts',
    'lib/consent.ts',
    'lib/route-access.ts',
    'components/SideNav.tsx',
    'components/BottomNav.tsx',
    'components/LocaleProvider.tsx',
  ])
  const unexpected = closure.filter((m) => !allowed.has(m) && !m.startsWith('components/'))
  assert.deepEqual(unexpected, [], 'unreviewed module reachable from the search client')
})

test('boundary: the client imports the contract, and the contract imports no catalogue', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  assert.match(page, /from '@\/lib\/search-contract'/)
  assert.equal(page.includes("from '@/lib/search-resolver'"), false)
  assert.equal(page.includes("from '@/lib/search-index'"), false)
  assert.equal(page.includes("from '@/lib/families'"), false)

  const contract = readFileSync(join(FRONTEND, 'lib', 'search-contract.ts'), 'utf8')
  const { value } = importEdges(contract)
  // INTEGRATION: `./analytics` joins the list as a TYPE-ONLY import, which is
  // erased at build time, so the contract still pulls no runtime module beyond
  // normalisation. It is what makes the payload types derived rather than a
  // second copy of WP-5's taxonomy.
  assert.deepEqual(
    value,
    ['./analytics', './model-key'],
    'the contract may depend on normalisation and the WP-5 taxonomy, and nothing else',
  )
  assert.match(contract, /import type \{ KlupEventMap \} from '\.\/analytics'/)
})

/* ------------------------------------------------------------------ *
 * 2. The server modules still refuse to run in a browser
 * ------------------------------------------------------------------ */

/** Evaluate a module in a child process with `globalThis.window` defined. */
function evaluateAsBrowser(moduleRelPath: string): { code: number; stderr: string } {
  const script =
    `globalThis.window = {};` +
    `import(${JSON.stringify(join(FRONTEND, moduleRelPath))})` +
    `.then(() => { console.log('NO_GUARD'); process.exit(0) })` +
    `.catch((e) => { console.log(String(e && e.message)); process.exit(3) })`
  try {
    const stdout = execFileSync(join(ROOT, 'node_modules', '.bin', 'tsx'), ['-e', script], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stderr: stdout }
  } catch (err) {
    const e = err as { status?: number; stderr?: string; stdout?: string }
    return { code: e.status ?? -1, stderr: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('guard: lib/search-index.ts still throws when a window exists', () => {
  const { code, stderr } = evaluateAsBrowser('lib/search-index.ts')
  assert.equal(code, 3, `expected the server-only guard to throw, got: ${stderr}`)
  assert.match(stderr, /server-only/)
  assert.equal(stderr.includes('NO_GUARD'), false)
})

test('guard: lib/search-resolver.ts refuses a browser on its own, not by inheritance', () => {
  const { code, stderr } = evaluateAsBrowser('lib/search-resolver.ts')
  assert.equal(code, 3, `expected the server-only guard to throw, got: ${stderr}`)
  assert.match(stderr, /search-resolver\.ts is server-only/)
  assert.match(stderr, /search-contract/, 'the message must name the client-safe alternative')
})

test('guard: lib/search-contract.ts evaluates happily in a browser', () => {
  const { code, stderr } = evaluateAsBrowser('lib/search-contract.ts')
  assert.equal(code, 0, `the client-safe module must not throw: ${stderr}`)
  assert.match(stderr, /NO_GUARD/)
})

test('guard: neither guard was softened into a warning', () => {
  // The index guards inline. The resolver guards through a first-position
  // side-effect import, because ESM evaluates imports before the importing
  // module's body — an inline guard there would be unreachable code that reads
  // like protection.
  for (const mod of ['lib/search-index.ts', 'lib/search-server-only.ts']) {
    const src = readFileSync(join(FRONTEND, mod), 'utf8')
    assert.match(src, /throw new Error\(/, `${mod} must throw, not warn`)
    assert.match(src, /globalThis as \{ window\?: unknown \}/, `${mod} must test for a window`)
    assert.equal(src.includes('console.warn'), false, `${mod} must not degrade to a warning`)
  }
  const resolver = readFileSync(join(FRONTEND, 'lib', 'search-resolver.ts'), 'utf8')
  const firstImport = resolver.split('\n').find((l) => l.startsWith('import ')) ?? ''
  assert.equal(firstImport, "import './search-server-only'", 'the guard must be the FIRST import')
})

/* ------------------------------------------------------------------ *
 * 3. Nothing is duplicated by the split
 * ------------------------------------------------------------------ */

test('no duplication: each contract symbol is declared once and re-exported', () => {
  const contract = readFileSync(join(FRONTEND, 'lib', 'search-contract.ts'), 'utf8')
  const resolver = readFileSync(join(FRONTEND, 'lib', 'search-resolver.ts'), 'utf8')

  const declared = [
    'searchSubmittedPayload',
    'searchResolvedPayload',
    'searchUnsupportedPayload',
    'demandSignalPayload',
    'UNSUPPORTED_CLASS_BY_OUTCOME',
  ]
  for (const name of declared) {
    assert.match(contract, new RegExp(`export (function|const) ${name}\\b`), `${name} must live in the contract`)
    assert.equal(
      new RegExp(`export (function|const) ${name}\\b`).test(resolver),
      false,
      `${name} must not be re-declared in the resolver`,
    )
    assert.ok(resolver.includes(name), `${name} must still be re-exported for server callers`)
  }

  // Outcome vocabulary: declared once.
  assert.match(contract, /export type SearchOutcomeKind =/)
  assert.equal(/export type SearchOutcomeKind =/.test(resolver), false)

  // Navigation-family configuration and eligibility predicates are not copied.
  for (const src of [contract, resolver]) {
    assert.equal(src.includes('NavigationFamily['), false, 'family config must not be duplicated')
  }
  assert.equal(contract.includes('browse_visibility'), false, 'no support/visibility axis in the contract')
  assert.equal(contract.includes('support_state'), false, 'no support/visibility axis in the contract')
  assert.equal(contract.includes('isCanonical'), false, 'eligibility is not duplicated')
})

test('no duplication: the WP-5 analytics taxonomy is referenced, never redefined', () => {
  const contract = readFileSync(join(FRONTEND, 'lib', 'search-contract.ts'), 'utf8')
  // One declaration of each taxonomy union, in the contract, matching WP-5.
  for (const name of ['TaxonomyResolution', 'TaxonomyResolutionClass', 'DemandCaptureMethod']) {
    const hits = [...contract.matchAll(new RegExp(`export type ${name} =`, 'g'))]
    assert.equal(hits.length, 1, `${name} must be declared exactly once`)
  }
  // INTEGRATION: WP-4a asserted the contract must NOT import './analytics',
  // because on its base WP-5 did not exist and any mention would have been a
  // copy. WP-5 is present now, so the same intent — one taxonomy, owned by
  // WP-5 — is asserted the stronger way: every union is DERIVED from
  // `KlupEventMap`, so a literal restatement cannot survive.
  assert.match(contract, /import type \{ KlupEventMap \} from '\.\/analytics'/)
  for (const derived of [
    "export type SearchEntrySurface = KlupEventMap['search_submitted']['entry_surface']",
    "export type SearchInputMethod = KlupEventMap['search_submitted']['input_method']",
    "export type TaxonomyResolution = KlupEventMap['search_resolved']['resolution']",
    "export type TaxonomyResolutionClass = KlupEventMap['search_unsupported']['resolution_class']",
    "export type DemandCaptureMethod = KlupEventMap['demand_signal_submitted']['capture_method']",
    "export type SearchSubmittedPayload = KlupEventMap['search_submitted']",
    "export type SearchResolvedPayload = KlupEventMap['search_resolved']",
    "export type SearchUnsupportedPayload = KlupEventMap['search_unsupported']",
    "export type DemandSignalPayload = KlupEventMap['demand_signal_submitted']",
  ]) {
    assert.ok(contract.includes(derived), `not derived from WP-5's taxonomy: ${derived}`)
  }
  assert.equal(
    /export type (SearchEntrySurface|SearchInputMethod|DemandCaptureMethod) = '/.test(contract),
    false,
    'a literal union survives alongside the derivation',
  )
})

test('typed analytics boundary: no cast or suppression survives the split', () => {
  // INTEGRATION: comments are stripped first. WP-5's seam on /search explains
  // that an `as never` or an `as any` would have compiled and would have
  // destroyed the check the seam exists for, so a raw substring scan reports
  // the explanation as the violation.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  for (const mod of ['lib/search-contract.ts', 'lib/search-resolver.ts']) {
    const src = stripComments(readFileSync(join(FRONTEND, mod), 'utf8'))
    for (const escape of ['as never', 'as any', '@ts-ignore', '@ts-expect-error']) {
      assert.equal(src.includes(escape), false, `"${escape}" is not permitted in ${mod}`)
    }
  }
  const page = stripComments(readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8'))
  for (const escape of ['as never', 'as any', '@ts-ignore', '@ts-expect-error']) {
    assert.equal(page.includes(escape), false, `"${escape}" is not permitted on /search`)
  }
  assert.equal(page.includes('Record<string, unknown>'), false, 'no untyped payload escape')
})

/* ------------------------------------------------------------------ *
 * 4. Search still never scrapes and never writes — including the new module
 * ------------------------------------------------------------------ */

test('the new contract module invokes no scraper and writes nothing', () => {
  const src = readFileSync(join(FRONTEND, 'lib', 'search-contract.ts'), 'utf8')
  for (const forbidden of ['lib/scrapers', 'scrapeDba', '/api/scrape', '.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.equal(src.includes(forbidden), false, `search-contract must not reference ${forbidden}`)
  }
})

test('/api/search/resolve remains the only runtime crossing', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  const fetched = [...page.matchAll(/fetch\(\s*[`'"]([^`'"$]*)/g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(fetched)],
    ['/api/search/resolve?q='],
    'the client may reach the resolver only through its endpoint',
  )
  const route = readFileSync(join(FRONTEND, 'app', 'api', 'search', 'resolve', 'route.ts'), 'utf8')
  assert.match(route, /from '@\/lib\/search-index'/, 'the route still owns index loading')
  assert.match(route, /from '@\/lib\/search-resolver'/, 'the route still owns resolution')
})

/* ------------------------------------------------------------------ *
 * 5. Family demand capture still works, and still cannot loop
 * ------------------------------------------------------------------ */

test('demand: ?demand=family:<slug> is honoured without resolving the family term', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  assert.match(page, /const DEMAND_FAMILY_PREFIX = 'family:'/)
  // Demand mode returns BEFORE any resolve call, so the family term can never
  // be sent to the resolver and 302'd back to the page it came from.
  const effect = page.slice(page.indexOf('if (demandFamilySlug.length > 0)'))
  const beforeReturn = effect.slice(0, effect.indexOf('return'))
  assert.equal(beforeReturn.includes('runSearch'), false, 'demand mode must not resolve')
  assert.ok(beforeReturn.includes('familyDemandOutcome('), 'demand mode builds its outcome locally')
  assert.ok(beforeReturn.includes("emit('search_unsupported'"), 'demand mode still records demand')
})

test('demand: the seeded term survives without reading family configuration', () => {
  const page = readFileSync(join(FRONTEND, 'app', 'search', 'page.tsx'), 'utf8')
  assert.ok(page.includes('initialQuery || familyTermFromSlug(demandFamilySlug)'))
  assert.ok(page.includes('initialQuery || familyPrefill'))
  // Code only: the prose above `familyTermFromSlug` records what was removed
  // and why, and must be allowed to name it.
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  for (const forbidden of ['getFamily', 'allFamilyChildSlugs', 'NAVIGATION_FAMILIES', 'isFamilySlug']) {
    assert.equal(code.includes(forbidden), false, `/search must not call ${forbidden}`)
  }
})

/* ------------------------------------------------------------------ *
 * 6. Client bundle: no private identity may appear in a public chunk
 * ------------------------------------------------------------------ */

/** Supported today but NOT public: must never reach a browser. */
function privateSupportedSlugs(): string[] {
  const artefact = JSON.parse(
    readFileSync(join(FRONTEND, 'data', 'klup-search-index.json'), 'utf8'),
  ) as { products: Array<{ slug: string }> }
  const publicCohort = new Set([
    'korg-ms-20', 'moog-minimoog', 'rhodes-mark-i-stage-73', 'rhodes-mark-i-suitcase-73',
    'rhodes-mark-ii-stage-73', 'roland-juno-106', 'roland-juno-60', 'roland-jupiter-8',
    'roland-re-201', 'roland-sh-101', 'roland-tr-808', 'roland-tr-909', 'wurlitzer-200a',
    'yamaha-dx7',
  ])
  return artefact.products.map((p) => p.slug).filter((s) => !publicCohort.has(s))
}

export type BundleScan =
  | { state: 'scanned'; files: number; offenders: string[] }
  | { state: 'no_build' }

export function scanClientChunks(staticDir: string, needles: string[]): BundleScan {
  if (!existsSync(staticDir)) return { state: 'no_build' }
  const files = walkAll(staticDir)
  const offenders: string[] = []
  for (const file of files) {
    const body = readFileSync(file, 'utf8')
    for (const needle of needles) {
      // BOUNDARY-AWARE. A bare `includes` reports `roland-juno-6` inside the
      // public `roland-juno-60`, which is how this scan first "failed" on an
      // admin form placeholder. A slug only counts when it is not a prefix of
      // a longer slug.
      const re = new RegExp(`${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`)
      if (re.test(body)) offenders.push(`${file.split('/.next/')[1]}: ${needle}`)
    }
  }
  return { state: 'scanned', files: files.length, offenders }
}

function walkAll(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkAll(full, out)
    else if (/\.(js|json|txt|css)$/.test(entry)) out.push(full)
  }
  return out
}

test('bundle: the private cohort is well formed and non-trivial', () => {
  const priv = privateSupportedSlugs()
  assert.ok(priv.length >= 30, `expected the private cohort, found ${priv.length}`)
  assert.ok(priv.includes('gibson-les-paul-custom'))
  assert.ok(priv.includes('neumann-u87ai'))
})

/**
 * Whether the bundle proof is REQUIRED of this run.
 *
 * Same shape as WP-4's `liveVerificationDecision`, and for the same reason: the
 * dangerous outcome is a release that reports green because nobody built the
 * app, so a missing build must FAIL in CI and be an explicit, named boundary
 * locally — never a silent pass.
 */
export type BundleVerification = 'run' | 'fail_missing_build' | 'declared_boundary'

export function bundleVerificationDecision(
  env: NodeJS.ProcessEnv,
  staticDirExists: boolean,
): BundleVerification {
  if (staticDirExists) return 'run'
  const required = env.KLUP_REQUIRE_BUNDLE_SCAN === '1' || env.CI === 'true'
  return required ? 'fail_missing_build' : 'declared_boundary'
}

test('bundle policy: a release run cannot degrade into a skip', () => {
  assert.equal(bundleVerificationDecision({} as NodeJS.ProcessEnv, true), 'run')
  assert.equal(bundleVerificationDecision({ CI: 'true' } as NodeJS.ProcessEnv, true), 'run')
  assert.equal(bundleVerificationDecision({ CI: 'true' } as NodeJS.ProcessEnv, false), 'fail_missing_build')
  assert.equal(
    bundleVerificationDecision({ KLUP_REQUIRE_BUNDLE_SCAN: '1' } as NodeJS.ProcessEnv, false),
    'fail_missing_build',
  )
  assert.equal(bundleVerificationDecision({} as NodeJS.ProcessEnv, false), 'declared_boundary')
})

const STATIC_DIR = join(FRONTEND, '.next', 'static')

const MISSING_BUILD =
  'frontend/.next/static is absent, so the client bundle could not be scanned. ' +
  'Run `npm run build` in frontend/ first: the import graph is proven statically ' +
  'above, but the bundle scan is the proof of what a browser actually receives.'

test('bundle: no private supported slug appears in a client chunk', (t) => {
  const decision = bundleVerificationDecision(process.env, existsSync(STATIC_DIR))
  if (decision === 'fail_missing_build') assert.fail(MISSING_BUILD)
  if (decision === 'declared_boundary') {
    t.diagnostic(`NOT VERIFIED: ${MISSING_BUILD}`)
    t.skip('no production build present')
    return
  }
  const scan = scanClientChunks(STATIC_DIR, privateSupportedSlugs())
  assert.equal(scan.state, 'scanned')
  assert.ok(scan.state === 'scanned' && scan.files > 0, 'no client assets were found to scan')
  assert.deepEqual(
    scan.state === 'scanned' ? scan.offenders : ['unscanned'],
    [],
    'a private supported identity reached a public chunk',
  )
})

test('bundle: no server-only search material reaches a client chunk', (t) => {
  const decision = bundleVerificationDecision(process.env, existsSync(STATIC_DIR))
  if (decision === 'fail_missing_build') assert.fail(MISSING_BUILD)
  if (decision === 'declared_boundary') {
    t.diagnostic(`NOT VERIFIED: ${MISSING_BUILD}`)
    t.skip('no production build present')
    return
  }
  const scan = scanClientChunks(STATIC_DIR, [
    'is server-only: it contains unpublished catalogue identities',
    'is server-only: it resolves against unpublished catalogue identities',
    'generatedFrom',
    'aliasKeys',
    'DANGEROUS_TERM_KEYS',
  ])
  assert.deepEqual(
    scan.state === 'scanned' ? scan.offenders : ['unscanned'],
    [],
    'server-only search material reached a public chunk',
  )
})

/* ------------------------------------------------------------------ *
 * 7. Index drift still fails closed in CI without credentials
 * ------------------------------------------------------------------ */

test('drift: a credential-less CI run of the WP-4 suite FAILS, it does not skip', () => {
  // End-to-end rather than by calling the policy function: the regression this
  // guards is a release reporting green on an index nobody compared against the
  // catalogue, and that can only be proven by running the suite the way CI
  // would. Executed in a child process with the credentials stripped.
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' }
  delete env.NEXT_PUBLIC_SUPABASE_URL
  delete env.SUPABASE_SERVICE_ROLE_KEY
  delete env.KLUP_REQUIRE_LIVE_VERIFICATION
  // Node's test runner sets NODE_TEST_CONTEXT for its children. Left in place,
  // the nested run switches to child-reporter mode and exits 0 whatever it
  // found — which would make this very assertion report green on a failure.
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_OPTIONS

  let failed = false
  let output = ''
  try {
    output = execFileSync(
      join(ROOT, 'node_modules', '.bin', 'tsx'),
      ['--test', join(ROOT, 'scripts', 'lib', 'wp4-search.test.ts')],
      { encoding: 'utf8', cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (err) {
    failed = true
    const e = err as { stdout?: string; stderr?: string }
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }

  assert.equal(failed, true, 'CI without credentials must not report green on index drift')
  assert.match(output, /Live verification is REQUIRED/)
})

/* ------------------------------------------------------------------ *
 * 8. Production invariants — SELECT only, no writer touched
 * ------------------------------------------------------------------ */

test('production invariant: WP-4a touches no writer, migration or config', () => {
  // Tracked changes AND untracked additions: `git diff` alone would not see a
  // new file, which is exactly how a forbidden path could be added unnoticed.
  const tracked = execFileSync('git', ['diff', '--name-only', WP4_TIP], { encoding: 'utf8', cwd: ROOT })
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8', cwd: ROOT },
  )
  const changed = `${tracked}\n${untracked}`.split('\n').map((l) => l.trim()).filter(Boolean)

  const forbidden = [
    'scripts/migrations/',
    'data/klup-source-monitoring.json',
    'frontend/vercel.json',
    'frontend/app/api/cron/',
    'frontend/lib/scrapers/',
    'frontend/lib/matching/',
    'ecosystem.config.js',
  ]
  for (const file of changed) {
    for (const f of forbidden) {
      assert.equal(file.startsWith(f), false, `WP-4a must not touch ${file}`)
    }
  }
  assert.ok(changed.length > 0, 'expected WP-4a to have changed something')
})

test('production invariant: the resolver route still only SELECTs', () => {
  const src = readFileSync(join(FRONTEND, 'app', 'api', 'search', 'resolve', 'route.ts'), 'utf8')
  for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.equal(src.includes(write), false, `the resolver route must not perform ${write}`)
  }
  const tables = [...src.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(tables)].sort(), ['browse_product_projection', 'kg_product'])
})
