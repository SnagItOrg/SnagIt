/**
 * /admin/match — operator dispositions.
 *
 * The page could express exactly one judgement: *this listing belongs to this
 * product*. Everything else collapsed into the same two buttons, so a Chamberlin
 * Rhythmate Model 45 and a Model 30 were the identical decision, an accessory
 * and a wanted ad were the identical rejection, and "I reviewed this and
 * genuinely cannot tell" had no expression at all.
 *
 * What is pinned here is the mapping from those judgements onto the ONE
 * eligibility axis the public product route reads, and the boundary that keeps
 * this surface from inventing taxonomy: no node is created, no relation is
 * persisted, and an observed-but-missing variant stays an audit string.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  IS_VALID_FOR,
  PERSISTS,
  REJECTION_REASON_FOR,
  isApproval,
  isRejection,
  requiresChildNode,
  targetProductId,
  validateDecision,
  type Disposition,
} from '../../frontend/app/admin/match/dispositions'
import {
  canUndo,
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

const DECISION_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'approve', 'route.ts')
const CANDIDATES_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'candidates', 'route.ts')
const PUBLIC_ROUTE = read('frontend', 'app', 'api', 'product', '[slug]', 'route.ts')
const DISPOSITIONS = read('frontend', 'app', 'admin', 'match', 'dispositions.ts')
const MATCH_PAGE = read('frontend', 'app', 'admin', 'match', 'page.tsx')

const ALL: Disposition[] = [
  'exact', 'family_level', 'existing_child',
  'accessory', 'wanted_ad', 'wrong',
  'cannot_determine', 'skipped',
]

/* ── fixtures ─────────────────────────────────────────────────────────── */

const CHAMBERLIN: MatchProduct = {
  id: 'prod-chamberlin', canonical_name: 'Chamberlin Rhythmate',
  slug: 'chamberlin-rhythmate', kg_brand: { name: 'Chamberlin' },
}
const SH101: MatchProduct = {
  id: 'prod-sh101', canonical_name: 'Roland SH-101',
  slug: 'roland-sh-101', kg_brand: { name: 'Roland' },
}

const c = (id: string): CandidateRef => ({ id })
const run = (
  s: MatchState<CandidateRef>,
  ...as: MatchAction<CandidateRef>[]
): MatchState<CandidateRef> => as.reduce(matchReducer, s)

const start = () => createInitialState<CandidateRef>(ALL_SOURCE_KEYS)

function withLoaded(product: MatchProduct, ids: string[]): MatchState<CandidateRef> {
  const sel = run(start(), { type: 'product_selected', product })
  return run(sel, {
    type: 'candidates_received',
    requestId: sel.candidateRequest.id,
    productId: product.id,
    candidates: ids.map(c),
  })
}

const set = (listingId: string, disposition: Disposition, nodeId?: string) =>
  ({ type: 'disposition_set', listingId, disposition, nodeId: nodeId ?? null }) as const

/* ------------------------------------------------------------------ *
 * 1. Every disposition maps onto is_valid, and only three values exist
 * ------------------------------------------------------------------ */

test('all seven dispositions plus skip are mapped', () => {
  for (const d of ALL) {
    assert.ok(d in IS_VALID_FOR, `${d} has no eligibility mapping`)
    assert.ok(d in PERSISTS, `${d} does not say whether it writes`)
  }
  assert.equal(Object.keys(IS_VALID_FOR).length, ALL.length, 'an unmapped disposition exists')
})

test('the eligibility mapping is exactly the approved one', () => {
  assert.deepEqual(IS_VALID_FOR, {
    exact:            true,
    family_level:     true,
    existing_child:   true,
    accessory:        false,
    wanted_ad:        false,
    wrong:            false,
    cannot_determine: null,
    skipped:          null,
  })
})

test('approvals and rejections are exactly the intended sets', () => {
  assert.deepEqual(ALL.filter(isApproval), ['exact', 'family_level', 'existing_child'])
  assert.deepEqual(ALL.filter(isRejection), ['accessory', 'wanted_ad', 'wrong'])
})

test('is_valid takes only three values — nothing invents a fourth', () => {
  for (const v of Object.values(IS_VALID_FOR)) {
    assert.ok(v === true || v === false || v === null, `${String(v)} is not a valid eligibility`)
  }
})

