/**
 * scripts/lib/matcher-integrity.test.ts
 *
 * Contract tests for the matcher data-integrity gate.
 *
 * Run: npm run test:matcher   (npx tsx --test scripts/lib/matcher-integrity.test.ts)
 *
 * Every case here corresponds to a defect observed in production:
 *   - `source='dba'` matched nothing because DBA rows are stored as 'dba.dk',
 *     leaving 752 of 769 active DBA listings unmatched;
 *   - 'kleinanzeigen' was absent from the matcher source list entirely;
 *   - Epiphone Les Paul and Epiphone ES-335 listings were auto-matched to the
 *     Gibson products with is_valid=NULL, which every consumer treats as
 *     trusted;
 *   - 13 legacy Kleinanzeigen rows carry concatenated raw prices (e.g.
 *     12491299 = "1.249 €" + "1.299 €") and still corrupt price statistics.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'

import {
  MATCHER_SOURCES,
  isMatcherSource,
  matcherSourceList,
} from '../../frontend/lib/matching/sources'
import {
  detectBrandCollision,
  brandCollisionReason,
  EXTERNAL_BRAND_TOKENS,
} from '../../frontend/lib/matching/brand-guard'
import {
  buildMatchIndex,
  buildSharedIdentifierIndex,
  decideMatch,
  normalizeProductRow,
  isMatchableProduct,
  MATCHABLE_STATUS,
  MATCHABLE_SUPPORT_STATE,
  AUTO_CONFIDENCE_MIN,
  type Product,
  type MatchDecision,
} from '../../frontend/lib/matching/match-listings'
import { resolveMatchConflict, MERGE_MANIFEST_053 } from './kg-merge-conflict'
import { isUnsafeIdentifierValue, filterIdentifiers } from './identifier-safety'
import {
  loadSeed, seedProducts, deriveSeedIdentifiers, manifestChecksum,
  duplicateNormalisedTuples, CURATION_054_CONTRACT, RETIRED_053_SLUGS,
} from './seed-identifier-manifest'
import {
  hasPlausibleListingPrice,
  KLEINANZEIGEN_MAX_PRICE_EUR,
} from '../../frontend/lib/listing-price-integrity'
import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'
import {
  matchScrapedBatch, MAX_BATCH_IDS, newIngestionBatchId,
  matchRunInflow, fetchBatchListingIds, isIngestionBatchId,
} from './match-new-inflow'

// ── fixtures ──────────────────────────────────────────────────────────────

const GIBSON_LES_PAUL: Product = {
  id: 'p-gibson-lp', slug: 'gibson-les-paul',
  canonical_name: 'Gibson Les Paul', model_name: 'Les Paul', brand_name: 'gibson', status: 'active', support_state: 'supported',
}
const GIBSON_ES335: Product = {
  id: 'p-gibson-es335', slug: 'gibson-es-335',
  canonical_name: 'Gibson ES-335', model_name: 'ES-335', brand_name: 'gibson', status: 'active', support_state: 'supported',
}
const FENDER_STRAT: Product = {
  id: 'p-fender-strat', slug: 'fender-stratocaster',
  canonical_name: 'Fender Stratocaster', model_name: 'Stratocaster', brand_name: 'fender', status: 'active', support_state: 'supported',
}
const RHODES_MK1: Product = {
  id: 'p-rhodes-mk1', slug: 'rhodes-mark-i-stage-73',
  canonical_name: 'Rhodes Mark I Stage 73', model_name: 'Mark I Stage 73', brand_name: 'rhodes', status: 'active', support_state: 'supported',
}
const ROLAND_JUNO106: Product = {
  id: 'p-juno-106', slug: 'roland-juno-106',
  canonical_name: 'Roland Juno-106', model_name: 'Juno-106', brand_name: 'roland', status: 'active', support_state: 'supported',
}

// The duplicate-model_name rows that made selection order-dependent in
// production: Gibson and Epiphone both ship a "Les Paul" and an "ES-335".
const EPIPHONE_LES_PAUL: Product = {
  id: 'p-epi-lp', slug: 'epiphone-les-paul',
  canonical_name: 'Epiphone Les Paul', model_name: 'Les Paul', brand_name: 'epiphone', status: 'active', support_state: 'supported',
}
const EPIPHONE_ES335: Product = {
  id: 'p-epi-es335', slug: 'epiphone-es-335',
  canonical_name: 'Epiphone ES-335', model_name: 'ES-335', brand_name: 'epiphone', status: 'active', support_state: 'supported',
}
/** Two unbranded rows sharing a model name — a tie with no evidence to break it. */
const NOBRAND_A: Product = {
  id: 'p-nobrand-a', slug: 'mystery-drum-a',
  canonical_name: 'Mystery Drum A', model_name: 'Rhythmbox', brand_name: null, status: 'active', support_state: 'supported',
}
const NOBRAND_B: Product = {
  id: 'p-nobrand-b', slug: 'mystery-drum-b',
  canonical_name: 'Mystery Drum B', model_name: 'Rhythmbox', brand_name: null, status: 'active', support_state: 'supported',
}
const CRUMAR_PERFORMER: Product = {
  id: 'p-crumar', slug: 'crumar-performer',
  canonical_name: 'Crumar Performer', model_name: 'Performer', brand_name: 'crumar', status: 'active', support_state: 'supported',
}
const IBANEZ_RG: Product = {
  id: 'p-ibanez-rg', slug: 'ibanez-rg',
  canonical_name: 'Ibanez RG', model_name: 'RG550', brand_name: 'ibanez', status: 'active', support_state: 'supported',
}
const FENDER_JAZZ_BASS: Product = {
  id: 'p-fender-jb', slug: 'fender-jazz-bass',
  canonical_name: 'Fender Jazz Bass', model_name: 'Jazz Bass', brand_name: 'fender', status: 'active', support_state: 'supported',
}
const FENDER_TELECASTER: Product = {
  id: 'p-fender-tele', slug: 'fender-telecaster',
  canonical_name: 'Fender Telecaster', model_name: 'Telecaster', brand_name: 'fender', status: 'active', support_state: 'supported',
}
const KORG_MS20: Product = {
  id: 'p-korg-ms20', slug: 'korg-ms-20',
  canonical_name: 'Korg MS-20', model_name: 'MS-20', brand_name: 'korg', status: 'active', support_state: 'supported',
}

const PRODUCTS = [GIBSON_LES_PAUL, GIBSON_ES335, FENDER_STRAT, RHODES_MK1, ROLAND_JUNO106]
const INDEX = buildMatchIndex(PRODUCTS, [], [])

/** Full catalogue including the duplicate-model_name and cross-brand rows. */
const FULL_PRODUCTS = [
  ...PRODUCTS, EPIPHONE_LES_PAUL, EPIPHONE_ES335,
  NOBRAND_A, NOBRAND_B, CRUMAR_PERFORMER, IBANEZ_RG, FENDER_JAZZ_BASS, FENDER_TELECASTER,
  KORG_MS20,
]

/**
 * Decide the same title against both the given product order and its reverse.
 * Asserts the two agree, then returns the decision. Every symmetry test uses
 * this, so order dependence cannot pass unnoticed anywhere.
 */
function decideBothOrders(title: string, products: Product[] = FULL_PRODUCTS): MatchDecision {
  const forward = decideMatch(title, buildMatchIndex(products, [], []))
  const reverse = decideMatch(title, buildMatchIndex([...products].reverse(), [], []))
  assert.deepEqual(
    reverse, forward,
    `decision changed when product order was reversed for: ${title}`,
  )
  return forward
}

function assertDeferred(d: MatchDecision, reason: string) {
  assert.equal(d.kind, 'deferred', `expected deferred, got ${d.kind}`)
  if (d.kind !== 'deferred') return
  assert.equal(d.reason, reason)
}

/** Only `matched` ever produces a trusted (is_valid=NULL) row. */
function assertNotTrusted(d: MatchDecision) {
  assert.notEqual(d.kind, 'matched', 'this outcome must never become a trusted match')
}

// ── source eligibility ────────────────────────────────────────────────────

test('DBA is eligible under its stored identifier, not the short name', () => {
  // The whole defect in one assertion: production stores 'dba.dk'.
  assert.ok(isMatcherSource('dba.dk'), "'dba.dk' must be an eligible matcher source")
  assert.ok(!isMatcherSource('dba'), "'dba' is not a stored listings.source value")
})

test('kleinanzeigen is an eligible matcher source', () => {
  assert.ok(isMatcherSource('kleinanzeigen'))
})

test('existing reverb / finn / blocket eligibility is preserved', () => {
  for (const source of ['reverb', 'finn', 'blocket']) {
    assert.ok(isMatcherSource(source), `${source} must remain eligible`)
  }
})

test('unsupported sources are rejected', () => {
  // thomann is retail, not secondhand — it must never enter product matching.
  assert.ok(!isMatcherSource('thomann'))
  assert.ok(!isMatcherSource('ebay'))
  assert.ok(!isMatcherSource(''))
  assert.ok(!isMatcherSource(null))
  assert.ok(!isMatcherSource(undefined))
})

test('the source list is exactly the five supported marketplaces', () => {
  assert.deepEqual(
    [...MATCHER_SOURCES].sort(),
    ['blocket', 'dba.dk', 'finn', 'kleinanzeigen', 'reverb'],
  )
  // matcherSourceList() must hand PostgREST a mutable copy, not the frozen const.
  const list = matcherSourceList()
  list.push('mutated')
  assert.equal(MATCHER_SOURCES.length, 5, 'MATCHER_SOURCES must not be mutable via the list helper')
})

// ── brand-collision guard ─────────────────────────────────────────────────

test('Epiphone Les Paul does NOT auto-match the Gibson Les Paul product', () => {
  const decision = decideMatch('Epiphone Les Paul Standard 2018 ebony inkl. hard case', INDEX)
  assert.equal(decision.kind, 'rejected')
  if (decision.kind !== 'rejected') return
  assert.equal(decision.best.product_id, GIBSON_LES_PAUL.id)
  assert.equal(decision.collision.detectedBrand, 'epiphone')
  assert.equal(decision.collision.productBrand, 'gibson')
  assert.equal(
    brandCollisionReason(decision.collision),
    'brand_collision:epiphone_listing_vs_gibson_product',
  )
})

test('Gibson Les Paul DOES match the Gibson Les Paul product', () => {
  const decision = decideMatch('Gibson Les Paul Standard 1998 Honeyburst', INDEX)
  assert.equal(decision.kind, 'matched')
  if (decision.kind !== 'matched') return
  assert.equal(decision.best.product_id, GIBSON_LES_PAUL.id)
  assert.equal(decision.best.method, 'MODEL')
})

test('Squier Stratocaster does NOT auto-match the Fender Stratocaster product', () => {
  const decision = decideMatch('Squier Stratocaster Affinity HSS sunburst', INDEX)
  assert.equal(decision.kind, 'rejected')
  if (decision.kind !== 'rejected') return
  assert.equal(decision.best.product_id, FENDER_STRAT.id)
  assert.equal(decision.collision.detectedBrand, 'squier')
  assert.equal(decision.collision.productBrand, 'fender')
})

test('Fender Stratocaster DOES match the Fender Stratocaster product', () => {
  const decision = decideMatch('Fender Stratocaster American Standard 2012', INDEX)
  assert.equal(decision.kind, 'matched')
  if (decision.kind !== 'matched') return
  assert.equal(decision.best.product_id, FENDER_STRAT.id)
})

test('Epiphone ES-335 does NOT auto-match the Gibson ES-335 product', () => {
  const decision = decideMatch('Epiphone es 335 med tilbehør', INDEX)
  assert.equal(decision.kind, 'rejected')
  if (decision.kind !== 'rejected') return
  assert.equal(decision.best.product_id, GIBSON_ES335.id)
})

test('a brandless model-token-only title is deferred, not matched', () => {
  // Score 70 with no brand proof. Previously this became a trusted
  // is_valid=NULL row; it must now fail closed.
  const decision = decideMatch('Les Paul kopi uden mærke, sælges billigt', INDEX)
  assertDeferred(decision, 'low_confidence')
})

test('an unrelated brand in the title does not block a legitimate match', () => {
  // "Fender Rhodes Mark I" is the instrument's real historical name. A blanket
  // "any other brand disqualifies" rule would wrongly reject this — which is
  // exactly why the collision table is closed rather than open-ended.
  const decision = decideMatch('Fender Rhodes Mark I Stage 73 Stage Piano 1973', INDEX)
  assert.equal(decision.kind, 'matched')
  if (decision.kind !== 'matched') return
  assert.equal(decision.best.product_id, RHODES_MK1.id)
})

test('the guard does not fire for products of an unprotected brand', () => {
  // 'epiphone' only blocks gibson products; a Roland product is unaffected.
  assert.equal(detectBrandCollision('epiphone juno-106 lookalike', 'roland'), null)
})

test('a product with no brand recorded is never blocked', () => {
  assert.equal(detectBrandCollision('Epiphone Les Paul', null), null)
  assert.equal(detectBrandCollision('Epiphone Les Paul', ''), null)
})

test('brand detection is word-boundary anchored', () => {
  // Substring matching would fire on these; token matching must not.
  assert.equal(detectBrandCollision('epiphonebrand les paul', 'gibson'), null)
  assert.equal(detectBrandCollision('squierish strat copy', 'fender'), null)
  // ...but real separators must still be detected.
  assert.notEqual(detectBrandCollision('EPIPHONE/Gibson Les Paul', 'gibson'), null)
})

test('a colliding candidate does not suppress a legitimate alternative', () => {
  // Epiphone blocks the Gibson product, but the Juno-106 model token is also
  // present and its product is unaffected — that match must survive.
  const index = buildMatchIndex(PRODUCTS, [
    { product_id: GIBSON_LES_PAUL.id, type: 'MODEL', value: 'Les Paul' },
    { product_id: ROLAND_JUNO106.id,  type: 'MODEL', value: 'Juno-106' },
  ], [])
  const decision = decideMatch('Epiphone Les Paul + Roland Juno-106 bundle', index)
  assert.equal(decision.kind, 'matched')
  if (decision.kind !== 'matched') return
  assert.equal(decision.best.product_id, ROLAND_JUNO106.id)
  assert.ok(decision.admissible.every((c) => c.product_id !== GIBSON_LES_PAUL.id))
})

test('a title matching nothing yields no row', () => {
  assert.equal(decideMatch('Kaffemaskine med mælkeskummer', INDEX).kind, 'none')
})

