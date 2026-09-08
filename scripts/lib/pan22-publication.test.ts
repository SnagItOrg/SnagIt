/**
 * PAN-22 — the single publication control.
 *
 * Two tests, matching the ticket's budget:
 *   1. the transition's field/guard contract;
 *   2. a refused Public leaves no partial state.
 *
 * `frontend/lib/publication.ts` is import-free for exactly this reason: the
 * rules a route must not restate have to be exercisable without Next.js or
 * Supabase in scope.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PUBLICATION_STATE_ACTION,
  PUBLICATION_TRANSITION,
  isPublicationAction,
  publicationRefusal,
  publicationState,
  type PublicationAction,
} from '../../frontend/lib/publication'

const ACTIVE_CLASSIFIED = { status: 'active', taxonomy_state: 'classified', browse_domain: 'music' }

test('PAN-22: the transition writes exactly the ratified fields, and a row is at one state', () => {
  // Public and QA establish support — an unsupported product answers 404
  // whatever its visibility says (PAN-23 audit: 21 such rows exist).
  assert.deepEqual(PUBLICATION_TRANSITION.public, {
    support_state: 'supported',
    browse_visibility: 'public',
  })
  assert.deepEqual(PUBLICATION_TRANSITION.qa, {
    support_state: 'supported',
    browse_visibility: 'qa_only',
  })
  // Hidden preserves support, matches and monitoring: visibility only.
  assert.deepEqual(PUBLICATION_TRANSITION.hidden, { browse_visibility: 'hidden' })

  // status is a separate lifecycle axis (ratified D-rule 4). Writing it here
  // could stop a whole source's scraper via assertResolved().
  for (const action of Object.keys(PUBLICATION_TRANSITION) as PublicationAction[]) {
    const fields = Object.keys(PUBLICATION_TRANSITION[action])
    assert.equal(fields.includes('status'), false, `${action} must not write status`)
    assert.equal(fields.includes('tier'), false, `${action} must not write tier`)
    assert.equal(fields.includes('subcategory_id'), false, `${action} must not write taxonomy`)
  }

  // The vocabulary is closed: three actions, nothing else accepted.
  assert.deepEqual(Object.keys(PUBLICATION_TRANSITION).sort(), ['hidden', 'public', 'qa'])
  for (const bad of ['Public', 'qa_only', 'supported', '', null, undefined, 1]) {
    assert.equal(isPublicationAction(bad), false, `${String(bad)} must not be an action`)
  }

  /* ---------------------------------------------------------------- *
   * The read side: which state a row is AT.
   *
   * The admin list derived the active button and the status badge from two
   * different rules, so a QA row said "QA" and "Skjult" at once, and a
   * supported+public row with no subcategory showed Public as a finished
   * state it does not satisfy. One mapping now feeds both.
   * ---------------------------------------------------------------- */
  const CASES: Array<[string, Parameters<typeof publicationState>[0], string, PublicationAction | null]> = [
    ['supported + public + classified',
      { exposure: 'live_in_browse', support_state: 'supported', browse_visibility: 'public' }, 'live', 'public'],
    ['supported + qa_only',
      { exposure: 'hidden', support_state: 'supported', browse_visibility: 'qa_only' }, 'qa', 'qa'],
    ['hidden',
      { exposure: 'hidden', support_state: 'supported', browse_visibility: 'hidden' }, 'hidden', 'hidden'],
    ['supported + public, no classifying taxonomy',
      { exposure: 'page_only', support_state: 'supported', browse_visibility: 'public' }, 'blocked_taxonomy', null],
    ['known + public — the measured legacy rows',
      { exposure: 'unsupported', support_state: 'known', browse_visibility: 'public' }, 'blocked_unsupported', null],
    ['inactive',
      { exposure: 'inactive', support_state: 'supported', browse_visibility: 'public' }, 'blocked_inactive', null],
    // Raw KG: 3.637 such rows exist and none of them is QA.
    ['known + qa_only',
      { exposure: 'unsupported', support_state: 'known', browse_visibility: 'qa_only' }, 'blocked_unsupported', null],
  ]

  for (const [what, row, expected, action] of CASES) {
    assert.equal(publicationState(row), expected, what)
    assert.equal(PUBLICATION_STATE_ACTION[publicationState(row)], action, `${what}: active action`)
  }

  // Fail-closed: an unreadable row is blocked, never live.
  assert.equal(publicationState(null), 'blocked_inactive')
  assert.equal(publicationState({}), 'blocked_unsupported')

  // The invariant the defect broke: a state that names a blocker can never
  // also present a finished publication action.
  for (const [state, act] of Object.entries(PUBLICATION_STATE_ACTION)) {
    assert.equal(state.startsWith('blocked_'), act === null,
      `${state} must not both block and show an active action`)
  }
})

test('PAN-22: a Public that cannot classify is refused before any write', () => {
  // The refusal exists so the route can return BEFORE .update() — that is what
  // makes "no partial state" true rather than hoped for.
  const missingTaxonomy = publicationRefusal('public', { status: 'active', taxonomy_state: 'missing_subcategory', browse_domain: 'music' })
  assert.equal(missingTaxonomy?.error, 'taxonomy_required_for_public')
  assert.equal(missingTaxonomy?.status, 409)
  assert.match(String(missingTaxonomy?.message), /underkategori/)

  // A leaf hanging off a non-music root would produce missing_root_mapping:
  // a page nobody can browse to. Refused for the same reason.
  assert.equal(
    publicationRefusal('public', { status: 'active', taxonomy_state: 'classified', browse_domain: 'danish-modern' })?.error,
    'taxonomy_required_for_public',
  )

  // Fail-closed: an unreadable or inactive row never publishes.
  assert.equal(publicationRefusal('public', null)?.error, 'inactive_product_cannot_be_supported')
  assert.equal(publicationRefusal('qa', { status: 'inactive' })?.error, 'inactive_product_cannot_be_supported')

  // What must still be allowed.
  assert.equal(publicationRefusal('public', ACTIVE_CLASSIFIED), null)
  assert.equal(publicationRefusal('qa', { status: 'active', taxonomy_state: 'missing_subcategory' }), null,
    'QA has no taxonomy precondition — it never reaches browse')
  assert.equal(publicationRefusal('hidden', { status: 'inactive' }), null,
    'Hidden only removes exposure, so it stays available on any row')
})
