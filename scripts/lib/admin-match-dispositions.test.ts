/**
 * /admin/match — operator dispositions and public eligibility.
 *
 * WHAT THIS FILE EXISTS TO PREVENT. An earlier draft of this slice offered a
 * `family_level` disposition — "right family, variant undeterminable" — mapped
 * to `is_valid = true`. That is unsafe, and the reason is the whole point of
 * the assertions below:
 *
 *   `is_valid = true` is not a review outcome. It is public listing eligibility
 *   AND price evidence for the selected product. A Chamberlin Rhythmate Model
 *   30 at 18.618 DKK and a Model 45 at 38.520 DKK are both honestly "the
 *   Rhythmate family", so both would have been written true against the single
 *   `chamberlin-rhythmate` node, and the public page would have shown one price
 *   history mixing two instruments that differ by more than 2x — presented as
 *   exact.
 *
 * So the axis is protected here directly: only a decision naming an EXACT
 * product may write true, and nothing may quietly reach that value through a
 * depth or confidence judgement. The deferred depth-aware model is specified in
 * `docs/admin-match-deferred-disposition-contract.md` and deliberately absent
 * from the interactive path.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  IS_VALID_FOR,
  MANUAL_METHOD,
  MANUAL_SCORE,
  PERSISTS,
  REJECTION_REASON,
  REJECTION_REASON_FOR,
  isApproval,
  isRejection,
  SOURCE_MATCH_CONFLICT,
  planDecisionWrites,
  planWrites,
  requiresTargetProduct,
  targetProductId,
  validateDecision,
  type DecisionInput,
  type Disposition,
  type PriorRow,
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
const MATCH_STATE = read('frontend', 'app', 'admin', 'match', 'match-state.ts')
const MATCH_PAGE = read('frontend', 'app', 'admin', 'match', 'page.tsx')

const ALL: Disposition[] = [
  'exact', 'move_to_existing_product', 'accessory', 'wanted_ad', 'wrong', 'skipped',
]

/** Everything the removed draft offered, by the names it used. */
const WITHDRAWN = [
  'family_level', 'cannot_determine', 'existing_child',
  'variant_observation', 'variantObservation', 'classification_depth',
]

const REVIEWED = 'prod-chamberlin'
const OTHER = 'prod-model-45'

const CHAMBERLIN: MatchProduct = {
  id: REVIEWED, canonical_name: 'Chamberlin Rhythmate',
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

const set = (listingId: string, disposition: Disposition, targetProductId?: string) =>
  ({ type: 'disposition_set', listingId, disposition, targetProductId: targetProductId ?? null }) as const

const decision = (
  listing_id: string, disposition: Disposition, target_product_id: string | null = null,
): DecisionInput => ({ listing_id, disposition, target_product_id })

function planArgs(decisions: DecisionInput[], priorByKey: Record<string, PriorRow> = {}) {
  return {
    decisions,
    reviewedProductId: REVIEWED,
    priorByKey,
    actorUserId: 'user-1',
    decidedAt: '2026-08-30T00:00:00.000Z',
    manualMethod: 'FUZZY',
    manualScore: 1,
    rejectedReasonConstant: 'admin_rejected',
  }
}

function plan(decisions: DecisionInput[], priorByKey: Record<string, PriorRow> = {}) {
  return planDecisionWrites(planArgs(decisions, priorByKey))
}

/* ------------------------------------------------------------------ *
 * 1. Only exact and explicit move can write is_valid = true
 * ------------------------------------------------------------------ */

test('exactly two dispositions can write a positive eligibility', () => {
  assert.deepEqual(ALL.filter(isApproval), ['exact', 'move_to_existing_product'])
})

test('every positive write names an exact product', () => {
  // The Chamberlin defect in one assertion: nothing may reach `true` through a
  // depth, family or confidence judgement.
  for (const d of ALL) {
    if (IS_VALID_FOR[d] !== true) continue
    assert.ok(
      d === 'exact' || requiresTargetProduct(d),
      `${d} writes true without naming an exact product`,
    )
  }
})

test('a positive row is only ever produced by exact or move', () => {
  const rows = plan([
    decision('l1', 'exact'),
    decision('l2', 'move_to_existing_product', OTHER),
    decision('l3', 'accessory'),
    decision('l4', 'wanted_ad'),
    decision('l5', 'wrong'),
    decision('l6', 'skipped'),
  ])
  const positives = rows.filter((r) => r.is_valid === true)
  assert.deepEqual(positives.map((r) => r.listing_id), ['l1', 'l2'])
})

/* ------------------------------------------------------------------ *
 * 2. Rejections write false, with a structured reason
 * ------------------------------------------------------------------ */

test('accessory, wanted ad and wrong each write false', () => {
  assert.deepEqual(ALL.filter(isRejection), ['accessory', 'wanted_ad', 'wrong'])
  for (const d of ['accessory', 'wanted_ad', 'wrong'] as Disposition[]) {
    const [row] = plan([decision('l', d)])
    assert.equal(row.is_valid, false, `${d} must write false`)
    const audit = row.explain.admin_decision as Record<string, unknown>
    assert.equal(audit.rejection_reason, REJECTION_REASON_FOR[d], `${d} must carry its reason`)
  }
})

test('the structured reason lives in explain, not in the populated column', () => {
  const [row] = plan([decision('l', 'accessory')])
  assert.equal(row.rejected_reason, 'admin_rejected', 'the column keeps its constant meaning')
  assert.equal((row.explain.admin_decision as Record<string, unknown>).rejection_reason, 'accessory')
})

/* ------------------------------------------------------------------ *
 * 3. Skip writes nothing
 * ------------------------------------------------------------------ */

test('skip produces no row at all', () => {
  assert.equal(PERSISTS.skipped, false)
  assert.deepEqual(plan([decision('l', 'skipped')]), [])
})

test('a save of only skips submits nothing', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'skipped'), set('b', 'skipped'))
  assert.equal(savePayload(s), null, 'there is nothing to write, so there is no request')
})

test('an absent row is how the schema already spells "no verdict"', () => {
  // A candidate has no match row, so a skip leaves the pair exactly as it was.
  assert.ok(
    /decided\.has\(row\.id\)/.test(CANDIDATES_ROUTE),
    'candidates must still exclude every listing that already has a decision',
  )
})

/* ------------------------------------------------------------------ *
 * 4. The withdrawn actions are gone from the whole interactive path
 * ------------------------------------------------------------------ */

test('no family-level or unresolved disposition exists anywhere', () => {
  for (const name of ['family_level', 'cannot_determine', 'existing_child']) {
    assert.ok(!(name in IS_VALID_FOR), `${name} must not be a disposition`)
  }
  assert.equal(Object.keys(IS_VALID_FOR).length, ALL.length)
})