// ── symmetric, deterministic brand selection ──────────────────────────────
// Every case runs in both product orders via decideBothOrders().

test('Gibson Les Paul selects Gibson, never Epiphone, in either input order', () => {
  const d = decideBothOrders('Gibson Les Paul Standard 2005')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, GIBSON_LES_PAUL.id)
  assert.equal(d.brandEvidence, 'gibson')
})

test('Epiphone Les Paul selects Epiphone, never Gibson, in either input order', () => {
  const d = decideBothOrders('Epiphone Les Paul Standard 2018 ebony')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, EPIPHONE_LES_PAUL.id)
})

test('Gibson ES-335 selects Gibson, never Epiphone, in either input order', () => {
  const d = decideBothOrders('Gibson ES-335 1968 cherry')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, GIBSON_ES335.id)
})

test('Epiphone ES-335 selects Epiphone, never Gibson, in either input order', () => {
  const d = decideBothOrders('Epiphone es 335 med tilbehør')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, EPIPHONE_ES335.id)
})

test('"Epiphone (Gibson)" still selects Epiphone — child brand takes precedence', () => {
  const d = decideBothOrders('Epiphone Les Paul (Gibson-style) sunburst')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, EPIPHONE_LES_PAUL.id)
})

test('"Squier by Fender" is rejected, never matched to Fender', () => {
  // Both brand words occur; the child brand must win. Squier is not a
  // kg_brand, so this is carried by the hard-collision rule.
  for (const title of [
    'Squier by Fender Telecaster el-guitar',
    'Fender Squier Stratocaster',
    'Squier Stratocaster (Fender)',
    'Squier by Fender Affinity Active Jazz Bass V 5 String Bundle',
  ]) {
    const d = decideBothOrders(title)
    assertNotTrusted(d)
    assert.equal(d.kind, 'rejected', `expected rejection for: ${title}`)
    if (d.kind !== 'rejected') continue
    assert.equal(d.collision.detectedBrand, 'squier')
    assert.equal(d.collision.productBrand, 'fender')
  }
})

test('Fender Stratocaster still matches Fender in either input order', () => {
  const d = decideBothOrders('Fender Stratocaster American Standard 2012')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, FENDER_STRAT.id)
})

test('a brandless duplicate model-name tie is deferred and writes no trusted match', () => {
  const d = decideBothOrders('Rhythmbox trommemaskine til salg')
  assertDeferred(d, 'ambiguous_tie')
  assertNotTrusted(d)
  if (d.kind !== 'deferred') return
  assert.equal(d.candidates.length, 2)
})

test('equal-score candidate order cannot change the decision (all permutations)', () => {
  // Exhaustive over permutations of the colliding trio, for both a Gibson and
  // an Epiphone title. Any order sensitivity anywhere fails here.
  const trio = [GIBSON_LES_PAUL, EPIPHONE_LES_PAUL, NOBRAND_A]
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ].map((order) => order.map((i) => trio[i]))

  for (const [title, expected] of [
    ['Gibson Les Paul Deluxe', GIBSON_LES_PAUL.id],
    ['Epiphone Les Paul Deluxe', EPIPHONE_LES_PAUL.id],
  ] as const) {
    const results = permutations.map((products) => {
      const d = decideMatch(title, buildMatchIndex(products, [], []))
      return d.kind === 'matched' ? d.best.product_id : d.kind
    })
    assert.equal(new Set(results).size, 1, `order-dependent result for "${title}": ${results.join(',')}`)
    assert.equal(results[0], expected)
  }
})

// ── automatic-confidence floor ────────────────────────────────────────────

test('AUTO_CONFIDENCE_MIN is the synonym tier, excluding model-token-only', () => {
  assert.equal(AUTO_CONFIDENCE_MIN, 80)
})

test('observed cross-brand score-70 examples are deferred, never trusted', () => {
  // Verbatim from the production dry run.
  const esp = decideBothOrders('ESP J-Four Jazz Bass Pro Artist Studio Bass MIJ Japan')
  assertNotTrusted(esp)
  assertDeferred(esp, 'low_confidence')

  // Ibanez IS a catalogue brand, so brand evidence eliminates Crumar outright.
  const ibanez = decideBothOrders('Ibanez Performer PF100')
  assertNotTrusted(ibanez)
  assertDeferred(ibanez, 'brand_mismatch')
})

test('score 70 IS trusted when the product brand is proven in the title', () => {
  const d = decideBothOrders('Roland Juno-106 synthesizer, nysynet')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, ROLAND_JUNO106.id)
  assert.equal(d.best.score, 70)
})

test('a curated identifier (score 95) is trusted without brand proof', () => {
  const index = buildMatchIndex(FULL_PRODUCTS, [
    { product_id: ROLAND_JUNO106.id, type: 'SKU', value: 'JUNO-106' },
  ], [])
  const d = decideMatch('JUNO-106 vintage polysynth', index)
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.score, 95)
})

test('a curated synonym (score 80) clears the floor', () => {
  const index = buildMatchIndex(FULL_PRODUCTS, [], [
    { alias: 'space echo', canonical_query: 'roland-juno-106' },
  ])
  const d = decideMatch('Vintage space echo unit', index)
  // canonical_query resolves to the Juno-106 fixture slug; the point under
  // test is that an 80-score candidate is not blocked by the floor.
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.score, 80)
})

// ── all callers inherit the shared core ───────────────────────────────────

test('every matcher caller routes through the shared decision core', () => {
  // Architectural invariant: safety lives in decideMatch, so no caller may
  // score or select on its own. If a new caller appears, it must appear here.
  const repoRoot = path.resolve(__dirname, '../..')
  const callers = [
    'scripts/match-listings.ts',
    'frontend/app/api/cron/scrape/route.ts',
    'scripts/report-match-backlog.ts',
  ]
  for (const rel of callers) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    assert.ok(
      // `matchRunInflow` / `matchScrapedBatch` are the bounded wrappers; both
      // reach the same `matchListings` core and add only a batch boundary.
      /matchListings|decideMatch|matchRunInflow|matchScrapedBatch/.test(src),
      `${rel} must go through the shared core`,
    )
    assert.ok(
      !/score:\s*(70|80|95)\b/.test(src),
      `${rel} must not define its own candidate scores`,
    )
  }

  // And the core itself must be the only place that writes a trusted row.
  const core = fs.readFileSync(
    path.join(repoRoot, 'frontend/lib/matching/match-listings.ts'), 'utf8',
  )
  assert.ok(core.includes("kind === 'deferred'"), 'core must handle deferred outcomes')
  assert.ok(core.includes('is_valid:        false'), 'core must mark collisions untrusted')
})

// ── tier shadowing (Prompt 02B) ───────────────────────────────────────────
// Production shape: the `ES-335` identifier belongs ONLY to Epiphone; Gibson's
// identifier is `335`, which word-boundary rules keep from firing inside
// "es-335". Before the fix, the identifier tier suppressed the model tier, so
// a Gibson title produced a single incompatible Epiphone candidate at 95 and
// the compatible Gibson product was never considered.
const ES335_IDENTS = [
  { product_id: EPIPHONE_ES335.id,  type: 'SKU', value: 'ES-335' },
  { product_id: GIBSON_ES335.id,    type: 'SKU', value: '335' },
  { product_id: EPIPHONE_LES_PAUL.id, type: 'SKU', value: 'Les Paul' },
]

function decideShadowed(title: string, products: Product[] = FULL_PRODUCTS): MatchDecision {
  const forward = decideMatch(title, buildMatchIndex(products, ES335_IDENTS, []))
  const reverse = decideMatch(title, buildMatchIndex(
    [...products].reverse(), [...ES335_IDENTS].reverse(), [],
  ))
  assert.deepEqual(reverse, forward, `decision changed under reversed input for: ${title}`)
  return forward
}

test('Gibson ES-335 selects Gibson despite a higher-scoring incompatible Epiphone identifier', () => {
  const d = decideShadowed('Gibson ES-335 Dot Ebony')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, GIBSON_ES335.id)
  // With Prompt 02C, 'ES-335' is recognised as a SHARED term, so Gibson
  // competes at the identifier tier too and brand evidence resolves it at full
  // confidence. Before 02C this same title was deferred as brand_mismatch;
  // before 02B it silently resolved to Epiphone.
  assert.equal(d.best.score, 95)
})

test('Epiphone ES-335 still selects Epiphone at the identifier tier', () => {
  const d = decideShadowed('Epiphone ES-335 Dot')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, EPIPHONE_ES335.id)
  assert.equal(d.best.score, 95)
})

test('a compatible higher-tier candidate is never displaced by a weaker one', () => {
  // Epiphone title: the Epiphone identifier (95) is compatible, and the
  // Epiphone model candidate (70) must not win instead.
  const d = decideShadowed('Epiphone Les Paul Standard 2018 ebony')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, EPIPHONE_LES_PAUL.id)
  assert.equal(d.best.score, 95, 'the 95-score compatible candidate must win over the 70-score one')
})

test('tier and input order cannot change either ES-335 result', () => {
  // decideShadowed already asserts reversal-invariance; this pins the pairing
  // explicitly across both catalogue orders.
  for (const products of [FULL_PRODUCTS, [...FULL_PRODUCTS].reverse()]) {
    const g = decideMatch('Gibson ES-335 Dot Ebony', buildMatchIndex(products, ES335_IDENTS, []))
    const e = decideMatch('Epiphone ES-335 Dot', buildMatchIndex(products, ES335_IDENTS, []))
    assert.equal(g.kind === 'matched' && g.best.product_id, GIBSON_ES335.id)
    assert.equal(e.kind === 'matched' && e.best.product_id, EPIPHONE_ES335.id)
  }
})

// ── non-product intent (Prompt 02B) ───────────────────────────────────────

test('the two named part listings cannot become trusted matches', () => {
  for (const title of ['Juno 106 voice chips', 'Fender Jazz Bass pickups']) {
    const d = decideBothOrders(title)
    assertNotTrusted(d)
    assertDeferred(d, 'non_product_intent')
    if (d.kind !== 'deferred') continue
    assert.equal(d.intent, 'part_or_accessory')
  }
})

test('observed da/de/en parts and accessory titles fail closed', () => {
  // Verbatim from the live DBA and Kleinanzeigen backlogs.
  for (const title of [
    'Fender stratocaster Floyd Rose hals',              // da — neck
    'Fender Stratocaster Krop og Hals (MJT)',           // da — body + neck
    '3 saddel moderne Fender Telecaster bro',           // da — bridge
    'Guitar Pickup, Fender 1978 Stratocaster',          // en — pickup
    'To Telecaster bridge pickups',                     // en
    'Fender Precision Bass Hals Mexiko (Neu)',          // de — neck
    'Tonabnehmer Fender Telecaster Texas spezial',      // de — pickup
    '2x Gibson Ace Frehley Signature Les Paul Strings Saiten in OVP 09', // de — strings
    'Roland Juno 106 Supernova Netzteil - Komplett restauriert',         // de — PSU
    'Fender Japan Telecaster Body - Black',             // de/en — body
  ]) {
    const d = decideBothOrders(title)
    assertNotTrusted(d)
    if (d.kind === 'deferred') assert.equal(d.reason, 'non_product_intent', title)
  }
})

test('observed da/de/en wanted and non-sale titles fail closed', () => {
  for (const title of [
    '!!!SØGER!!! Gibson hardcase til les Paul i brun eller sort',
    'Fender ARTISAN TAMO ASH Stratocaster Custom Shop … SØGES',
    'Suche Roland JUNO 60 , auch defekt',
    'SUCHE: Vintage SCI Sequential Prophet 5 synthesizer',
    'FENDER STRATOCASTER gesucht',
    '[Suche] defekten Oberheim OB-X',
    'Fender Telecaster zum Tausch gesucht',
    'WANTED: Roland Juno-106 any condition',
  ]) {
    const d = decideBothOrders(title)
    assertNotTrusted(d)
    if (d.kind === 'deferred') assert.equal(d.reason, 'non_product_intent', title)
  }
})

test('an explicit offer marker overrides a wanted token', () => {
  // Real listing: an offer of the MS-20 that states what is wanted in trade.
  const d = decideBothOrders('BIETE: Korg MS-20 Vintage (IC35 / OTA) --> SUCHE: Synthesizer')
  assert.equal(d.kind, 'matched')
})

test('a complete product sold WITH an accessory stays eligible', () => {
  // The invariant the guard must not break. None of case/koffer/kasse/gigbag/
  // zubehör/tilbehør/manual/incl/inkl is a part token.
  for (const title of [
    'Fender Jazz Bass with case',
    'Fender Telecaster incl. Koffer und Zubehör E-Gitarre',
    'Gibson Les Paul med original kasse og manual',
    'Roland Juno-106 inkl. Gigbag',
    'Korg MS-20 with box and manual',
  ]) {
    const d = decideBothOrders(title)
    assert.equal(d.kind, 'matched', `must stay eligible: ${title}`)
  }
})

test('intent tokens are word-boundary anchored and cannot fire on substrings', () => {
  // Substring matching would wreck ordinary product names.
  assert.equal(detectNonProductIntent('Fender Bassbreaker 15 combo'), null)     // 'bass' inside a word
  assert.equal(detectNonProductIntent('Gibson Bridgeport reissue'), null)       // 'bridge'
  assert.equal(detectNonProductIntent('Roland Chipset demo unit'), null)        // 'chip'
  assert.equal(detectNonProductIntent('Moog Halsey Edition'), null)             // 'hals'
  assert.equal(detectNonProductIntent('Yamaha Bodypack receiver'), null)        // 'body'
  assert.equal(detectNonProductIntent('Korg Suchen-Modell'), null)              // 'suche' hyphen-bounded
  // ...but real, separated tokens still fire.
  assert.equal(detectNonProductIntent('Fender Telecaster bridge')?.intent, 'part_or_accessory')
  assert.equal(detectNonProductIntent('Suche Fender Telecaster')?.intent, 'wanted_or_non_sale')
})

// ── accessory-noise guard (2026-08-29) ────────────────────────────────────
//
// Sanitised from the real titles measured on the 14 canonical public products.
// The rejections and the protections come from the same measurement pass, so
// each protection is a listing that actually exists and actually renders.

