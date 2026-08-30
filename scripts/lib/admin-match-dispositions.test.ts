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
  MOVED_AWAY_REASON,
  PERSISTS,
  REJECTION_REASON_FOR,
  isApproval,
  isRejection,
  planDecisionWrites,
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

function plan(decisions: DecisionInput[], priorByKey: Record<string, PriorRow> = {}) {
  return planDecisionWrites({
    decisions,
    reviewedProductId: REVIEWED,
    priorByKey,
    actorUserId: 'user-1',
    decidedAt: '2026-08-30T00:00:00.000Z',
    manualMethod: 'FUZZY',
    manualScore: 1,
    rejectedReasonConstant: 'admin_rejected',
  })
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
    (rows[0].explain.admin_decision as Record<string, unknown>).moved_from_product_id,
    REVIEWED,
    'the move is recorded, so the row is not mistaken for an ordinary approval',
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
 * 6. The reviewed product keeps no positive match after a move
 * ------------------------------------------------------------------ */

test('an existing positive match on the reviewed product is demoted by a move', () => {
  const rows = plan(
    [decision('l', 'move_to_existing_product', OTHER)],
    { [`l:${REVIEWED}`]: { method: 'MODEL', score: 95, isValid: true, explain: {} } },
  )
  const left = rows.find((r) => r.product_id === REVIEWED)
  assert.ok(left, 'the row left behind must be rewritten, not ignored')
  assert.equal(left!.is_valid, false, 'it would otherwise stay price evidence for both products')
  assert.equal(
    (left!.explain.admin_decision as Record<string, unknown>).rejection_reason,
    MOVED_AWAY_REASON,
  )
})

test('an unreviewed automatic match on the reviewed product is also demoted', () => {
  // NULL is publicly visible, so leaving it would keep the listing on the page.
  const rows = plan(
    [decision('l', 'move_to_existing_product', OTHER)],
    { [`l:${REVIEWED}`]: { method: 'FUZZY', score: 70, isValid: null, explain: {} } },
  )
  assert.equal(rows.find((r) => r.product_id === REVIEWED)?.is_valid, false)
})

test('no row is invented on the reviewed product where none existed', () => {
  const rows = plan([decision('l', 'move_to_existing_product', OTHER)])
  assert.equal(rows.filter((r) => r.product_id === REVIEWED).length, 0,
    'absence already means "not evidence" — inventing a rejection claims more')
})

test('an already-rejected source row is left alone', () => {
  const rows = plan(
    [decision('l', 'move_to_existing_product', OTHER)],
    { [`l:${REVIEWED}`]: { method: 'FUZZY', score: 1, isValid: false, explain: {} } },
  )
  assert.equal(rows.filter((r) => r.product_id === REVIEWED).length, 0, 'nothing to change')
})

test('after any move, no positive row remains on the reviewed product', () => {
  for (const prior of [
    undefined,
    { method: 'MODEL', score: 95, isValid: true as boolean | null, explain: {} },
    { method: 'FUZZY', score: 70, isValid: null as boolean | null, explain: {} },
    { method: 'FUZZY', score: 1, isValid: false as boolean | null, explain: {} },
  ]) {
    const rows = plan(
      [decision('l', 'move_to_existing_product', OTHER)],
      prior ? { [`l:${REVIEWED}`]: prior as PriorRow } : {},
    )
    const positiveOnSource = rows.some((r) => r.product_id === REVIEWED && r.is_valid === true)
    assert.equal(positiveOnSource, false, 'a move must never leave the source positive')
  }
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

test('the move control is not described as a childnode or a relationship', () => {
  assert.ok(/Flyt til andet produkt/.test(MATCH_PAGE))
  for (const misleading of ['underknude', 'childnode', 'child node', 'forælder']) {
    assert.ok(!MATCH_PAGE.includes(misleading), `"${misleading}" implies a relationship that is never created`)
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