test('the withdrawn actions cannot reach the save payload', () => {
  const s = withLoaded(CHAMBERLIN, ['a'])
  for (const name of ['family_level', 'cannot_determine', 'existing_child']) {
    const after = run(s, {
      type: 'disposition_set', listingId: 'a',
      disposition: name as Disposition, targetProductId: null,
    })
    assert.equal(savePayload(after), null, `${name} produced a payload`)
  }
})

test('the withdrawn actions are absent from the module, state and page', () => {
  for (const [name, src] of [
    ['dispositions', DISPOSITIONS], ['match-state', MATCH_STATE], ['page', MATCH_PAGE],
  ] as const) {
    for (const term of WITHDRAWN) {
      // The dispositions module explains why they were withdrawn; a comment is
      // not a control. Only executable references are forbidden.
      const executable = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
        .join('\n')
      assert.ok(!executable.includes(term), `${name} still references ${term}`)
    }
  }
})

test('nothing is retained as a session-only decision that vanishes at save', () => {
  // Every disposition the UI offers either persists or is explicitly a skip.
  const offered = ALL.filter((d) => d !== 'skipped')
  for (const d of offered) {
    assert.equal(PERSISTS[d], true, `${d} is offered but would silently not be written`)
  }
})

/* ------------------------------------------------------------------ *
 * 5. A move writes the target, and only the target
 * ------------------------------------------------------------------ */

test('a move with no prior row writes exactly one row, on the target', () => {
  const rows = plan([decision('l', 'move_to_existing_product', OTHER)])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].product_id, OTHER)
  assert.equal(rows[0].is_valid, true)
  assert.equal(
    (rows[0].explain.admin_decision as Record<string, unknown>).reviewed_product_id,
    REVIEWED,
    'the row records which product was under review, so it is not mistaken for an ordinary approval',
  )
})

test('a move updates rather than duplicates an existing target row', () => {
  const rows = plan(
    [decision('l', 'move_to_existing_product', OTHER)],
    { [`l:${OTHER}`]: { method: 'MODEL', score: 95, isValid: null, explain: { matcher: 'x' } } },
  )
  const onTarget = rows.filter((r) => r.product_id === OTHER)
  assert.equal(onTarget.length, 1, 'the unique index takes one row per pair')
  assert.equal(onTarget[0].method, 'MODEL', 'matcher provenance survives')
  assert.equal(onTarget[0].score, 95)
  assert.equal(onTarget[0].explain.matcher, 'x', 'the matcher explain payload is merged, not replaced')
})

test('the target must differ from the reviewed product', () => {
  assert.deepEqual(
    validateDecision(decision('l', 'move_to_existing_product', REVIEWED), REVIEWED),
    { ok: false, error: 'the move target must differ from the reviewed product' },
  )
  // And the reducer refuses it too, so it never reaches the wire.
  const s = run(withLoaded(CHAMBERLIN, ['a']), set('a', 'move_to_existing_product', REVIEWED))
  assert.equal(dispositionOf(s, 'a'), null)
})

test('only a move may carry a target product', () => {
  for (const d of ALL) {
    assert.equal(requiresTargetProduct(d), d === 'move_to_existing_product')
  }
  assert.deepEqual(
    validateDecision(decision('l', 'exact', OTHER), REVIEWED),
    { ok: false, error: 'target_product_id is only valid for move_to_existing_product' },
  )
  assert.deepEqual(
    validateDecision(decision('l', 'move_to_existing_product', null), REVIEWED),
    { ok: false, error: 'move_to_existing_product requires a target_product_id' },
  )
})

test('the target travels explicitly in the save payload', () => {
  const s = run(withLoaded(CHAMBERLIN, ['a']), set('a', 'move_to_existing_product', OTHER))
  const payload = savePayload(s)!
  assert.equal(payload.product_id, REVIEWED, 'the reviewed product identifies the sweep')
  assert.equal(payload.decisions[0].target_product_id, OTHER, 'the target is never implicit')
})

test('a move without a target is refused by the reducer', () => {
  const s = run(withLoaded(CHAMBERLIN, ['a']), {
    type: 'disposition_set', listingId: 'a',
    disposition: 'move_to_existing_product', targetProductId: null,
  })
  assert.equal(dispositionOf(s, 'a'), null, 'it must not degrade into an approval here')
})

/* ------------------------------------------------------------------ *
 * 6. A reassignment is one write, and the two-write case is refused
 * ------------------------------------------------------------------ */

const PRIOR: PriorRow = { method: 'MODEL', score: 95, isValid: true, explain: {} }

test('a normal reassignment plans exactly one row', () => {
  // The candidate query guarantees no row on the reviewed product, so this is
  // a single insert with nothing left behind.
  const p = planWrites(planArgs([decision('l', 'move_to_existing_product', OTHER)]))
  assert.equal(p.outcome, 'write')
  assert.equal(p.outcome === 'write' && p.rows.length, 1, 'one decision, one row')
  assert.equal(p.outcome === 'write' && p.rows[0].product_id, OTHER)
})

test('no row is planned against the reviewed product on a reassignment', () => {
  const p = planWrites(planArgs([decision('l', 'move_to_existing_product', OTHER)]))
  assert.ok(p.outcome === 'write')
  assert.equal(
    p.rows.filter((r) => r.product_id === REVIEWED).length, 0,
    'the source product must be neither inserted, updated nor demoted',
  )
})

test('an existing source row refuses the whole submission before any write', () => {
  for (const isValid of [true, false, null] as (boolean | null)[]) {
    const p = planWrites(planArgs(
      [decision('l', 'move_to_existing_product', OTHER)],
      { [`l:${REVIEWED}`]: { ...PRIOR, isValid } },
    ))
    assert.equal(p.outcome, 'conflict', `a source row with is_valid=${String(isValid)} must refuse`)
    assert.deepEqual(p.outcome === 'conflict' && p.conflicts, ['l'])
    assert.equal(p.outcome === 'conflict' && p.message, SOURCE_MATCH_CONFLICT)
  }
})

test('a refusal writes nothing at all, including the other decisions', () => {
  // Partial application is the failure mode being removed; a refused submission
  // must not half-apply the decisions that were fine.
  const p = planWrites(planArgs(
    [
      decision('good', 'exact'),
      decision('l', 'move_to_existing_product', OTHER),
      decision('bad', 'accessory'),
    ],
    { [`l:${REVIEWED}`]: PRIOR },
  ))
  assert.equal(p.outcome, 'conflict')
  assert.ok(!('rows' in p), 'no rows may be produced alongside a refusal')
})

