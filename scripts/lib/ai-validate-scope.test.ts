/**
 * PAN-265: the AI validation pass decides only unreviewed, human-untouched
 * rows, and `--public-only` narrows it to what a public page counts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { citesPriceComparison, farBelowOwnMedian, guardedIsValid, inPublicScope, isAiReviewable, isPriceRejectionLabel, priceReasonGuard, variantGuard } from './ai-validate-scope'

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

/* ── PAN-265: price is never a reason for invalid (2,322 rejections cited a wrong Thomann price) ── */

test('a price comparison is recognised; a cabinet size or a quantity is not', () => {
  assert.equal(citesPriceComparison('Price is 8–13× the Thomann price of 399 DKK, likely a different item'), true)
  assert.equal(citesPriceComparison('Listed at 3x the MSRP'), true)
  assert.equal(citesPriceComparison('Asking 5 x the new price'), true)
  assert.equal(citesPriceComparison('Gibson ES-335 not Epiphone; price ~2.5x candidate max confirms it'), true)
  assert.equal(citesPriceComparison('Price of 4492 DKK is ~13x higher than listed reference price'), true)
  // Title and brand reasons that merely contain a multiple (S2 sample, 2026-10-15):
  assert.equal(citesPriceComparison("Replacement tactile switches ('10x PANASONIC EVQ-Q8R13K buttons'), not the Push"), false)
  assert.equal(citesPriceComparison("Listing title states '2x' (two units), not a single module"), false)
  assert.equal(citesPriceComparison('Gibson USA ES-335 matched to Epiphone; Gibson costs 3x Epiphone range'), false)
  assert.equal(citesPriceComparison('Marshall 2x12 cabinet, not the head'), false)
  assert.equal(citesPriceComparison('Shure SM57 x2 bundle of two mics'), false)
  assert.equal(citesPriceComparison('A footpedal accessory, not the unit'), false)
  assert.equal(citesPriceComparison(null), false)
})

test('a new "invalid" resting on price is left NULL; a title reason is kept', () => {
  assert.equal(priceReasonGuard('Price is about 2% of the median, likely a part'), 'price_reason')
  assert.equal(priceReasonGuard('10x the Thomann price'), 'price_reason')
  assert.equal(priceReasonGuard('Dust cover for the Juno-106, not the synth'), null)
})

test('the eval drops exactly the reset labels: AI price rejections, never a person\'s or a merge', () => {
  const ai = { ai_pass1: { verdict: 'invalid' } }
  const reason = '8–13× the Thomann price of 399 DKK'
  assert.equal(isPriceRejectionLabel({ is_valid: false, rejected_reason: reason, explain: ai }), true)
  assert.equal(isPriceRejectionLabel({ is_valid: false, rejected_reason: reason, explain: { ...ai, admin_decision: {} } }), false, 'a person decided it')
  assert.equal(isPriceRejectionLabel({ is_valid: false, rejected_reason: 'merged_into: moog-one-16-voice (3x)', explain: ai }), false, 'merges are correct')
  assert.equal(isPriceRejectionLabel({ is_valid: false, rejected_reason: reason, explain: {} }), false, 'not an AI label')
  assert.equal(isPriceRejectionLabel({ is_valid: true, rejected_reason: null, explain: ai }), false)
  assert.equal(isPriceRejectionLabel({ is_valid: false, rejected_reason: 'A footpedal accessory', explain: ai }), false)
})

test('price far below the own median is a hint (5 %), and there is no hint without a reference', () => {
  assert.equal(farBelowOwnMedian(300, 10000), true)
  assert.equal(farBelowOwnMedian(500, 10000), false, 'exactly 5 % is not below it')
  assert.equal(farBelowOwnMedian(300, null), null)
  assert.equal(farBelowOwnMedian(null, 10000), null)
})

test('the prompt carries no Thomann, MSRP or KG price range, and both paths apply the price guard', () => {
  const code = readFileSync(join(__dirname, '..', 'ai-validate-matches.ts'), 'utf8')
  const prompt = code.slice(code.indexOf('const SYSTEM_PROMPT'), code.indexOf('async function fetchCandidates'))
  assert.equal(/thomann|msrp|price_min|price_max|price_range/i.test(prompt), false)
  assert.ok(prompt.includes('PRICE IS NEVER A REASON FOR "invalid"'))
  assert.ok(prompt.includes('candidate_own_valid_median_dkk: c.ownValidMedianDkk'))
  assert.ok(code.includes('priceReasonGuard(v.reason)'), 'finalIsValid, used by --eval and the live write')
  assert.ok(code.includes('data.filter(m => !isPriceRejectionLabel(m))'), 'the eval set drops the reset labels')
})
