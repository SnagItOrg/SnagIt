/**
 * Stage 3 WP-4 — restricted catalogue search.
 *
 * Covers the supported-search contract (docs/klup-launch-catalogue-selection.md
 * §11, adopted verbatim by the build plan §8.2), the five-outcome resolver, the
 * eligibility re-check, and the removal of the live-scrape SERP.
 *
 * GUARDRAIL G1 IS A TEST HERE, NOT A METRIC. The build plan says
 * `search_resolved.auto_navigated` must read exactly 0 for every dangerous term
 * for the whole release. A metric tells you afterwards; this suite refuses the
 * commit.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { modelKey, queryNorm, queryTokens, sameModelKey } from '../../frontend/lib/model-key'
import { lookupSynonym, allSynonyms } from '../../frontend/lib/synonyms'
import {
  DANGEROUS_TERM_KEYS,
  SHADOW_BRAND_KEYS,
  allEntities,
  loadSearchIndex,
  liveFamilyEntities,
  type SearchEntity,
  type SearchIndex,
} from '../../frontend/lib/search-index'
import {
  UNSUPPORTED_CLASS_BY_OUTCOME,
  applyEligibility,
  demandSignalPayload,
  filterEligibleSlugs,
  resolveQuery,
  searchResolvedPayload,
  searchSubmittedPayload,
  searchUnsupportedPayload,
  type SearchOutcome,
  type SearchOutcomeKind,
} from '../../frontend/lib/search-resolver'
import { NAVIGATION_FAMILIES } from '../../frontend/lib/families'
import {
  ROUTE_ACCESS,
  classifyPath,
  isAuthenticatedClass,
  requiresAuth,
} from '../../frontend/lib/route-access'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const readCode = (...parts: string[]) => readFileSync(join(FRONTEND, ...parts), 'utf8')

/**
 * Source with comments stripped.
 *
 * Every "this token must be gone" assertion below has to read CODE, not prose.
 * These files document what they removed and why — `/search`'s header names
 * `/api/scrape`, and `synonyms.ts` names the Apple terms it deleted — so a
 * naive substring search over the raw file fails on the explanation rather than
 * on the behaviour. Stripping comments first is what makes the assertion mean
 * what it says.
 */
const readSource = (...parts: string[]) =>
  readCode(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const INDEX = loadSearchIndex(NAVIGATION_FAMILIES)

/** Every supported identity in the committed artefact — public AND private. */
const INDEXED_SLUGS = INDEX.products.map((p) => p.slug).sort()

/**
 * The public cohort, as the runtime gate would report it.
 *
 * A fixture, deliberately: the resolver is pure and the tests do not reach a
 * database, so the eligibility verdict has to be injected. Live truth is the
 * business of `filterEligibleSlugs` (covered below) and of the drift check
 * against live state; this set only stands in for "what the gate said today".
 */
const PUBLIC_COHORT = new Set([
  'korg-ms-20',
  'moog-minimoog',
  'rhodes-mark-i-stage-73',
  'rhodes-mark-i-suitcase-73',
  'rhodes-mark-ii-stage-73',
  'roland-juno-106',
  'roland-juno-60',
  'roland-jupiter-8',
  'roland-re-201',
  'roland-sh-101',
  'roland-tr-808',
  'roland-tr-909',
  'wurlitzer-200a',
  'yamaha-dx7',
])

/** Supported but private today. In the index, never in a response. */
const PRIVATE_SUPPORTED = [
  'gibson-les-paul-custom',
  'emu-sp-1200',
  'neumann-u87ai',
  'ua-1176ln',
  'fender-mustang-bass',
  'roland-tr-707',
  'gibson-j-45',
  'martin-d-28',
  'roland-system-100',
  'tube-tech-cl1b',
  'moog-model-d',
  'roland-juno-6',
]

const FAMILY_SLUGS = new Set(NAVIGATION_FAMILIES.map((f) => f.slug))

/**
 * What the ROUTE produces: resolve, then apply the eligibility verdict.
 *
 * Behavioural assertions go through this rather than through `resolveQuery`
 * alone, because the raw resolver now sees all 48 supported identities and its
 * unfiltered output is an intermediate value no visitor ever receives.
 */
function resolvePublic(
  query: string,
  index = INDEX,
  publicSlugs: Set<string> = PUBLIC_COHORT,
  familySlugs: Set<string> = FAMILY_SLUGS,
) {
  return applyEligibility(resolveQuery(query, index), publicSlugs, familySlugs)
}

/* ------------------------------------------------------------------ *
 * 1. Normalisation — the gap the contract names explicitly (§8.3)
 * ------------------------------------------------------------------ */

test('modelKey: -, space and nothing are equivalent inside a model number', () => {
  const expected = 'juno106'
  for (const variant of ['juno106', 'juno-106', 'juno 106', 'JUNO 106', ' Juno-106 ', 'JuNo106']) {
    assert.equal(modelKey(variant), expected, `${variant} must key to ${expected}`)
  }
})

test('modelKey: the same holds for every model number in the catalogue', () => {
  const cases: Array<[string, string[]]> = [
    ['tr808', ['TR-808', 'TR 808', 'tr808']],
    ['tr909', ['TR-909', 'TR 909', 'tr909']],
    ['dx7', ['DX7', 'DX 7', 'dx-7']],
    ['sh101', ['SH-101', 'SH 101', 'sh101']],
    ['ms20', ['MS-20', 'MS 20', 'ms20']],
    ['re201', ['RE-201', 'RE 201', 're201']],
    ['jupiter8', ['Jupiter-8', 'Jupiter 8', 'jupiter8']],
    ['200a', ['200A', '200 a', '200-a']],
  ]
  for (const [key, variants] of cases) {
    for (const v of variants) assert.equal(modelKey(v), key, `${v} -> ${key}`)
  }
})

test('modelKey: brand+model collapses to one key too', () => {
  assert.equal(modelKey('Roland Juno-106'), 'rolandjuno106')
  assert.equal(modelKey('roland juno 106'), 'rolandjuno106')
  assert.ok(sameModelKey('Roland TR-808', 'roland tr808'))
})

test('modelKey: generation qualifiers stay significant, never collapsed away', () => {
  // selection doc §11: Mini, Kit, FS, II, Mk2, Suitcase, Stage, 73, 88, 100M.
  assert.notEqual(modelKey('MS-20'), modelKey('MS-20 Mini'))
  assert.notEqual(modelKey('System 100'), modelKey('System 100M'))
  assert.notEqual(modelKey('Mark I Stage 73'), modelKey('Mark I Stage 88'))
  assert.notEqual(modelKey('Mark I Stage 73'), modelKey('Mark II Stage 73'))
  assert.notEqual(modelKey('Mark I Stage 73'), modelKey('Mark I Suitcase 73'))
})

test('modelKey: diacritics fold through the shared normaliser, unchanged', () => {
  assert.equal(queryNorm('Röland'), 'roeland')
  assert.equal(queryTokens('  Roland   Juno-106 ').length, 2)
  assert.equal(modelKey(''), '')
  assert.equal(modelKey('   '), '')
})

test('lib/query-normalizer.ts is not modified by WP-4', () => {
  // /api/scrape and the matcher-adjacent paths consume it; WP-4 composes on
  // top instead (build plan §8.3, and the WP-4 forbidden list).
  const src = readCode('lib', 'query-normalizer.ts')
  assert.ok(src.includes('export function normalizeQuery'))
  assert.equal(src.includes('modelKey'), false, 'model-key logic must not leak into the shared normaliser')
})

/* ------------------------------------------------------------------ *
 * 2. Synonyms — the pre-pivot residue is gone (decision 17)
 * ------------------------------------------------------------------ */

test('synonyms: only the two music entries survive', () => {
  assert.deepEqual(Object.keys(allSynonyms()).sort(), ['re201', 'space echo'])
  assert.equal(lookupSynonym('space echo'), 'roland re-201')
  assert.equal(lookupSynonym('re201'), 're-201')
})

test('synonyms: no multi-vertical term remains', () => {
  const src = readSource('lib', 'synonyms.ts')
  for (const term of ['macmini', 'mac mini', 'imac', 'macbook', 'airpods']) {
    assert.equal(src.toLowerCase().includes(term), false, `"${term}" must be gone from synonyms.ts`)
  }
})

/* ------------------------------------------------------------------ *
 * 3. The index — shape, coverage, and what it may never contain
 * ------------------------------------------------------------------ */

test('index: covers the canonical cohort and nothing else', () => {
  assert.ok(INDEX.products.length > 0, 'the index must not be empty')
  for (const p of INDEX.products) {
    assert.equal(p.kind, 'product')
    assert.ok(p.slug.length > 0)
    assert.ok(p.label.length > 0, `${p.slug} must carry a label`)
    assert.ok(p.brand.length > 0, `${p.slug} must carry a brand`)
    assert.ok(p.aliasKeys.length > 0, `${p.slug} must carry at least one alias key`)
  }
})

test('index: covers ALL supported identities, public and private', () => {
  // 48 supported, not the 14 public ones. An index of only the public cohort
  // makes the artefact the visibility authority, so a qa_only -> public
  // promotion would need a regeneration and a deploy before search noticed.
  for (const slug of PRIVATE_SUPPORTED) {
    assert.ok(
      INDEXED_SLUGS.includes(slug),
      `${slug} is supported and must be indexed so a promotion is searchable at once`,
    )
  }
  for (const slug of PUBLIC_COHORT) {
    assert.ok(INDEXED_SLUGS.includes(slug), `${slug} is public and must be indexed`)
  }
  assert.ok(INDEXED_SLUGS.length > PUBLIC_COHORT.size, 'the index must exceed the public cohort')
})

test('index: never carries a visibility field', () => {
  // Storing it would recreate the authority this change removes.
  const raw = readCode('data', 'klup-search-index.json')
  for (const token of ['browse_visibility', 'qa_only', 'visibility', 'is_public']) {
    assert.equal(raw.includes(token), false, `the artefact must not record "${token}"`)
  }
})

test('index: cohorts outside the supported set are absent entirely', () => {
  const forbidden = [
    // public + unsupported (held from launch) — the matcher can never update them
    'ampex-atr-700', 'arp-2600', 'linn-electronics-linndrum', 'oberheim-ob-x',
    'oberheim-ob-xa', 'rhodes-mark-i-stage-88', 'sequential-prophet-5', 'strymon-timeline',
    // family labels — they are families, never products
    'gibson-les-paul', 'fender-stratocaster', 'fender-telecaster',
    'fender-jazz-bass', 'fender-precision-bass', 'gibson-es-335',
    // inactive / non-music
    'vitra-vitra-flowerpot', 'carl-hansen-sn-carl-hansen--sn-wishbone-chair',
  ]
  for (const slug of forbidden) {
    assert.equal(
      INDEXED_SLUGS.includes(slug),
      false,
      `${slug} is not a supported identity and must not be indexed`,
    )
  }
})

test('a private supported product is recognised but NEVER returned', () => {
  for (const slug of PRIVATE_SUPPORTED) {
    const entry = INDEX.products.find((p) => p.slug === slug)!
    for (const key of entry.aliasKeys) {
      const settled = resolvePublic(key)
      assert.equal(settled.navigateTo, null, `"${key}" must not navigate to a private product`)
      const offered = [...settled.candidates, ...settled.suggestions].map((c) => c.slug)
      assert.equal(
        offered.includes(slug),
        false,
        `"${key}" offered the private product ${slug}`,
      )
    }
  }
})

test('promotion freshness: qa_only -> public is searchable with no regeneration', () => {
  const slug = 'roland-tr-707'
  const term = 'roland tr-707'

  // Today: supported but private. Recognised, refused.
  const before = resolvePublic(term)
  assert.equal(before.navigateTo, null, 'a private product must not be navigable')

  // The operator flips browse_visibility to public through the admin seam.
  // Nothing is rebuilt, nothing is redeployed — only the gate's answer changes.
  const after = resolvePublic(term, INDEX, new Set([...PUBLIC_COHORT, slug]))
  assert.equal(after.navigateTo, `/product/${slug}`, 'the promotion must be live immediately')
  assert.equal(after.autoNavigated, true)
})

test('depublication freshness: public -> qa_only stops resolving at once', () => {
  const shrunk = new Set(PUBLIC_COHORT)
  shrunk.delete('roland-juno-106')
  const settled = resolvePublic('juno-106', INDEX, shrunk)
  assert.equal(settled.navigateTo, null)
  assert.equal(settled.autoNavigated, false)
})

test('the index module is server-only and says so at module scope', () => {
  // It carries the slugs and labels of the private supported identities, so a
  // client import must fail loudly rather than bundle them into a public chunk.
  const src = readSource('lib', 'search-index.ts')
  assert.ok(/typeof\s*\(?globalThis[^)]*\)?\.window\s*!==\s*'undefined'/.test(src) ||
            src.includes("typeof window !== 'undefined'"),
    'a server-only guard is required')
  assert.ok(src.includes('throw new Error'), 'the guard must throw, not warn')
  assert.ok(src.includes('server-only'), 'the guard must say why it exists')
})