test('accessory head-nouns are rejected when they are the thing being sold', () => {
  for (const title of [
    // The named Juno-60 / Juno-106 / Jupiter cases.
    'Slider Cap Roland Juno-6, Juno-60, Jupiter 8...',
    'NEW Roland Slider Cap (016H004) for Juno-60, Juno-6, Jupiter-8, RS-09, EP-09',
    'Slide Potentiometer (Slider) - Roland Juno-6 / Juno-60 (A10K/A50K/B100K)',
    'Roland Bender SH-1, SH-2, SH-7, SH-09, Juno-6, Juno-60, Jupiter 4, Jupiter 8',
    // Covers, the largest residual class.
    'Roland SH-101 cover',
    'Roland JUPITER-8 cover (special edition)',
    'Korg MS-20 Mini keyboard cover',
    // Exact model name PLUS explicit replacement-part wording.
    'Korg MS-20 MINI replacement keys 2000',
    'ORIGINAL Roland Juno-60 Replacement HPF Slider Switch (13159505) for Juno-60',
    // Documentation and data carriers sold alone.
    'Yamaha DX7 original operators manual og performance notes',
    'Yamaha DX7 Data ROM Cartridge',
    'Roland TR-909 OS 4.0 EPROM Firmware Upgrade Kit',
    'Modgrip till Roland SH-101 grå original',
  ]) {
    const hit = detectNonProductIntent(title.toLowerCase())
    assert.equal(hit?.intent, 'part_or_accessory', `must reject: ${title}`)
  }
})

test('a legitimate bargain is never rejected for being cheap', () => {
  // The measured SH-101 at 7,500 DKK against a ~15,000 DKK band — an
  // unusually cheap but entirely genuine instrument, and exactly the listing
  // Klup exists to surface. It survives BECAUSE `inkl` precedes `Manual`.
  const bargain = 'SJÆLDEN BLÅ Roland SH-101 – Nyserviceret & inkl. Original Manual'
  assert.equal(detectNonProductIntent(bargain.toLowerCase()), null)

  // Price is not an input to the guard at all: the same title is judged
  // identically however cheap the listing is. Nothing here reads a price.
  assert.equal(detectNonProductIntent('Roland SH-101 monosynth'.toLowerCase()), null)
  assert.equal(detectNonProductIntent('Roland SH-101'.toLowerCase()), null)
})

test('a complete instrument bundled with accessories stays eligible', () => {
  for (const title of [
    'SJÆLDEN BLÅ Roland SH-101 – Nyserviceret & inkl. Original Manual',
    'Yamaha DX7 – Komplett med original Flightcase, 5 ROM-kassetter och manual',
    'Tausche Yamaha DX7 inkl Case, Cover, Cartridges und Patchbook',
    'Roland SH-101 with Original Soft Case',
    'Roland Juno-60 with Travel Hardcase',
    'Roland TR-606 Drumatix plus Roland Silver Case & PSU',
    'Original BLACK Emu SP1200 Sampling Drum SP-1200 reissue vintage Big Knobs w/case',
    'Roland Juno 60 + midi adapter +psu',
    'Roland SH-101 RED + Modulation Grip - RED',
    'Roland RE-501 Chorus Echo - Spare Tapes - Pro Serviced - Warranty',
  ]) {
    assert.equal(detectNonProductIntent(title.toLowerCase()), null, `must stay eligible: ${title}`)
  }
})

test('an inclusion marker only rescues an accessory that FOLLOWS it', () => {
  // Position is the whole rule. Here the EPROM is the head noun and `with`
  // merely lists what it is compatible with, so it must still be rejected.
  assert.equal(
    detectNonProductIntent('Casio RZ-1 SOUND KIT EPROM with Sp12 - DMX - TR-808 Sounds'.toLowerCase())?.intent,
    'part_or_accessory',
  )
  // ...whereas the same noun after the marker is an included extra.
  assert.equal(
    detectNonProductIntent('Yamaha DX7 inkl. EPROM upgrade'.toLowerCase()),
    null,
  )
})

test('ordinary full-product listings across canonical products stay eligible', () => {
  for (const title of [
    'Roland Juno-60 61-Key Polyphonic Synthesizer 1982 - 1984 - Black',
    'Roland Juno-106 Vintage Analog Synthesizer',
    'Roland Jupiter-8 Polyphonic Analog Synthesizer in Good condition',
    'Roland TR-808 Rhythm Composer Vintage Drum Machine',
    'Roland RE-201 Space Echo Tape Delay 1970s - Black',
    'Korg MS-20 Vintage Analog Synthesizer – mk1',
    'Yamaha DX7 Digital Programmable Algorithm Synthesizer',
    'Wurlitzer 200A 64-Key Electric Piano 1974 - 1983 - Black',
    'Fender Rhodes Mark II 73 - Klassiker in gutem Zustand',
    'Roland Juno-60 – Legendary Polyphonic Analog Synth with MIDI, Needs Service',
    'Roland Juno-60 - serviced - very good condition',
  ]) {
    assert.equal(detectNonProductIntent(title.toLowerCase()), null, `must stay eligible: ${title}`)
  }
})

test('`pickup` in its shipping sense is not a part', () => {
  // Found by this change's dry run: 48 active listings mean collection in
  // person, including complete instruments up to 119,406 DKK.
  for (const title of [
    'Roland TR-909 tr909 Rhythm Composer Drum Machine 1984 - Local Pickup Only',
    'Moog Model 345A Memorymoog Plus Polyphonic Synthesizer Keyboard - Local Pickup Only',
    'Rhodes Mark II 73 1980\'s - Black Local Pickup only',
    'Fender 1964 Deluxe Reverb Combo, Vintage - Pre Owned *Pickup Only*',
  ]) {
    assert.equal(detectNonProductIntent(title.toLowerCase()), null, `must stay eligible: ${title}`)
  }
  // The part sense is untouched — 363 of the 409 `pickup` titles.
  assert.equal(
    detectNonProductIntent('Guitar Pickup, Fender 1978 Stratocaster'.toLowerCase())?.intent,
    'part_or_accessory',
  )
  assert.equal(
    detectNonProductIntent('Fender Jazz Bass pickups'.toLowerCase())?.intent,
    'part_or_accessory',
  )
})

test('German accessory vocabulary is deliberately NOT adopted', () => {
  // Re-measured 2026-08-29: zero hits on the canonical cohort, which is 98%
  // Reverb and lists in English. An unexercised token is a latent false
  // rejection, so these stay out until the data demonstrates them. This test
  // records the decision so a future reader does not "fix" the omission.
  for (const title of [
    'Roland Juno-60 Regler defekt',
    'Roland Juno-60 Abdeckung',
    'Yamaha DX7 Ersatzteil',
  ]) {
    assert.equal(detectNonProductIntent(title.toLowerCase()), null, `not yet adopted: ${title}`)
  }
  // `netzteil` IS adopted — it was measured in the original derivation.
  assert.equal(
    detectNonProductIntent('Roland Juno-60 Netzteil'.toLowerCase())?.intent,
    'part_or_accessory',
  )
})

test('accessory words that belong to a model identity are not rejection rules', () => {
  // No supported product name contains an accessory token — verified by SELECT
  // over the 48-product cohort. These guard the boundary behaviour anyway.
  assert.equal(detectNonProductIntent('Roland JX-3P Coverage demo'.toLowerCase()), null)
  assert.equal(detectNonProductIntent('Moog Manualis prototype'.toLowerCase()), null)
  assert.equal(detectNonProductIntent('Korg Slidermatic 400'.toLowerCase()), null)
})

test('the public product page does not render an adjudicated rejection', () => {
  // `is_valid = false` is a written verdict — from the matcher's hard
  // brand-collision branch, the AI validation pass, or an admin. The product
  // listing query discarded it, so 87 of 309 rendered rows on the canonical
  // cohort were matches something had already ruled out. Asserted at the query
  // because that is where the defect was: no amount of matcher correctness
  // helps if the read ignores the answer.
  const repoRoot = path.resolve(__dirname, '../..')
  const route = fs.readFileSync(
    path.join(repoRoot, 'frontend/app/api/product/[slug]/route.ts'), 'utf8',
  )
  const q = route.slice(route.indexOf("from('listing_product_match')"))
  const query = q.slice(0, q.indexOf('.limit(50)'))
  assert.ok(
    query.includes(".not('is_valid', 'is', false)"),
    'the product listing query must exclude explicitly rejected matches',
  )
  // NULL is the normal state of an automatic match and must survive.
  assert.ok(
    !/\.eq\('is_valid'/.test(query),
    'filtering to is_valid=true would hide every unreviewed automatic match',
  )
})

test('the accessory guard rejects the association, never the price', () => {
  // A hard rejection must be explainable by a token, and that token must be a
  // word in the title — never a threshold. Same title, absurd prices, same
  // verdict, because no price is passed in.
  const accessory = 'roland sh-101 cover'
  const product = 'roland sh-101 monosynth'
  assert.equal(detectNonProductIntent(accessory)?.token, 'cover')
  assert.equal(detectNonProductIntent(product), null)
})

// ── duplicate KG rows (Prompt 02B) ────────────────────────────────────────

test('identical canonical duplicate rows fail closed with an auditable outcome', () => {
  // Mirrors the live `Manley CORE` / `Moog Slim Phatty` duplicates: two rows,
  // same brand and model_name, indistinguishable by any title.
  const dupA: Product = {
    id: 'p-dup-a', slug: 'manley-core',
    canonical_name: 'Manley CORE', model_name: 'CORE', brand_name: 'manley', status: 'active', support_state: 'supported',
  }
  const dupB: Product = {
    id: 'p-dup-b', slug: 'manley-manley-core',
    canonical_name: 'Manley CORE', model_name: 'CORE', brand_name: 'manley', status: 'active', support_state: 'supported',
  }
  const d = decideBothOrders('Manley CORE mastering compressor', [...FULL_PRODUCTS, dupA, dupB])
  assertNotTrusted(d)
  assertDeferred(d, 'product_data_conflict')
  if (d.kind !== 'deferred') return
  assert.equal(d.candidates.length, 2)
  assert.match(d.detail, /duplicate kg_product rows/)
})

test('product_data_conflict is distinct from a genuine ambiguous tie', () => {
  // NOBRAND_A/B share a model name but are different products, not duplicates.
  const tie = decideBothOrders('Rhythmbox trommemaskine til salg')
  assertDeferred(tie, 'ambiguous_tie')
})

// ── caller inheritance of the new guard ───────────────────────────────────

test('every matcher caller inherits the non-product guard via the shared core', () => {
  const repoRoot = path.resolve(__dirname, '../..')
  // No caller may implement its own intent screening.
  for (const rel of [
    'scripts/match-listings.ts',
    'frontend/app/api/cron/scrape/route.ts',
    'scripts/report-match-backlog.ts',
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    assert.ok(
      !/detectNonProductIntent/.test(src),
      `${rel} must not screen intent itself — it inherits it from decideMatch`,
    )
  }
  // The core is the single place the guard is applied.
  const core = fs.readFileSync(
    path.join(repoRoot, 'frontend/lib/matching/match-listings.ts'), 'utf8',
  )
  assert.ok(core.includes('detectNonProductIntent('), 'core must apply the intent guard')
  assert.ok(core.includes("reason: 'non_product_intent'"), 'core must emit the deferral')
})

// ── shared / asymmetric identifiers (Prompt 02C) ──────────────────────────
//
// Live KG shape: `kg_identifier` has NO unique constraint on value, and the
// rows are populated asymmetrically — 'Les Paul' and 'ES-335' exist ONLY on
// the Epiphone products, while Gibson instead owns '335' and the generic SKU
// 'PAUL'. A score-95 identifier hit therefore used to confer a brand.

const ASYM_IDENTS = [
  { product_id: EPIPHONE_LES_PAUL.id, type: 'SKU', value: 'Les Paul' }, // Epiphone only
  { product_id: EPIPHONE_ES335.id,    type: 'SKU', value: 'ES-335' },   // Epiphone only
  { product_id: GIBSON_ES335.id,      type: 'SKU', value: '335' },      // Gibson's variant
  { product_id: ROLAND_JUNO106.id,    type: 'SKU', value: 'Juno-106' }, // genuinely exclusive
]

function decideAsym(title: string, products: Product[] = FULL_PRODUCTS): MatchDecision {
  const forward = decideMatch(title, buildMatchIndex(products, ASYM_IDENTS, []))
  const reverse = decideMatch(title, buildMatchIndex(
    [...products].reverse(), [...ASYM_IDENTS].reverse(), [],
  ))
  assert.deepEqual(reverse, forward, `decision changed under reversed input for: ${title}`)
  return forward
}

test('a brandless shared identifier defers instead of picking the mapped product', () => {
  // 'Les Paul' maps only to Epiphone. Without brand evidence the matcher must
  // NOT hand the listing to Epiphone just because that is where the SKU sits.
  for (const title of ['LES PAUL STANDARD 2012', 'Unik Les Paul', 'ES-335 semi hollow 1968']) {
    const d = decideAsym(title)
    assertNotTrusted(d)
    assertDeferred(d, 'shared_identifier_conflict')
  }
})

test('explicit Gibson and Epiphone titles still resolve through a shared identifier', () => {
  const g = decideAsym('Gibson Les Paul Standard 2005')
  assert.equal(g.kind, 'matched')
  if (g.kind === 'matched') {
    assert.equal(g.best.product_id, GIBSON_LES_PAUL.id)
    assert.equal(g.best.score, 95, 'brand evidence resolves the shared term at full identifier confidence')
  }

  const e = decideAsym('Epiphone Les Paul Standard 2018')
  assert.equal(e.kind, 'matched')
  if (e.kind === 'matched') assert.equal(e.best.product_id, EPIPHONE_LES_PAUL.id)

  const g335 = decideAsym('Gibson ES-335 Dot Ebony')
  assert.equal(g335.kind, 'matched')
  if (g335.kind === 'matched') assert.equal(g335.best.product_id, GIBSON_ES335.id)

  const e335 = decideAsym('Epiphone ES-335 Dot')
  assert.equal(e335.kind, 'matched')
  if (e335.kind === 'matched') assert.equal(e335.best.product_id, EPIPHONE_ES335.id)
})

test('a genuinely exclusive identifier keeps its existing confidence', () => {
  const d = decideAsym('Juno-106 vintage polysynth')
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, ROLAND_JUNO106.id)
  assert.equal(d.best.score, 95)
})

test('shared-identifier decisions are independent of identifier and product order', () => {
  // decideAsym already asserts reversal-invariance; this pins it across every
  // permutation of the identifier list for the ambiguous case.
  const perms = [
    [0, 1, 2, 3], [3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1],
  ].map((o) => o.map((i) => ASYM_IDENTS[i]))
  const results = perms.map((idents) => {
    const d = decideMatch('LES PAUL STANDARD 2012', buildMatchIndex(FULL_PRODUCTS, idents, []))
    return d.kind === 'deferred' ? d.reason : d.kind
  })
  assert.equal(new Set(results).size, 1, `order-dependent: ${results.join(',')}`)
  assert.equal(results[0], 'shared_identifier_conflict')
})

test('the shared-identifier index is structural, not a hard-coded string list', () => {
  const shared = buildSharedIdentifierIndex(FULL_PRODUCTS, ASYM_IDENTS)
  // 'les paul' and 'es-335' are shared because ANOTHER product's model_name
  // matches them under the matcher's own token rule.
  assert.ok(shared.has('les paul'))
  assert.ok(shared.has('es-335'))
  // '335' is ALSO shared, and for a reason the matcher itself produces: the
  // model tier tries the space-normalised form, so "ES 335" matches the token
  // '335'. Gibson's variant identifier is therefore not exclusive proof
  // either — which is exactly the symmetry the invariant demands.
  assert.ok(shared.has('335'))
  // An exclusive identifier is absent entirely.
  assert.ok(!shared.has('juno-106'))
  // The index is derived, so removing the colliding product removes the entry.
  const soloShared = buildSharedIdentifierIndex(
    FULL_PRODUCTS.filter((p) => p.id !== GIBSON_ES335.id), ASYM_IDENTS,
  )
  assert.ok(!soloShared.has('es-335'), 'no collision left => term becomes exclusive again')
})

test('a sibling only competes when the title independently supports it', () => {
  // Guard against over-expansion. The live KG has the generic SKU 'PAUL' on
  // Gibson Les Paul, which shares with 17 products; unfiltered it would defer
  // every Les Paul listing. Siblings are intersected with model-name support.
  const genericIdents = [{ product_id: GIBSON_LES_PAUL.id, type: 'SKU', value: 'PAUL' }]
  const variant: Product = {
    id: 'p-gib-lp-custom', slug: 'gibson-les-paul-custom',
    canonical_name: 'Gibson Les Paul Custom', model_name: 'Les Paul Custom', brand_name: 'gibson', status: 'active', support_state: 'supported',
  }
  const d = decideMatch(
    'Gibson Les Paul Standard 2005',
    buildMatchIndex([...FULL_PRODUCTS, variant], genericIdents, []),
  )
  // "Les Paul Custom" is not in the title, so the variant must not compete.
  assert.equal(d.kind, 'matched')
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, GIBSON_LES_PAUL.id)
})

