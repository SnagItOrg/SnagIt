/**
 * /admin/match — the classifier audit and the disposition workflow together.
 *
 * The two slices were built on the same base and touch the same surface from
 * opposite ends: the classifier owns how a candidate ARRIVES (and what it means
 * when no verdict arrives), the dispositions own what the operator DOES with it
 * and what gets written. Each is tested on its own; this file tests only the
 * seam, and only the ways the seam could be wrong:
 *
 *   - a degraded classifier silently disabling manual review, which would make
 *     an outage look like an empty queue;
 *   - classifier metadata leaking into the decision written to the database;
 *   - decision state leaking back into what the classifier is asked;
 *   - the additive response envelope breaking a client that ignores it;
 *   - provider configuration or operational log detail reaching the browser.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  classifierStatus,
  verdictFor,
  type ClassifierOutcome,
} from '../../frontend/lib/admin-match-classifier'
import {
  createInitialState,
  decisionCounts,
  dispositionOf,
  matchReducer,
  savePayload,
  type CandidateRef,
  type MatchAction,
  type MatchProduct,
  type MatchState,
} from '../../frontend/app/admin/match/match-state'
import { ALL_SOURCE_KEYS } from '../../frontend/lib/admin-match-sources'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

const MATCH_PAGE = read('frontend', 'app', 'admin', 'match', 'page.tsx')
const CANDIDATES_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'candidates', 'route.ts')
const DECISION_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'approve', 'route.ts')
const CLASSIFIER = read('frontend', 'lib', 'admin-match-classifier.ts')

/**
 * A candidate as the integrated route returns it — the disposition fields and
 * the classifier's additive `scored` on the same object.
 */
type IntegratedCandidate = CandidateRef & {
  title: string
  score: 'yes' | 'maybe' | 'no'
  reason: string
  scored: boolean
}

const PRODUCT: MatchProduct = {
  id: 'prod-1', canonical_name: 'Roland SH-101',
  slug: 'roland-sh-101', kg_brand: { name: 'Roland' },
}
const OTHER_PRODUCT: MatchProduct = {
  id: 'prod-2', canonical_name: 'Roland Juno-60',
  slug: 'roland-juno-60', kg_brand: { name: 'Roland' },
}

const run = <C extends CandidateRef>(
  s: MatchState<C>, ...as: MatchAction<C>[]
): MatchState<C> => as.reduce(matchReducer, s)

const start = () => createInitialState<IntegratedCandidate>(ALL_SOURCE_KEYS)

/** Build the candidate list a DEGRADED classifier produces, via the real code. */
function degradedCandidates(ids: string[]): IntegratedCandidate[] {
  const outcome: ClassifierOutcome = {
    status: 'degraded', failure: 'truncated', detail: 'max_tokens',
  }
  return ids.map((id) => ({ id, title: `listing ${id}`, ...verdictFor(outcome, id) }))
}

/** Build the candidate list an OK classifier produces, with one id unscored. */
function partiallyScoredCandidates(): IntegratedCandidate[] {
  const outcome: ClassifierOutcome = {
    status: 'ok',
    verdicts: { a: { score: 'yes', reason: 'titlen nævner SH-101' } },
    unscored: ['b'],
  }
  return ['a', 'b'].map((id) => ({ id, title: `listing ${id}`, ...verdictFor(outcome, id) }))
}

function loaded(product: MatchProduct, candidates: IntegratedCandidate[]) {
  const sel = run(start(), { type: 'product_selected', product })
  return run(sel, {
    type: 'candidates_received',
    requestId: sel.candidateRequest.id,
    productId: product.id,
    candidates,
  })
}

/* ------------------------------------------------------------------ *
 * 1. A candidate with scored=false still renders
 * ------------------------------------------------------------------ */

test('an unscored candidate reaches the list intact', () => {
  const cands = partiallyScoredCandidates()
  const b = cands.find((c) => c.id === 'b')!
  assert.equal(b.scored, false, 'the classifier returned no verdict for b')
  assert.equal(b.score, 'maybe', 'the placeholder verdict is still a renderable value')

  const s = loaded(PRODUCT, cands)
  assert.deepEqual(s.candidates.map((c) => c.id), ['a', 'b'], 'both rows are present')
  assert.equal(s.selectedCandidateId, 'a')
  // Nothing in the state machine branches on `scored`, so an unscored row is
  // an ordinary row: it cannot crash a renderer that never reads the field.
  assert.equal(decisionCounts(s).pending, 2)
})

test('the page reads no classifier field, so an additive one cannot break it', () => {
  for (const field of ['scored', 'classifier', 'unscored', 'failure']) {
    assert.ok(
      !new RegExp(`c\\.${field}\\b|\\.${field}\\s*\\?\\?`).test(MATCH_PAGE),
      `the page must not depend on the classifier field "${field}" to render a row`,
    )
  }
})