/* ------------------------------------------------------------------ *
 * 2. "Cannot determine" must not publish the listing
 * ------------------------------------------------------------------ */

test('cannot_determine and skipped write nothing at all', () => {
  assert.equal(PERSISTS.cannot_determine, false)
  assert.equal(PERSISTS.skipped, false)
  for (const d of ALL.filter((x) => x !== 'cannot_determine' && x !== 'skipped')) {
    assert.equal(PERSISTS[d], true, `${d} must reach the database`)
  }
})

test('the public route keeps NULL, which is why NULL is never written', () => {
  // The whole reason cannot_determine writes nothing. A candidate has no match
  // row, so "write NULL" would mean CREATE a row — and this filter keeps NULL,
  // so that row would render the listing as evidence on the public page.
  assert.ok(
    /\.not\('is_valid', 'is', false\)/.test(PUBLIC_ROUTE),
    'the public route must still drop only explicit rejections',
  )
  assert.ok(
    !/is_valid['"]?\s*,\s*['"]?is['"]?\s*,\s*null/.test(PUBLIC_ROUTE),
    'the public route must not start excluding NULL — that is the matcher contract',
  )
})

test('a candidate has no existing match row, so there is no NULL to preserve', () => {
  // Pinned because the safety of the mapping depends on it: if the candidate
  // query ever stopped excluding decided rows, writing NULL would mean
  // something different and this reasoning would need revisiting.
  assert.ok(
    /decided\.has\(row\.id\)/.test(CANDIDATES_ROUTE),
    'candidates must still exclude every listing that already has a decision',
  )
})

test('the write path filters non-persisting dispositions before any upsert', () => {
  const filterAt = DECISION_ROUTE.indexOf('PERSISTS[d.disposition]')
  const upsertAt = DECISION_ROUTE.indexOf('.upsert(')
  assert.ok(filterAt > -1, 'the route must consult PERSISTS')
  assert.ok(upsertAt > filterAt, 'the filter must run before the write')
})

/* ------------------------------------------------------------------ *
 * 3. No taxonomy is invented
 * ------------------------------------------------------------------ */

test('only existing_child may carry a node id', () => {
  for (const d of ALL) {
    assert.equal(requiresChildNode(d), d === 'existing_child')
  }
  assert.deepEqual(
    validateDecision({ listing_id: 'l', disposition: 'existing_child', node_id: null, variant_observation: null }),
    { ok: false, error: 'existing_child requires an existing node_id' },
  )
  assert.deepEqual(
    validateDecision({ listing_id: 'l', disposition: 'exact', node_id: 'node-1', variant_observation: null }),
    { ok: false, error: 'node_id is only valid for existing_child' },
  )
})

test('a decision is written against the reviewed product unless a child was named', () => {
  const base = { listing_id: 'l', node_id: null, variant_observation: null }
  for (const d of ALL.filter((x) => x !== 'existing_child')) {
    assert.equal(targetProductId({ ...base, disposition: d }, 'prod-x'), 'prod-x')
  }
  assert.equal(
    targetProductId(
      { listing_id: 'l', disposition: 'existing_child', node_id: 'child-1', variant_observation: null },
      'prod-x',
    ),
    'child-1',
    'an existing child receives the match, because a family renders no listings',
  )
})

