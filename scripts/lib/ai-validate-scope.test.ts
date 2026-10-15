/**
 * PAN-265: the AI validation pass decides only unreviewed, human-untouched
 * rows, and `--public-only` narrows it to what a public page counts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { guardedIsValid, inPublicScope, isAiReviewable, variantGuard } from './ai-validate-scope'

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

/* ── PAN-265: the eval of 2026-10-15 failed one way — a variant called valid on a broader row ── */

test('variant guard: a family label row is never valid, whatever the title', () => {
  // Four of the eval's broader products are FAMILY_SLUGS rows (lines, not priced products).
  assert.equal(variantGuard('Fender American Ultra II Telecaster Texas Tea', 'fender-telecaster'), 'family_label')
  assert.equal(variantGuard('Gibson Les Paul Deluxe -73 Gold Top', 'gibson-les-paul'), 'family_label')
  assert.equal(variantGuard('Fender American Vintage II 1966 Jazz Bass', 'fender-jazz-bass'), 'family_label')
  assert.equal(variantGuard('Fender American Professional II Precision Bass', 'fender-precision-bass'), 'family_label')
})

test('variant guard: the matcher\'s own line boundary refuses another member of the line', () => {
  assert.equal(variantGuard("Gibson '50s J-45 Original Vintage Sunburst", 'gibson-j-45'), "line_boundary:other_member:'50s")
  assert.equal(variantGuard('Gibson J-45 Studio Rosewood', 'gibson-j-45'), 'line_boundary:other_member:studio')
  assert.equal(variantGuard('Gibson Custom Shop 1957 Les Paul Custom Black Beauty VOS', 'gibson-les-paul-custom'), 'line_boundary:other_member:vos')
})

test('variant guard: the product itself, and a specific product, are not guarded', () => {
  assert.equal(variantGuard('Gibson J-45 Standard', 'gibson-j-45'), null)
  assert.equal(variantGuard('Roland Juno-106 synthesizer', 'roland-juno-106'), null)
  assert.equal(variantGuard('Fender American Professional II Stratocaster', 'fender-american-professional-ii-stratocaster'), null)
  assert.equal(variantGuard('anything', null), null)
})

test('a guarded "valid" is left NULL; "invalid" and unguarded verdicts pass through', () => {
  assert.equal(guardedIsValid(true, 'family_label'), null)
  assert.equal(guardedIsValid(false, 'family_label'), false)
  assert.equal(guardedIsValid(null, 'line_boundary:other_member:vos'), null)
  assert.equal(guardedIsValid(true, null), true)
})

test('the eval scores what an apply writes, and the prompt carries the variant rule', () => {
  const code = readFileSync(join(__dirname, '..', 'ai-validate-matches.ts'), 'utf8')
  assert.equal((code.match(/finalIsValid\(/g) ?? []).length, 3, 'defined once, used by --eval and by the live write')
  assert.equal(code.includes('const predictedValid = decideIsValid(pred)'), false)
  assert.ok(code.includes('VARIANTS AND EDITIONS ARE NOT THE BASE PRODUCT'))
  assert.ok(code.includes('"Fender American Ultra II Telecaster" for candidate "Fender Telecaster"'))
  assert.ok(code.includes('Never "valid"'))
})