test('the refusal message is static and carries no listing data', () => {
  assert.ok(!/\$\{/.test(SOURCE_MATCH_CONFLICT))
  assert.ok(SOURCE_MATCH_CONFLICT.length > 0)
  const p = planWrites(planArgs(
    [decision('listing-secret', 'move_to_existing_product', OTHER)],
    { [`listing-secret:${REVIEWED}`]: PRIOR },
  ))
  assert.ok(p.outcome === 'conflict')
  assert.ok(!p.message.includes('listing-secret'), 'the message must not embed the id')
})

test('there is no compensation logic anywhere in the writer', () => {
  // The prose explains why compensation is absent; only executable lines are
  // checked, or the explanation would trip the assertion it exists to support.
  for (const [name, src] of [['dispositions', DISPOSITIONS], ['route', DECISION_ROUTE]] as const) {
    const executable = src
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
      .join('\n')
      .toLowerCase()
    for (const term of ['rollback', 'compensat', 'retrywrite', 'undowrite']) {
      assert.ok(!executable.includes(term), `${name} must not ${term}`)
    }
  }
})

test('an existing target row is updated idempotently, not duplicated', () => {
  const p = planWrites(planArgs(
    [decision('l', 'move_to_existing_product', OTHER)],
    { [`l:${OTHER}`]: { method: 'MODEL', score: 95, isValid: true, explain: { matcher: 'x' } } },
  ))
  assert.ok(p.outcome === 'write')
  assert.equal(p.rows.length, 1, 'the unique index takes one row per pair')
  assert.equal(p.rows[0].product_id, OTHER)
  assert.equal(p.rows[0].method, 'MODEL', 'matcher provenance survives')
  assert.equal(p.rows[0].explain.matcher, 'x', 'the matcher explain payload is merged')
  // Planning it twice produces the identical row.
  const again = planWrites(planArgs(
    [decision('l', 'move_to_existing_product', OTHER)],
    { [`l:${OTHER}`]: { method: 'MODEL', score: 95, isValid: true, explain: { matcher: 'x' } } },
  ))
  assert.deepEqual(again, p, 'repeating the decision converges on the same single row')
})

test('matches for unrelated products are never planned', () => {
  const p = planWrites(planArgs(
    [decision('l', 'move_to_existing_product', OTHER)],
    {
      'l:prod-unrelated': { method: 'MODEL', score: 90, isValid: true, explain: {} },
      'other-listing:prod-unrelated': { method: 'MODEL', score: 90, isValid: true, explain: {} },
    },
  ))
  assert.ok(p.outcome === 'write')
  assert.deepEqual(p.rows.map((r) => r.product_id), [OTHER])
  assert.deepEqual(p.rows.map((r) => r.listing_id), ['l'])
})

test('every planned row belongs to a listing that was decided', () => {
  const p = planWrites(planArgs([
    decision('a', 'exact'),
    decision('b', 'move_to_existing_product', OTHER),
    decision('c', 'accessory'),
  ]))
  assert.ok(p.outcome === 'write')
  assert.deepEqual(p.rows.map((r) => r.listing_id).sort(), ['a', 'b', 'c'])
  assert.equal(p.rows.length, 3, 'one row per decision — never more')
})

/* ------------------------------------------------------------------ *
 * 7. An unverifiable target is rejected
 * ------------------------------------------------------------------ */

test('the route verifies every move target against kg_product before writing', () => {
  const verifyAt = DECISION_ROUTE.indexOf("from('kg_product')")
  const upsertAt = DECISION_ROUTE.indexOf('.upsert(')
  assert.ok(verifyAt > -1, 'the route must resolve the target, not trust the client')
  assert.ok(verifyAt < upsertAt, 'verification must precede the write')
  assert.ok(/unknown or inactive target product/.test(DECISION_ROUTE))
  assert.ok(/\.eq\('status', 'active'\)/.test(DECISION_ROUTE),
    'an inactive product must not silently receive the listing')
})

test('the route validates shape before it writes anything', () => {
  const validateAt = DECISION_ROUTE.indexOf('validateDecision(d, reviewedProductId)')
  assert.ok(validateAt > -1 && validateAt < DECISION_ROUTE.indexOf('.upsert('))
})

test('the route refuses two dispositions for one listing', () => {
  assert.ok(DECISION_ROUTE.includes('duplicate decision for listing'),
    'array order must never decide which verdict wins on a unique index')
})

/* ------------------------------------------------------------------ *
 * 8. No taxonomy is created or changed
 * ------------------------------------------------------------------ */

test('nothing writes kg_product, kg_relation or a family row', () => {
  for (const [name, src] of [
    ['dispositions', DISPOSITIONS], ['route', DECISION_ROUTE],
    ['match-state', MATCH_STATE], ['page', MATCH_PAGE],
  ] as const) {
    assert.ok(!/from\(['"]kg_product['"]\)[\s\S]{0,160}\.(insert|upsert|update|delete)\(/.test(src),
      `${name} must never write kg_product`)
    assert.ok(!/from\(['"]kg_relation['"]\)/.test(src),
      `${name} must not touch kg_relation — no relationship is created`)
    assert.ok(!/from\(['"]kg_(brand|category|identifier|synonym)['"]\)[\s\S]{0,160}\.(insert|upsert|update|delete)\(/.test(src),
      `${name} must not write taxonomy`)
    assert.ok(!/lib\/families/.test(src), `${name} must not reach into the family model`)
  }
})

test('the only table this slice writes is listing_product_match', () => {
  const written = [...DECISION_ROUTE.matchAll(/\.from\('([a-z_]+)'\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/g)]
    .map((m) => m[1])
  assert.deepEqual(Array.from(new Set(written)), ['listing_product_match'])
})

test('no migration is introduced by this slice', () => {
  for (const src of [DECISION_ROUTE, DISPOSITIONS, MATCH_STATE]) {
    assert.ok(!/ALTER TABLE|CREATE TABLE|ADD COLUMN|DROP COLUMN/i.test(src))
  }
})

/* ------------------------------------------------------------------ *
 * 9. State integrity is not weakened
 * ------------------------------------------------------------------ */

test('changing product clears dispositions, selection and undo in one transition', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'exact'), set('b', 'accessory'))
  const moved = run(s, { type: 'product_selected', product: CHAMBERLIN })
  assert.deepEqual(moved.localDecisions, {})
  assert.equal(moved.selectedCandidateId, null)
  assert.deepEqual(moved.undoStack, [])
  assert.deepEqual(moved.candidates, [])
})

test('a save submits only candidates visible for the active product', () => {
  const onSh101 = run(withLoaded(SH101, ['listing-1']), set('listing-1', 'exact'))
  const moved = run(onSh101, { type: 'product_selected', product: CHAMBERLIN })
  const loaded = run(moved, {
    type: 'candidates_received',
    requestId: moved.candidateRequest.id,
    productId: CHAMBERLIN.id, candidates: [c('listing-1')],
  })
  assert.equal(dispositionOf(loaded, 'listing-1'), null)
  assert.equal(savePayload(loaded), null)
})

test('a stale response cannot write over the current product', () => {
  const sel = run(start(), { type: 'product_selected', product: SH101 })
  const stale = run(sel, {
    type: 'candidates_received',
    requestId: sel.candidateRequest.id - 1,
    productId: SH101.id, candidates: [c('ghost')],
  })
  assert.deepEqual(stale.candidates, [], 'an overtaken sweep must not land')
})

test('deciding advances to the next undecided candidate', () => {
  let s = withLoaded(SH101, ['a', 'b', 'c'])
  assert.equal(s.selectedCandidateId, 'a')
  s = run(s, set('a', 'exact'))
  assert.equal(s.selectedCandidateId, 'b')
  s = run(s, set('b', 'wrong'))
  assert.equal(s.selectedCandidateId, 'c')
})

test('a decided row stays in the list with its disposition', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'wrong'))
  assert.deepEqual(s.candidates.map((x) => x.id), ['a', 'b'],
    'a decision the operator cannot see is one they cannot check')
  assert.equal(dispositionOf(s, 'a'), 'wrong')
})

test('undo restores the previous disposition and the previous selection', () => {
  let s = run(withLoaded(SH101, ['a', 'b', 'c']), set('a', 'exact'))
  assert.equal(s.selectedCandidateId, 'b')
  s = run(s, { type: 'undo' })
  assert.equal(dispositionOf(s, 'a'), null)
  assert.equal(s.selectedCandidateId, 'a')
})

test('undo restores an overwritten disposition, including its target', () => {
  let s = run(withLoaded(CHAMBERLIN, ['a']), set('a', 'move_to_existing_product', OTHER))
  s = run(s, set('a', 'accessory'))
  s = run(s, { type: 'undo' })
  assert.equal(dispositionOf(s, 'a'), 'move_to_existing_product')
  assert.equal(s.localDecisions.a.targetProductId, OTHER, 'the target came back with it')
})

test('undo does not reach across a product change or a successful save', () => {
  const s = run(withLoaded(SH101, ['a', 'b']), set('a', 'exact'))
  assert.equal(canUndo(s), true)
  assert.equal(canUndo(run(s, { type: 'product_selected', product: CHAMBERLIN })), false)
  assert.equal(
    canUndo(run(s, { type: 'save_started' }, { type: 'save_succeeded', savedIds: ['a'] })),
    false,
    'those rows are written — undo would misrepresent that',
  )
})

test('counts separate what will be written from what will not', () => {
  const s = run(withLoaded(CHAMBERLIN, ['a', 'b', 'c', 'd', 'e']),
    set('a', 'exact'), set('b', 'move_to_existing_product', OTHER),
    set('c', 'accessory'), set('d', 'skipped'),
  )
  assert.deepEqual(decisionCounts(s), {
    approved: 2, rejected: 1, skipped: 1, total: 3, pending: 1,
  })
})

/* ------------------------------------------------------------------ *
 * 10. Public eligibility and price evidence are unchanged
 * ------------------------------------------------------------------ */

test('the public route still drops only explicit rejections', () => {
  assert.ok(/\.not\('is_valid', 'is', false\)/.test(PUBLIC_ROUTE))
  assert.ok(!/is_valid['"]?\s*,\s*['"]?is['"]?\s*,\s*null/.test(PUBLIC_ROUTE),
    'excluding NULL would change the matcher contract, not just this surface')
})

test('is_valid still takes exactly three values', () => {
  for (const v of Object.values(IS_VALID_FOR)) {
    assert.ok(v === true || v === false || v === null, `${String(v)} is not a valid eligibility`)
  }
})

test('this slice writes no new eligibility axis into the match row', () => {
  // Everything structured rides in the existing JSONB; no new column is read or
  // written, so price-evidence selection is exactly what it was.
  const [row] = plan([decision('l', 'exact')])
  assert.deepEqual(
    Object.keys(row).sort(),
    ['explain', 'is_valid', 'listing_id', 'method', 'product_id', 'rejected_reason', 'score'],
  )
})

test('the deferred contract is documented rather than half-built', () => {
  const doc = read('docs', 'admin-match-deferred-disposition-contract.md')
  for (const field of [
    'review_disposition', 'classification_depth', 'suggested_product_id',
    'observed_variant', 'price_evidence_eligible',
  ]) {
    assert.ok(doc.includes(field), `${field} must be specified`)
  }
  assert.ok(/is_valid/.test(doc), 'the document must explain why is_valid cannot carry these')
})

/* ------------------------------------------------------------------ *
 * Route and page shape
 * ------------------------------------------------------------------ */

test('the route authorizes through the shared helper before touching data', () => {
  const guard = DECISION_ROUTE.indexOf('requireAdminInRoute()')
  const client = DECISION_ROUTE.indexOf('getSupabaseAdmin()')
  assert.ok(guard > -1 && client > -1 && guard < client)
  assert.ok(!/async function verifyAdmin/.test(DECISION_ROUTE))
})

test('idempotency and reversal still rest on the unique index', () => {
  assert.ok(/onConflict: 'listing_id,product_id'/.test(DECISION_ROUTE))
})

test('the reason is reachable without standing in front of approve or reject', () => {
  const primary = MATCH_PAGE.indexOf("setDisposition(c.id, 'exact')")
  const secondary = MATCH_PAGE.indexOf('SECONDARY_DISPOSITIONS.map')
  assert.ok(primary > -1 && secondary > -1 && primary < secondary)
  assert.ok(!/confirm\(|window\.confirm/.test(MATCH_PAGE),
    'a rejection must not be gated behind a modal confirmation')
})

test('the control names the operation it actually performs', () => {
  // The candidate is unmatched, so nothing is moved and nothing is related.
  assert.ok(/Match med andet produkt/.test(MATCH_PAGE))
  for (const misleading of ['underknude', 'childnode', 'child node', 'forælder', 'Flyt']) {
    assert.ok(
      !MATCH_PAGE.includes(misleading),
      `"${misleading}" describes an operation this release does not perform`,
    )
  }
})

test('every offered disposition has a label and a badge', () => {
  for (const d of ALL) {
    assert.ok(new RegExp(`${d}:\\s*'`).test(MATCH_PAGE), `${d} needs a label and a badge`)
  }
})

test('keyboard shortcuts are suppressed while typing', () => {
  assert.ok(/tagName === 'INPUT'/.test(MATCH_PAGE))
})

test('the shared mapping is imported, not duplicated', () => {
  assert.ok(/from '@\/app\/admin\/match\/dispositions'/.test(DECISION_ROUTE),
    'the route must read the same mapping the reducer uses')
  assert.ok(/from '\.\/dispositions'/.test(MATCH_STATE))
  assert.ok(!/IS_VALID_FOR\s*[:=]\s*\{/.test(DECISION_ROUTE), 'the mapping must exist once')
})

/* ------------------------------------------------------------------ *
 * The route's write-count contract
 *
 * The safety of this release is "one statement per submission", so the count
 * itself is the thing to pin. These read the route source deliberately: the
 * property is "how many mutation call sites exist and what must precede them",
 * which is a property of the code, not of one execution of it.
 * ------------------------------------------------------------------ */

/** Every Supabase call that can change data. */
const MUTATION_CALL = /\.(upsert|insert|update|delete|rpc)\s*\(/g

test('the route contains exactly one mutation call site', () => {
  const calls = [...DECISION_ROUTE.matchAll(MUTATION_CALL)].map((m) => m[1])
  assert.deepEqual(calls, ['upsert'],
    'a second mutation would reintroduce the partial-failure window this release removes')
})

test('the one mutation is a single batched statement, not a loop', () => {
  const upsertAt = DECISION_ROUTE.indexOf('.upsert(')
  const before = DECISION_ROUTE.slice(0, upsertAt)
  const lastFor = Math.max(before.lastIndexOf('for ('), before.lastIndexOf('.map('), before.lastIndexOf('forEach'))
  const lastClose = before.lastIndexOf('}')
  assert.ok(lastClose > lastFor, 'the upsert must not sit inside an iteration')
  assert.ok(/\.upsert\(rows,/.test(DECISION_ROUTE), 'all rows go in one call')
})

test('the refusal returns before the mutation is reached', () => {
  const conflictAt = DECISION_ROUTE.indexOf("plan.outcome === 'conflict'")
  const status409 = DECISION_ROUTE.indexOf('status: 409')
  const upsertAt = DECISION_ROUTE.indexOf('.upsert(')
  assert.ok(conflictAt > -1 && status409 > -1, 'the route must refuse with 409')
  assert.ok(conflictAt < upsertAt && status409 < upsertAt, 'no write may precede the refusal')
})

test('target validation returns before the mutation is reached', () => {
  const verifyAt = DECISION_ROUTE.indexOf("from('kg_product')")
  const rejectAt = DECISION_ROUTE.indexOf('unknown or inactive target product')
  const upsertAt = DECISION_ROUTE.indexOf('.upsert(')
  assert.ok(verifyAt < upsertAt && rejectAt < upsertAt,
    'an unverifiable target must cost zero mutations')
})

test('a submission with nothing to write performs no mutation', () => {
  assert.ok(/plan\.outcome === 'noop'/.test(DECISION_ROUTE))
  const noopAt = DECISION_ROUTE.indexOf("plan.outcome === 'noop'")
  assert.ok(noopAt < DECISION_ROUTE.indexOf('.upsert('))
  assert.equal(planWrites(planArgs([decision('l', 'skipped')])).outcome, 'noop')
})

test('no RPC, migration or transaction is introduced or claimed', () => {
  for (const [name, src] of [
    ['route', DECISION_ROUTE], ['dispositions', DISPOSITIONS], ['page', MATCH_PAGE],
  ] as const) {
    assert.ok(!/\.rpc\s*\(/.test(src), `${name} must not call an RPC`)
    assert.ok(!/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i.test(src), `${name} must not issue transaction control`)
    assert.ok(!/ALTER TABLE|CREATE TABLE|CREATE FUNCTION|ADD COLUMN/i.test(src),
      `${name} must not contain DDL`)
  }
  // And no claim of atomicity is made in prose either — the release refuses the
  // case that would need one instead of asserting it has one.
  assert.ok(!/is atomic\b|atomically/i.test(DECISION_ROUTE),
    'the route must not claim a transactional guarantee it does not implement')
})

test('the writer reads only what it needs to decide, before deciding', () => {
  // The prior-row read has to cover BOTH ends, or the refusal cannot see the
  // source row it exists to detect.
  assert.ok(/touchedProductIds/.test(DECISION_ROUTE))
  assert.ok(/new Set\(\[reviewedProductId, \.\.\.moveTargets\]\)/.test(DECISION_ROUTE),
    'the reviewed product must always be read, or a conflict would go unseen')
})

/* ==========================================================================
   Product-page match review mode.

   The public product page gains admin-only review controls. These cover the
   two things that can be wrong without being visible: the authorisation
   boundary, and whether one decision can reach a relation it was not aimed at.
   ========================================================================== */

import {
  DECISION_SOURCE,
  DISPOSITION_FOR,
} from '../../frontend/lib/admin-match-decision'

const RV_FE = join(__dirname, '..', '..', 'frontend')
/** Code only; the comments legitimately quote the patterns being asserted. */
const rvCodeOf = (...seg: string[]) =>
  readFileSync(join(RV_FE, ...seg), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const RV_PRODUCT_PAGE = ['app', 'product', '[slug]', 'page.tsx']
const RV_CONTROLS = ['components', 'admin', 'ProductReviewControls.tsx']
const RV_DECISION_LIB = ['lib', 'admin-match-decision.ts']
const RV_REVIEW_ROUTE = ['app', 'api', 'admin', 'product', '[slug]', 'match-review', 'route.ts']
const RV_APPROVE_ROUTE = ['app', 'api', 'admin', 'product', '[slug]', 'approve-match', 'route.ts']
const RV_REJECT_ROUTE = ['app', 'api', 'admin', 'product', '[slug]', 'reject-match', 'route.ts']
const RV_PUBLIC_ROUTE = ['app', 'api', 'product', '[slug]', 'route.ts']

const RV_PRIOR = (isValid: boolean | null) => ({
  method: 'MODEL', score: 70, isValid, explain: { matcher: 'kept' },
})
const rvPlanOne = (
  disposition: 'exact' | 'wrong',
  listingId = 'L1',
  productId = 'P1',
  prior: ReturnType<typeof RV_PRIOR> | undefined = RV_PRIOR(null),
) =>
  planDecisionWrites({
    decisions: [{ listing_id: listingId, disposition, target_product_id: null }],
    reviewedProductId: productId,
    priorByKey: prior ? { [`${listingId}:${productId}`]: prior } : {},
    actorUserId: 'admin-1',
    decidedAt: '2026-09-02T10:00:00.000Z',
    manualMethod: MANUAL_METHOD,
    manualScore: MANUAL_SCORE,
    rejectedReasonConstant: REJECTION_REASON,
    decisionSource: DECISION_SOURCE,
  })

// ── 1-5: the authorisation boundary ─────────────────────────────────────────

test('review 1: the toggle is rendered only for a server-verified admin', () => {
  const code = rvCodeOf(...RV_PRODUCT_PAGE)
  assert.ok(/isAdmin && \(/.test(code), 'the toggle is behind isAdmin')
  assert.ok(code.includes("fetch('/api/admin/me')"), 'isAdmin comes from the server, not the URL')
})

test('review 2: every write route enforces admin server-side', () => {
  for (const route of [RV_APPROVE_ROUTE, RV_REJECT_ROUTE, RV_REVIEW_ROUTE]) {
    const code = rvCodeOf(...route)
    assert.ok(code.includes('requireAdminInRoute'), `${route.join('/')} must gate itself`)
  }
})

test('review 3: a query parameter grants nothing', () => {
  const code = rvCodeOf(...RV_PRODUCT_PAGE)
  // Review mode is the AND of a preference and a server-verified identity.
  assert.ok(/reviewMode = isAdmin && reviewRequested/.test(code))
  assert.equal(/reviewMode = reviewRequested/.test(code), false)
  // The parameter must never be read by a route as authority.
  for (const route of [RV_APPROVE_ROUTE, RV_REJECT_ROUTE, RV_REVIEW_ROUTE]) {
    const code = rvCodeOf(...route)
    assert.equal(/searchParams|['"]debug['"]|['"]review['"]/.test(code), false,
      `${route.join('/')} must not read a view flag`)
  }
})

test('review 4: an admin without review mode gets the normal page', () => {
  const code = rvCodeOf(...RV_PRODUCT_PAGE)
  assert.ok(/\{reviewMode && \(/.test(code), 'controls are behind reviewMode, not isAdmin alone')
})

test('review 5: review mode renders status and the controls, via i18n', () => {
  const code = rvCodeOf(...RV_CONTROLS)
  // The literal Danish that used to live here moved into lib/i18n.ts, which
  // frontend/CLAUDE.md requires for anything rendered on a localised page.
  // The controls are still all three; they are now keys, not strings.
  assert.ok(code.includes('t.adminReview.approve'))
  assert.ok(code.includes('t.adminReview.reject'))
  assert.ok(code.includes('t.adminReview.move'))
  assert.ok(code.includes('StatusChip'))
  assert.equal(/'(Godkend|Afvis|Match med andet produkt)'/.test(code), false,
    'no raw Danish string may remain in the component')
})

// ── 6-10: the decision contract ─────────────────────────────────────────────

test('review 6: an already-approved match can be rejected again', () => {
  const rows = rvPlanOne('wrong', 'L1', 'P1', RV_PRIOR(true))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].is_valid, false)
  assert.equal(rows[0].rejected_reason, REJECTION_REASON)
})

test('review 7: an unresolved match can be approved', () => {
  const rows = rvPlanOne('exact', 'L1', 'P1', RV_PRIOR(null))
  assert.equal(rows[0].is_valid, true)
  assert.equal(rows[0].rejected_reason, null)
})

test('review 8: a decision is scoped to the listing and the reviewed product', () => {
  const rows = rvPlanOne('wrong', 'L-target', 'P-reviewed', RV_PRIOR(true))
  assert.equal(rows.length, 1, 'exactly one row is written')
  assert.equal(rows[0].listing_id, 'L-target')
  assert.equal(rows[0].product_id, 'P-reviewed')
})

test('review 9: another product relation for the same listing is untouched', () => {
  // The Juno-6 case: wrong on juno-106, correct on juno-6. One decision, one row.
  const rows = rvPlanOne('wrong', 'L-juno6', 'P-juno106', RV_PRIOR(true))
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].product_id, 'P-juno6')
  // And the writer refuses anything the planner aims elsewhere.
  const lib = rvCodeOf(...RV_DECISION_LIB)
  assert.ok(lib.includes('refusing an out-of-scope write'))
  assert.ok(lib.includes(".eq('listing_id'") && lib.includes(".eq('product_id'"))
})

test('review 10: provenance is written, and prior matcher evidence survives', () => {
  const rows = rvPlanOne('wrong', 'L1', 'P1', RV_PRIOR(true))
  const decision = (rows[0].explain as Record<string, Record<string, unknown>>).admin_decision
  assert.equal(decision.decision, 'rejected')
  assert.equal(decision.actor_user_id, 'admin-1')
  assert.equal(decision.decided_at, '2026-09-02T10:00:00.000Z')
  assert.equal(decision.decision_source, DECISION_SOURCE)
  assert.equal(rows[0].method, 'MODEL', 'the matcher method is preserved')
  assert.equal(rows[0].score, 70)
  assert.equal((rows[0].explain as Record<string, unknown>).matcher, 'kept', 'prior explain survives')
})

test('review 10b: both product-page decisions use the shared disposition vocabulary', () => {
  assert.equal(DISPOSITION_FOR.approve, 'exact')
  assert.equal(DISPOSITION_FOR.reject, 'wrong')
  assert.equal(IS_VALID_FOR[DISPOSITION_FOR.approve], true)
  assert.equal(IS_VALID_FOR[DISPOSITION_FOR.reject], false)
})

test('review 10c: the product page no longer has a second reject contract', () => {
  const code = rvCodeOf(...RV_REJECT_ROUTE)
  assert.ok(code.includes('applyProductPageDecision'), 'delegates to the shared writer')
  assert.equal(/\.update\(\s*\{/.test(code), false, 'no direct is_valid update remains')
})

// ── 11-13: interaction ──────────────────────────────────────────────────────

test('review 11: reassign reuses the existing contract, not a new picker', () => {
  const code = rvCodeOf(...RV_CONTROLS)
  assert.ok(code.includes('ReassignPanel'), 'the existing panel is reused')
  assert.equal(/admin\/products\?q=/.test(code), false, 'no parallel KG search here')
  const panel = rvCodeOf('components', 'admin', 'ReassignPanel.tsx')
  assert.ok(panel.includes('reassign-match'), 'the panel still calls the existing route')
})

test('review 12: a server error does not advance the card status', () => {
  const code = rvCodeOf(...RV_CONTROLS)
  // onDecided is only reached after the ok-check returns.
  const failIdx = code.indexOf('if (!res.ok)')
  const successIdx = code.indexOf('onDecided(listingId')
  assert.ok(failIdx !== -1 && successIdx !== -1)
  assert.ok(failIdx < successIdx, 'the failure branch returns before any state advance')
  // The failure is still surfaced; it now travels up via `onFailed` to the
  // page-level toast /admin/match already used, instead of a local error line
  // that vanished with the card.
  assert.ok(code.includes('onFailed('), 'the failure is surfaced')
})

test('review 13: a confirmed decision refetches product and match data', () => {
  const code = rvCodeOf(...RV_PRODUCT_PAGE)
  assert.ok(code.includes('void loadProduct()'))
  assert.ok(code.includes('void loadMatchStatuses()'))
})

// ── 14-15: the public surface is unchanged ──────────────────────────────────

test('review 14: the public product API exposes no admin match metadata', () => {
  const code = rvCodeOf(...RV_PUBLIC_ROUTE)

  /**
   * SCOPED TO THE PAYLOAD, NOT THE FILE.
   *
   * This used to forbid the substring `is_valid:` anywhere in the route. P2
   * added `is_valid: boolean | null` as a TYPE ANNOTATION on the internal
   * match-row shape, which the coarse check read as a leak. The property being
   * protected is that the RESPONSE carries no admin metadata, so the assertion
   * now looks at the response object and at the public listing shape — the two
   * places a leak could actually occur.
   */
  const at = code.lastIndexOf('return NextResponse.json(')
  assert.ok(at !== -1, 'the route returns a JSON response')
  const payload = code.slice(at, code.indexOf('\n', code.indexOf('{', at + 25)))
  for (const leak of ['is_valid', 'rejected_reason', 'explain', 'admin_decision', 'actor_user_id']) {
    assert.equal(payload.includes(leak), false, `public payload must not carry ${leak}`)
  }

  // The listings themselves are built by `toPublicListing`, whose field list is
  // the real boundary: nothing can be serialised that is not named there.
  const publicShape = rvCodeOf('lib', 'public-product.ts')
  for (const leak of ['is_valid', 'rejected_reason', 'explain', 'admin_decision', 'actor_user_id']) {
    assert.equal(publicShape.includes(leak), false, `the public listing shape must not carry ${leak}`)
  }

  // The public route still filters rejections without publishing the field.
  assert.ok(code.includes("not('is_valid', 'is', false)"), 'filtering is allowed; exposing is not')
})

test('review 15: without review mode the public page renders no review markup', () => {
  const code = rvCodeOf(...RV_PRODUCT_PAGE)
  const controls = code.indexOf('<ProductReviewControls')
  assert.ok(controls !== -1)
  const guard = code.lastIndexOf('reviewMode &&', controls)
  assert.ok(guard !== -1 && guard < controls, 'every control is behind the reviewMode guard')
})

test('review 15b: the admin metadata endpoint withholds actor and explain', () => {
  const code = rvCodeOf(...RV_REVIEW_ROUTE)
  assert.ok(code.includes("select('listing_id, is_valid, method, score')"))
  assert.equal(code.includes('explain'), false, 'explain holds actor_user_id and is not returned')
  assert.equal(code.includes('rejected_reason'), false)
})

/* ── Reject contract: provenance AND the pre-existing reason ────────────────
   The route documented `{ listing_id, reason? }` before review mode existed.
   These lock the compatibility of that request shape and, more importantly,
   that a decision never erases a more specific cause another producer wrote. */

import { applyProductPageDecision } from '../../frontend/lib/admin-match-decision'

type RvFakeRow = Record<string, unknown>

/** Minimal recording stand-in for the Supabase admin client. */
function rvFakeAdmin(prior: RvFakeRow | null) {
  const upserts: RvFakeRow[][] = []
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () =>
          table === 'kg_product'
            ? { data: { id: 'P-juno106' }, error: null }
            : { data: prior, error: null },
        upsert: async (rows: RvFakeRow[]) => { upserts.push(rows); return { error: null } },
      }
      return b
    },
  }
  return { client: client as never, upserts }
}

const RV_PRIOR_ROW = (over: RvFakeRow = {}) => ({
  method: 'MODEL', score: 70, is_valid: true, rejected_reason: null,
  explain: { matcher: 'kept' }, ...over,
})

test('reject 1: a legacy request carrying `reason` is still accepted', async () => {
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW())
  const res = await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'reject',
    actorUserId: 'admin-1', operatorNote: 'Det er en JV-1010, ikke en Juno-106',
  })
  assert.equal(res.ok, true)
  const row = upserts[0][0] as RvFakeRow
  const decision = (row.explain as Record<string, RvFakeRow>).admin_decision
  assert.equal(decision.operator_note, 'Det er en JV-1010, ikke en Juno-106')
})

test('reject 2: a more specific prior cause is preserved, not overwritten', async () => {
  // The matcher's brand guard wrote this; an admin confirming the rejection
  // must not replace it with the generic constant.
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW({ rejected_reason: 'brand_collision', is_valid: false }))
  await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'reject', actorUserId: 'admin-1',
  })
  assert.equal((upserts[0][0] as RvFakeRow).rejected_reason, 'brand_collision')
})

test('reject 2b: with no prior cause the structured constant is written', async () => {
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW())
  await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'reject', actorUserId: 'admin-1',
  })
  assert.equal((upserts[0][0] as RvFakeRow).rejected_reason, REJECTION_REASON)
})