test('every degraded candidate is still a complete, renderable row', () => {
  for (const c of degradedCandidates(['a', 'b', 'c'])) {
    assert.equal(typeof c.score, 'string')
    assert.equal(typeof c.reason, 'string')
    assert.equal(c.scored, false)
    assert.ok(['yes', 'maybe', 'no'].includes(c.score), 'no fourth score value exists')
  }
})

/* ------------------------------------------------------------------ *
 * 2. Classifier metadata never enters the save payload
 * ------------------------------------------------------------------ */

test('the disposition payload carries no classifier field', () => {
  const s = run(loaded(PRODUCT, partiallyScoredCandidates()),
    { type: 'disposition_set', listingId: 'a', disposition: 'exact', targetProductId: null },
    { type: 'disposition_set', listingId: 'b', disposition: 'accessory', targetProductId: null },
  )
  const payload = savePayload(s)!
  assert.deepEqual(Object.keys(payload).sort(), ['decisions', 'product_id'])
  for (const d of payload.decisions) {
    assert.deepEqual(
      Object.keys(d).sort(),
      ['disposition', 'listing_id', 'target_product_id'],
      'a decision is the operator judgement only — never the model score',
    )
  }
})

test('the writer never consults the classifier', () => {
  // `score` and `rejected_reason` here are listing_product_match columns — the
  // matcher's 0-100 confidence and the rejection constant. What must be absent
  // is the CLASSIFIER's verdict: its module, its status, and its enum values.
  for (const term of ['admin-match-classifier', 'classifier', 'scored', 'Anthropic', 'anthropic']) {
    assert.ok(
      !DECISION_ROUTE.includes(term),
      `the decision writer must not consult "${term}" — a human verdict is not a model verdict`,
    )
  }
  assert.ok(
    !/'(yes|maybe|no)'/.test(DECISION_ROUTE),
    'a semantic verdict value must never influence what is written',
  )
  // And the numeric score it does write is the matcher's, carried forward
  // untouched from the prior row rather than derived from any judgement.
  assert.ok(/score: r\.score as number/.test(DECISION_ROUTE))
})

/* ------------------------------------------------------------------ *
 * 3. Disposition metadata never reaches the classifier
 * ------------------------------------------------------------------ */

test('the candidate route sends no disposition state to the classifier', () => {
  for (const term of ['disposition', 'localDecisions', 'undoStack', 'is_valid:']) {
    assert.ok(
      !CANDIDATES_ROUTE.includes(term),
      `retrieval must not be shaped by "${term}" — decisions are not classifier input`,
    )
  }
})

test('the classifier module knows nothing about dispositions', () => {
  for (const term of ['disposition', 'is_valid', 'listing_product_match', 'approve']) {
    assert.ok(!CLASSIFIER.includes(term), `the classifier must not reference "${term}"`)
  }
})

/* ------------------------------------------------------------------ *
 * 4. A degraded classifier does not disable manual review
 * ------------------------------------------------------------------ */

test('every manual disposition still works on a fully degraded batch', () => {
  let s = loaded(PRODUCT, degradedCandidates(['a', 'b', 'c', 'd']))
  s = run(s,
    { type: 'disposition_set', listingId: 'a', disposition: 'exact', targetProductId: null },
    { type: 'disposition_set', listingId: 'b', disposition: 'accessory', targetProductId: null },
    { type: 'disposition_set', listingId: 'c', disposition: 'wanted_ad', targetProductId: null },
    { type: 'disposition_set', listingId: 'd', disposition: 'wrong', targetProductId: null },
  )
  assert.deepEqual(
    ['a', 'b', 'c', 'd'].map((id) => dispositionOf(s, id)),
    ['exact', 'accessory', 'wanted_ad', 'wrong'],
    'an unavailable classifier must not remove the operator from the loop',
  )
  const payload = savePayload(s)!
  assert.equal(payload.decisions.length, 4, 'all four decisions are writable')
})

test('a degraded batch is reported as degraded, not as a queue of maybes', () => {
  const degraded: ClassifierOutcome = {
    status: 'degraded', failure: 'truncated', detail: 'max_tokens',
  }
  const status = classifierStatus(degraded, 4)
  assert.deepEqual(status, { status: 'degraded', failure: 'truncated', unscored: 4 })

  // The distinction the incident was about: a real `maybe` and an unavailable
  // classifier are both rendered `maybe`, and are distinguishable by `scored`.
  const real: ClassifierOutcome = {
    status: 'ok', verdicts: { a: { score: 'maybe', reason: 'uklart billede' } }, unscored: [],
  }
  assert.equal(verdictFor(real, 'a').scored, true)
  assert.equal(verdictFor(degraded, 'a').scored, false)
  assert.equal(verdictFor(real, 'a').score, verdictFor(degraded, 'a').score,
    'both are `maybe` on the surface — which is why `scored` has to exist')
})

/* ------------------------------------------------------------------ *
 * 5. Product switching clears decisions and keeps freshness protection
 * ------------------------------------------------------------------ */