test('every caller inherits shared-identifier safety via the shared core', () => {
  const repoRoot = path.resolve(__dirname, '../..')
  for (const rel of [
    'scripts/match-listings.ts',
    'frontend/app/api/cron/scrape/route.ts',
    'scripts/report-match-backlog.ts',
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    assert.ok(
      !/buildSharedIdentifierIndex|sharedIdentifiers/.test(src),
      `${rel} must not reimplement shared-identifier logic`,
    )
  }
  const core = fs.readFileSync(
    path.join(repoRoot, 'frontend/lib/matching/match-listings.ts'), 'utf8',
  )
  assert.ok(core.includes('buildSharedIdentifierIndex('), 'core must build the shared index')
  assert.ok(core.includes("reason: 'shared_identifier_conflict'"), 'core must emit the deferral')
})

// ── migration 053 preconditions and conflict truth table (Prompt 02C) ──────
// These test the AUTHORED migration's decision rules. Nothing here touches a
// database; migration 053 implements the identical rules in SQL.

test('merge manifest reconciles to the 14 audited groups and 29 rows', () => {
  assert.equal(MERGE_MANIFEST_053.length, 14)
  const merges = MERGE_MANIFEST_053.filter((g) => g.merge)
  assert.equal(merges.length, 13, '13 merge groups + 1 out-of-vertical deactivation')

  const losers = MERGE_MANIFEST_053.flatMap((g) => g.losers)
  assert.equal(losers.length, 16, '14 merge losers + 2 HP Z8 rows')
  assert.equal(new Set(losers).size, 16, 'no product may be a loser twice')

  // Every audited row is accounted for exactly once: 13 survivors + 16 losers.
  const survivorsAll = MERGE_MANIFEST_053.map((g) => g.survivor).filter(Boolean) as string[]
  assert.equal(survivorsAll.length + losers.length, 29, 'must reconcile to the 29 audited rows')
  const survivors = MERGE_MANIFEST_053.map((g) => g.survivor).filter(Boolean) as string[]
  assert.equal(new Set(survivors).size, survivors.length, 'no product may survive twice')
  for (const s of survivors) assert.ok(!losers.includes(s), 'a survivor must never also be a loser')
})

test('roland-re-201 is the survivor and hp z8 is a deactivation, not a merge', () => {
  const re201 = MERGE_MANIFEST_053.find((g) => g.grp === 'roland|re-201')!
  assert.equal(re201.survivor, '07cc1ac5-a0c9-4707-99ed-c4440a1f9563')
  assert.ok(re201.merge)

  const hp = MERGE_MANIFEST_053.find((g) => g.grp === 'hp|z8')!
  assert.equal(hp.survivor, null, 'out-of-vertical group has no survivor')
  assert.equal(hp.merge, false)
  assert.equal(hp.losers.length, 2, 'both HP Z8 rows are deactivated')
})

test('any true/false contradiction aborts, regardless of provenance', () => {
  // Stricter than "manual only", and identical to migration 053's SQL
  // precondition: listing_product_match has no column recording whether a
  // verdict came from a human or the AI pass, so the migration cannot tell
  // them apart and must refuse every contradiction.
  for (const [s, l] of [[true, false], [false, true]] as const) {
    for (const manual of [true, false, undefined]) {
      const r = resolveMatchConflict(
        { is_valid: s, score: 95, method: 'SKU',   rejected_reason: null, manual },
        { is_valid: l, score: 70, method: 'MODEL', rejected_reason: 'x',  manual },
      )
      assert.equal(r.action, 'abort', `survivor=${s} loser=${l} manual=${manual} must abort`)
    }
  }
})

test('rejection dominates and is never silently promoted', () => {
  const r = resolveMatchConflict(
    { is_valid: null,  score: 70, method: 'MODEL', rejected_reason: null },
    { is_valid: false, score: 95, method: 'SKU',   rejected_reason: 'accessory' },
  )
  assert.equal(r.action, 'merge')
  if (r.action !== 'merge') return
  assert.equal(r.resolved.is_valid, false)
  assert.equal(r.resolved.rejected_reason, 'accessory', 'the rejection reason must survive')
  assert.equal(r.resolved.score, 95, 'strongest evidence survives')
  assert.equal(r.resolved.method, 'SKU')
})

test('confirmation beats unreviewed; unreviewed pairs stay unreviewed', () => {
  const t = resolveMatchConflict(
    { is_valid: null, score: 70, method: 'MODEL', rejected_reason: null },
    { is_valid: true, score: 80, method: 'SYNONYM', rejected_reason: null },
  )
  assert.equal(t.action === 'merge' && t.resolved.is_valid, true)

  const n = resolveMatchConflict(
    { is_valid: null, score: 70, method: 'MODEL', rejected_reason: null },
    { is_valid: null, score: 70, method: 'MODEL', rejected_reason: null },
  )
  assert.equal(n.action === 'merge' && n.resolved.is_valid, null)
})

// ── identifier safety (Prompt 02D) ────────────────────────────────────────
// Migration 054 removes 'PAUL', 'TOM' and '335' from kg_identifier, but
// data/knowledge-graph.json still seeds them and
// scripts/import-knowledge-graph.ts wipes and re-inserts the whole table. This
// guard is what stops the next `npm run import-kg` from putting them back.

test('the generic tokens migration 054 removes are rejected by the importer', () => {
  assert.equal(isUnsafeIdentifierValue('PAUL', 'SKU'), 'generic_token')
  assert.equal(isUnsafeIdentifierValue('paul', 'SKU'), 'generic_token')
  assert.equal(isUnsafeIdentifierValue('TOM',  'SKU'), 'generic_token')
  assert.equal(isUnsafeIdentifierValue('335',  'SKU'), 'bare_short_number')
})

test('legitimate manufacturer codes and model identifiers are accepted', () => {
  for (const [v, t] of [
    ['TR-909', 'SKU'], ['Stratocaster', 'SKU'], ['Les Paul', 'SKU'], ['ES-335', 'SKU'],
    ['MPC2000XL', 'SKU'], ['SP-1200', 'SKU'], ['U 87 Ai', 'SKU'], ['ILCE-7M4', 'SKU'],
    ['500-6B', 'SKU'], ['RB-338', 'SKU'],
  ] as const) {
    assert.equal(isUnsafeIdentifierValue(v, t), null, `${v} must be accepted`)
  }
})

test('EAN codes are exempt from the bare-number rule', () => {
  assert.equal(isUnsafeIdentifierValue('4548736018839', 'EAN'), null)
  // ...but a short bare number is still unsafe as a SKU.
  assert.equal(isUnsafeIdentifierValue('7865', 'SKU'), 'bare_short_number')
})

test('values below the matcher token floor are rejected', () => {
  // 'SG', 'DX', 'Z8' can never fire in the matcher (min token length 3), so
  // storing them as score-95 evidence is misleading.
  for (const v of ['SG', 'DX', 'Z8']) {
    assert.equal(isUnsafeIdentifierValue(v, 'SKU'), 'too_short')
  }
})

test('filterIdentifiers partitions a seed batch and explains each rejection', () => {
  const { safe, rejected } = filterIdentifiers([
    { type: 'SKU', value: 'PAUL' },
    { type: 'SKU', value: 'Les Paul' },
    { type: 'SKU', value: '335' },
    { type: 'EAN', value: '4548736018839' },
    { type: 'SKU', value: 'TR-909' },
  ])
  assert.deepEqual(safe.map((s) => s.value), ['Les Paul', '4548736018839', 'TR-909'])
  assert.deepEqual(
    rejected.map((r) => `${r.value}:${r.reason}`),
    ['PAUL:generic_token', '335:bare_short_number'],
  )
})

test('the importer routes seed identifiers through the safety filter', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../import-knowledge-graph.ts'), 'utf8')
  assert.ok(src.includes('filterIdentifiers('), 'importer must filter seed identifiers')
  assert.ok(/rejectedIdents/.test(src), 'importer must report what it dropped')
})

test('migration 054 targets exactly the values the safety filter rejects', () => {
  // Keeps the SQL and the code-side guard from drifting apart.
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/054_identifier_curation.sql'), 'utf8')
  for (const v of ['PAUL', 'TOM', '335']) {
    assert.ok(sql.includes(`'${v}'`), `054 must reference ${v}`)
    assert.notEqual(isUnsafeIdentifierValue(v, 'SKU'), null, `${v} must also be rejected in code`)
  }
  // And the two symmetric additions must NOT be rejected by the filter.
  for (const v of ['Les Paul', 'ES-335']) {
    assert.equal(isUnsafeIdentifierValue(v, 'SKU'), null)
  }
})

// ── seed / migration-054 canonical equivalence (Prompt 02E) ───────────────
//
// The importer wipes kg_identifier and rebuilds it from the seed, so the SEED
// is authoritative for identifier MEMBERSHIP. Migration 054 writes directly to
// the database; without a matching seed change the next clean import would
// erase its additions and recreate the asymmetric cross-brand data.

const SEED = loadSeed()
const SEED_IDENTS = deriveSeedIdentifiers(SEED)

test('a clean rebuild produces no unsafe identifier values', () => {
  for (const bad of CURATION_054_CONTRACT.removedValues) {
    const hits = SEED_IDENTS.filter((r) => r.normalised === bad)
    assert.deepEqual(hits, [], `seed still yields unsafe identifier '${bad}': ${JSON.stringify(hits)}`)
  }
})

test('a clean rebuild produces no duplicate normalised (slug, type, value) tuples', () => {
  assert.deepEqual(duplicateNormalisedTuples(SEED_IDENTS), [])
})

test('Les Paul and ES-335 are symmetric in the seed, matching 054 POST', () => {
  for (const { normalised, slugs } of CURATION_054_CONTRACT.symmetric) {
    const owners = SEED_IDENTS.filter((r) => r.normalised === normalised).map((r) => r.slug).sort()
    assert.deepEqual(owners, [...slugs].sort(),
      `'${normalised}' must be seeded on exactly ${slugs.join(' + ')}, got ${owners.join(' + ')}`)
  }
})

test('migration 053 retired losers receive no identifiers from a clean import', () => {
  const offenders = SEED_IDENTS.filter((r) => RETIRED_053_SLUGS.includes(r.slug))
  assert.deepEqual(offenders, [],
    `retired product(s) would be re-seeded with identifiers: ${JSON.stringify(offenders)}`)
})

test('the Reference Gold identifier survives on the 053 SURVIVOR slug', () => {
  // Explicit, narrow record of the one re-keyed seed entry: the loser
  // `manley-ref-gold` held the only "Reference Gold" identifier, so the seed
  // entry was re-keyed to the survivor rather than deleted.
  const owners = SEED_IDENTS.filter((r) => r.normalised === 'reference gold').map((r) => r.slug)
  assert.deepEqual(owners, ['manley-reference-gold'])
  assert.ok(!SEED_IDENTS.some((r) => r.slug === 'manley-ref-gold'))
})

test('seed model fields still drive model_name for the curated products', () => {
  // The seed's `model` populates kg_product.model_name (score-70 tier), which
  // is a different concern from kg_identifier (score-95). A clean import must
  // not regress these back to 'PAUL' / '335'.
  const products = seedProducts(SEED)
  assert.equal(products.get('gibson-les-paul')?.model, 'Les Paul')
  assert.equal(products.get('gibson-es-335')?.model, 'ES-335')
  // TOM remains a legitimate model_name even though it is not a safe identifier.
  assert.equal(products.get('sequential-tom')?.model, 'TOM')
  assert.deepEqual(products.get('sequential-tom')?.sku, [])
})

test('the seed manifest is deterministic and order-independent', () => {
  const a = manifestChecksum(deriveSeedIdentifiers(SEED))
  const b = manifestChecksum([...deriveSeedIdentifiers(SEED)].reverse())
  assert.equal(a, b)
})