test('reject 3: admin_decision is written alongside the reason', async () => {
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW({ rejected_reason: 'brand_collision', is_valid: false }))
  await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'reject',
    actorUserId: 'admin-1', operatorNote: 'bekræftet',
  })
  const row = upserts[0][0] as RvFakeRow
  const decision = (row.explain as Record<string, RvFakeRow>).admin_decision
  assert.equal(row.rejected_reason, 'brand_collision', 'column cause survives')
  assert.equal(decision.decision, 'rejected', 'and provenance is written too')
  assert.equal(decision.operator_note, 'bekræftet')
})

test('reject 4: actor, timestamp and source are recorded', async () => {
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW())
  await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'reject', actorUserId: 'admin-7',
  })
  const d = ((upserts[0][0] as RvFakeRow).explain as Record<string, RvFakeRow>).admin_decision
  assert.equal(d.actor_user_id, 'admin-7')
  assert.equal(d.decision_source, DECISION_SOURCE)
  assert.ok(typeof d.decided_at === 'string' && !Number.isNaN(Date.parse(d.decided_at as string)))
  assert.equal(d.disposition, 'wrong', 'the structured disposition is kept')
})

test('reject 5: existing explain and matcher metadata survive', async () => {
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW({ explain: { matcher: 'kept', ai_pass: 2 } }))
  await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'reject', actorUserId: 'admin-1',
  })
  const row = upserts[0][0] as RvFakeRow
  assert.equal(row.method, 'MODEL', 'matcher method preserved')
  assert.equal(row.score, 70)
  assert.equal((row.explain as RvFakeRow).matcher, 'kept')
  assert.equal((row.explain as RvFakeRow).ai_pass, 2)
})