test('nothing in this surface creates a node or persists a relation', () => {
  for (const [name, src] of [['dispositions', DISPOSITIONS], ['route', DECISION_ROUTE], ['page', MATCH_PAGE]] as const) {
    assert.ok(!/from\(['"]kg_product['"]\)[\s\S]{0,120}\.(insert|upsert|update)\(/.test(src),
      `${name} must never write kg_product`)
    assert.ok(!/from\(['"]kg_relation['"]\)/.test(src),
      `${name} must not touch kg_relation — no clone_of is persisted`)
  }
})

test('an observed variant is an audit string, never an identifier', () => {
  const s = run(withLoaded(CHAMBERLIN, ['ka-30', 'ka-45']),
    set('ka-45', 'family_level'),
    { type: 'variant_observation_changed', listingId: 'ka-45', value: 'Model 45' },
  )
  assert.equal(s.localDecisions['ka-45'].variantObservation, 'Model 45')
  assert.equal(s.localDecisions['ka-45'].nodeId, null, 'an observation must not become a node id')

  const payload = savePayload(s)
  assert.ok(payload)
  const decision = payload!.decisions.find((d) => d.listing_id === 'ka-45')!
  assert.equal(decision.variant_observation, 'Model 45')
  assert.equal(decision.node_id, null)
})

test('Chamberlin Model 30 and 45 are reviewable in one workspace at family level', () => {
  // Both variants are real listings; neither exists as a node. Both must be
  // classifiable without leaving the product, and without creating anything.
  const s = run(withLoaded(CHAMBERLIN, ['ka-30', 'ka-45']),
    set('ka-30', 'family_level'),
    { type: 'variant_observation_changed', listingId: 'ka-30', value: 'Model 30' },
    set('ka-45', 'family_level'),
    { type: 'variant_observation_changed', listingId: 'ka-45', value: 'Model 45' },
  )
  const payload = savePayload(s)!
  assert.equal(payload.product_id, CHAMBERLIN.id, 'both stay on the family node')
  assert.deepEqual(payload.decisions.map((d) => d.variant_observation), ['Model 30', 'Model 45'])
  assert.ok(payload.decisions.every((d) => d.node_id === null))
  assert.ok(payload.decisions.every((d) => d.disposition === 'family_level'))
})

/* ------------------------------------------------------------------ *
 * 4. Save filtering
 * ------------------------------------------------------------------ */

test('a save carries only the dispositions that persist', () => {
  const s = run(withLoaded(SH101, ['a', 'b', 'c', 'd', 'e']),
    set('a', 'exact'),
    set('b', 'accessory'),
    set('c', 'cannot_determine'),
    set('d', 'skipped'),
    // 'e' is left pending
  )
  const payload = savePayload(s)!
  assert.deepEqual(payload.decisions.map((d) => d.listing_id), ['a', 'b'])
})

test('a save of only non-persisting dispositions submits nothing', () => {
  const s = run(withLoaded(SH101, ['a', 'b']),
    set('a', 'cannot_determine'),
    set('b', 'skipped'),
  )
  assert.equal(savePayload(s), null, 'there is nothing to write, so there is no request')
})

test('existing_child submits the selected node, not the reviewed product', () => {
  const s = run(withLoaded(CHAMBERLIN, ['a']), set('a', 'existing_child', 'child-node-1'))
  const payload = savePayload(s)!
  assert.equal(payload.product_id, CHAMBERLIN.id, 'the reviewed product identifies the sweep')
  assert.equal(payload.decisions[0].node_id, 'child-node-1', 'the chosen node travels with it')
})

test('existing_child without a node is refused by the reducer', () => {
  const s = run(withLoaded(CHAMBERLIN, ['a']),
    { type: 'disposition_set', listingId: 'a', disposition: 'existing_child', nodeId: null },
  )
  assert.equal(dispositionOf(s, 'a'), null, 'it must not degrade into an approval on the family')
})

test('a save submits only candidates visible for the active product', () => {
  const onSh101 = run(withLoaded(SH101, ['listing-1']), set('listing-1', 'exact'))
  const moved = run(onSh101, { type: 'product_selected', product: CHAMBERLIN })
  const loaded = run(moved, {
    type: 'candidates_received',
    requestId: moved.candidateRequest.id,
    productId: CHAMBERLIN.id,
    candidates: [c('listing-1')],
  })
  assert.equal(dispositionOf(loaded, 'listing-1'), null, 'the decision did not follow the operator')
  assert.equal(savePayload(loaded), null)
})

/* ------------------------------------------------------------------ *
 * 5. Auto-advance
 * ------------------------------------------------------------------ */

test('deciding advances to the next undecided candidate', () => {
  let s = withLoaded(SH101, ['a', 'b', 'c'])
  assert.equal(s.selectedCandidateId, 'a', 'the first candidate is selected on arrival')
  s = run(s, set('a', 'exact'))
  assert.equal(s.selectedCandidateId, 'b')
  s = run(s, set('b', 'wrong'))
  assert.equal(s.selectedCandidateId, 'c')
})

test('auto-advance skips rows that already carry a decision', () => {
  let s = run(withLoaded(SH101, ['a', 'b', 'c']), set('b', 'accessory'))
  s = run(s, { type: 'candidate_selected', listingId: 'a' })
  s = run(s, set('a', 'exact'))
  assert.equal(s.selectedCandidateId, 'c', 'b was already decided and must not be offered again')
})

test('the last decision holds the selection instead of emptying the pane', () => {
  const s = run(withLoaded(SH101, ['a']), set('a', 'exact'))
  assert.equal(s.selectedCandidateId, 'a', 'nothing is left to advance to')
})

test('a decided row stays in the list', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'wrong'))
  assert.deepEqual(s.candidates.map((x) => x.id), ['a', 'b'],
    'a decision the operator cannot see is one they cannot check')
})

/* ------------------------------------------------------------------ *
 * 6. Undo
 * ------------------------------------------------------------------ */

test('undo restores the previous disposition and the previous selection', () => {
  let s = withLoaded(SH101, ['a', 'b', 'c'])
  s = run(s, set('a', 'exact'))
  assert.equal(s.selectedCandidateId, 'b')
  s = run(s, { type: 'undo' })
  assert.equal(dispositionOf(s, 'a'), null, 'the decision is taken back')
  assert.equal(s.selectedCandidateId, 'a', 'and the operator is returned to the row')
})

test('undo restores an overwritten disposition rather than clearing it', () => {
  let s = run(withLoaded(SH101, ['a']), set('a', 'exact'))
  s = run(s, set('a', 'accessory'))
  assert.equal(dispositionOf(s, 'a'), 'accessory')
  s = run(s, { type: 'undo' })
  assert.equal(dispositionOf(s, 'a'), 'exact', 'the earlier verdict comes back')
})

test('undo is available for the whole session, across many decisions', () => {
  let s = withLoaded(SH101, ['a', 'b', 'c'])
  s = run(s, set('a', 'exact'), set('b', 'wrong'), set('c', 'accessory'))
  assert.equal(canUndo(s), true)
  s = run(s, { type: 'undo' }, { type: 'undo' }, { type: 'undo' })
  assert.deepEqual(s.localDecisions, {}, 'every decision is reachable')
  assert.equal(canUndo(s), false, 'and the stack is stable when empty')
})

test('undo on an empty stack is a no-op', () => {
  const s = withLoaded(SH101, ['a'])
  assert.deepEqual(run(s, { type: 'undo' }), s)
})

test('a product change empties the undo stack', () => {
  const s = run(withLoaded(SH101, ['a']), set('a', 'exact'))
  const moved = run(s, { type: 'product_selected', product: CHAMBERLIN })
  assert.equal(canUndo(moved), false,
    'undo must not reach back to a listing the operator can no longer see')
})

test('a successful save empties the undo stack', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'exact'))
  const saved = run(s, { type: 'save_started' }, { type: 'save_succeeded', savedIds: ['a'] })
  assert.equal(canUndo(saved), false, 'those rows are written — undo would misrepresent that')
})