test('the importer preserves existing product status and paginates its id map', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../import-knowledge-graph.ts'), 'utf8')
  assert.ok(src.includes('fetchStatusMap('),
    'importer must preserve existing status so retired products are not reactivated')
  assert.ok(/range\(offset, offset \+ 999\)/.test(src),
    'importer id/status maps must paginate past the PostgREST 1000-row cap')
})

// ── active-only eligibility (Prompt 02F) ──────────────────────────────────
//
// Migration 053 retires duplicate losers with status='inactive' and never
// touches model_name. Before this fix `PRODUCT_SELECT` did not load `status`
// and no caller filtered it, so the production index held 3,862 products
// including 293 inactive ones — and a retired duplicate kept producing
// product_data_conflict against its own survivor.

/** The 053 shape: survivor active, duplicate retired, identical brand+model. */
const RETIRED_DUPLICATE: Product = {
  id: 'p-manley-core-loser', slug: 'manley-manley-core',
  canonical_name: 'Manley CORE', model_name: 'CORE', brand_name: 'manley', status: 'inactive', support_state: 'supported',
}
const ACTIVE_SURVIVOR: Product = {
  id: 'p-manley-core', slug: 'manley-core',
  canonical_name: 'Manley CORE', model_name: 'CORE', brand_name: 'manley', status: 'active', support_state: 'supported',
}

test('a retired duplicate cannot create product_data_conflict against its survivor', () => {
  const withRetired = buildMatchIndex([...FULL_PRODUCTS, ACTIVE_SURVIVOR, RETIRED_DUPLICATE], [], [])
  const d = decideMatch('Manley CORE mastering compressor', withRetired)
  assert.equal(d.kind, 'matched', `expected a clean match, got ${d.kind}`)
  if (d.kind !== 'matched') return
  assert.equal(d.best.product_id, ACTIVE_SURVIVOR.id)

  // Control: if the duplicate were still ACTIVE, this is exactly the conflict
  // migration 053 is meant to remove — proving the test targets the real cause.
  const bothActive = buildMatchIndex(
    [...FULL_PRODUCTS, ACTIVE_SURVIVOR, { ...RETIRED_DUPLICATE, status: 'active', support_state: 'supported' }], [], [])
  assertDeferred(decideMatch('Manley CORE mastering compressor', bothActive), 'product_data_conflict')
})

test('an inactive product cannot be matched even as the sole lexical candidate', () => {
  const onlyInactive = buildMatchIndex([{
    id: 'p-only-inactive', slug: 'retired-widget',
    canonical_name: 'Retired Widget', model_name: 'Widget9000',
    brand_name: 'retiredbrand', status: 'inactive', support_state: 'supported',
  }], [], [])
  // Brand AND model both present in the title: a guaranteed match if eligible.
  assert.equal(decideMatch('Retiredbrand Widget9000 for sale', onlyInactive).kind, 'none')
})

test('an inactive product is excluded even with a score-95 identifier', () => {
  const idx = buildMatchIndex(
    [{ ...ROLAND_JUNO106, id: 'p-inactive-juno', status: 'inactive', support_state: 'supported' }],
    [{ product_id: 'p-inactive-juno', type: 'SKU', value: 'Juno-106' }], [])
  assert.equal(decideMatch('Roland Juno-106 synthesizer', idx).kind, 'none')
})

test('null, empty and unknown status all fail closed', () => {
  for (const status of [null, '', 'Active', 'ACTIVE', 'archived', 'draft', 'pending'] as const) {
    const idx = buildMatchIndex(
      [{ ...ROLAND_JUNO106, id: 'p-odd-status', status: status as string | null }], [], [])
    assert.equal(
      decideMatch('Roland Juno-106 synthesizer', idx).kind, 'none',
      `status=${JSON.stringify(status)} must be ineligible (exact 'active' only)`)
  }
  // ...and the exact value is eligible.
  assert.equal(isMatchableProduct({ status: MATCHABLE_STATUS, support_state: MATCHABLE_SUPPORT_STATE }), true)
  assert.equal(isMatchableProduct({ status: 'inactive', support_state: MATCHABLE_SUPPORT_STATE }), false)
  assert.equal(isMatchableProduct({ status: null, support_state: MATCHABLE_SUPPORT_STATE }), false)
})

// ── support axis (migration 056) ──────────────────────────────────────────
//
// Identity and support are different questions. The KG is the verified-product
// universe; the launch cohort is a small explicitly frozen subset. A product
// may be a perfectly valid music identity and still not be a match target.

test('support_state gates matcher eligibility independently of status', () => {
  for (const support of [null, '', 'known', 'reserve', 'Supported', 'SUPPORTED'] as const) {
    assert.equal(
      isMatchableProduct({ status: MATCHABLE_STATUS, support_state: support as string | null }), false,
      `support_state=${JSON.stringify(support)} must be ineligible (exact 'supported' only)`)
  }
  assert.equal(isMatchableProduct({ status: MATCHABLE_STATUS, support_state: MATCHABLE_SUPPORT_STATE }), true)
})

test('known and reserve products are never matcher targets', () => {
  for (const support of ['known', 'reserve']) {
    const idx = buildMatchIndex(
      [{ ...ROLAND_JUNO106, support_state: support }],
      [{ product_id: ROLAND_JUNO106.id, type: 'SKU', value: 'Juno-106' }], [])
    assert.equal(decideMatch('Roland Juno-106 synthesizer, nysynet', idx).kind, 'none',
      `support_state='${support}' must produce no candidate even at the identifier tier`)
  }
  // The same product, supported, does match — so the gate is the only difference.
  const ok = buildMatchIndex([ROLAND_JUNO106],
    [{ product_id: ROLAND_JUNO106.id, type: 'SKU', value: 'Juno-106' }], [])
  assert.equal(decideMatch('Roland Juno-106 synthesizer, nysynet', ok).kind, 'matched')
})

test('a row loaded without support_state is ineligible (fail-closed)', () => {
  const row = normalizeProductRow({
    id: 'x', slug: 's', canonical_name: 'Roland Juno-106', model_name: 'Juno-106',
    status: 'active', kg_brand: { name: 'Roland' },
  } as Parameters<typeof normalizeProductRow>[0])
  assert.equal(row.support_state, null)
  assert.equal(isMatchableProduct(row), false)
})

test('brand protection covers verified brands with NO supported product', () => {
  // Tokai is a legitimate manufacturer. None of its products is supported, so
  // it contributes no candidate — but a Tokai title must still be recognised as
  // a Tokai and must not become a Gibson.
  const tokai: Product = {
    id: 'p-tokai', slug: 'tokai-love-rock', canonical_name: 'Tokai Love Rock',
    model_name: 'Love Rock', brand_name: 'tokai', status: 'active', support_state: 'known',
  }
  const idx = buildMatchIndex([GIBSON_LES_PAUL, tokai],
    [{ product_id: GIBSON_LES_PAUL.id, type: 'SKU', value: 'Les Paul' }], [])
  assert.ok(idx.catalogueBrands.has('tokai'), 'verified brand must survive into brand protection')
  assert.ok(!idx.products.some(p => p.id === 'p-tokai'), 'unsupported product must not be a candidate')
  const d = decideMatch('Tokai Love Rock LS-120 Les Paul type', idx)
  assert.notEqual(d.kind, 'matched', 'a Tokai title must never become a trusted Gibson match')
})

test('deprecated non-music brands never become brand evidence', () => {
  // Apple has 9 products in the KG, all status='inactive'. Brand protection is
  // derived from ACTIVE identities, so "Candy Apple Red" cannot read as a brand.
  const apple: Product = {
    id: 'p-apple', slug: 'apple-logic', canonical_name: 'Apple Logic',
    model_name: 'Logic', brand_name: 'apple', status: 'inactive', support_state: 'known',
  }
  const idx = buildMatchIndex([...FULL_PRODUCTS, apple], [], [])
  assert.ok(!idx.catalogueBrands.has('apple'), 'inactive non-music brand must not be brand evidence')
})

test('an explicit verified-brand set overrides the derived one', () => {
  const idx = buildMatchIndex(FULL_PRODUCTS, [], [], ['Tokai', 'Greco', ' BURNY '])
  assert.deepEqual([...Array.from(idx.catalogueBrands)].sort(), ['burny', 'greco', 'tokai'])
})

test('active products retain every existing matching behaviour', () => {
  // Spot-check one case from each tier alongside an inactive decoy sharing the
  // same model_name, proving exclusion changes nothing for eligible products.
  const decoys: Product[] = FULL_PRODUCTS.map((p, i) => ({
    ...p, id: `decoy-${i}`, slug: `decoy-${i}`, status: 'inactive', support_state: 'supported',
  }))
  const idx = buildMatchIndex([...FULL_PRODUCTS, ...decoys], [
    { product_id: ROLAND_JUNO106.id, type: 'SKU', value: 'Juno-106' },
  ], [])
  const ident = decideMatch('JUNO-106 vintage polysynth', idx)
  assert.equal(ident.kind === 'matched' && ident.best.score, 95)
  const model = decideMatch('Gibson Les Paul Standard 2005', idx)
  assert.equal(model.kind === 'matched' && model.best.product_id, GIBSON_LES_PAUL.id)
  assertDeferred(decideMatch('Fender Jazz Bass pickups', idx), 'non_product_intent')
})

test('eligibility is applied before brand and shared-identifier derivation', () => {
  // An inactive product must not contribute its brand to catalogue-brand
  // evidence, nor make an identifier term look "shared".
  const idx = buildMatchIndex([
    GIBSON_LES_PAUL,
    { ...EPIPHONE_LES_PAUL, status: 'inactive', support_state: 'supported' },
  ], [{ product_id: GIBSON_LES_PAUL.id, type: 'SKU', value: 'Les Paul' }], [])
  assert.ok(!idx.catalogueBrands.has('epiphone'), 'inactive brand must not enter brand evidence')
  assert.ok(!idx.sharedIdentifiers.has('les paul'), 'term is exclusive once the inactive sibling is excluded')
  const d = decideMatch('Les Paul Standard 2012', idx)
  assert.equal(d.kind, 'matched')
  if (d.kind === 'matched') assert.equal(d.best.product_id, GIBSON_LES_PAUL.id)
})

test('eligibility is order-independent', () => {
  const mixed = [...FULL_PRODUCTS, ACTIVE_SURVIVOR, RETIRED_DUPLICATE]
  const fwd = decideMatch('Manley CORE mastering compressor', buildMatchIndex(mixed, [], []))
  const rev = decideMatch('Manley CORE mastering compressor', buildMatchIndex([...mixed].reverse(), [], []))
  assert.deepEqual(rev, fwd)
})

test('every matcher caller inherits active-only eligibility', () => {
  const repoRoot = path.resolve(__dirname, '../..')
  // No caller may re-implement or bypass the eligibility rule.
  for (const rel of [
    'scripts/match-listings.ts',
    'frontend/app/api/cron/scrape/route.ts',
    'scripts/report-match-backlog.ts',
  ]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    assert.ok(!/isMatchableProduct|MATCHABLE_STATUS *=/.test(src),
      `${rel} must not reimplement eligibility — it inherits it from buildMatchIndex`)
  }
  const core = fs.readFileSync(
    path.join(repoRoot, 'frontend/lib/matching/match-listings.ts'), 'utf8')
  // Enforced in the shared index (fail-closed) AND in the query (defence in depth).
  assert.ok(core.includes('products = products.filter(isMatchableProduct)'),
    'buildMatchIndex must filter to eligible products')
  assert.ok(core.includes("eq('status', MATCHABLE_STATUS)"),
    'matchListings must also filter server-side')
  assert.ok(core.includes('status, kg_brand(name)'), 'PRODUCT_SELECT must load status')
})