test('no client component imports the index or the resolver runtime', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const src = readFileSync(full, 'utf8')
      if (!/^['"]use client['"]/m.test(src)) continue
      // A `import type { ... }` is erased at compile time and ships nothing.
      const valueImport = /^import\s+(?!type\b)[^\n]*from\s+['"][^'"\n]*search-(index|resolver)['"]/m
      if (valueImport.test(src)) offenders.push(full)
    }
  }
  walk(FRONTEND)
  assert.deepEqual(offenders, [], 'a client component pulls in private catalogue identities')
})

test('index: labels carry a disambiguating qualifier where the data has one', () => {
  const byslug = new Map(INDEX.products.map((p) => [p.slug, p.label]))
  assert.equal(byslug.get('roland-tr-808'), 'Roland TR-808 (Rhythm Composer)')
  assert.equal(byslug.get('yamaha-dx7'), 'Yamaha DX7 (1983)')
  assert.ok((byslug.get('rhodes-mark-i-suitcase-73') ?? '').startsWith('Rhodes Mark I Suitcase 73'))
  // Nothing is invented: a product whose row carries no era and no year gets a
  // bare label rather than a plausible-looking fabricated one.
  assert.equal(byslug.get('korg-ms-20'), 'Korg MS-20')
})

test('index: alias keys are normalised, de-duplicated and sorted', () => {
  for (const p of INDEX.products) {
    assert.deepEqual(p.aliasKeys, [...new Set(p.aliasKeys)], `${p.slug} has duplicate alias keys`)
    assert.deepEqual(p.aliasKeys, [...p.aliasKeys].sort(), `${p.slug} alias keys must be sorted`)
    for (const key of p.aliasKeys) {
      assert.equal(key, modelKey(key), `${p.slug}: "${key}" is not a normalised model key`)
    }
  }
})

test('index: no alias key is shared by two products', () => {
  // A shared key would make one product unreachable, or make navigation
  // arbitrary. Sharing must surface as disambiguation by design, not by
  // accident, so the generator must not emit a colliding key.
  const owners = new Map<string, string[]>()
  for (const p of INDEX.products) {
    for (const key of p.aliasKeys) {
      owners.set(key, [...(owners.get(key) ?? []), p.slug])
    }
  }
  const collisions = [...owners.entries()].filter(([, slugs]) => slugs.length > 1)
  assert.deepEqual(collisions, [], 'alias-key collisions between canonical products')
})

/* ------------------------------------------------------------------ *
 * 4. Canonical results — every product in the cohort resolves
 * ------------------------------------------------------------------ */

test('every PUBLIC product resolves from its slug', () => {
  for (const p of INDEX.products.filter((e) => PUBLIC_COHORT.has(e.slug))) {
    const outcome = resolvePublic(p.slug.replace(/-/g, ' '))
    assert.equal(outcome.navigateTo, `/product/${p.slug}`, `${p.slug} must resolve to its own page`)
    assert.equal(outcome.autoNavigated, true)
    assert.ok(['canonical_exact', 'accepted_alias'].includes(outcome.outcome))
  }
})

test('every PUBLIC product resolves from its brand + model name', () => {
  for (const p of INDEX.products.filter((e) => PUBLIC_COHORT.has(e.slug))) {
    // The label without its parenthetical qualifier is the brand+model form.
    const term = p.label.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
    const outcome = resolvePublic(term)
    assert.equal(
      outcome.navigateTo,
      `/product/${p.slug}`,
      `"${term}" must resolve to /product/${p.slug}`,
    )
  }
})

test('acceptance 1: juno106 / juno-106 / juno 106 / JUNO 106 all reach Juno-106', () => {
  for (const variant of ['juno106', 'juno-106', 'juno 106', 'JUNO 106', 'Roland Juno-106']) {
    const outcome = resolvePublic(variant)
    assert.equal(outcome.navigateTo, '/product/roland-juno-106', `${variant}`)
    assert.equal(outcome.autoNavigated, true)
  }
})

test('accepted alias: a reviewed synonym navigates and is reported as an alias', () => {
  // `space echo` is itself a dangerous term and is refused earlier, so the
  // synonym is exercised through its other key.
  const outcome = resolvePublic('re201')
  assert.equal(outcome.navigateTo, '/product/roland-re-201')
  assert.equal(outcome.outcome, 'accepted_alias')
  assert.equal(outcome.viaSynonym, true)
})

test('accepted alias: the parenthetical qualifier is itself a navigation term', () => {
  const outcome = resolvePublic('roland rhythm composer')
  assert.equal(outcome.navigateTo, '/product/roland-tr-808')
})

/* ------------------------------------------------------------------ *
 * 5. Dangerous terms — G1
 * ------------------------------------------------------------------ */

test('acceptance 2 / G1: NO dangerous term ever auto-navigates', () => {
  const offenders: string[] = []
  DANGEROUS_TERM_KEYS.forEach((term) => {
    const outcome = resolvePublic(term)
    if (outcome.autoNavigated || outcome.navigateTo !== null) {
      offenders.push(`${term} -> ${outcome.navigateTo}`)
    }
  })
  assert.deepEqual(offenders, [], 'G1 must read exactly 0: a dangerous term auto-navigated')
})

test('G1: the spaced and hyphenated forms of a dangerous term are also blocked', () => {
  for (const term of ['TR 808', 'tr-808']) {
    // These are NOT dangerous — the model prefix disambiguates them.
    assert.equal(resolvePublic(term).navigateTo, '/product/roland-tr-808')
  }
  for (const term of ['808', ' 808 ', 'Juno', 'JUNO', 'Rhodes', 'Model D', 'model-d', '1176']) {
    const outcome = resolvePublic(term)
    assert.equal(outcome.autoNavigated, false, `"${term}" must not auto-navigate`)
    assert.equal(outcome.resolution, 'dangerous_alias_blocked', `"${term}"`)
  }
})