test('reject 6: approving clears the rejection cause', async () => {
  const { client, upserts } = rvFakeAdmin(RV_PRIOR_ROW({ rejected_reason: 'brand_collision', is_valid: false }))
  await applyProductPageDecision(client, {
    slug: 'roland-juno-106', listingId: 'L1', decision: 'approve', actorUserId: 'admin-1',
  })
  const row = upserts[0][0] as RvFakeRow
  assert.equal(row.is_valid, true)
  assert.equal(row.rejected_reason, null, 'the cause no longer holds once approved')
})

test('reject 7: the batch flow is untouched by the product-page source', () => {
  // planDecisionWrites still defaults to the original source when none is given.
  const rows = planDecisionWrites({
    decisions: [{ listing_id: 'L1', disposition: 'wrong', target_product_id: null }],
    reviewedProductId: 'P1', priorByKey: {}, actorUserId: 'a', decidedAt: 'D',
    manualMethod: MANUAL_METHOD, manualScore: MANUAL_SCORE, rejectedReasonConstant: REJECTION_REASON,
  })
  const d = (rows[0].explain as Record<string, Record<string, unknown>>).admin_decision
  assert.equal(d.decision_source, 'admin/match')
})

test('reject 7b: the curation client request shape still works', () => {
  const code = rvCodeOf('app', 'admin', 'product', '[slug]', 'ProductCurationClient.tsx')
  assert.ok(code.includes("JSON.stringify({ listing_id: listing.id })"), 'existing client unchanged')
  const route = rvCodeOf(...RV_REJECT_ROUTE)
  assert.ok(/listing_id, reason/.test(route), 'and the route still destructures reason')
})

