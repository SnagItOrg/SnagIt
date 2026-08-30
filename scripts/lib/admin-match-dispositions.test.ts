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
  PERSISTS,
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