test('acceptance 3: "rhodes" disambiguates across every Rhodes identity Klup follows', () => {
  const outcome = resolvePublic('rhodes')
  assert.equal(outcome.outcome, 'dangerous_alias_blocked')
  assert.equal(outcome.navigateTo, null)
  const slugs = outcome.candidates.map((c) => c.slug).sort()
  assert.deepEqual(slugs, [
    'rhodes-mark-i-stage-73',
    'rhodes-mark-i-suitcase-73',
    'rhodes-mark-ii-stage-73',
  ])
  // Each candidate is labelled well enough to choose between them.
  for (const c of outcome.candidates) {
    assert.ok(c.label.length > 'Rhodes'.length, `"${c.label}" must carry its qualifier`)
  }
})

test('a dangerous term is dangerous only as the WHOLE query', () => {
  // `rhodes` blocks; `rhodes mark i suitcase 73` is a real identity.
  assert.equal(resolvePublic('rhodes').autoNavigated, false)
  assert.equal(
    resolvePublic('rhodes mark i suitcase 73').navigateTo,
    '/product/rhodes-mark-i-suitcase-73',
  )
  assert.equal(resolvePublic('minimoog').autoNavigated, false)
  assert.equal(resolvePublic('moog minimoog').navigateTo, '/product/moog-minimoog')
})

test('a synonym can never smuggle a blocked term into a navigation', () => {
  // `space echo` is both a synonym key and a dangerous term. Dangerous wins,
  // because the dangerous check runs before the synonym rewrite.
  const outcome = resolvePublic('space echo')
  assert.equal(outcome.autoNavigated, false)
  assert.equal(outcome.resolution, 'dangerous_alias_blocked')
  assert.ok(outcome.candidates.some((c) => c.slug === 'roland-re-201'))
})

/* ------------------------------------------------------------------ *
 * 6. Shadow brands — acceptance 6
 * ------------------------------------------------------------------ */

test('acceptance 6: "squier strat" never resolves to a Fender page', () => {
  for (const term of ['squier strat', 'Squier Stratocaster', 'squier', 'epiphone les paul']) {
    const outcome = resolvePublic(term)
    assert.equal(outcome.autoNavigated, false, `"${term}" must not navigate`)
    assert.equal(outcome.navigateTo, null)
    // ...and must not even be offered the shadowed brand as a suggestion.
    const offered = [...outcome.candidates, ...outcome.suggestions].map((c) => c.slug)
    assert.deepEqual(offered, [], `"${term}" must not offer a shadowed-brand result`)
  }
})

test('shadow brands cover the KG collision set the matcher already rejects', () => {
  for (const brand of ['squier', 'epiphone', 'tokai', 'greco', 'burny']) {
    assert.ok(SHADOW_BRAND_KEYS.has(modelKey(brand)), `${brand} must be shadowed`)
  }
})

/* ------------------------------------------------------------------ *
 * 7. Ambiguity, unsupported demand and no-result
 * ------------------------------------------------------------------ */

test('ambiguous input lists the candidates and never picks one', () => {
  // A shared prefix across two Roland identities.
  const outcome = resolvePublic('roland tr')
  assert.equal(outcome.outcome, 'disambiguation')
  assert.equal(outcome.navigateTo, null)
  assert.equal(outcome.autoNavigated, false)
  assert.equal(outcome.resolutionClass, 'ambiguous')
  assert.ok(outcome.candidates.length > 1, 'a disambiguation must offer more than one candidate')
})

test('a disambiguation set actually disambiguates — it is not "every product of that brand"', () => {
  // Regression. Substring token scoring made "roland tr" list all seven Roland
  // products, because `roland` is a substring of every roland* alias. A set
  // that wide tells the visitor nothing.
  const tr = resolvePublic('roland tr')
  assert.deepEqual(tr.candidates.map((c) => c.slug).sort(), ['roland-tr-808', 'roland-tr-909'])

  const juno = resolvePublic('roland juno')
  assert.deepEqual(juno.candidates.map((c) => c.slug).sort(), ['roland-juno-106', 'roland-juno-60'])
})

test('a qualifier token never drags in an unrelated product', () => {
  // Regression. `mini` from "MS-20 Mini" substring-matched `minimoog`, so a
  // Korg query offered a Moog. A token is evidence when it names an identity,
  // not when it is a prefix of one.
  const outcome = resolvePublic('ms-20 mini')
  assert.equal(outcome.autoNavigated, false, 'MS-20 Mini is a dangerous qualified form')
  assert.deepEqual(outcome.candidates.map((c) => c.slug), ['korg-ms-20'])
  assert.equal(
    outcome.candidates.some((c) => c.slug === 'moog-minimoog'),
    false,
    'a Moog must never be offered for a Korg query',
  )
})

test('a brand-only match is a suggestion, never a disambiguation', () => {
  // Regression. "roland tr-707" — a real product Klup keeps private — matched
  // all seven Roland entries on brand alone and was presented as
  // "Hvilken mener du?". The honest answer is "not followed, here is the
  // nearest", so a disambiguation now requires model-level evidence.
  const outcome = resolvePublic('roland tr-707')
  assert.notEqual(outcome.outcome, 'disambiguation')
  assert.equal(outcome.resolution, 'unsupported')
  assert.deepEqual(outcome.candidates, [])
  assert.ok(outcome.suggestions.length <= 4, 'the nearest set stays small')
  assert.equal(
    outcome.suggestions.some((s) => s.slug === 'roland-tr-707'),
    false,
    'a private product may never be offered',
  )
})

test('brand affinity is weak enough to suggest but never to disambiguate alone', () => {
  // "Yamaha CS-80" must reach the Yamaha Klup does follow...
  const cs80 = resolvePublic('yamaha cs-80')
  assert.deepEqual(cs80.suggestions.map((s) => s.slug), ['yamaha-dx7'])
  assert.equal(cs80.candidates.length, 0, 'a brand hit alone is not a disambiguation')
  // ...and an unknown generation of a known product suggests the base product.
  const mk2 = resolvePublic('roland juno-106 mk2')
  assert.equal(mk2.outcome, 'unsupported')
  assert.deepEqual(mk2.suggestions.map((s) => s.slug), ['roland-juno-106'])
})

test('acceptance 5: an unsupported product is honest, offers the nearest, and is measurable', () => {
  const outcome = resolvePublic('yamaha cs-80')
  assert.equal(outcome.navigateTo, null)
  assert.equal(outcome.autoNavigated, false)
  assert.equal(outcome.resolution, 'unsupported')
  assert.equal(outcome.outcome, 'unsupported')
  assert.equal(outcome.resolutionClass, 'unsupported')
  // The nearest thing Klup does follow is the other Yamaha.
  assert.ok(outcome.suggestions.some((s) => s.slug === 'yamaha-dx7'))
  // The payload the demand events need is present and contract-normalised.
  assert.equal(outcome.queryNorm, 'yamaha cs-80')
  assert.equal(outcome.rawTokenCount, 2)
})

test('no-result is distinguished from unsupported-with-suggestions', () => {
  const outcome = resolvePublic('zzzz nothing like this exists')
  assert.equal(outcome.outcome, 'no_result')
  assert.equal(outcome.resolution, 'unsupported')
  assert.equal(outcome.resolutionClass, 'zero_results_supported')
  assert.deepEqual(outcome.suggestions, [])
  assert.deepEqual(outcome.candidates, [])
  assert.equal(outcome.navigateTo, null)
})

test('an empty query is a no-result, never an error and never a listing list', () => {
  for (const q of ['', '   ', '***']) {
    const outcome = resolvePublic(q)
    assert.equal(outcome.outcome, 'no_result')
    assert.equal(outcome.navigateTo, null)
  }
})

test('every outcome carries exactly one resolution from the contract vocabulary', () => {
  const allowed = new Set([
    'canonical_exact',
    'accepted_alias',
    'disambiguation',
    'dangerous_alias_blocked',
    'unsupported',
  ])
  const probes = ['juno-106', 're201', 'rhodes', 'roland tr', 'yamaha cs-80', 'zzzz', 'squier strat']
  for (const q of probes) {
    const outcome = resolvePublic(q)
    assert.ok(allowed.has(outcome.resolution), `${q} produced "${outcome.resolution}"`)
    // Navigation and candidate-listing are mutually exclusive.
    if (outcome.navigateTo) assert.deepEqual(outcome.candidates, [], `${q}`)
  }
})

/* ------------------------------------------------------------------ *
 * 8. Families — inclusion and exclusion
 * ------------------------------------------------------------------ */

/** A fixture family, so the mechanism is testable before WP-2 lands. */
const FAMILY_FIXTURE: SearchIndex = {
  generatedFrom: 'fixture',
  products: INDEX.products,
  families: [
    {
      kind: 'family',
      slug: 'gibson-les-paul',
      label: 'Gibson Les Paul',
      brand: 'Gibson',
      aliasKeys: ['gibsonlespaul', 'lespaul'],
    },
  ],
}

test('acceptance 4: a family label navigates to /family, not /product', () => {
  const outcome = resolvePublic('les paul', FAMILY_FIXTURE, PUBLIC_COHORT, new Set(['gibson-les-paul']))
  assert.equal(outcome.navigateTo, '/family/gibson-les-paul')
  assert.equal(outcome.outcome, 'accepted_alias')
  assert.equal(outcome.autoNavigated, true)
})

