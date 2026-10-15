/**
 * PAN-265: the AI validation pass decides only unreviewed, human-untouched
 * rows, and `--public-only` narrows it to what a public page counts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { inPublicScope, isAiReviewable } from './ai-validate-scope'

const PUBLIC = { slug: 'roland-juno-106', status: 'active', support_state: 'supported', browse_visibility: 'public', browse_domain: 'music' }

test('the pass may decide an unreviewed row nobody has touched', () => {
  assert.equal(isAiReviewable({ is_valid: null, explain: { method: 'MODEL' } }), true)
  assert.equal(isAiReviewable({ is_valid: null, explain: null }), true)
})

test('the pass never decides a verdict: true, false, or a person\'s decision', () => {
  assert.equal(isAiReviewable({ is_valid: true, explain: {} }), false)
  assert.equal(isAiReviewable({ is_valid: false, explain: {} }), false)
  assert.equal(isAiReviewable({ is_valid: null, explain: { admin_decision: { by: 'owner' } } }), false)
  assert.equal(isAiReviewable({ is_valid: undefined, explain: {} }), false, 'a missing column is not "unreviewed"')
})

test('--public-only: a public product and an active listing', () => {
  assert.equal(inPublicScope(PUBLIC, { is_active: true }), true)
  assert.equal(inPublicScope(PUBLIC, { is_active: null }), true, 'NULL is active, as on the product route')
  assert.equal(inPublicScope(PUBLIC, { is_active: false }), false)
  assert.equal(inPublicScope(PUBLIC, null), false)
  assert.equal(inPublicScope({ ...PUBLIC, browse_visibility: 'private' }, { is_active: true }), false)
  assert.equal(inPublicScope({ ...PUBLIC, browse_domain: null }, { is_active: true }), false, 'fail-closed without the fourth axis')
  assert.equal(inPublicScope(null, { is_active: true }), false)
})

test('the script uses both predicates and guards its write against a concurrent decision', () => {
  const code = readFileSync(join(__dirname, '..', 'ai-validate-matches.ts'), 'utf8')
  assert.ok(code.includes('isAiReviewable('), 'candidate selection skips verdicts')
  assert.ok(code.includes('inPublicScope('), '--public-only is applied')
  // The update only lands on a row that is still unreviewed when it is written.
  assert.match(code, /\.eq\('id', row\.matchId\)\s*\n\s*\.is\('is_valid', null\)/)
})