test('historical matches on inactive products are never mutated by the matcher', () => {
  // The matcher only ever writes rows it decides on; excluding a product from
  // candidate generation cannot delete or alter its existing matches.
  const core = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/lib/matching/match-listings.ts'), 'utf8')
  assert.ok(!/\.delete\(/.test(core), 'the matcher must never delete match rows')
  const writes = core.match(/\.(upsert|insert|update|delete)\(/g) ?? []
  assert.deepEqual(writes, ['.upsert('], 'exactly one write call, the guarded upsert')
})

// ── bounded new-inflow boundary (Prompt 02D-C) ────────────────────────────
//
// The PM2 path may consider only listings its own scrape batch just wrote.
// The pre-activation unmatched backlog must be unreachable from any schedule.

/**
 * Minimal chainable/thenable fake. Records every id list the matcher asked
 * about, and returns empty result sets so no real query is needed.
 */
function fakeSupabase(seen: string[][]) {
  const builder: Record<string, unknown> = {}
  const self = () => builder
  for (const m of ['select', 'eq', 'not', 'order', 'limit']) builder[m] = self
  // Record the column so listing-id lookups can be told apart from the
  // matcher's own `.in('type', ['SKU','MODEL'])` filter.
  builder.in = (col: string, ids: string[]) => { seen.push([col, ...ids]); return builder }
  builder.range = () => Promise.resolve({ data: [], error: null })
  // Awaiting the builder directly (the listings query does this) resolves empty.
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { from: () => builder } as unknown as Parameters<typeof matchScrapedBatch>[0]
}

test('a bounded batch offers exactly its own ids, deduplicated', async () => {
  const seen: string[][] = []
  const r = await matchScrapedBatch(fakeSupabase(seen), 'finn',
    ['a', 'b', 'a', 'c', 'b'])
  assert.equal(r.considered, 3, 'duplicates must collapse')
  assert.equal(r.skipped, undefined)
  // Only batch ids ever reach the matcher; nothing is selected by recency.
  const offeredIds = seen.filter(c => c[0] === 'id').flatMap(c => c.slice(1))
  assert.deepEqual([...new Set(offeredIds)].sort(), ['a', 'b', 'c'])
  assert.ok(seen.some(c => c[0] === 'id'), 'the listing lookup must be by explicit id')
})

test('an absent or empty boundary performs zero work', async () => {
  for (const ids of [[], [null], [undefined], ['', null]] as Array<Array<string | null | undefined>>) {
    const seen: string[][] = []
    const r = await matchScrapedBatch(fakeSupabase(seen), 'finn', ids)
    assert.equal(r.skipped, 'no_batch_ids')
    assert.equal(r.considered, 0)
    assert.deepEqual(seen, [], 'no query may be issued without a boundary')
  }
})

test('an unsupported source performs zero work', async () => {
  const seen: string[][] = []
  const r = await matchScrapedBatch(fakeSupabase(seen), 'thomann', ['a', 'b'])
  assert.equal(r.skipped, 'source_not_matchable')
  assert.deepEqual(seen, [])
})

test('an implausibly large batch is refused rather than becoming unbounded', async () => {
  const seen: string[][] = []
  const many = Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => `id-${i}`)
  const r = await matchScrapedBatch(fakeSupabase(seen), 'dba.dk', many)
  assert.match(String(r.skipped), /^batch_too_large_/)
  assert.deepEqual(seen, [])
})

test('a matcher failure is contained and never falsifies scraper success', async () => {
  // A pre-handled rejection: matchListings issues four queries via Promise.all,
  // so a bare throw would leave sibling rejections unhandled and crash the
  // runner. Marking the base promise handled keeps the test about containment.
  const boom = Promise.reject(new Error('connection reset'))
  boom.catch(() => {})
  const failing: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in']) failing[m] = () => failing
  failing.range = () => boom
  failing.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => boom.then(res, rej)
  const exploding = { from: () => failing } as unknown as Parameters<typeof matchScrapedBatch>[0]
  const r = await matchScrapedBatch(exploding, 'finn', ['a'])
  assert.match(String(r.skipped), /^matcher_error:/)
  assert.equal(r.matched, 0)
})

test('every marketplace scraper hands off a bounded batch after a successful write', () => {
  const root = path.resolve(__dirname, '../..')
  const expected: Array<[string, string]> = [
    ['scripts/scrape-dba.ts',           'dba.dk'],
    ['scripts/scrape-finn.ts',          'finn'],
    ['scripts/scrape-blocket.ts',       'blocket'],
    ['scripts/scrape-kleinanzeigen.ts', 'kleinanzeigen'],
    ['scripts/scrape-reverb.ts',        'reverb'],
  ]
  for (const [rel, source] of expected) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.ok(src.includes('matchScrapedBatch('), `${rel} must hand off to the shared bounded matcher`)
    assert.ok(src.includes(`'${source}'`), `${rel} must declare its source as ${source}`)
    // No scraper may select its own work by time or "unmatched" status.
    assert.ok(!/order\('scraped_at'/.test(src), `${rel} must not select matcher work by recency`)
  }
})

test('the scheduled PM2 config cannot reach historical backlog mode', () => {
  const root = path.resolve(__dirname, '../..')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const eco = require(path.join(root, 'ecosystem.config.js')) as { apps: Array<{ name: string; args?: string }> }
  const names = eco.apps.map((a) => a.name)
  assert.ok(!names.includes('match-listings'), 'the unbounded hourly matcher must not be scheduled')
  for (const app of eco.apps) {
    assert.ok(!String(app.args ?? '').includes('match-listings'),
      `PM2 app ${app.name} must not invoke match-listings`)
    assert.ok(!String(app.args ?? '').includes('--historical-backfill'),
      `PM2 app ${app.name} must not invoke historical mode`)
  }
})

test('the CLI refuses to run without an explicit historical opt-in', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../match-listings.ts'), 'utf8')
  assert.ok(src.includes("if (!HISTORICAL) {"), 'default mode must refuse')
  assert.ok(src.includes('--sources='), 'historical mode must require an explicit source set')
  assert.ok(src.includes('--max='), 'historical mode must require an explicit maximum')
  assert.ok(src.includes('const DRY_RUN = !APPLY'), 'historical mode must be dry-run by default')
  // package.json must not expose an unbounded default entry point.
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
  for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) {
    if (!cmd.includes('match-listings.ts')) continue
    assert.ok(cmd.includes('--historical-backfill'),
      `npm script "${name}" must not invoke match-listings without --historical-backfill`)
    assert.ok(!cmd.includes('--apply'), `npm script "${name}" must not pre-authorise --apply`)
  }
})

// ── Vercel watchlist route: first-ingestion boundary ──────────────────────
//
// SUPERSEDES 'the Vercel batch-scoped route keeps its existing per-watchlist
// boundary', which asserted the exact defect this section closes. That test
// required `matchListings(getSupabaseAdmin(), ids)` where `ids` came from
// `upserted.map(...)` — i.e. raw upsert output. An `ON CONFLICT DO UPDATE`
// returns REFRESHED rows too, so those ids were never proof of first
// ingestion and the route sat outside the contract migration 055 enforces on
// every other writer. It is the one test-only correction this work required.

test('the Vercel route stamps every insert and never trusts upsert output', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/app/api/cron/scrape/route.ts'), 'utf8')
  // Comments must be free to NAME the rejected mechanisms as the rationale;
  // only executable code is held to the negative assertions below.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // One id per EXECUTION, minted before the watchlist loop.
  assert.equal((src.match(/newIngestionBatchId\(\)/g) ?? []).length, 1,
    'exactly one batch id per route execution')
  // Both write paths (listing-type and query-type) stamp it.
  assert.equal((src.match(/ingestion_batch_id: ingestionBatchId/g) ?? []).length, 2,
    'both watchlist write paths must stamp the execution identity')
  // Database time only — the route must never send an ingestion timestamp.
  assert.ok(!/ingested_at/.test(code),
    'ingested_at is established by migration 055, never by the application')

  // The old eligibility sources must be gone. (`upserted:` survives as a
  // RESPONSE field — rows written — but no id may be derived from the write.)
  assert.ok(!/data:\s*upserted/.test(code), 'the upsert must not return rows at all')
  assert.ok(!/upserted\.map|upserted\?\./.test(code),
    'upsert output must not survive as an id source')
  assert.ok(!/\.upsert\([^)]*\)[\s\S]{0,120}?\.select\(/.test(code),
    'no listing write may select ids back for matching')
  assert.ok(!/matchListings\(/.test(code), 'the route must not call the core directly any more')
  // and no time/recency inference may have replaced them.
  assert.ok(!/order\(['"]scraped_at['"]\)/.test(code) && !/first_seen_at/.test(code),
    'eligibility must never be inferred from timestamps')

  // Exactly one execution-scoped handoff, after the loop.
  assert.equal((src.match(/matchRunInflow\(/g) ?? []).length, 1,
    'one execution-scoped handoff, not one per watchlist')
  assert.ok(src.indexOf('matchRunInflow(') > src.lastIndexOf('results.push({'),
    'the handoff must run after every watchlist has been written')
})

test('no normal scheduler can reach historical mode — including Vercel', () => {
  const root = path.resolve(__dirname, '../..')
  const vercel = JSON.parse(
    fs.readFileSync(path.join(root, 'frontend/vercel.json'), 'utf8'),
  ) as { crons: Array<{ path: string; schedule: string }> }
  assert.deepEqual(vercel.crons.map((c) => c.path), ['/api/cron/scrape'],
    'the only scheduled Vercel route is the watchlist cron')
  const src = fs.readFileSync(
    path.join(root, 'frontend/app/api/cron/scrape/route.ts'), 'utf8')
  assert.ok(!/historical|--sources=|--max=/i.test(src),
    'the scheduled route must have no historical path at all')
  assert.ok(!/match-listings/.test(src),
    'the scheduled route must not reach the historical CLI')
})

// ── Execution-scoped handoff: behavioural evidence ────────────────────────
//
// A FakeRow store plus `applyIngestionTrigger` reproduces migration 055's
// contract exactly: INSERT with a batch id establishes identity; UPDATE (which
// is what `ON CONFLICT DO UPDATE` performs) carries the ORIGINAL pair over
// verbatim. The SQL itself is asserted separately by 'migration 055 keeps
// first-ingestion identity write-once'.

interface FakeRow {
  id: string
  title: string
  source: string
  url: string
  watchlist_id: string
  ingestion_batch_id: string | null
}

/** Migration 055's trigger, in TypeScript. Conflict target: (url, watchlist_id). */
function applyIngestionTrigger(
  store: FakeRow[],
  payloads: Array<{ id: string; title: string; source: string; url: string; watchlist_id: string; ingestion_batch_id: string }>,
): void {
  for (const p of payloads) {
    const existing = store.find(r => r.url === p.url && r.watchlist_id === p.watchlist_id)
    if (existing) {
      // UPDATE path: every ordinary field refreshes, identity NEVER changes.
      existing.title  = p.title
      existing.source = p.source
      continue
    }
    store.push({ ...p })  // INSERT path: identity established
  }
}

/**
 * Minimal Supabase fake backed by `store`. Serves `fetchBatchListingIds`'s
 * `(source, ingestion_batch_id)` lookup and `matchListings`' own queries, and
 * records every listing-id list actually offered to the matcher.
 */
function fakeInflowDb(store: FakeRow[], opts: { lookupFails?: boolean } = {}) {
  const offered: string[][] = []
  const matchWrites: unknown[] = []

  const from = (table: string) => {
    const eq: Record<string, unknown> = {}
    let cols = ''
    let ids: string[] | null = null
    const b: Record<string, unknown> = {}
    const self = () => b
    b.select = (c: string) => { cols = c; return b }
    b.eq = (c: string, v: unknown) => { eq[c] = v; return b }
    b.not = self
    b.order = self
    b.limit = self
    b.in = (c: string, v: string[]) => {
      if (c === 'id') { ids = v; offered.push(v) }
      return b
    }
    b.upsert = (rows: unknown[]) => { matchWrites.push(...rows); return Promise.resolve({ error: null }) }

    const rows = (): { data: unknown[] | null; error: { message: string } | null } => {
      if (table !== 'listings') return { data: [], error: null }
      if (cols.includes('ingestion_batch_id')) {
        if (opts.lookupFails) return { data: null, error: { message: 'connection reset' } }
        return {
          data: store
            .filter(r => r.source === eq.source && r.ingestion_batch_id === eq.ingestion_batch_id)
            .map(r => ({ id: r.id, ingestion_batch_id: r.ingestion_batch_id })),
          error: null,
        }
      }
      // matchListings' own `select('id, title').in('id', ...)`
      return { data: store.filter(r => ids?.includes(r.id)).map(r => ({ id: r.id, title: r.title })), error: null }
    }

    b.range = () => Promise.resolve(rows())
    b.then = (res: (v: unknown) => unknown) => res(rows())
    return b
  }

  return {
    client: { from } as unknown as Parameters<typeof matchRunInflow>[0],
    offered,
    matchWrites,
    /** Every listing id handed to the matcher across all chunks. */
    handedOff: () => offered.flat(),
  }
}

const VERCEL_SOURCES = ['dba.dk']

function vercelPayload(batchId: string, url: string, watchlist = 'wl-1', source = 'dba.dk') {
  return {
    id: `row-${url}-${watchlist}`,
    title: 'Zzzz unmatched placeholder title',
    source,
    url,
    watchlist_id: watchlist,
    ingestion_batch_id: batchId,
  }
}

test('a newly inserted Vercel row gets this execution batch and is handed off once', async () => {
  const store: FakeRow[] = []
  const batch = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(batch, '/a'), vercelPayload(batch, '/b')])

  assert.deepEqual(store.map(r => r.ingestion_batch_id), [batch, batch])

  const db = fakeInflowDb(store)
  const r = await matchRunInflow(db.client, batch, VERCEL_SOURCES)
  assert.equal(r.complete, true)
  assert.equal(r.results[0].considered, 2)
  assert.deepEqual(db.handedOff().sort(), ['row-/a-wl-1', 'row-/b-wl-1'])
})

test('a legacy NULL row refreshed by the Vercel upsert stays NULL and is never handed off', async () => {
  // Pre-activation inventory: inserted before migration 055, identity NULL.
  const store: FakeRow[] = [{
    id: 'legacy-1', title: 'Legacy row', source: 'dba.dk',
    url: '/legacy', watchlist_id: 'wl-1', ingestion_batch_id: null,
  }]
  const batch = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(batch, '/legacy')])

  assert.equal(store.length, 1, 'a refresh must not create a second row')
  assert.equal(store[0].ingestion_batch_id, null,
    'conflict refresh must preserve the legacy NULL identity')

  const db = fakeInflowDb(store)
  const r = await matchRunInflow(db.client, batch, VERCEL_SOURCES)
  assert.equal(r.results[0].skipped, 'no_batch_ids')
  assert.deepEqual(db.handedOff(), [], 'a rescraped legacy row is not new inflow')
  assert.deepEqual(db.matchWrites, [], 'zero matcher writes')
})

test('a post-activation row refreshed by a later execution keeps its original batch', async () => {
  const store: FakeRow[] = []
  const first = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(first, '/a')])

  const second = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(second, '/a')])
  assert.equal(store[0].ingestion_batch_id, first,
    'identity is write-once; a later execution cannot claim the row')

  const db = fakeInflowDb(store)
  const r = await matchRunInflow(db.client, second, VERCEL_SOURCES)
  assert.equal(r.results[0].skipped, 'no_batch_ids')
  assert.deepEqual(db.handedOff(), [], 'already-ingested rows are not handed off again')
})

test('repeated execution over unchanged inventory hands off nothing', async () => {
  const store: FakeRow[] = []
  const b1 = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(b1, '/a'), vercelPayload(b1, '/b')])

  for (let i = 0; i < 3; i++) {
    const bn = newIngestionBatchId()
    applyIngestionTrigger(store, [vercelPayload(bn, '/a'), vercelPayload(bn, '/b')])
    const db = fakeInflowDb(store)
    const r = await matchRunInflow(db.client, bn, VERCEL_SOURCES)
    assert.deepEqual(db.handedOff(), [], `execution ${i + 2} must hand off nothing`)
    assert.equal(r.results[0].skipped, 'no_batch_ids')
  }
  assert.deepEqual(store.map(r => r.ingestion_batch_id), [b1, b1])
})

test('the same listing under several watchlists is written per watchlist and offered once each', async () => {
  // (url, watchlist_id) is the conflict target, so two watchlists tracking the
  // same URL are two distinct rows — but neither may be offered twice.
  const store: FakeRow[] = []
  const batch = newIngestionBatchId()
  applyIngestionTrigger(store, [
    vercelPayload(batch, '/shared', 'wl-1'),
    vercelPayload(batch, '/shared', 'wl-2'),
    vercelPayload(batch, '/shared', 'wl-1'),   // same watchlist again in one run
  ])
  assert.equal(store.length, 2)

  const db = fakeInflowDb(store)
  const r = await matchRunInflow(db.client, batch, ['dba.dk', 'dba.dk', ' dba.dk '])
  assert.equal(r.results.length, 1, 'duplicate source names must collapse')
  assert.equal(r.results[0].considered, 2)
  const handed = db.handedOff()
  assert.equal(handed.length, new Set(handed).size, 'no id may be offered twice')
})