test('family INCLUSION: a family in the config resolves and is offered', () => {
  const included = resolvePublic('les paul', FAMILY_FIXTURE, PUBLIC_COHORT, new Set(['gibson-les-paul']))
  assert.equal(included.navigateTo, '/family/gibson-les-paul')
  assert.equal(included.navigateKind, 'family')
  assert.equal(included.navigateSlug, 'gibson-les-paul')
})

test('family EXCLUSION: a family absent from the config never navigates', () => {
  // Fixture-driven on both sides. The previous version asserted that
  // NAVIGATION_FAMILIES was empty, which encoded the pre-WP-2 state as a
  // requirement and would have failed the moment WP-2 filled it in.
  const noFamilies: SearchIndex = { ...FAMILY_FIXTURE, families: [] }
  const excluded = resolvePublic('les paul', noFamilies, PUBLIC_COHORT, new Set())
  assert.equal(excluded.navigateTo, null, 'an unconfigured family must not be navigated to')
  assert.equal(excluded.navigateKind, null)
  assert.deepEqual(excluded.candidates, [])
})

test('family EXCLUSION: a configured family the gate refuses is dropped', () => {
  // Present in the index, absent from the eligible set — e.g. WP-2 removed the
  // entry, or the family route is not deployed yet.
  const settled = resolvePublic('les paul', FAMILY_FIXTURE, PUBLIC_COHORT, new Set())
  assert.equal(settled.navigateTo, null)
  assert.equal(settled.autoNavigated, false)
  assert.equal(settled.navigateKind, null)
})

test('family analytics: a family hit is an accepted_alias with a null product', () => {
  const outcome = resolvePublic('les paul', FAMILY_FIXTURE, PUBLIC_COHORT, new Set(['gibson-les-paul']))
  assert.equal(outcome.resolution, 'accepted_alias')
  // What `search_resolved` will carry. A family is not a priced identity, so
  // `product_slug` stays null and the family is named by its own property.
  const productSlug = outcome.navigateKind === 'product' ? outcome.navigateSlug : null
  const familySlug = outcome.navigateKind === 'family' ? outcome.navigateSlug : null
  assert.equal(productSlug, null, 'product_slug must be null for a family hit')
  assert.equal(familySlug, 'gibson-les-paul')

  // ...and the converse, so the two can never be conflated.
  const product = resolvePublic('juno-106')
  assert.equal(product.navigateKind, 'product')
  assert.equal(product.navigateSlug, 'roland-juno-106')
})

test('families never aggregate: a family candidate carries no price, listing or count', () => {
  const outcome = resolvePublic('les paul', FAMILY_FIXTURE, PUBLIC_COHORT, new Set(['gibson-les-paul']))
  const keys = Object.keys(
    outcome.candidates[0] ?? { kind: 1, slug: 1, label: 1, brand: 1, href: 1 },
  )
  for (const forbidden of ['price', 'listings', 'count', 'band']) {
    assert.equal(keys.some((k) => k.toLowerCase().includes(forbidden)), false)
  }
})

/* ------------------------------------------------------------------ *
 * 8b. Family-originated demand capture — ?demand=family:<slug>
 * ------------------------------------------------------------------ */

const PAGE_SRC = readSource('app', 'search', 'page.tsx')

test('demand mode: the family parameter is parsed and honoured', () => {
  assert.ok(PAGE_SRC.includes("DEMAND_FAMILY_PREFIX = 'family:'"), 'the prefix must be explicit')
  assert.ok(PAGE_SRC.includes("params.get('demand')"), 'the parameter must be read')
  assert.ok(
    PAGE_SRC.includes('demandParam.startsWith(DEMAND_FAMILY_PREFIX)'),
    'only the family: form may be honoured',
  )
})

test('demand mode: NEVER navigates back to the originating family', () => {
  // The whole failure mode: resolving "Gibson Les Paul" would 302 straight back
  // to /family/gibson-les-paul and bounce the visitor between two pages.
  const builder = PAGE_SRC.slice(
    PAGE_SRC.indexOf('function familyDemandOutcome'),
    PAGE_SRC.indexOf('function useEmit'),
  )
  assert.ok(builder.includes('navigateTo: null'), 'the demand outcome must not navigate')
  assert.ok(builder.includes('navigateKind: null'))
  assert.ok(builder.includes('autoNavigated: false'))
  assert.equal(builder.includes('router.push'), false, 'the demand path must not route')

  // ...and it must short-circuit before the resolver is ever called.
  const mount = PAGE_SRC.slice(
    PAGE_SRC.indexOf('if (demandFamilySlug.length > 0)'),
    PAGE_SRC.indexOf('function handleSubmit'),
  )
  assert.ok(mount.includes('return'), 'demand mode must return before runSearch')
  assert.ok(
    mount.indexOf('return') < mount.indexOf('runSearch'),
    'runSearch must not run in demand mode',
  )
})

test('demand mode: both events go through the useEmit() boundary', () => {
  // SUPERSEDED AT INTEGRATION, in the stricter direction.
  //
  // Before WP-5 landed this asserted "exactly one `posthog?.capture(` call,
  // and it is inside useEmit()" — one permitted direct use of the SDK. The
  // seam now hands over WP-5's `track` itself, so the correct assertion is
  // ZERO direct SDK access from this page, and exactly one reference to the
  // analytics entry point, in the seam. Anything reaching PostHog by another
  // route would bypass the consent gate that owns it.
  assert.equal(PAGE_SRC.includes('posthog'), false, 'the page must not touch the SDK at all')
  assert.equal(PAGE_SRC.includes('usePostHog'), false, 'the SDK hook must be gone')

  const trackRefs = PAGE_SRC.match(/\btrack\b/g) ?? []
  assert.equal(trackRefs.length, 2, 'track appears exactly twice: the import and the seam')
  assert.ok(
    PAGE_SRC.includes("import { track } from '@/lib/analytics'"),
    'the seam must consume WP-5 analytics directly',
  )
  assert.ok(
    PAGE_SRC.indexOf('return track') > PAGE_SRC.indexOf('function useEmit'),
    'the only analytics reference must live in the seam',
  )

  const mount = PAGE_SRC.slice(
    PAGE_SRC.indexOf('if (demandFamilySlug.length > 0)'),
    PAGE_SRC.indexOf('function handleSubmit'),
  )
  assert.ok(mount.includes("emit('search_unsupported'"), 'demand mode must record the miss')
  assert.ok(
    mount.includes('searchUnsupportedPayload(built)'),
    'demand mode must use the typed payload builder, not a hand-rolled object',
  )

  assert.ok(
    PAGE_SRC.includes("emit('demand_signal_submitted', demandSignalPayload("),
    'the notify control must emit the typed payload through the seam',
  )
})

test('demand mode: the submitted/thanks state is rendered', () => {
  assert.ok(PAGE_SRC.includes('setSent(true)'), 'submission must move to the sent state')
  assert.ok(PAGE_SRC.includes('{t.demandThanks}'), 'the thanks state must render')
  assert.ok(PAGE_SRC.includes('{t.demandCta}'), 'the control itself must render')
  // The panel is what demand mode shows, so the unsupported branch must accept
  // an outcome with no suggestions at all.
  assert.ok(PAGE_SRC.includes('outcome.suggestions.length > 0 &&'), 'suggestions are optional')
})

test('demand mode: the field is pre-filled with the family term', () => {
  // SUPERSEDED AT INTEGRATION — the behaviour is unchanged, the source of the
  // label moved. This asserted `getFamily(demandFamilySlug)?.label`, i.e. the
  // client reading `lib/families.ts`. Once WP-2 filled that module with the
  // families' `children` arrays, importing it from a client component shipped
  // ten qa_only product slugs to every anonymous visitor of /search. The label
  // now comes from `lib/family-labels.ts`, which holds no private data.
  assert.ok(
    PAGE_SRC.includes('familyLabel(demandFamilySlug)'),
    'the family label should seed the input so the visitor can refine it',
  )
  assert.ok(
    PAGE_SRC.includes("import { familyLabel } from '@/lib/family-labels'"),
    'the label must come from the client-safe module',
  )
  assert.equal(
    /from '@\/lib\/families'/.test(PAGE_SRC),
    false,
    'a client component must not import the module holding private child slugs',
  )
})

test('demand mode: an unknown family slug still captures demand safely', () => {
  const builder = PAGE_SRC.slice(
    PAGE_SRC.indexOf('function familyDemandOutcome'),
    PAGE_SRC.indexOf('function useEmit'),
  )
  assert.ok(builder.includes('?? familySlug.replace'), 'a fabricated slug must not break the page')
})

/* ------------------------------------------------------------------ *
 * 9. Eligibility — no result may ever link to a 404
 * ------------------------------------------------------------------ */

const okRows = (slugs: string[]) => ({
  data: slugs.map((slug) => ({
    slug,
    status: 'active',
    support_state: 'supported',
    browse_visibility: 'public',
  })),
  error: null,
})
const okDomains = (slugs: string[]) => ({
  data: slugs.map((slug) => ({ slug, browse_domain: 'music' })),
  error: null,
})

test('eligibility: the full four axes are required', async () => {
  const wanted = ['a', 'b', 'c', 'd']
  const eligible = await filterEligibleSlugs(
    {
      canonicalRows: async () => ({
        data: [
          { slug: 'a', status: 'active', support_state: 'supported', browse_visibility: 'public' },
          { slug: 'b', status: 'inactive', support_state: 'supported', browse_visibility: 'public' },
          { slug: 'c', status: 'active', support_state: 'known', browse_visibility: 'public' },
          { slug: 'd', status: 'active', support_state: 'supported', browse_visibility: 'qa_only' },
        ],
        error: null,
      }),
      domainRows: async () => okDomains(wanted),
    },
    wanted,
  )
  assert.deepEqual([...eligible], ['a'], 'only the fully canonical row survives')
})