/* ------------------------------------------------------------------ *
 * 7. Product switching clears everything it owns
 * ------------------------------------------------------------------ */

test('changing product clears dispositions, selection and undo in one transition', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'exact'), set('b', 'accessory'))
  const moved = run(s, { type: 'product_selected', product: CHAMBERLIN })
  assert.deepEqual(moved.localDecisions, {})
  assert.equal(moved.selectedCandidateId, null)
  assert.deepEqual(moved.undoStack, [])
  assert.deepEqual(moved.candidates, [])
})

test('clearing the product empties everything it owned', () => {
  const s = run(withLoaded(SH101, ['a']), set('a', 'exact'))
  const cleared = run(s, { type: 'product_cleared' })
  assert.deepEqual(cleared.localDecisions, {})
  assert.equal(cleared.selectedCandidateId, null)
  assert.deepEqual(cleared.undoStack, [])
})

/* ------------------------------------------------------------------ *
 * 8. Counts
 * ------------------------------------------------------------------ */

test('counts separate what will be written from what will not', () => {
  const s = run(withLoaded(SH101, ['a', 'b', 'c', 'd', 'e']),
    set('a', 'exact'), set('b', 'existing_child', 'n1'),
    set('c', 'accessory'), set('d', 'cannot_determine'),
  )
  assert.deepEqual(decisionCounts(s), {
    approved: 2, rejected: 1, unwritten: 1, total: 3, pending: 1,
  })
})

