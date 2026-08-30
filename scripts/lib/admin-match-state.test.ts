/**
 * /admin/match — search and candidate state.
 *
 * Five production defects are pinned here. Every one of them is an ORDERING
 * defect: the code was correct for any single event and wrong for a sequence,
 * which is why none of them was visible in a screenshot or catchable by types.
 *
 *   1. Selecting a product did not load candidates; the operator had to click
 *      "Find kandidater" as a second, mandatory step.
 *   2. Searching for another product could leave the previous query, product or
 *      candidate list on screen.
 *   3. A response for the PREVIOUS product could land after the response for
 *      the new one and overwrite it.
 *   4. Approve/reject ticks survived a product change, so the next save could
 *      carry a decision the operator made about a different product — writing a
 *      durable, wrong label.
 *   5. Reload lost the selection entirely.
 *
 * The reducer is import-free, so these run under the root `tsx --test` harness
 * with no React, no DOM and no network. The hostile interleavings below are the
 * whole point: they are trivial to produce here and near-impossible to produce
 * by hand in a browser.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  canSave,
  createInitialState,
  decisionCounts,
  isLoadingCandidates,
  isSelectionSettling,
  matchReducer,
  savePayload,
  sourcesDiffer,
  type CandidateRef,
  type MatchAction,
  type MatchProduct,
  type MatchState,
} from '../../frontend/app/admin/match/match-state'
import { ALL_SOURCE_KEYS } from '../../frontend/lib/admin-match-sources'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const MATCH_PAGE  = read('frontend', 'app', 'admin', 'match', 'page.tsx')
const SEARCH_ROUTE = read('frontend', 'app', 'api', 'admin', 'match', 'search', 'route.ts')

/* ── fixtures ────────────────────────────────────────────────────────────── */

const JUNO60: MatchProduct = {
  id: 'p-juno-60', canonical_name: 'Roland Juno-60', slug: 'roland-juno-60', kg_brand: { name: 'Roland' },
}
const JUNO106: MatchProduct = {
  id: 'p-juno-106', canonical_name: 'Roland Juno-106', slug: 'roland-juno-106', kg_brand: { name: 'Roland' },
}

const c = (id: string): CandidateRef => ({ id })

type S = MatchState<CandidateRef>
const start = (): S => createInitialState<CandidateRef>(ALL_SOURCE_KEYS)
const run = (state: S, ...actions: MatchAction<CandidateRef>[]): S =>
  actions.reduce((s, a) => matchReducer(s, a), state)

/** Select a product and let its sweep land. */
function withLoaded(product: MatchProduct, ids: string[], from: S = start()): S {
  const selected = run(from, { type: 'product_selected', product })
  return run(selected, {
    type: 'candidates_received',
    requestId: selected.candidateRequest.id,
    productId: product.id,
    candidates: ids.map(c),
  })
}

/* ------------------------------------------------------------------ *
 * 1. Selection triggers exactly one request
 * ------------------------------------------------------------------ */

test('selecting a product starts a sweep immediately — no second click required', () => {
  const s = run(start(), { type: 'product_selected', product: JUNO60 })
  assert.equal(s.candidateRequest.status, 'loading', 'selection must load candidates by itself')
  assert.equal(s.candidateRequest.productId, JUNO60.id)
  assert.equal(isLoadingCandidates(s), true)
})

test('selection bumps the request counter exactly once', () => {
  const before = start().candidateRequest.id
  const s = run(start(), { type: 'product_selected', product: JUNO60 })
  assert.equal(s.candidateRequest.id, before + 1, 'one selection is one sweep')
})

test('re-selecting the SAME product does not start a second sweep', () => {
  // This is what stops the URL restore and the click that caused it from each
  // firing a request for the same product.
  const first = run(start(), { type: 'product_selected', product: JUNO60 })
  const again = run(first, { type: 'product_selected', product: JUNO60 })
  assert.equal(again.candidateRequest.id, first.candidateRequest.id, 'duplicate request')
  assert.equal(again.selectedProduct?.id, JUNO60.id)
})

test('the mandatory "Find kandidater" step is gone and a secondary reload replaces it', () => {
  assert.ok(!MATCH_PAGE.includes('Find kandidater'), 'the mandatory first click must be gone')
  assert.ok(MATCH_PAGE.includes('Genindlæs'), 'a secondary reload action must exist')
})

test('reload re-sweeps the same product without changing the selection', () => {
  const loaded = withLoaded(JUNO60, ['a', 'b'])
  const reloaded = run(loaded, { type: 'candidates_reload_requested' })
  assert.equal(reloaded.candidateRequest.id, loaded.candidateRequest.id + 1)
  assert.equal(reloaded.selectedProduct?.id, JUNO60.id)
  assert.deepEqual(reloaded.candidates, [], 'the stale list must not linger during a reload')
})