test('a stored identity that is not this batch fails closed', async () => {
  // Defence in depth: the server-side filter is bypassed to prove the
  // in-memory re-check refuses a row that does not carry the batch id.
  const other = newIngestionBatchId()
  const store: FakeRow[] = [{
    id: 'x', title: 'T', source: 'dba.dk', url: '/x',
    watchlist_id: 'wl-1', ingestion_batch_id: other,
  }]
  const leaky = {
    from: () => {
      const b: Record<string, unknown> = {}
      const self = () => b
      for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in']) b[m] = self
      b.range = () => Promise.resolve({
        data: store.map(r => ({ id: r.id, ingestion_batch_id: r.ingestion_batch_id })),
        error: null,
      })
      return b
    },
  } as unknown as Parameters<typeof fetchBatchListingIds>[0]

  const ids = await fetchBatchListingIds(leaky, 'dba.dk', newIngestionBatchId())
  assert.equal(ids, null, 'a mismatched stored identity must fail the whole lookup')
})

test('an identity lookup failure performs zero matcher writes for the whole execution', async () => {
  const store: FakeRow[] = []
  const batch = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(batch, '/a'), vercelPayload(batch, '/r', 'wl-2', 'reverb')])

  const db = fakeInflowDb(store, { lookupFails: true })
  const r = await matchRunInflow(db.client, batch, ['dba.dk', 'reverb'])
  assert.equal(r.complete, false)
  assert.deepEqual(db.handedOff(), [])
  assert.deepEqual(db.matchWrites, [])
  const skips = r.results.map(x => x.skipped)
  assert.ok(skips.includes('batch_identity_lookup_failed'))
  assert.ok(skips.every(s => typeof s === 'string'), 'no source may be matched')
})

test('one failing source suppresses the OTHER source in the same execution', async () => {
  // Partial trust in an execution with known-incomplete boundary evidence is
  // exactly what the contract denies.
  const store: FakeRow[] = []
  const batch = newIngestionBatchId()
  applyIngestionTrigger(store, [vercelPayload(batch, '/a')])
  let call = 0
  const flaky = {
    from: () => {
      const eq: Record<string, unknown> = {}
      const b: Record<string, unknown> = {}
      const self = () => b
      for (const m of ['select', 'not', 'order', 'limit', 'in']) b[m] = self
      b.eq = (c: string, v: unknown) => { eq[c] = v; return b }
      b.range = () => {
        // 'dba.dk' sorts before 'reverb', so the first lookup succeeds.
        call += 1
        if (call > 1) return Promise.resolve({ data: null, error: { message: 'timeout' } })
        return Promise.resolve({
          data: store.filter(r => r.source === eq.source && r.ingestion_batch_id === eq.ingestion_batch_id)
            .map(r => ({ id: r.id, ingestion_batch_id: r.ingestion_batch_id })),
          error: null,
        })
      }
      b.then = (res: (v: unknown) => unknown) => res({ data: [], error: null })
      return b
    },
  } as unknown as Parameters<typeof matchRunInflow>[0]

  const r = await matchRunInflow(flaky, batch, ['dba.dk', 'reverb'])
  assert.equal(r.complete, false)
  assert.deepEqual(r.results.find(x => x.source === 'dba.dk')?.skipped,
    'execution_identity_incomplete')
  assert.ok(r.results.every(x => x.considered === 0 && x.matched === 0))
})

test('a malformed batch id performs zero lookups and zero writes', async () => {
  for (const bad of ['', 'not-a-uuid', '123', 'NULL', undefined as unknown as string]) {
    assert.equal(isIngestionBatchId(bad), false)
    const db = fakeInflowDb([])
    const r = await matchRunInflow(db.client, bad, VERCEL_SOURCES)
    assert.equal(r.batch_id_valid, false)
    assert.equal(r.complete, false)
    assert.equal(r.results[0].skipped, 'malformed_batch_id')
    assert.deepEqual(db.offered, [], 'no query may be issued without a usable batch id')
  }
  // A real minted id is accepted.
  assert.equal(isIngestionBatchId(newIngestionBatchId()), true)
})

test('an oversized execution batch is refused rather than becoming unbounded', async () => {
  const batch = newIngestionBatchId()
  const huge = Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => ({
    id: `id-${i}`, ingestion_batch_id: batch,
  }))
  let served = false
  const big = {
    from: () => {
      const b: Record<string, unknown> = {}
      const self = () => b
      for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in']) b[m] = self
      b.range = (lo: number) => {
        served = true
        return Promise.resolve({ data: huge.slice(lo, lo + 1000), error: null })
      }
      b.then = (res: (v: unknown) => unknown) => res({ data: [], error: null })
      return b
    },
  } as unknown as Parameters<typeof matchRunInflow>[0]

  const r = await matchRunInflow(big, batch, VERCEL_SOURCES)
  assert.ok(served, 'the lookup must actually have run')
  assert.equal(r.complete, false)
  assert.match(String(r.results[0].skipped), /^execution_batch_too_large_/)
  assert.equal(r.results[0].matched, 0)
})

test('a non-matchable source in the execution is skipped without a lookup', async () => {
  // The Vercel listing path can fetch Thomann URLs. Thomann is retail, not a
  // secondhand listing source, and must never enter product matching.
  const db = fakeInflowDb([])
  const r = await matchRunInflow(db.client, newIngestionBatchId(), ['thomann'])
  assert.equal(r.complete, true)
  assert.deepEqual(r.results.map(x => x.skipped), ['source_not_matchable'])
  assert.deepEqual(db.offered, [])
})

test('an execution that wrote nothing is a clean no-op', async () => {
  const db = fakeInflowDb([])
  const r = await matchRunInflow(db.client, newIngestionBatchId(), [])
  assert.equal(r.complete, true)
  assert.deepEqual(r.results, [])
  assert.deepEqual(db.offered, [])
})


// ── ingestion identity + copy/reference (Prompt 02G) ──────────────────────

test('every scraper generates one batch id and matches only DB-confirmed inserts', () => {
  const root = path.resolve(__dirname, '../..')
  for (const rel of [
    'scripts/scrape-dba.ts', 'scripts/scrape-finn.ts', 'scripts/scrape-blocket.ts',
    'scripts/scrape-kleinanzeigen.ts', 'scripts/scrape-reverb.ts',
  ]) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.ok(src.includes('fetchBatchListingIds('),
      `${rel} must re-query stored identity rather than trust upsert output`)
    assert.ok(src.includes('batch_identity_lookup_failed'),
      `${rel} must perform zero matcher writes when identity lookup fails`)
    // No scraper may hand the matcher raw upsert results any more.
    assert.ok(!/batchListingIds/.test(src), `${rel} must not pass refreshed upsert ids`)
  }
  // DBA uses the promotion run id as its batch identity; the other four mint one.
  const dba = fs.readFileSync(path.join(root, 'scripts/scrape-dba.ts'), 'utf8')
  assert.ok(dba.includes("fetchBatchListingIds(supabase, 'dba.dk', String(runId))"))
  for (const rel of ['scripts/scrape-finn.ts', 'scripts/scrape-blocket.ts',
                     'scripts/scrape-kleinanzeigen.ts', 'scripts/scrape-reverb.ts']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.ok(src.includes('newIngestionBatchId()'), `${rel} must mint a batch id`)
    assert.ok(src.includes('ingestion_batch_id: ingestionBatchId'),
      `${rel} must stamp every insert payload`)
  }
})

test('batch ids are unique per run and are real UUIDs', () => {
  const a = newIngestionBatchId(), b = newIngestionBatchId()
  assert.notEqual(a, b)
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
})

test('migration 055 keeps first-ingestion identity write-once', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/055_listing_ingestion_identity.sql'), 'utf8')
  // No DEFAULT — legacy rows must not gain an apparent ingestion time.
  assert.ok(!/ADD COLUMN[^;]*ingested_at[^;]*DEFAULT/i.test(sql))
  assert.ok(sql.includes('NEW.ingestion_batch_id := OLD.ingestion_batch_id'),
    'UPDATE must always carry the original identity over')
  assert.ok(sql.includes('NEW.ingested_at := now()'), 'INSERT must use DATABASE time')
  assert.ok(sql.includes('BEFORE INSERT OR UPDATE ON listings'))
  // first_seen_at must not be repurposed.
  assert.ok(!/first_seen_at\s*:?=\s*NEW\.ingested_at/.test(sql))
})

test('the three known copy/reference false positives fail closed', () => {
  const GIBSON_LP_ID = GIBSON_LES_PAUL.id
  const idx = buildMatchIndex(FULL_PRODUCTS, [
    { product_id: GIBSON_LP_ID, type: 'SKU', value: 'Les Paul' },
    { product_id: GIBSON_ES335.id, type: 'SKU', value: '335' },
  ], [])
  for (const title of [
    'Jackson USA Anthrax Korina JJ1 Scott Ian Gibson Les Paul DC Junior Guitar',
    'Jackson Scott Ian Anthrax JJ4 Signature Guitar Gibson Les Paul Jr MIJ Japan',
    'Leader Flashback 335 type elguitar i Candy Apple Red',
  ]) {
    const d = decideMatch(title, idx)
    assert.notEqual(d.kind, 'matched', `must not be trusted: ${title}`)
    if (d.kind === 'deferred') assert.equal(d.reason, 'copy_or_reference', title)
  }
})

test('copy/reference wording only fires when ADJACENT to the matched token', () => {
  const idx = buildMatchIndex(FULL_PRODUCTS, [], [])
  // Adjacent -> deferred.
  assertDeferred(decideMatch('Behringer K-2 MK2, Korg MS-20 Nachbau mit OVP', idx), 'copy_or_reference')
  assertDeferred(decideMatch('Custom made Fender Telecaster Style E-Gitarre', idx), 'copy_or_reference')
  // Real products whose NAME contains a reference word stay eligible.
  const t = decideMatch("Gibson Les Paul '52 Tribute Prototype Electric Guitar", idx)
  assert.equal(t.kind, 'matched', 'a genuine Gibson "Tribute" model must survive')
})

test('manufacturer collaborations and lead-brand listings are preserved', () => {
  const idx = buildMatchIndex(FULL_PRODUCTS, [], [])
  // Matched brand appears within the leading words -> keep.
  for (const title of [
    'Gibson Les Paul Standard 2005',
    'Fender Stratocaster American Standard 2012',
    'Roland Juno-106 synthesizer, nysynet',
  ]) {
    assert.equal(decideMatch(title, idx).kind, 'matched', `must stay eligible: ${title}`)
  }
})

test('the copy/reference rule is a closed table, not an open ontology', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/lib/matching/brand-guard.ts'), 'utf8')
  assert.ok(src.includes('EXTERNAL_BRAND_TOKENS'), 'external brands must be an explicit list')
  assert.ok(src.includes('OFFERED_BRAND_LEAD_WORDS'), 'lead-word threshold must be explicit')
  // No exact listing ids or full-title deny-lists IN CODE. Comments may (and
  // should) cite the observed titles as the evidence for each rule.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(code),
    'brand-guard code must not reference listing ids')
  assert.ok(!/Anthrax|Flashback/i.test(code), 'brand-guard code must not deny-list full titles')
  // Every token in the external list is a single brand word/phrase, not a title.
  for (const m of code.matchAll(/'([a-z ]+)',/g)) {
    assert.ok(m[1].split(' ').length <= 2, `external brand entry too long: ${m[1]}`)
  }
})

// ── product row normalisation ─────────────────────────────────────────────

test('embedded kg_brand is normalised from both object and array shapes', () => {
  const base = { id: 'x', slug: 's', canonical_name: 'C', model_name: 'M', status: 'active', support_state: 'supported' }
  assert.equal(normalizeProductRow({ ...base, kg_brand: { name: 'Gibson' } }).brand_name, 'gibson')
  assert.equal(normalizeProductRow({ ...base, kg_brand: [{ name: 'Fender' }] }).brand_name, 'fender')
  assert.equal(normalizeProductRow({ ...base, kg_brand: null }).brand_name, null)
  // status is carried through verbatim; a row without it is ineligible.
  assert.equal(normalizeProductRow({ ...base, kg_brand: null }).status, 'active')
  assert.equal(normalizeProductRow({ ...base, status: undefined as unknown as string, kg_brand: null }).status, null)
})

// ── legacy Kleinanzeigen price defect ─────────────────────────────────────

test('a plausible Kleinanzeigen price is included', () => {
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: 1249 }))
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: KLEINANZEIGEN_MAX_PRICE_EUR }))
})

test('a welded Kleinanzeigen discount pair is kept and recovered', () => {
  // Real production values: "1.249 €" struck through from "1.299 €", and
  // "2.650" from "2.750". Both are discounted ads, not corrupt numbers, so the
  // row stays and the current price is what every boundary reports.
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: 12491299 }))
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: 26502750 }))
  // Postgres numeric arrives over PostgREST as a string.
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: '12491299' }))
})

test('the predicate is NOT a global price ceiling', () => {
  // A Roland Jupiter-8 legitimately clears 160,000 DKK, and Reverb rows are
  // stored already converted to DKK. No non-Kleinanzeigen row may be dropped.
  assert.ok(hasPlausibleListingPrice({ source: 'reverb', price: 12491299 }))
  assert.ok(hasPlausibleListingPrice({ source: 'dba.dk', price: 999999999 }))
  assert.ok(hasPlausibleListingPrice({ source: 'finn', price: 26502750 }))
})

test('a null or unparseable price is not treated as a violation', () => {
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: null }))
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: undefined }))
  assert.ok(hasPlausibleListingPrice({ source: 'kleinanzeigen', price: 'n/a' }))
})

// ── product lifecycle: promotion seam and monitoring boundary (Prompt 04) ──

