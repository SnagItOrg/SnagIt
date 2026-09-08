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
  PUBLICATION_TRANSITION,
  isPublicationAction,
  publicationRefusal,
  type PublicationAction,
} from '../../frontend/lib/publication'

const ACTIVE_CLASSIFIED = { status: 'active', taxonomy_state: 'classified', browse_domain: 'music' }

test('PAN-22: each action writes exactly the ratified fields, and never status', () => {
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