test('reload with nothing selected is inert', () => {
  const s = start()
  assert.equal(run(s, { type: 'candidates_reload_requested' }), s)
})

/* ------------------------------------------------------------------ *
 * 2. A product change clears the previous product synchronously
 * ------------------------------------------------------------------ */

test('changing product clears candidates, decisions and error in the same transition', () => {
  const loaded = run(withLoaded(JUNO60, ['a', 'b']), {
    type: 'decision_toggled', listingId: 'a', verdict: 'approved',
  })
  assert.equal(loaded.candidates.length, 2)
  assert.equal(Object.keys(loaded.localDecisions).length, 1)

  const switched = run(loaded, { type: 'product_selected', product: JUNO106 })
  // Not "eventually" — in the very state the new product first appears in.
  assert.deepEqual(switched.candidates, [], 'previous candidates survived the switch')
  assert.deepEqual(switched.localDecisions, {}, 'previous ticks survived the switch')
  assert.equal(switched.error, null)
  assert.equal(switched.selectedProduct?.id, JUNO106.id)
})

test('changing product replaces the query text and closes the suggestion list', () => {
  const loaded = run(withLoaded(JUNO60, ['a']), {
    type: 'search_results_received', products: [JUNO60, JUNO106],
  })
  assert.equal(loaded.searchResults.length, 2)
  const switched = run(loaded, { type: 'product_selected', product: JUNO106 })
  assert.equal(switched.searchInput, 'Roland Juno-106', 'the box must name the current product')
  assert.deepEqual(switched.searchResults, [], 'the old suggestion list must close')
})

test('clearing the product empties everything it owned', () => {
  const loaded = run(withLoaded(JUNO60, ['a']), {
    type: 'decision_toggled', listingId: 'a', verdict: 'rejected',
  })
  const cleared = run(loaded, { type: 'product_cleared' })
  assert.equal(cleared.selectedProduct, null)
  assert.deepEqual(cleared.candidates, [])
  assert.deepEqual(cleared.localDecisions, {})
  assert.equal(cleared.candidateRequest.status, 'idle')
})

test('candidates on screen always belong to the selected product', () => {
  // The invariant, stated directly: after ANY of these sequences, a non-empty
  // candidate list implies a settled request for the selected product.
  const sequences: MatchAction<CandidateRef>[][] = [
    [{ type: 'product_selected', product: JUNO60 }],
    [{ type: 'product_selected', product: JUNO60 }, { type: 'product_selected', product: JUNO106 }],
    [{ type: 'product_selected', product: JUNO60 }, { type: 'candidates_reload_requested' }],
    [{ type: 'product_selected', product: JUNO60 }, { type: 'product_cleared' }],
  ]
  for (const seq of sequences) {
    const s = run(start(), ...seq)
    if (s.candidates.length > 0) {
      assert.equal(s.candidateRequest.productId, s.selectedProduct?.id ?? null)
    }
  }
})

/* ------------------------------------------------------------------ *
 * 3. A stale response cannot overwrite a newer one
 * ------------------------------------------------------------------ */

test('a slow response for the previous product cannot land on the new one', () => {
  const first = run(start(), { type: 'product_selected', product: JUNO60 })
  const staleId = first.candidateRequest.id

  const second = run(first, { type: 'product_selected', product: JUNO106 })
  const freshId = second.candidateRequest.id

  // Juno-106 answers first…
  const answered = run(second, {
    type: 'candidates_received', requestId: freshId, productId: JUNO106.id, candidates: [c('new-1')],
  })
  // …then Juno-60's earlier sweep finally arrives.
  const afterStale = run(answered, {
    type: 'candidates_received', requestId: staleId, productId: JUNO60.id, candidates: [c('old-1')],
  })

  assert.deepEqual(afterStale.candidates.map((x) => x.id), ['new-1'], 'a stale response overwrote fresh results')
})

test('a stale FAILURE cannot blank a healthy list or raise a false error', () => {
  const first = run(start(), { type: 'product_selected', product: JUNO60 })
  const staleId = first.candidateRequest.id
  const second = run(first, { type: 'product_selected', product: JUNO106 })
  const loaded = run(second, {
    type: 'candidates_received',
    requestId: second.candidateRequest.id, productId: JUNO106.id, candidates: [c('new-1')],
  })
  const after = run(loaded, {
    type: 'candidates_failed', requestId: staleId, productId: JUNO60.id, message: 'boom',
  })
  assert.deepEqual(after.candidates.map((x) => x.id), ['new-1'])
  assert.equal(after.error, null, 'an abandoned sweep must not report an error')
})