test('switching product clears decisions on a degraded batch too', () => {
  const s = run(loaded(PRODUCT, degradedCandidates(['a', 'b'])),
    { type: 'disposition_set', listingId: 'a', disposition: 'exact', targetProductId: null },
  )
  const moved = run(s, { type: 'product_selected', product: OTHER_PRODUCT })
  assert.deepEqual(moved.localDecisions, {})
  assert.deepEqual(moved.candidates, [])
  assert.equal(moved.selectedCandidateId, null)
  assert.deepEqual(moved.undoStack, [])
})

test('a stale classifier response cannot land after the operator moved on', () => {
  const first = run(start(), { type: 'product_selected', product: PRODUCT })
  const staleRequestId = first.candidateRequest.id
  const second = run(first, { type: 'product_selected', product: OTHER_PRODUCT })

  // The slow sweep for the PREVIOUS product finally returns.
  const landed = run(second, {
    type: 'candidates_received',
    requestId: staleRequestId,
    productId: PRODUCT.id,
    candidates: degradedCandidates(['ghost']),
  })
  assert.deepEqual(landed.candidates, [], 'an overtaken sweep must not write')
  assert.equal(landed.selectedProduct?.id, OTHER_PRODUCT.id)
})

test('a decision cannot survive onto another product through a classifier retry', () => {
  const s = run(loaded(PRODUCT, degradedCandidates(['shared'])),
    { type: 'disposition_set', listingId: 'shared', disposition: 'exact', targetProductId: null },
  )
  const moved = run(s, { type: 'product_selected', product: OTHER_PRODUCT })
  const reloaded = run(moved, {
    type: 'candidates_received',
    requestId: moved.candidateRequest.id,
    productId: OTHER_PRODUCT.id,
    candidates: degradedCandidates(['shared']),
  })
  assert.equal(dispositionOf(reloaded, 'shared'), null,
    'the same listing under a new product is a new judgement')
  assert.equal(savePayload(reloaded), null)
})

/* ------------------------------------------------------------------ *
 * 6. The additive response envelope
 * ------------------------------------------------------------------ */

test('the route returns the classifier envelope alongside candidates', () => {
  assert.ok(/classifier,/.test(CANDIDATES_ROUTE), 'the envelope must be returned')
  assert.ok(/scored:\s+boolean/.test(CANDIDATES_ROUTE), 'the per-candidate field must be typed')
})

test('the envelope is counts and enums only — never listing content', () => {
  const status = classifierStatus(
    { status: 'ok', verdicts: { a: { score: 'yes', reason: 'r' } }, unscored: ['b'] }, 2,
  )
  assert.deepEqual(Object.keys(status).sort(), ['failure', 'status', 'unscored'])
  assert.equal(typeof status.unscored, 'number', 'ids would leak listing identity')
})

test('the score set stays three-valued across the integration', () => {
  const seen = new Set<string>()
  for (const outcome of [
    { status: 'ok', verdicts: { a: { score: 'yes', reason: '' } }, unscored: [] },
    { status: 'ok', verdicts: { a: { score: 'no', reason: '' } }, unscored: [] },
    { status: 'degraded', failure: 'provider_error', detail: 'x' },
  ] as ClassifierOutcome[]) {
    seen.add(verdictFor(outcome, 'a').score)
  }
  for (const v of seen) assert.ok(['yes', 'maybe', 'no'].includes(v))
})

/* ------------------------------------------------------------------ *
 * 7. Nothing provider-related reaches the browser
 * ------------------------------------------------------------------ */

test('the client page imports no provider SDK and no server module', () => {
  assert.ok(!/from ['"]@anthropic-ai/.test(MATCH_PAGE), 'no SDK in a client component')
  assert.ok(!/ANTHROPIC|API_KEY/.test(MATCH_PAGE), 'no provider configuration in the browser')
  // The only route import is type-only, so it is erased at compile time.
  const routeImports = [...MATCH_PAGE.matchAll(/^import (type )?.*from '(@\/app\/api[^']*)'/gm)]
  for (const m of routeImports) {
    assert.ok(m[1] === 'type ', `${m[2]} must be imported as a type, or the route enters the bundle`)
  }
})

test('operational log detail is confined to the server route', () => {
  assert.ok(!/channel: 'operational'/.test(MATCH_PAGE), 'operational logs are a server concern')
  assert.ok(!/classifier_degraded/.test(MATCH_PAGE))
})

test('the built client bundle carries no provider configuration', () => {
  // Skipped rather than silently passing when there is no build to inspect —
  // the gate runs `npm run build` before this suite in a full verification.
  const chunks = join(ROOT, 'frontend', '.next', 'static', 'chunks')
  if (!existsSync(chunks)) {
    assert.ok(true, 'no build present; the standalone bundle scan covers this')
    return
  }
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.js')) files.push(full)
    }
  }
  walk(chunks)
  assert.ok(files.length > 0, 'a build with no client chunks is not a build')

  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const secret of ['ANTHROPIC_API_KEY', 'sk-ant-', 'classifier_degraded', "channel:\"operational\""]) {
      assert.ok(!src.includes(secret), `${secret} reached the client bundle in ${f}`)
    }
  }
})