/* ------------------------------------------------------------------ *
 * 9. Route contract
 * ------------------------------------------------------------------ */

test('the route validates every decision before writing any of them', () => {
  const validateAt = DECISION_ROUTE.indexOf('validateDecision(d)')
  const upsertAt = DECISION_ROUTE.indexOf('.upsert(')
  assert.ok(validateAt > -1, 'the route must not trust the client')
  assert.ok(validateAt < upsertAt, 'validation must precede the write')
})

test('the route refuses two dispositions for one listing', () => {
  assert.ok(
    DECISION_ROUTE.includes('duplicate decision for listing'),
    'array order must never decide which verdict wins on a unique index',
  )
})

test('the route authorizes through the shared helper before touching data', () => {
  const guard = DECISION_ROUTE.indexOf('requireAdminInRoute()')
  const client = DECISION_ROUTE.indexOf('getSupabaseAdmin()')
  assert.ok(guard > -1 && client > -1 && guard < client)
  assert.ok(!/async function verifyAdmin/.test(DECISION_ROUTE), 'no private copy of the admin check')
})

test('the route preserves matcher provenance on an existing row', () => {
  assert.ok(/prior\?\.method \?\? MANUAL_METHOD/.test(DECISION_ROUTE))
  assert.ok(/prior\?\.score \?\? MANUAL_SCORE/.test(DECISION_ROUTE))
  assert.ok(/\.\.\.\(prior\?\.explain \?\? \{\}\)/.test(DECISION_ROUTE),
    'the matcher explain payload must be merged, not replaced')
})

test('structured detail goes to explain, and rejected_reason keeps its meaning', () => {
  assert.ok(/admin_decision:/.test(DECISION_ROUTE))
  assert.ok(/disposition: decision\.disposition/.test(DECISION_ROUTE))
  assert.ok(/rejected_reason: isValid \? null : REJECTION_REASON/.test(DECISION_ROUTE),
    'the populated column must not be redefined by this slice')
})

test('the structured rejection reasons are exactly the rejecting dispositions', () => {
  assert.deepEqual(Object.keys(REJECTION_REASON_FOR).sort(), ['accessory', 'wanted_ad', 'wrong'])
  for (const d of ALL.filter(isRejection)) {
    assert.ok(REJECTION_REASON_FOR[d], `${d} must carry a structured reason`)
  }
})

test('idempotency and reversal still rest on the unique index', () => {
  assert.ok(/onConflict: 'listing_id,product_id'/.test(DECISION_ROUTE),
    'repeating a decision must converge on one row; changing one must update it')
})

test('no migration is introduced by this slice', () => {
  // Every structured field rides in the existing JSONB column.
  assert.ok(/explain: \{/.test(DECISION_ROUTE))
  assert.ok(!/ALTER TABLE|CREATE TABLE|ADD COLUMN/i.test(DECISION_ROUTE))
  assert.ok(!/ALTER TABLE|CREATE TABLE|ADD COLUMN/i.test(DISPOSITIONS))
})

test('the route still accepts the legacy body a stale tab would send', () => {
  assert.ok(DECISION_ROUTE.includes('fromLegacyArrays'),
    'a tab open across a deploy must not lose the operator work it holds')
})

/* ------------------------------------------------------------------ *
 * 10. The page keeps approve and reject primary
 * ------------------------------------------------------------------ */

test('the reason is reachable without standing in front of approve or reject', () => {
  const primary = MATCH_PAGE.indexOf("setDisposition(c.id, 'exact')")
  const secondary = MATCH_PAGE.indexOf('SECONDARY_DISPOSITIONS.map')
  assert.ok(primary > -1 && secondary > -1)
  assert.ok(primary < secondary, 'the primary pair must render before the reason chips')
  assert.ok(!/confirm\(|window\.confirm/.test(MATCH_PAGE),
    'a rejection must not be gated behind a modal confirmation')
})

test('every disposition has an operator-facing label and badge', () => {
  for (const d of ALL) {
    assert.ok(new RegExp(`${d}:\\s*'`).test(MATCH_PAGE), `${d} needs a label and a badge`)
  }
})

test('keyboard shortcuts are suppressed while typing', () => {
  assert.ok(/tagName === 'INPUT'/.test(MATCH_PAGE),
    'the product search and the node picker are text inputs on the same screen')
})