test('the right counter with the wrong product is still refused', () => {
  // A -> B -> A returns to a matching product; only the counter separates them.
  const s = run(start(), { type: 'product_selected', product: JUNO60 })
  const wrongProduct = run(s, {
    type: 'candidates_received',
    requestId: s.candidateRequest.id, productId: JUNO106.id, candidates: [c('x')],
  })
  assert.deepEqual(wrongProduct.candidates, [], 'product identity must be checked too')
})

test('the right product with a superseded counter is still refused', () => {
  const loaded = withLoaded(JUNO60, ['a'])
  const reloading = run(loaded, { type: 'candidates_reload_requested' })
  const late = run(reloading, {
    type: 'candidates_received',
    requestId: reloading.candidateRequest.id - 1, productId: JUNO60.id, candidates: [c('stale')],
  })
  assert.deepEqual(late.candidates, [], 'a superseded sweep must not undo a reload')
})

test('the page pairs an AbortController with the request identity', () => {
  assert.ok(MATCH_PAGE.includes('AbortController'), 'the previous sweep must be aborted')
  assert.ok(/signal:\s*controller\.signal/.test(MATCH_PAGE), 'the fetch must carry the signal')
  assert.ok(/AbortError/.test(MATCH_PAGE), 'an aborted sweep must not be reported as a failure')
})

/* ------------------------------------------------------------------ *
 * 4. Decisions cannot leak across products
 * ------------------------------------------------------------------ */

test('a decision made on one product cannot be saved against another', () => {
  // The defect that mattered most: this would have written a durable, wrong
  // is_valid label onto a listing/product pair the operator never judged.
  const onJuno60 = run(withLoaded(JUNO60, ['listing-1']), {
    type: 'decision_toggled', listingId: 'listing-1', verdict: 'approved',
  })
  const onJuno106 = withLoaded(JUNO106, ['listing-1'], onJuno60)

  assert.deepEqual(onJuno106.localDecisions, {}, 'the tick followed the operator to a new product')
  assert.equal(savePayload(onJuno106), null, 'nothing is pending, so nothing may be submitted')
})

test('a save submits only the active product and only its visible candidates', () => {
  const s = run(withLoaded(JUNO60, ['a', 'b', 'c']),
    { type: 'decision_toggled', listingId: 'a', verdict: 'approved' },
    { type: 'decision_toggled', listingId: 'b', verdict: 'rejected' },
  )
  const payload = savePayload(s)
  assert.ok(payload)
  assert.equal(payload!.product_id, JUNO60.id)
  assert.deepEqual(payload!.listing_ids, ['a'])
  assert.deepEqual(payload!.rejected_listing_ids, ['b'])
})

test('a decision whose listing is no longer on screen cannot reach the payload', () => {
  const s = run(withLoaded(JUNO60, ['a', 'b']),
    { type: 'decision_toggled', listingId: 'a', verdict: 'approved' },
  )
  // The list is refreshed and 'a' is gone — it was decided elsewhere, say.
  const refreshed = run(s,
    { type: 'candidates_reload_requested' },
  )
  const landed = run(refreshed, {
    type: 'candidates_received',
    requestId: refreshed.candidateRequest.id, productId: JUNO60.id, candidates: [c('b')],
  })
  assert.deepEqual(landed.localDecisions, {}, 'a decision must not outlive its candidate')
  assert.equal(savePayload(landed), null)
})

test('a tick for a listing that is not a candidate is ignored', () => {
  const s = withLoaded(JUNO60, ['a'])
  const after = run(s, { type: 'decision_toggled', listingId: 'not-here', verdict: 'approved' })
  assert.deepEqual(after.localDecisions, {})
})

test('toggling replaces the opposite verdict and a repeat clears it', () => {
  let s = withLoaded(JUNO60, ['a'])
  s = run(s, { type: 'decision_toggled', listingId: 'a', verdict: 'approved' })
  assert.equal(s.localDecisions.a, 'approved')
  s = run(s, { type: 'decision_toggled', listingId: 'a', verdict: 'rejected' })
  assert.equal(s.localDecisions.a, 'rejected', 'a listing cannot hold both verdicts')
  s = run(s, { type: 'decision_toggled', listingId: 'a', verdict: 'rejected' })
  assert.equal(s.localDecisions.a, undefined, 'clicking the same verdict twice takes it back')
})