test('the promotion API separates support, visibility and monitoring', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/app/api/admin/products/[id]/route.ts'), 'utf8')
  // All four axes are named and mapped.
  for (const f of ['support_state', 'browse_visibility', 'tier', 'year_released'])
    assert.ok(src.includes(f), `promotion route must handle ${f}`)
  // Visibility and monitoring cannot ride along with a support promotion.
  assert.ok(src.includes("const mustDeclare: Axis[] = ['visibility', 'monitoring']"),
    'visibility and monitoring must require explicit intent')
  assert.ok(src.includes('undeclared_axis'), 'undeclared axis must fail closed')
  // A dry run exists and returns the same manifest without writing.
  assert.ok(/dryRun/.test(src) && src.includes('applied: false'),
    'promotion route must offer a non-writing preview')
  // An inactive identity can never be promoted to supported.
  assert.ok(src.includes('inactive_product_cannot_be_supported'))
  // Values are validated against closed sets.
  for (const c of ['SUPPORT_STATES', 'VISIBILITIES', 'TIERS'])
    assert.ok(src.includes(c), `${c} must be a closed set`)
})

test('the admin UI declares intent for the two consequential axes', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/app/admin/products/page.tsx'), 'utf8')
  assert.ok(src.includes("intent: ['monitoring']"), 'tier change must declare monitoring intent')
  assert.ok(src.includes("intent: ['visibility']"), 'visibility change must declare visibility intent')
})

// SUPERSEDED by 'no scraper selects products by editorial tier' (Prompt 04B).
// The old assertion required the scrapers to KEEP selecting on tier; the
// executable monitoring config deliberately removes that coupling.

test('the activation package adds support without touching tier, visibility or status', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/056_activation_package.sql'), 'utf8')
  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS support_state text NOT NULL DEFAULT 'known'"),
    "default must be 'known' (fail-closed), never 'supported'")
  assert.ok(sql.includes("CHECK (support_state IN ('known','reserve','supported'))"))
  const body = sql.replace(/--.*$/gm, '')
  // The ONE permitted UPDATE is the frozen-cohort promotion; it sets support only.
  const updates = body.match(/UPDATE kg_product[\s\S]*?;/g) ?? []
  assert.equal(updates.length, 1, 'exactly one UPDATE, the promotion')
  assert.ok(/SET support_state = 'supported'/.test(updates[0]))
  // Only the SET clause is an assignment; `p.status = 'active'` in the WHERE is
  // a filter and must not be read as one.
  const setClause = (updates[0].match(/SET([\s\S]*?)(?:\bFROM\b|\bWHERE\b)/) ?? [, ''])[1]
  for (const col of ['browse_visibility', 'tier', 'status', 'attributes', 'image_url'])
    assert.ok(!new RegExp(`\\b${col}\\b`).test(setClause), `promotion must not set ${col}`)
  for (const st of ["'PRE'", "'POST'", "'DRIFT'"]) assert.ok(sql.includes(st))
})

test('056 rollback refuses to erase promotion evidence by default', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/056_rollback.sql'), 'utf8')
  assert.ok(sql.includes('056_rollback REFUSED'), 'must refuse while evidence exists')
  assert.ok(sql.includes('keep_identities') && sql.includes('full'),
    'both documented escape modes must exist')
  assert.ok(!/DELETE FROM kg_product[\s\S]{0,200}$/m.test(sql.split('IF v_mode = \'full\'')[0] ?? ''),
    'no identity may be deleted outside the explicit full mode')
})

// ── activation package: atomic cutover (Prompt 04B) ───────────────────────

test('the activation package is ONE transaction with no zero-supported commit', () => {
  const root = path.resolve(__dirname, '../..')
  const sql = fs.readFileSync(path.join(root, 'scripts/migrations/056_activation_package.sql'), 'utf8')
  assert.equal((sql.match(/^BEGIN;$/gm) ?? []).length, 1, 'exactly one transaction')
  assert.equal((sql.match(/^COMMIT;$/gm) ?? []).length, 1, 'exactly one commit')
  // schema, data and promotion all inside it
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS support_state'))
  assert.ok(sql.includes('INSERT INTO kg_brand') && sql.includes('INSERT INTO kg_product'))
  assert.ok(sql.includes("SET support_state = 'supported'"))
  // the post-condition runs BEFORE the single COMMIT
  assert.ok(sql.lastIndexOf('expected exactly 48/0') < sql.lastIndexOf('COMMIT;'),
    'the 48-product assertion must precede COMMIT')
  // the superseded split package is gone
  for (const f of ['056_product_support_state.sql', '057_freeze_launch_cohort.sql', '056_057_release.sql'])
    assert.ok(!fs.existsSync(path.join(root, 'scripts/migrations', f)), `${f} must be retired`)
})

test('the activation package never publishes or changes monitoring', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/056_activation_package.sql'), 'utf8')
  const body = sql.replace(/--.*$/gm, '')
  assert.ok(!/UPDATE\s+kg_product[\s\S]{0,400}SET[\s\S]{0,200}browse_visibility/i.test(body),
    'must never update browse_visibility')
  assert.ok(!/UPDATE\s+kg_product[\s\S]{0,400}SET[\s\S]{0,200}\btier\b/i.test(body),
    'must never update tier')
  // additive rows arrive private, unmonitored and unsupported
  assert.ok(body.includes("'active', 'known', 'qa_only', 'standard'"),
    'additive products must default to known/private/unmonitored')
})

test('no scraper selects products by editorial tier', () => {
  const root = path.resolve(__dirname, '../..')
  for (const [rel, source] of [['scripts/scrape-dba.ts','dba.dk'], ['scripts/scrape-finn.ts','finn'],
      ['scripts/scrape-blocket.ts','blocket'], ['scripts/scrape-kleinanzeigen.ts','kleinanzeigen']] as const) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.ok(!/\.(in|eq)\('tier'/.test(src), `${rel} must not select products by tier`)
    assert.ok(src.includes(`monitoredSlugs('${source}')`), `${rel} must read the explicit set for ${source}`)
    assert.ok(src.includes("assertResolved("), `${rel} must fail loud on an unresolved configured product`)
  }
})

test('the monitoring config reproduces the pre-change source sets exactly', () => {
  const cfg = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../data/klup-source-monitoring.json'), 'utf8')).sources
  assert.equal(cfg['dba.dk'].products.length, 30)
  for (const s of ['finn', 'blocket', 'kleinanzeigen']) assert.equal(cfg[s].products.length, 28)
  // DBA is legendary+classic, the others legendary: a strict superset of exactly 2
  const d = new Set<string>(cfg['dba.dk'].products)
  const f: string[] = cfg.finn.products
  assert.ok(f.every(s => d.has(s)), 'dba must contain every finn product')
  assert.equal(cfg['dba.dk'].products.length - f.length, 2)
  // Reverb is a sweep, not a product list
  assert.equal(cfg.reverb.mode, 'broad_catalogue_sweep')
  assert.equal(cfg.reverb.products, null)
  // no duplicates anywhere
  for (const s of ['dba.dk', 'finn', 'blocket', 'kleinanzeigen']) {
    const p: string[] = cfg[s].products
    assert.equal(new Set(p).size, p.length, `${s} has duplicate slugs`)
  }
})

test('every matchable-labelled candidate has exactly one disposition', () => {
  const root = path.resolve(__dirname, '../..')
  const rows = fs.readFileSync(path.join(root, 'data/klup-candidate-disposition.csv'), 'utf8')
    .trim().split('\n').slice(1)
  assert.equal(rows.length, 194, 'all 194 matchable-labelled rows must be dispositioned')
  const OUTCOMES = ['existing_exact_kg_product', 'added_verified_kg_product',
    'registry_only_insufficient_identity', 'reclassified_navigation_or_discovery',
    'rejected_duplicate_nonproduct_or_unsafe', 'deferred_missing_named_evidence']
  for (const r of rows) assert.ok(OUTCOMES.some(o => r.includes(o)), `row has no valid outcome: ${r.slice(0, 60)}`)
})

test('the derived artefacts retain every source candidate', () => {
  const root = path.resolve(__dirname, '../..')
  const reg = fs.readFileSync(path.join(root, 'data/klup-product-candidate-registry.csv'), 'utf8')
  const n336 = fs.readFileSync(path.join(root, 'data/klup-clean-product-candidates.csv'), 'utf8')
    .trim().split('\n').length - 1
  const n182 = fs.readFileSync(path.join(root, 'data/klup-music-vertical-candidate-additions.csv'), 'utf8')
    .trim().split('\n').length - 1
  assert.equal(n336, 336, 'the immutable source must still hold 336 rows')
  assert.equal(n182, 182, 'the overlay must still hold 182 rows')
  // Every gross-list and overlay row is represented in the registry.
  assert.ok(reg.includes('gross_list_336') && reg.includes('user_authoritative_addition'),
    'registry must preserve source provenance')
  const cohort = fs.readFileSync(path.join(root, 'data/klup-launch-cohort-frozen.csv'), 'utf8')
    .trim().split('\n')
  assert.equal(cohort.length - 1, 48, 'frozen cohort must hold exactly 48 products')
  assert.ok(cohort.slice(1).every(l => l.includes(',private,')),
    'every frozen row must target private visibility — freezing support never publishes')
  assert.ok(cohort.slice(1).every(l => l.includes(',unchanged,')),
    'every frozen row must leave monitoring unchanged')
})

// ── Tokai / Greco / Burny: paired brand + guard transition (Prompt 04A) ────
//
// These three are legitimate manufacturers. The seed now carries them as
// verified kg_brand identities with exact products, and the same change removed
// them from EXTERNAL_BRAND_TOKENS. Protection therefore comes from
// catalogueBrands (identity-derived) rather than from the copy-token list.

const VINTAGE_JP: Product[] = [
  { id: 'p-tokai-lr', slug: 'tokai-love-rock', canonical_name: 'Tokai Love Rock',
    model_name: 'Love Rock', brand_name: 'tokai', status: 'active', support_state: 'known' },
  { id: 'p-greco-sa', slug: 'greco-super-real', canonical_name: 'Greco Super Real',
    model_name: 'Super Real', brand_name: 'greco', status: 'active', support_state: 'known' },
  { id: 'p-burny-sg', slug: 'burny-super-grade', canonical_name: 'Burny Super Grade',
    model_name: 'Super Grade', brand_name: 'burny', status: 'active', support_state: 'known' },
]
const GIBSON_IDENTS = [
  { product_id: GIBSON_LES_PAUL.id, type: 'SKU', value: 'Les Paul' },
  { product_id: GIBSON_ES335.id,    type: 'SKU', value: 'ES-335' },
]

test('the three vintage-JP brands left the external copy-token list', () => {
  for (const b of ['tokai', 'greco', 'burny'])
    assert.ok(!EXTERNAL_BRAND_TOKENS.includes(b), `${b} must no longer be a copy stop token`)
  // Unverified makers stay.
  for (const b of ['jackson', 'charvel', 'esp', 'aria'])
    assert.ok(EXTERNAL_BRAND_TOKENS.includes(b), `${b} is still unverified and must remain`)
})

test('the seed carries the three brands with exact products', () => {
  const seed = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../data/knowledge-graph.json'), 'utf8'))
  const brands = seed.categories['music-gear'].brands
  for (const [b, slug] of [['tokai', 'tokai-love-rock'], ['greco', 'greco-super-real'],
                           ['burny', 'burny-super-grade']] as const) {
    assert.ok(brands[b], `seed must carry the ${b} brand`)
    assert.ok(brands[b].products[slug], `seed must carry ${slug}`)
    // No generic family token may have been introduced as an identifier.
    for (const p of Object.values(brands[b].products) as Array<{ model?: string; sku?: string[] }>) {
      assert.ok((p.sku ?? []).length === 0, 'no SKU identifier for an unverified-tier addition')
      assert.ok((p.model ?? '').trim().length >= 3, 'model token must clear the matcher floor')
    }
  }
})

test('Tokai / Greco / Burny titles cannot match Gibson', () => {
  const idx = buildMatchIndex([...FULL_PRODUCTS, ...VINTAGE_JP], GIBSON_IDENTS, [])
  for (const b of ['tokai', 'greco', 'burny'])
    assert.ok(idx.catalogueBrands.has(b), `${b} must be brand evidence via identity`)
  for (const title of [
    'Tokai Love Rock LS-120 Les Paul type',
    'Greco Super Real SA-500 ES-335',
    'Burny Super Grade RLG-70 Les Paul',
  ]) {
    const d = decideMatch(title, idx)
    assert.notEqual(d.kind, 'matched', `must never become a trusted Gibson match: ${title}`)
  }
})

test('an exact vintage-JP product stays ineligible while known or reserve', () => {
  for (const support of ['known', 'reserve']) {
    const idx = buildMatchIndex(
      [...FULL_PRODUCTS, ...VINTAGE_JP.map(p => ({ ...p, support_state: support }))],
      GIBSON_IDENTS, [])
    assert.equal(decideMatch('Tokai Love Rock LS-120', idx).kind, 'none',
      `support_state='${support}' must produce no candidate for its own brand`)
  }
})

test('a supported vintage-JP product matches itself without weakening Gibson', () => {
  const supported = VINTAGE_JP.map(p => ({ ...p, support_state: 'supported' }))
  const idx = buildMatchIndex([...FULL_PRODUCTS, ...supported], GIBSON_IDENTS, [])
  const own = decideMatch('Tokai Love Rock LS-120 elguitar', idx)
  assert.equal(own.kind, 'matched', 'an exact supported Tokai must match its own product')
  if (own.kind === 'matched') assert.equal(own.best.product_id, 'p-tokai-lr')
  // Gibson/Epiphone protection is unchanged in the same index: the Epiphone
  // title resolves to the EPIPHONE product (it exists in FULL_PRODUCTS), never
  // to Gibson — which is the collision the guard exists to prevent.
  const e = decideMatch('Epiphone Les Paul Standard', idx)
  assert.equal(e.kind, 'matched')
  if (e.kind === 'matched') assert.equal(e.best.product_id, EPIPHONE_LES_PAUL.id)
  const g = decideMatch('Gibson Les Paul Standard 2005', idx)
  assert.equal(g.kind, 'matched')
  if (g.kind === 'matched') assert.equal(g.best.product_id, GIBSON_LES_PAUL.id)
})

test('the frozen cohort resolves to exactly 48 clean KG identities', () => {
  const root = path.resolve(__dirname, '../..')
  const rows = fs.readFileSync(path.join(root, 'data/klup-launch-cohort-frozen.csv'), 'utf8')
    .trim().split('\n').slice(1)
  assert.equal(rows.length, 48)
  const needing = rows.filter(r => r.includes('create_kg_product_before_support'))
  assert.equal(needing.length, 9, 'nine identities are created by the seed additions')
  assert.equal(rows.filter(r => r.includes('consolidate_multiple_kg_rows')).length, 0,
    'no consolidation prerequisite may remain after the mapping correction')
})

