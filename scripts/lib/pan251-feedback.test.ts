/**
 * Feedback (PAN-251): the route's validation and the Linear issue text. No email is sent and no row is written here — the
 * route sends, and the route is not under test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readFeedback } from '../../frontend/lib/feedback'
import { linearIssueText } from '../../frontend/lib/linear-feedback'

test('PAN-251: the feedback read — the four kinds, the two surfaces, bounded fields, the honeypot', () => {
  const ok = readFeedback({ kind: 'wrong_price', surface: 'tjek-prisen', path: '/tjek-prisen', text: '  Prisen er for lav  ', email: ' mig@example.com ', productSlug: 'roland-juno-60', state: 'verdict', website: '' })
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.honeypot, false)
    assert.deepEqual(ok.feedback, { kind: 'wrong_price', surface: 'tjek-prisen', path: '/tjek-prisen', text: 'Prisen er for lav', email: 'mig@example.com', productSlug: 'roland-juno-60', state: 'verdict', tipPriceDkk: null, tipName: null, listingUrl: null })
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

test('PAN-256: a price tip needs a whole-kroner price; name and ad link are optional and bounded', () => {
  const ok = readFeedback({ kind: 'price_tip', surface: 'tjek-prisen', path: '/tjek-prisen', state: 'not_recognised', tipPriceDkk: '4500', tipName: ' Roland Juno-106 ', listingUrl: 'https://www.dba.dk/recommerce/forsale/item/123', website: '' })
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual([ok.feedback.kind, ok.feedback.tipPriceDkk, ok.feedback.tipName, ok.feedback.listingUrl], ['price_tip', 4500, 'Roland Juno-106', 'https://www.dba.dk/recommerce/forsale/item/123'])
  const reason = (body: Record<string, unknown>) => { const r = readFeedback({ kind: 'price_tip', surface: 'product', path: '/product/x', ...body }); return r.ok ? 'ok' : r.reason }
  assert.equal(reason({ tipPriceDkk: 4500 }), 'ok')
  for (const tipPriceDkk of [undefined, '', 0, -5, 12.5, 'abc', 10_000_001]) assert.equal(reason({ tipPriceDkk }), 'tip', String(tipPriceDkk))
  assert.equal(reason({ tipPriceDkk: 4500, tipName: 'a'.repeat(201) }), 'tip')
  assert.equal(reason({ tipPriceDkk: 4500, listingUrl: 'javascript:alert(1)' }), 'tip')
  // Another kind never carries tip fields, whatever the body says.
  const other = readFeedback({ kind: 'other', surface: 'product', path: '/x', tipPriceDkk: 4500 })
  assert.ok(other.ok && other.feedback.tipPriceDkk === null)
})

test('PAN-251: the Linear issue names kind and product or page, and never carries the address', () => {
  const read = readFeedback({ kind: 'wrong_price', surface: 'product', path: '/product/roland-juno-60', text: 'For lav', email: 'mig@example.com', productSlug: 'roland-juno-60' })
  assert.ok(read.ok)
  if (!read.ok) return
  const issue = linearIssueText(read.feedback, 'https://www.klup.dk')
  assert.equal(issue.title, '[feedback] wrong_price — roland-juno-60')
  assert.ok(issue.description.includes('https://www.klup.dk/product/roland-juno-60'))
  assert.ok(issue.description.includes('**Svar ønsket:** ja'))
  assert.equal(issue.description.includes('mig@example.com'), false)
  // No slug: the page path names the issue; no address: "nej".
  const tip = readFeedback({ kind: 'price_tip', surface: 'tjek-prisen', path: '/tjek-prisen', tipPriceDkk: 4500, tipName: 'Roland Juno-106' })
  assert.ok(tip.ok)
  if (tip.ok) {
    const t = linearIssueText(tip.feedback, 'https://www.klup.dk')
    assert.equal(t.title, '[feedback] price_tip — /tjek-prisen')
    assert.ok(t.description.includes('**Svar ønsket:** nej'))
    assert.ok(t.description.includes('4.500 kr used'))
  }
})