test('counts describe the visible list only', () => {
  const s = run(withLoaded(JUNO60, ['a', 'b']),
    { type: 'decision_toggled', listingId: 'a', verdict: 'approved' },
    { type: 'decision_toggled', listingId: 'b', verdict: 'rejected' },
  )
  assert.deepEqual(decisionCounts(s), { approved: 1, rejected: 1, total: 2 })
  const switched = run(s, { type: 'product_selected', product: JUNO106 })
  assert.deepEqual(decisionCounts(switched), { approved: 0, rejected: 0, total: 0 })
})

test('a saved listing leaves the queue with its decision', () => {
  const s = run(withLoaded(JUNO60, ['a', 'b']),
    { type: 'decision_toggled', listingId: 'a', verdict: 'approved' },
  )
  const saved = run(s, { type: 'save_started' }, { type: 'save_succeeded', savedIds: ['a'] })
  assert.deepEqual(saved.candidates.map((x) => x.id), ['b'])
  assert.deepEqual(saved.localDecisions, {})
  assert.equal(saved.saving, false)
})

/* ------------------------------------------------------------------ *
 * 5. Save is disabled while the selection is moving
 * ------------------------------------------------------------------ */

test('save is refused while a sweep is in flight', () => {
  const selecting = run(start(), { type: 'product_selected', product: JUNO60 })
  assert.equal(isSelectionSettling(selecting), true)
  assert.equal(canSave(selecting), false)
  assert.equal(savePayload(selecting), null)
})

test('save is refused with nothing selected, and with nothing decided', () => {
  assert.equal(canSave(start()), false)
  assert.equal(canSave(withLoaded(JUNO60, ['a'])), false, 'no ticks means nothing to save')
})

test('save is refused while a save is already running', () => {
  const s = run(withLoaded(JUNO60, ['a']),
    { type: 'decision_toggled', listingId: 'a', verdict: 'approved' },
    { type: 'save_started' },
  )
  assert.equal(canSave(s), false, 'a double submit would write the same decision twice')
})

/* ------------------------------------------------------------------ *
 * 6. Source selection survives, and still filters
 * ------------------------------------------------------------------ */

test('source selection is preserved across a product change', () => {
  const s = run(withLoaded(JUNO60, ['a']), { type: 'source_toggled', key: 'reverb' })
  assert.ok(!s.sourceSelection.includes('reverb'))
  const switched = run(s, { type: 'product_selected', product: JUNO106 })
  assert.deepEqual(switched.sourceSelection, s.sourceSelection, 'the operator had to re-pick sources')
})

test('every registry source starts selected, and toggling is reversible', () => {
  const s = start()
  assert.deepEqual([...s.sourceSelection].sort(), [...ALL_SOURCE_KEYS].sort())
  const off = run(s, { type: 'source_toggled', key: 'kleinanzeigen' })
  assert.ok(!off.sourceSelection.includes('kleinanzeigen'))
  const on = run(off, { type: 'source_toggled', key: 'kleinanzeigen' })
  assert.deepEqual([...on.sourceSelection].sort(), [...ALL_SOURCE_KEYS].sort())
})

test('the last remaining source cannot be switched off', () => {
  // An empty selection returns an empty list, which reads as "nothing left to
  // match" — the exact ambiguity the DBA identifier bug created.
  let s = start()
  for (const key of ALL_SOURCE_KEYS.slice(1)) s = run(s, { type: 'source_toggled', key })
  assert.equal(s.sourceSelection.length, 1)
  const stillOne = run(s, { type: 'source_toggled', key: s.sourceSelection[0] })
  assert.equal(stillOne.sourceSelection.length, 1, 'the operator could reach an empty query')
})

test('the sweep sends the selected sources to the route', () => {
  assert.ok(/sources=\$\{sourcesParam\}/.test(MATCH_PAGE), 'the source filter must reach the query')
  assert.ok(/sourceSelection\.join\(','\)/.test(MATCH_PAGE), 'sources come from the selection state')
})

/* ------------------------------------------------------------------ *
 * 7. The URL carries the selection
 * ------------------------------------------------------------------ */