test('reject 8: a decision never touches a relation by listing id alone', () => {
  const lib = rvCodeOf(...RV_DECISION_LIB)
  // Both reads and the write are keyed on the pair.
  assert.equal((lib.match(/\.eq\('product_id'/g) ?? []).length >= 1, true)
  assert.ok(lib.includes("upsert([row], { onConflict: 'listing_id,product_id' })"))
})

/* ── The extracted reassign panel, and its two consumers ────────────────────── */

test('reassign: both consumers render the same extracted panel', () => {
  const panel = 'components/admin/ReassignPanel'
  const curation = rvCodeOf('app', 'admin', 'product', '[slug]', 'ProductCurationClient.tsx')
  const controls = rvCodeOf(...RV_CONTROLS)
  for (const [name, code] of [['curation page', curation], ['product-page review', controls]] as const) {
    assert.ok(code.includes(panel), `${name} imports the shared panel`)
    assert.ok(code.includes('<ReassignPanel'), `${name} renders it`)
  }
  // Neither consumer may hold its own copy of the search or the create form.
  for (const code of [curation, controls]) {
    assert.equal(code.includes('function ReassignPanel'), false)
    assert.equal(code.includes('function InlineNewProductForm'), false)
  }
})

test('reassign: the panel props contract is identical for both consumers', () => {
  for (const code of [
    rvCodeOf('app', 'admin', 'product', '[slug]', 'ProductCurationClient.tsx'),
    rvCodeOf(...RV_CONTROLS),
  ]) {
    let at = code.indexOf('<ReassignPanel')
    let sites = 0
    while (at !== -1) {
      const block = code.slice(at, at + 1200)
      for (const prop of ['slug=', 'listingId=', 'onSuccess=', 'onCancel=']) {
        assert.ok(block.includes(prop), `call site ${sites} must pass ${prop}`)
      }
      sites += 1
      at = code.indexOf('<ReassignPanel', at + 1)
    }
    assert.ok(sites > 0, 'at least one call site')
  }
})

test('reassign: the panel still targets the pre-existing routes', () => {
  const panel = rvCodeOf('components', 'admin', 'ReassignPanel.tsx')
  assert.ok(panel.includes('/api/admin/products?q='), 'the existing product search')
  assert.ok(panel.includes('/reassign-match'), 'the existing reassign route')
  assert.ok(panel.includes('/api/admin/product/new'), 'the existing create route')
  // Payload keys, unchanged by the move.
  assert.ok(panel.includes('target_slug'))
})

/* ── Multi-relation safety and the security surface ─────────────────────────── */

test('safety: reassign moves one pair and deletes nothing', () => {
  const route = rvCodeOf('app', 'api', 'admin', 'product', '[slug]', 'reassign-match', 'route.ts')
  assert.equal(/\.delete\(/.test(route), false, 'no listing or match is ever deleted')
  // The route now delegates, exactly as reject-match and approve-match already
  // do. The pair-scoping property did not go away — it moved into the shared
  // writer, so it is asserted there instead of here.
  assert.ok(route.includes('applyReassign'), 'delegates to the shared writer')
  assert.equal(/\.from\('listing_product_match'\)/.test(route), false, 'no direct table access')

  const writer = rvCodeOf('lib', 'admin-match-decision.ts')
  assert.equal(/\.delete\(/.test(writer), false, 'the writer deletes nothing either')
  assert.ok(writer.includes(".eq('listing_id'"), 'scoped by listing')
  assert.ok(writer.includes(".eq('product_id'"), 'AND by the product')
})

test('safety: no decision route updates by listing id alone', () => {
  for (const seg of [
    ['app', 'api', 'admin', 'product', '[slug]', 'reject-match', 'route.ts'],
    ['app', 'api', 'admin', 'product', '[slug]', 'approve-match', 'route.ts'],
  ]) {
    const code = rvCodeOf(...seg)
    // These delegate; the pair-scoping lives in the shared writer.
    assert.ok(code.includes('applyProductPageDecision'))
    assert.equal(/\.from\('listing_product_match'\)/.test(code), false, 'no direct table access')
  }
})

test('security: the client cannot choose the actor or the product', () => {
  for (const seg of [
    ['app', 'api', 'admin', 'product', '[slug]', 'reject-match', 'route.ts'],
    ['app', 'api', 'admin', 'product', '[slug]', 'approve-match', 'route.ts'],
  ]) {
    const code = rvCodeOf(...seg)
    assert.ok(code.includes('getCurrentAdminState()'), 'actor comes from the session')
    assert.ok(/actorUserId: userId/.test(code))
    // Only listing_id (and the optional note) are read from the body.
    assert.equal(/product_id.*await req\.json|json\(\).*product_id/s.test(code), false,
      'product id is never taken from the request body')
    assert.ok(/slug: params\.slug/.test(code), 'product is resolved from the route slug')
  }
})

test('security: both new routes are in the posture registry', async () => {
  const { ROUTE_ACCESS } = await import('../../frontend/lib/route-access')
  const rows = ROUTE_ACCESS as ReadonlyArray<{ route: string; access: string }>
  for (const r of [
    '/api/admin/product/[slug]/approve-match',
    '/api/admin/product/[slug]/match-review',
  ]) {
    const hit = rows.find((x) => x.route === r)
    assert.ok(hit, `${r} must be classified`)
    assert.equal(hit.access, 'admin_api')
  }
})

test('security: match-review metadata is admin-gated and minimal', () => {
  const code = rvCodeOf(...RV_REVIEW_ROUTE)
  const gate = code.indexOf('requireAdminInRoute')
  const read = code.indexOf("from('listing_product_match')")
  assert.ok(gate !== -1 && read !== -1 && gate < read, 'authorisation runs before any read')
})
