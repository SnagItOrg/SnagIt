/**
 * Feedback (PAN-251): one test on the route's validation. No email is sent here — the
 * route sends, and the route is not under test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readFeedback } from '../../frontend/lib/feedback'

test('PAN-251: the feedback read — the four kinds, the two surfaces, bounded fields, the honeypot', () => {
  const ok = readFeedback({ kind: 'wrong_price', surface: 'tjek-prisen', path: '/tjek-prisen', text: '  Prisen er for lav  ', email: ' mig@example.com ', productSlug: 'roland-juno-60', state: 'verdict', website: '' })
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.honeypot, false)
    assert.deepEqual(ok.feedback, { kind: 'wrong_price', surface: 'tjek-prisen', path: '/tjek-prisen', text: 'Prisen er for lav', email: 'mig@example.com', productSlug: 'roland-juno-60', state: 'verdict' })
  }
  // Optional fields left empty arrive as null; the honeypot filled is a bot, still "ok" so it learns nothing.
  const bare = readFeedback({ kind: 'other', surface: 'product', path: '/product/roland-juno-60', text: '', email: '', website: 'http://spam' })
  assert.ok(bare.ok)
  if (bare.ok) {
    assert.equal(bare.honeypot, true)
    assert.deepEqual([bare.feedback.text, bare.feedback.email, bare.feedback.productSlug, bare.feedback.state], [null, null, null, null])
  }
  const reason = (body: unknown) => { const r = readFeedback(body); return r.ok ? 'ok' : r.reason }
  assert.equal(reason({ kind: 'praise', surface: 'product', path: '/x' }), 'kind')
  assert.equal(reason({ kind: 'other', surface: 'admin', path: '/x' }), 'surface')
  assert.equal(reason({ kind: 'other', surface: 'product', path: 'product/x' }), 'path')
  assert.equal(reason({ kind: 'other', surface: 'product', path: '/x', text: 'a'.repeat(2001) }), 'text')
  assert.equal(reason({ kind: 'other', surface: 'product', path: '/x', email: 'not-an-email' }), 'email')
  assert.equal(reason({ kind: 'other', surface: 'product', path: '/x', productSlug: 'Bad Slug!' }), 'slug')
  assert.equal(reason({ kind: 'other', surface: 'product', path: '/x', state: 'guessing' }), 'state')
  assert.equal(reason(null), 'kind')
})