test('eligibility: the music axis is enforced, not assumed', async () => {
  const eligible = await filterEligibleSlugs(
    {
      canonicalRows: async () => okRows(['a', 'b']),
      domainRows: async () => ({
        data: [
          { slug: 'a', browse_domain: 'music' },
          { slug: 'b', browse_domain: 'furniture' },
        ],
        error: null,
      }),
    },
    ['a', 'b'],
  )
  assert.deepEqual([...eligible], ['a'])
})

test('eligibility: a missing projection row fails closed', async () => {
  const eligible = await filterEligibleSlugs(
    { canonicalRows: async () => okRows(['a']), domainRows: async () => ({ data: [], error: null }) },
    ['a'],
  )
  assert.deepEqual([...eligible], [], 'no domain evidence means not eligible')
})

test('eligibility: unavailability raises rather than quietly thinning the catalogue', async () => {
  await assert.rejects(
    () =>
      filterEligibleSlugs(
        { canonicalRows: async () => ({ data: null, error: { message: 'boom' } }), domainRows: async () => okDomains([]) },
        ['a'],
      ),
    /Catalogue eligibility could not be established/,
  )
  await assert.rejects(
    () =>
      filterEligibleSlugs(
        {
          canonicalRows: async () => okRows(['a']),
          domainRows: async () => {
            throw new Error('transport')
          },
        },
        ['a'],
      ),
    /Catalogue eligibility could not be established/,
  )
})

test('a withdrawn navigation target degrades instead of linking to a 404', () => {
  const resolved = resolvePublic('juno-106')
  assert.equal(resolved.navigateTo, '/product/roland-juno-106')
  // The product was depublished between the build and this request.
  const settled = applyEligibility(resolved, new Set(), new Set())
  assert.equal(settled.navigateTo, null)
  assert.equal(settled.autoNavigated, false)
  assert.equal(settled.outcome, 'no_result')
})

test('ineligible candidates are stripped from a disambiguation set', () => {
  const resolved = resolvePublic('rhodes')
  assert.ok(resolved.candidates.length >= 2)
  const keepOne = new Set(['rhodes-mark-i-stage-73'])
  const settled = applyEligibility(resolved, keepOne, new Set())
  assert.deepEqual(settled.candidates.map((c) => c.slug), ['rhodes-mark-i-stage-73'])
})

test('ineligible suggestions are stripped, and an empty set becomes no-result', () => {
  const resolved = resolvePublic('yamaha cs-80')
  assert.ok(resolved.suggestions.length > 0)
  const settled = applyEligibility(resolved, new Set(), new Set())
  assert.deepEqual(settled.suggestions, [])
  assert.equal(settled.outcome, 'no_result')
  assert.equal(settled.resolutionClass, 'zero_results_supported')
})

test('every href a result can produce points at /product or /family only', () => {
  const probes = ['juno-106', 'rhodes', 'roland tr', 'yamaha cs-80', 're201', 'les paul']
  for (const q of probes) {
    const outcome = resolvePublic(q, FAMILY_FIXTURE, PUBLIC_COHORT, new Set(['gibson-les-paul']))
    const targets = [
      ...outcome.candidates.map((c) => c.href),
      ...outcome.suggestions.map((c) => c.href),
      ...(outcome.navigateTo ? [outcome.navigateTo] : []),
    ]
    for (const href of targets) {
      assert.match(href, /^\/(product|family)\/[a-z0-9-]+$/, `${q} produced "${href}"`)
    }
  }
})

/* ------------------------------------------------------------------ *
 * 10. Search never scrapes and never writes
 * ------------------------------------------------------------------ */

const SEARCH_SOURCES: Array<[string, string]> = [
  ['app/search/page.tsx', readSource('app', 'search', 'page.tsx')],
  ['app/api/search/resolve/route.ts', readSource('app', 'api', 'search', 'resolve', 'route.ts')],
  ['lib/search-resolver.ts', readSource('lib', 'search-resolver.ts')],
  ['lib/search-index.ts', readSource('lib', 'search-index.ts')],
  ['lib/model-key.ts', readSource('lib', 'model-key.ts')],
]

test('search invokes no marketplace scraper', () => {
  for (const [name, src] of SEARCH_SOURCES) {
    for (const forbidden of [
      'lib/scrapers',
      'scrapeDba',
      'scrapeFinn',
      'scrapeBlocket',
      'scrapeKleinanzeigen',
      'scrapeThomannSearch',
      'fetchListingFromUrl',
    ]) {
      assert.equal(src.includes(forbidden), false, `${name} must not reference ${forbidden}`)
    }
  }
})

test('search does not call /api/scrape', () => {
  for (const [name, src] of SEARCH_SOURCES) {
    assert.equal(src.includes('/api/scrape'), false, `${name} must not call /api/scrape`)
  }
})