test('selecting a product writes ?product=<slug> to the URL', () => {
  assert.ok(
    /router\.replace\(`\/admin\/match\?product=\$\{encodeURIComponent\(product\.slug\)\}`/.test(MATCH_PAGE),
    'the selection must be addressable',
  )
})

test('reload restores the product from the URL', () => {
  assert.ok(/useSearchParams\(\)/.test(MATCH_PAGE), 'the page must read the URL')
  assert.ok(/params\.get\('product'\)/.test(MATCH_PAGE), 'it must read the product slug')
  assert.ok(
    /selectedProduct\?\.slug === productParam/.test(MATCH_PAGE),
    'an already-restored product must short-circuit, or restore would loop',
  )
})

test('restoring a product yields the same single-sweep state as clicking it', () => {
  // Whichever path set the product, the resulting state must be identical —
  // that is what makes back/forward and reload behave like a selection.
  const clicked = run(start(), { type: 'product_selected', product: JUNO60 })
  const restored = run(start(), { type: 'product_selected', product: JUNO60 })
  assert.deepEqual(restored.candidateRequest, clicked.candidateRequest)
  assert.equal(restored.candidateRequest.id, 1, 'exactly one sweep after a restore')
})

test('navigating back to a bare URL drops the selection', () => {
  assert.ok(
    /if \(!productParam\) \{[\s\S]*?product_cleared/.test(MATCH_PAGE),
    'back to /admin/match with no slug must clear the product',
  )
})

/* ------------------------------------------------------------------ *
 * 8. Preserved behaviour and authorization
 * ------------------------------------------------------------------ */

test('the rewrite kept the shared source registry and the durable reject path', () => {
  assert.ok(MATCH_PAGE.includes("from '@/lib/admin-match-sources'"))
  assert.ok(!/const SOURCE_CONFIG/.test(MATCH_PAGE))
  assert.ok(MATCH_PAGE.includes('rejected_listing_ids'), 'rejections must still reach the server')
  assert.ok(!MATCH_PAGE.includes('saveApproved'))
})

test('approve and reject remain the card actions, and no dead action was added', () => {
  assert.ok(/verdict: 'approved'/.test(MATCH_PAGE))
  assert.ok(/verdict: 'rejected'/.test(MATCH_PAGE))
  for (const dead of ['Refine', 'Forfin', 'Relation', 'relationship']) {
    assert.ok(!MATCH_PAGE.includes(dead), `a non-functional "${dead}" action must not appear`)
  }
})

test('the search endpoint still denies a caller who is not an admin', () => {
  // Anonymous and signed-in-non-admin both fail the same check before any data
  // is read; the page now calls this route on load, so it carries more weight.
  const guard = SEARCH_ROUTE.indexOf('verifyAdmin()')
  const read_ = SEARCH_ROUTE.indexOf('getSupabaseAdmin()')
  assert.ok(guard > -1, 'the search route must authorize')
  assert.ok(/user\) return false/.test(SEARCH_ROUTE), 'no session must be denied')
  assert.ok(/is_admin/.test(SEARCH_ROUTE), 'a non-admin session must be denied')
  assert.ok(guard < SEARCH_ROUTE.indexOf('.from(\'kg_product\')'), 'deny before reading products')
  assert.ok(read_ > -1)
})

test('the match surfaces stay classified admin-only', () => {
  const access = read('frontend', 'lib', 'route-access.ts')
  for (const route of ['/admin/match', '/api/admin/match/candidates', '/api/admin/match/approve']) {
    const line = access.split('\n').find((l) => l.includes(`'${route}'`))
    assert.ok(line, `${route} must be classified`)
    assert.ok(/admin_(page|api)/.test(line), `${route} must stay admin-gated`)
  }
})

test('the state module stays dependency-free so it can be tested at all', () => {
  const src = read('frontend', 'app', 'admin', 'match', 'match-state.ts')
  assert.ok(!/^import /m.test(src), 'an import here would break the plain-node harness')
})

test('a source toggle is visible before the next sweep, not silently pending', () => {
  // The failure this prevents: an operator switches Kleinanzeigen off, the list
  // does not change, and the chip reads as broken. A toggle must either change
  // the result or say that it will.
  const loaded = withLoaded(JUNO60, ['a'])
  assert.equal(sourcesDiffer(loaded), false, 'a freshly loaded list is in sync')

  const toggled = run(loaded, { type: 'source_toggled', key: 'reverb' })
  assert.equal(sourcesDiffer(toggled), true, 'the pending filter change must be visible')

  const reloading = run(toggled, { type: 'candidates_reload_requested' })
  const landed = run(reloading, {
    type: 'candidates_received',
    requestId: reloading.candidateRequest.id, productId: JUNO60.id, candidates: [c('a')],
  })
  assert.equal(sourcesDiffer(landed), false, 'the sweep must clear the pending state')
  assert.deepEqual(landed.appliedSources, landed.sourceSelection)
})

test('a pending source change is not reported while nothing is loaded', () => {
  assert.equal(sourcesDiffer(start()), false)
  assert.equal(sourcesDiffer(run(start(), { type: 'product_selected', product: JUNO60 })), false)
})