test('/api/scrape has no caller left anywhere in the application', () => {
  // Build plan D8: admin curation calls /api/admin/product/[slug]/scrape-*,
  // and /search was the only other caller.
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        if (full.includes(join('lib', 'scrapers'))) continue
        const src = readFileSync(full, 'utf8')
        if (/fetch\(\s*[`'"]\/api\/scrape/.test(src)) offenders.push(full)
      }
    }
  }
  walk(FRONTEND)
  assert.deepEqual(offenders, [], '/api/scrape still has a caller')
})

test('search writes nothing — no insert, update, upsert or delete', () => {
  for (const [name, src] of SEARCH_SOURCES) {
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.equal(src.includes(write), false, `${name} must not perform ${write}`)
    }
  }
})

test('the resolver route reads only, and only from catalogue sources', () => {
  const src = readCode('app', 'api', 'search', 'resolve', 'route.ts')
  const tables = [...src.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]).sort()
  assert.deepEqual(
    [...new Set(tables)],
    ['browse_product_projection', 'kg_product'],
    'the resolver may read the catalogue and nothing else',
  )
})

test('the demand control never sends an email address to analytics', () => {
  const src = readSource('app', 'search', 'page.tsx')
  // The payload is built by `demandSignalPayload`, so the property set is
  // fixed by its return type; this asserts the page never adds one.
  assert.ok(
    src.includes("emit('demand_signal_submitted', demandSignalPayload(outcome, address))"),
    'the demand event must be the builder output, unmodified',
  )
  const built = demandSignalPayload(FIXTURE_UNSUPPORTED, 'someone@example.com')
  assert.equal(
    Object.values(built).some((v) => typeof v === 'string' && v.includes('@')),
    false,
    'no property may carry an address',
  )
})

/* ------------------------------------------------------------------ *
 * 11. Route posture
 * ------------------------------------------------------------------ */

test('acceptance 7: /api/scrape is DELETED, not merely gated', () => {
  // Retaining it behind generic authenticated access would have left any
  // signed-in visitor able to drive scraper and database load with free text.
  // It had zero functional callers once /search became a resolver.
  assert.equal(
    existsSync(join(FRONTEND, 'app', 'api', 'scrape')),
    false,
    'app/api/scrape must not exist',
  )
  assert.equal(classifyPath('/api/scrape'), null, 'a deleted route must classify as null')
  assert.equal(requiresAuth('/api/scrape'), false, 'a nonexistent path passes through to a 404')
  assert.equal(
    ROUTE_ACCESS.some((r) => r.route === '/api/scrape'),
    false,
    'the classification must be removed, or the WP-1 planned-route guard fails',
  )
})

test('/api/scrape is removed from the security reference too', () => {
  const ref = JSON.parse(readCode('lib', 'route-posture-reference.json'))
  assert.equal('/api/scrape' in ref.expected, false, 'a deleted route must not stay pinned')
})

test('no ANONYMOUSLY REACHABLE route can invoke a marketplace scraper', () => {
  // This is the property WP-4 actually delivers: deleting /api/scrape removed
  // the last public scraper entry point.
  //
  // `/api/watchlists` still imports `scrapeDba` — creating a watchlist seeds it
  // — but it is `protected_api`, so a scrape needs a session, and that route is
  // not WP-4's to change. Scoping this assertion to the anonymous surface makes
  // it say what is true rather than what would be convenient.
  const sep = require('node:path').sep
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      if (entry.isDirectory()) { walk(full); continue }
      if (entry.name !== 'route.ts') continue
      const src = readFileSync(full, 'utf8')
      if (!src.includes("@/lib/scrapers/")) continue

      const rel = full.slice(join(FRONTEND, 'app').length + 1)
      const route = '/' + rel.split(sep).slice(0, -1).join('/')
      const rule = ROUTE_ACCESS.find((r) => r.route === route)
      if (rule?.access === 'machine_api') continue // own credential, in-route
      if (!rule || !isAuthenticatedClass(rule.access)) offenders.push(route)
    }
  }
  walk(join(FRONTEND, 'app'))
  assert.deepEqual(offenders, [], 'an anonymously reachable route imports a marketplace scraper')
})

test('the resolver route is classified, public and documented as data-gated', () => {
  const rule = ROUTE_ACCESS.find((r) => r.route === '/api/search/resolve')
  assert.ok(rule, 'a new route must be classified or the WP-1 completeness guard fails')
  assert.equal(rule!.access, 'public_api_data_gated')
  assert.equal(requiresAuth('/api/search/resolve'), false)
  assert.ok(rule!.note && rule!.note.length > 0, 'a data-gated route must document its gate')
})

test('/search itself stays anonymously reachable', () => {
  assert.equal(requiresAuth('/search'), false)
  assert.equal(classifyPath('/search')?.access, 'public_page')
})

test('the middleware rate limiter is untouched', () => {
  // WP-4's forbidden list names `middleware.ts:10-36` explicitly, so the
  // limiter stays exactly as it is. It now guards a path that no longer
  // resolves, which is inert: removing it is a separate, owned decision.
  const src = readCode('middleware.ts')
  assert.ok(src.includes('SCRAPE_RATE_MAX'), 'the per-IP limiter must remain')
  assert.ok(src.includes("request.nextUrl.pathname === '/api/scrape'"))
})

test('the admin scrape workflow is preserved exactly', () => {
  // WP-4 must not touch admin curation. These routes keep their own in-route
  // admin check and their edge classification.
  for (const route of [
    '/api/admin/product/[slug]/scrape-platform',
    '/api/admin/product/[slug]/scrape-kleinanzeigen',
  ]) {
    const rule = ROUTE_ACCESS.find((r) => r.route === route)
    assert.ok(rule, `${route} must stay classified`)
    assert.equal(rule!.access, 'admin_api')
    assert.equal(requiresAuth(route.replace('[slug]', 'x')), true)
  }
  for (const file of ['scrape-platform', 'scrape-kleinanzeigen']) {
    const src = readCode('app', 'api', 'admin', 'product', '[slug]', file, 'route.ts')
    assert.ok(
      /requireAdminInRoute|getCurrentAdminState|isCurrentUserAdmin/.test(src),
      `${file} must keep its in-route admin check`,
    )
  }
  // The admin curation client still drives them.
  const client = readCode('app', 'admin', 'product', '[slug]', 'ProductCurationClient.tsx')
  assert.ok(client.includes('scrape-platform'), 'admin curation must still call scrape-platform')
})

/* ------------------------------------------------------------------ *
 * 12. The generic SERP is gone
 * ------------------------------------------------------------------ */

test('acceptance 9: no listing grid, source chips or sort control remain on /search', () => {
  const src = readSource('app', 'search', 'page.tsx')
  const removed: Array<[string, string]> = [
    ['SearchResultCard', 'the listing card'],
    ['ALL_SOURCES', 'the source toggle chips'],
    ['SourceKey', 'the source toggle chips'],
    ['SortKey', 'the sort control'],
    ['sortListings', 'the sort control'],
    ['md:grid-cols-4', 'the desktop listing grid'],
    ['platformList', 'the "we search N platforms" subtext'],
    ['CreateWatchlistModal', 'the free-text watchlist button'],
    ['createWatchlist', 'the free-text watchlist button'],
    ['ListingErrorBoundary', 'listing rendering'],
    ['{platforms}', 'the multi-vertical subtext'],
  ]
  for (const [token, what] of removed) {
    assert.equal(src.includes(token), false, `${what} must be gone from /search (found "${token}")`)
  }
})

test('/search renders no listing type at all', () => {
  const src = readSource('app', 'search', 'page.tsx')
  assert.equal(/from '@\/lib\/supabase'/.test(src), false, 'the Listing type must not be imported')
  assert.equal(src.includes('listings'), false, 'no listing collection may be rendered')
})

test('/search uses i18n keys, never a hardcoded Danish string', () => {
  const src = readCode('app', 'search', 'page.tsx')
  // Danish-specific characters outside a comment would mean inline copy.
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const danish = withoutComments.match(/["'`][^"'`]*[æøåÆØÅ][^"'`]*["'`]/g) ?? []
  assert.deepEqual(danish, [], 'user-facing copy must come from lib/i18n.ts')
})

/* ------------------------------------------------------------------ *
 * 13. Mobile and keyboard behaviour
 * ------------------------------------------------------------------ */

test('mobile: the search field cannot trigger an iOS zoom, and targets are tappable', () => {
  const src = readCode('app', 'search', 'page.tsx')
  assert.ok(src.includes('text-base'), 'the input must be >=16px or iOS Safari zooms on focus')
  assert.ok(src.includes('min-h-[44px]'), 'primary controls need a 44px touch target')
  assert.ok(src.includes('min-h-[56px]'), 'candidate rows need a comfortable touch target')
  assert.ok(src.includes('enterKeyHint="search"'), 'the soft keyboard must offer a search action')
  assert.ok(src.includes('<BottomNav'), 'mobile navigation must remain on the page')
  assert.ok(src.includes('pb-24'), 'content must clear the fixed bottom navigation')
})

test('keyboard: the candidate set is fully operable without a pointer', () => {
  const src = readCode('app', 'search', 'page.tsx')
  for (const token of [
    "role=\"combobox\"",
    'aria-expanded',
    'aria-controls',
    'aria-activedescendant',
    "role=\"listbox\"",
    "role=\"option\"",
    'aria-selected',
    "e.key === 'ArrowDown'",
    "e.key === 'ArrowUp'",
    "e.key === 'Enter'",
    "e.key === 'Escape'",
  ]) {
    assert.ok(src.includes(token), `keyboard/ARIA affordance missing: ${token}`)
  }
  assert.ok(src.includes('aria-live="polite"'), 'outcome changes must be announced')
  assert.ok(src.includes('className="sr-only"'), 'the field needs an accessible label')
})

test('decorative icons are hidden from assistive technology', () => {
  const src = readCode('app', 'search', 'page.tsx')
  const icons = src.match(/material-symbols-outlined/g) ?? []
  const hidden = src.match(/aria-hidden="true"/g) ?? []
  assert.ok(hidden.length >= icons.length, 'every ligature icon must be aria-hidden')
})

/* ------------------------------------------------------------------ *
 * 14. Index drift — the CI check (§8.4)
 * ------------------------------------------------------------------ */

test('drift: the artefact family section equals the reviewed family config', () => {
  const raw = JSON.parse(readCode('data', 'klup-search-index.json')) as SearchIndex
  assert.deepEqual(
    raw.families.map((f) => f.slug),
    NAVIGATION_FAMILIES.map((f) => f.slug),
    'regenerate the index after changing lib/families.ts',
  )
})

/**
 * Whether live verification is REQUIRED of this run.
 *
 * Exported shape rather than an inline env read so the policy itself can be
 * tested: the dangerous case is a CI run that silently degrades to a skip and
 * reports green, which is exactly what the previous version did.
 */
export type LiveVerification = 'run' | 'fail_missing_credentials' | 'declared_boundary'

export function liveVerificationDecision(env: NodeJS.ProcessEnv): LiveVerification {
  const hasCredentials = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  const required = env.KLUP_REQUIRE_LIVE_VERIFICATION === '1' || env.CI === 'true'
  if (hasCredentials) return 'run'
  return required ? 'fail_missing_credentials' : 'declared_boundary'
}

test('drift policy: CI or a release validation cannot degrade into a skip', () => {
  const base = { NEXT_PUBLIC_SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' }
  assert.equal(liveVerificationDecision(base as NodeJS.ProcessEnv), 'run')
  assert.equal(
    liveVerificationDecision({ ...base, CI: 'true' } as NodeJS.ProcessEnv),
    'run',
  )
  // Declared required, credentials absent -> this must FAIL, never skip.
  assert.equal(
    liveVerificationDecision({ CI: 'true' } as NodeJS.ProcessEnv),
    'fail_missing_credentials',
  )
  assert.equal(
    liveVerificationDecision({ KLUP_REQUIRE_LIVE_VERIFICATION: '1' } as NodeJS.ProcessEnv),
    'fail_missing_credentials',
  )
  // Local, undeclared -> an explicit boundary, never a silent success.
  assert.equal(liveVerificationDecision({} as NodeJS.ProcessEnv), 'declared_boundary')
})

test('drift (deterministic): the artefact is internally consistent — always runs', () => {
  // Needs no credentials, so it can never be skipped. Everything that can be
  // checked without the database is checked here.
  const raw = JSON.parse(readCode('data', 'klup-search-index.json')) as SearchIndex
  assert.ok(raw.generatedFrom.includes('support_state=supported'), 'provenance must be recorded')
  assert.equal(
    raw.generatedFrom.includes('browse_visibility'),
    false,
    'the artefact must not be generated on a visibility filter',
  )
  assert.deepEqual(
    raw.products.map((p) => p.slug),
    [...raw.products.map((p) => p.slug)].sort(),
    'the artefact must be slug-ordered so a regeneration diff is readable',
  )
  assert.equal(
    new Set(raw.products.map((p) => p.slug)).size,
    raw.products.length,
    'no duplicate identities',
  )
  assert.ok(raw.products.length >= PUBLIC_COHORT.size, 'the index must cover at least the public set')
})

test('drift (live): the committed index equals the live supported cohort', async (t) => {
  const decision = liveVerificationDecision(process.env)

  if (decision === 'fail_missing_credentials') {
    assert.fail(
      'Live verification is REQUIRED for this run (CI=true or ' +
        'KLUP_REQUIRE_LIVE_VERIFICATION=1) but NEXT_PUBLIC_SUPABASE_URL / ' +
        'SUPABASE_SERVICE_ROLE_KEY are not set. A release must not report green ' +
        'on an index nobody compared against the catalogue.',
    )
  }

  if (decision === 'declared_boundary') {
    // Not a pass. Node reports this as skipped, and the reason names exactly
    // what was NOT verified, so a green local run cannot be mistaken for a
    // verified one.
    t.diagnostic(
      'BOUNDARY: index-vs-live drift was NOT verified — no Supabase credentials. ' +
        'Set KLUP_REQUIRE_LIVE_VERIFICATION=1 to make this a hard failure.',
    )
    t.skip('live drift unverified: no Supabase credentials (explicit boundary, not a pass)')
    return
  }

  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // ALL supported identities — the index is no longer visibility-filtered.
  const productsRes = await admin
    .from('kg_product')
    .select('slug')
    .eq('status', 'active')
    .eq('support_state', 'supported')
    .order('slug')
  assert.equal(productsRes.error, null)

  const slugs = (productsRes.data ?? []).map((r) => (r as { slug: string }).slug)
  const domainRes = await admin
    .from('browse_product_projection')
    .select('slug, browse_domain')
    .in('slug', slugs)
  assert.equal(domainRes.error, null)

  const live = (domainRes.data ?? [])
    .filter((r) => (r as { browse_domain?: string }).browse_domain === 'music')
    .map((r) => (r as { slug: string }).slug)
    .sort()

  assert.deepEqual(
    INDEXED_SLUGS,
    live,
    'the search index has drifted from the live supported cohort — run ' +
      '`npx tsx frontend/scripts/build-search-index.ts`',
  )
})

test('the index artefact and its generator are both committed', () => {
  assert.ok(existsSync(join(FRONTEND, 'data', 'klup-search-index.json')))
  assert.ok(existsSync(join(FRONTEND, 'scripts', 'build-search-index.ts')))
})

/* ------------------------------------------------------------------ *
 * 15. Outcome invariants that hold for the whole entity set
 * ------------------------------------------------------------------ */

test('no query in the catalogue vocabulary ever produces a listing-shaped result', () => {
  const entities: SearchEntity[] = allEntities(INDEX)
  for (const entity of entities) {
    for (const key of entity.aliasKeys) {
      const outcome: SearchOutcome = resolveQuery(key, INDEX)
      assert.equal(
        Object.prototype.hasOwnProperty.call(outcome, 'listings'),
        false,
        'a resolver outcome may never carry listings',
      )
      if (outcome.navigateTo) {
        assert.match(outcome.navigateTo, /^\/(product|family)\//)
      }
    }
  }
})

test('every alias key of every product resolves to that product or to a refusal', () => {
  // It may never resolve to a DIFFERENT product. That is the whole point of the
  // dangerous list: refusing is always acceptable, mis-navigating never is.
  for (const p of INDEX.products) {
    for (const key of p.aliasKeys) {
      const outcome = resolveQuery(key, INDEX)
      if (outcome.navigateTo) {
        assert.equal(
          outcome.navigateTo,
          `/product/${p.slug}`,
          `alias "${key}" of ${p.slug} navigated to ${outcome.navigateTo}`,
        )
      }
    }
  }
})

/* ------------------------------------------------------------------ *
 * 16. WP-5 analytics taxonomy conformance
 *
 * WP-5 owns `lib/analytics.ts` and is frozen. Its `KlupEventMap` declares every
 * property and every enum as a literal union, and `track()` is generic over the
 * map, so a stray property or an invented enum value is a compile error there.
 * WP-4 cannot import that file — it does not exist on this branch — so the
 * contract is enforced two ways: a VENDORED TYPE FIXTURE copied verbatim from
 * the WP-5 commit gives compile-time assignability, and a RUNTIME CHECK reads
 * the real file out of git and asserts the fixture has not drifted from it.
 *
 * No `as never`, no `as any`, no index-signature widening: every check below is
 * ordinary assignability.
 * ------------------------------------------------------------------ */

const WP5_COMMIT = 'd76a25b673574150931664e5b049ac61f5723a4c'

/* ---- the vendored fixture: verbatim from WP-5's KlupEventMap ---- */

type WP5SearchResolution =
  | 'canonical_exact'
  | 'accepted_alias'
  | 'disambiguation'
  | 'dangerous_alias_blocked'
  | 'unsupported'
  | 'error'

interface WP5SearchSubmitted {
  query_norm: string
  query_length: number
  token_count: number
  entry_surface: 'landing' | 'search' | 'mobile_bar' | 'nav'
  input_method: 'typed' | 'suggestion' | 'url_param'
}

interface WP5SearchResolved {
  query_norm: string
  resolution: WP5SearchResolution
  candidate_count: number
  product_slug: string | null
  auto_navigated: boolean
  latency_ms: number
}

interface WP5SearchUnsupported {
  query_norm: string
  resolution_class: 'unsupported' | 'ambiguous' | 'dangerous_alias_blocked' | 'zero_results_supported'
  raw_token_count: number
  suggested_slugs: string[]
  suggested_count: number
  nearest_distance: number | null
}

interface WP5DemandSignalSubmitted {
  query_norm: string
  capture_method: 'inline_email' | 'notify_button'
  has_email: boolean
  suggested_shown: number
}

/** Declared key sets, for the exact-payload assertions. */
const WP5_KEYS: Record<string, string[]> = {
  search_submitted: ['query_norm', 'query_length', 'token_count', 'entry_surface', 'input_method'],
  search_resolved: [
    'query_norm',
    'resolution',
    'candidate_count',
    'product_slug',
    'auto_navigated',
    'latency_ms',
  ],
  search_unsupported: [
    'query_norm',
    'resolution_class',
    'raw_token_count',
    'suggested_slugs',
    'suggested_count',
    'nearest_distance',
  ],
  demand_signal_submitted: ['query_norm', 'capture_method', 'has_email', 'suggested_shown'],
}

const FIXTURE_UNSUPPORTED = resolvePublic('yamaha cs-80')
const FIXTURE_RESOLVED = resolvePublic('juno-106')
const FIXTURE_BLOCKED = resolvePublic('rhodes')

/* ---- COMPILE FIXTURE: plain assignability, no casts ---- */

const _submittedTyped: WP5SearchSubmitted = searchSubmittedPayload('TR-808', 'search', 'typed')
const _submittedUrl: WP5SearchSubmitted = searchSubmittedPayload('TR-808', 'search', 'url_param')
const _resolvedTyped: WP5SearchResolved = searchResolvedPayload(FIXTURE_RESOLVED, 12)
const _unsupportedTyped: WP5SearchUnsupported | null = searchUnsupportedPayload(FIXTURE_UNSUPPORTED)
const _demandEmail: WP5DemandSignalSubmitted = demandSignalPayload(FIXTURE_UNSUPPORTED, 'a@b.dk')
const _demandAnon: WP5DemandSignalSubmitted = demandSignalPayload(FIXTURE_UNSUPPORTED, '')

test('compile fixture: every builder satisfies the WP-5 payload type', () => {
  // The four bindings above are the assertion — this body only keeps them from
  // being elided and proves they were evaluated.
  for (const value of [_submittedTyped, _submittedUrl, _resolvedTyped, _demandEmail, _demandAnon]) {
    assert.equal(typeof value.query_norm, 'string')
  }
  assert.notEqual(_unsupportedTyped, null)
})

test('the vendored fixture has not drifted from the WP-5 commit', () => {
  let source: string
  try {
    source = execFileSync('git', ['show', `${WP5_COMMIT}:frontend/lib/analytics.ts`], {
      encoding: 'utf8',
      cwd: join(__dirname, '..', '..'),
    })
  } catch {
    assert.fail(
      `Could not read ${WP5_COMMIT}:frontend/lib/analytics.ts. The taxonomy fixture ` +
        'cannot be verified against WP-5, so this run must not report green.',
    )
  }

  for (const [event, expected] of Object.entries(WP5_KEYS)) {
    const start = source.indexOf(`  ${event}: {`)
    assert.ok(start > -1, `${event} must exist in the WP-5 event map`)
    const block = source.slice(start, source.indexOf('\n  }', start))
    const declared = [...block.matchAll(/^\s{4}([a-z_]+)\??:/gm)].map((m) => m[1])
    assert.deepEqual(
      declared.sort(),
      [...expected].sort(),
      `${event}: the vendored key set no longer matches WP-5`,
    )
  }

  // The enum literals WP-4 emits must still exist in WP-5's unions.
  for (const literal of [
    "'landing' | 'search' | 'mobile_bar' | 'nav'",
    "'typed' | 'suggestion' | 'url_param'",
    "'inline_email' | 'notify_button'",
  ]) {
    assert.ok(source.includes(literal), `WP-5 no longer declares ${literal}`)
  }
})

/* ---- exact payloads, exact enums, no undeclared property ---- */

function assertExactKeys(event: string, payload: object) {
  assert.deepEqual(
    Object.keys(payload).sort(),
    [...WP5_KEYS[event]].sort(),
    `${event}: payload keys must match the taxonomy exactly — no extras, none missing`,
  )
}

test('search_submitted: exact keys, derived lengths, declared enums', () => {
  const p = searchSubmittedPayload('  TR-808  ', 'search', 'typed')
  assertExactKeys('search_submitted', p)
  // Derived from the NORMALISED query, so whitespace and case do not change it.
  assert.equal(p.query_norm, 'tr-808')
  assert.equal(p.query_length, 'tr-808'.length)
  assert.equal(p.token_count, 1)
  assert.equal(searchSubmittedPayload('roland juno 106', 'search', 'typed').token_count, 3)
  assert.ok((['landing', 'search', 'mobile_bar', 'nav'] as const).includes(p.entry_surface))
  assert.ok((['typed', 'suggestion', 'url_param'] as const).includes(p.input_method))
})

test('search_submitted: family-prefill and manual typing map differently', () => {
  const src = readSource('app', 'search', 'page.tsx')
  // An unedited family prefill came from the URL; an edited one is the
  // visitor's own. Reporting both as `typed` would inflate manual intent.
  assert.ok(src.includes("q === prefillSeed.current ? 'url_param' : 'typed'"))
  assert.ok(src.includes("void runSearch(initialQuery, 'url_param')"), '?q= arrivals are url_param')
  assert.ok(src.includes("prefillSeed.current = familyPrefill.trim()"))
})

test('search_resolved: exact keys, no via_synonym, product/family separation', () => {
  const p = searchResolvedPayload(FIXTURE_RESOLVED, 12.6)
  assertExactKeys('search_resolved', p)
  assert.equal('via_synonym' in p, false, 'via_synonym is not in the taxonomy')
  assert.equal('family_slug' in p, false, 'family_slug is not in the taxonomy')
  assert.equal(p.product_slug, 'roland-juno-106')
  assert.equal(p.latency_ms, 13, 'latency is rounded to a whole millisecond')

  // A family navigation reports NO product.
  const family = resolvePublic('les paul', FAMILY_FIXTURE, PUBLIC_COHORT, new Set(['gibson-les-paul']))
  const fp = searchResolvedPayload(family, 5)
  assert.equal(fp.resolution, 'accepted_alias')
  assert.equal(fp.product_slug, null, 'a family is never reported as a product')
})

test('search_resolved: resolution is always a declared WP-5 value', () => {
  const declared = new Set<WP5SearchResolution>([
    'canonical_exact',
    'accepted_alias',
    'disambiguation',
    'dangerous_alias_blocked',
    'unsupported',
    'error',
  ])
  const probes = ['juno-106', 're201', 'rhodes', 'roland tr', 'yamaha cs-80', 'zzzz', 'squier strat']
  for (const q of probes) {
    const p = searchResolvedPayload(resolvePublic(q), 1)
    assert.ok(declared.has(p.resolution), `${q} produced "${p.resolution}"`)
    assertExactKeys('search_resolved', p)
  }
})

test('search_unsupported: resolution_class is NEVER null', () => {
  const declared = new Set(['unsupported', 'ambiguous', 'dangerous_alias_blocked', 'zero_results_supported'])
  for (const q of ['yamaha cs-80', 'zzzz nothing', 'rhodes', 'roland tr', 'squier strat', '808']) {
    const outcome = resolvePublic(q)
    const p = searchUnsupportedPayload(outcome)
    if (p === null) {
      assert.ok(
        outcome.outcome === 'canonical_exact' || outcome.outcome === 'accepted_alias',
        `${q}: only a resolving outcome may skip the event`,
      )
      continue
    }
    assertExactKeys('search_unsupported', p)
    assert.notEqual(p.resolution_class, null)
    assert.ok(declared.has(p.resolution_class), `${q} produced "${p.resolution_class}"`)
  }
})

test('search_unsupported: every path maps to its declared class', () => {
  assert.equal(searchUnsupportedPayload(FIXTURE_UNSUPPORTED)!.resolution_class, 'unsupported')
  assert.equal(searchUnsupportedPayload(resolvePublic('zzzz'))!.resolution_class, 'zero_results_supported')
  assert.equal(searchUnsupportedPayload(FIXTURE_BLOCKED)!.resolution_class, 'dangerous_alias_blocked')
  assert.equal(searchUnsupportedPayload(resolvePublic('roland tr'))!.resolution_class, 'ambiguous')
  // Family demand is an unsupported miss.
  assert.equal(searchUnsupportedPayload(FIXTURE_UNSUPPORTED)!.resolution_class, 'unsupported')
})

test('search_unsupported: the outcome map is exhaustive by construction', () => {
  // A Record over the outcome union, so a seventh outcome fails to compile
  // rather than arriving as a null resolution_class.
  const kinds: SearchOutcomeKind[] = [
    'canonical_exact',
    'accepted_alias',
    'disambiguation',
    'dangerous_alias_blocked',
    'unsupported',
    'no_result',
  ]
  assert.deepEqual(Object.keys(UNSUPPORTED_CLASS_BY_OUTCOME).sort(), [...kinds].sort())
  for (const kind of kinds) {
    const value = UNSUPPORTED_CLASS_BY_OUTCOME[kind]
    const resolving = kind === 'canonical_exact' || kind === 'accepted_alias'
    if (resolving) assert.equal(value, null, `${kind} resolves and must not emit`)
    else assert.notEqual(value, null, `${kind} must have a declared class`)
  }
})

test('demand_signal_submitted: inline_email vs notify_button, exact keys', () => {
  const withEmail = demandSignalPayload(FIXTURE_UNSUPPORTED, 'someone@example.dk')
  assertExactKeys('demand_signal_submitted', withEmail)
  assert.equal(withEmail.capture_method, 'inline_email')
  assert.equal(withEmail.has_email, true)

  for (const blank of ['', '   ']) {
    const anon = demandSignalPayload(FIXTURE_UNSUPPORTED, blank)
    assertExactKeys('demand_signal_submitted', anon)
    assert.equal(anon.capture_method, 'notify_button')
    assert.equal(anon.has_email, false)
  }

  assert.equal(withEmail.suggested_shown, FIXTURE_UNSUPPORTED.suggestions.length)
})

test('the retired email/anonymous vocabulary is gone everywhere', () => {
  const sources = [
    readSource('app', 'search', 'page.tsx'),
    readSource('lib', 'search-resolver.ts'),
  ]
  for (const src of sources) {
    assert.equal(/capture_method:\s*'?(email|anonymous)'?/.test(src), false)
    assert.equal(src.includes("'anonymous'"), false, "the 'anonymous' literal must be gone")
  }
})

test('no discovery_product_clicked emission remains in search', () => {
  const src = readSource('app', 'search', 'page.tsx')
  assert.equal(src.includes('discovery_product_clicked'), false)
  for (const shelf of ['browse_grid', 'related', 'followed', 'recent', 'search_disambiguation', 'search_nearest']) {
    assert.equal(src.includes(shelf), false, `search must not label a click as "${shelf}"`)
  }
  // The gap is accepted; resolution itself is still measured.
  assert.ok(src.includes("emit('search_resolved'"), 'resolution must remain measured')
})

test('the page can emit only the four declared events, with no escape hatch', () => {
  const src = readSource('app', 'search', 'page.tsx')
  const emitted = [...src.matchAll(/emit\(\s*'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(emitted)].sort(),
    ['demand_signal_submitted', 'search_resolved', 'search_submitted', 'search_unsupported'],
  )
  // SUPERSEDED AT INTEGRATION. WP-4 shipped a local `SearchEventMap` shaped
  // like WP-5's taxonomy so that landing WP-5 would be a substitution. It is
  // now the substitution: `emit` IS `track`, so the generic in force is WP-5's
  // own `<E extends KlupEventName>(event: E, properties: KlupEventMap[E])` and
  // a local map would be a SECOND declaration of the same taxonomy.
  assert.ok(src.includes('function useEmit() {\n  return track\n}'), 'the seam must be track itself')
  assert.equal(
    src.includes('type SearchEventMap'),
    false,
    'the interim local event map must not survive integration as a duplicate taxonomy',
  )
  assert.equal(src.includes('Record<string, unknown>'), false, 'no untyped payload escape')
  for (const escape of ['as never', 'as any', '@ts-ignore', '@ts-expect-error']) {
    assert.equal(src.includes(escape), false, `"${escape}" is not permitted`)
  }
})

test('integration: the payload shapes are WP-5 taxonomy, not a copy of it', () => {
  // The registered integration point. WP-4 could not import WP-5's types
  // before WP-5 existed, so it restated five unions and four payload shapes
  // and kept them in step with comments. Integration replaced every one with a
  // derivation, so the taxonomy is declared exactly once and drift is a
  // compile error rather than a review burden.
  const src = readSource('lib', 'search-resolver.ts')
  assert.ok(
    src.includes("import type { KlupEventMap } from './analytics'"),
    'the resolver must derive its payloads from the single taxonomy',
  )
  for (const derived of [
    "export type SearchSubmittedPayload = KlupEventMap['search_submitted']",
    "export type SearchResolvedPayload = KlupEventMap['search_resolved']",
    "export type SearchUnsupportedPayload = KlupEventMap['search_unsupported']",
    "export type DemandSignalPayload = KlupEventMap['demand_signal_submitted']",
    "export type SearchEntrySurface = KlupEventMap['search_submitted']['entry_surface']",
    "export type SearchInputMethod = KlupEventMap['search_submitted']['input_method']",
    "export type TaxonomyResolution = KlupEventMap['search_resolved']['resolution']",
    "export type TaxonomyResolutionClass = KlupEventMap['search_unsupported']['resolution_class']",
    "export type DemandCaptureMethod = KlupEventMap['demand_signal_submitted']['capture_method']",
  ]) {
    assert.ok(src.includes(derived), `not derived from the taxonomy: ${derived}`)
  }
  // A restated shape would reintroduce the drift this replaced.
  assert.equal(
    /export interface Search(Submitted|Resolved|Unsupported)Payload \{/.test(src),
    false,
    'a hand-written payload interface survives alongside the derivation',
  )
})

test('no cast or suppression is used in the analytics builders', () => {
  const src = readSource('lib', 'search-resolver.ts')
  for (const escape of ['as never', 'as any', '@ts-ignore', '@ts-expect-error']) {
    assert.equal(src.includes(escape), false, `"${escape}" is not permitted`)
  }
})
