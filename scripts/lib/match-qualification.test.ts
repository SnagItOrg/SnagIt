/**
 * PAN-95 — the parts of match qualification that are NOT the model's judgement.
 *
 * The judge's accuracy is measured by sampling, not asserted here: the number
 * that decides whether this ships is in `docs/pan-95-model-qualification.md`,
 * against the hand-labelled rows in `docs/pan-95-handcheck-sample.tsv`. A unit
 * test cannot tell you whether a title means a TR-909 or a TR-909's EPROM.
 *
 * What it CAN pin is everything that makes a pass auditable and reversible —
 * and the one structural promise the product owner actually asked for: that no
 * price reaches the judge.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MODEL_PAYLOAD_KEYS,
  VERDICT_DISPOSITION,
  buildIdentityPayload,
  decisionSource,
  deterministicSignal,
  planManifestRow,
  type QualificationRow,
} from './match-qualification'
import {
  IS_VALID_FOR,
  REJECTION_REASON,
  REJECTION_REASON_FOR,
} from '../../frontend/app/admin/match/dispositions'

const ROW: QualificationRow = {
  match_id: 'match-1',
  listing_id: 'listing-1',
  product_id: 'product-1',
  product_slug: 'fender-telecaster-custom',
  canonical_name: 'Fender Telecaster Custom',
  model_name: 'Telecaster Custom',
  brand_name: 'Fender',
  subcategory: 'Electric Guitars',
  listing_title: 'Fender American Ultra II Telecaster Ultraburst Maple Fingerboard',
  listing_source: 'reverb',
  matcher_method: 'SYNONYM',
  matcher_score: 80,
  siblings: [
    { slug: 'fender-american-ultra-ii-telecaster', canonical_name: 'Fender American Ultra II Telecaster' },
  ],
  listing_price_dkk: 14754,
  listing_currency: 'DKK',
  listing_url: 'https://example.invalid/listing',
  prior_explain: { matcher: 'synonym' },
}

const ARGS = { decidedAt: '2026-09-20T00:00:00.000Z', runId: 'test' }

/**
 * The whole point of PAN-95. A price floor is a proxy for identity that deletes
 * cheap genuine instruments and admits expensive parts, so it is removed by
 * construction rather than by a sentence in a prompt: the payload builder is
 * the only thing that constructs the judge's view, and neither it nor the key
 * list it is pinned against may name money.
 */
test('the judge is given identity and never a price', () => {
  const payload = buildIdentityPayload(ROW)
  assert.deepEqual(Object.keys(payload).sort(), [...MODEL_PAYLOAD_KEYS].sort())

  const forbidden = /price|dkk|currency|msrp|thomann|cost|value/i
  for (const key of MODEL_PAYLOAD_KEYS) {
    assert.ok(!forbidden.test(key), `${key} would put money in front of the judge`)
  }
  // The listing's price is known — it reaches the manifest, not the payload.
  const manifest = planManifestRow({ row: ROW, verdict: 'exact', confidence: 90, evidence: 'x', ...ARGS })
  assert.equal(manifest.listing_price_dkk, 14754)
  assert.ok(!JSON.stringify(payload).includes('14754'))

  // Identity that a title-only judge could not otherwise have.
  assert.equal(payload.candidate_brand, 'Fender')
  assert.deepEqual(payload.sibling_products.map((s) => s.slug), [
    'fender-american-ultra-ii-telecaster',
  ])
})

/**
 * No parallel vocabulary. Every verdict resolves to a `Disposition` the admin
 * surface already writes, so these rows are read by the existing consumers and
 * an abstention is the existing `skipped` — which persists nothing at all.
 */
test('verdicts resolve to the existing dispositions, and abstain writes nothing', () => {
  for (const [verdict, disposition] of Object.entries(VERDICT_DISPOSITION)) {
    assert.ok(disposition in IS_VALID_FOR, `${verdict} maps outside the vocabulary`)
  }

  const abstained = planManifestRow({
    row: ROW, verdict: 'abstain', confidence: 40, evidence: 'ambiguous title', ...ARGS,
  })
  assert.equal(abstained.disposition, 'skipped')
  assert.equal(abstained.would_write, null)

  const approved = planManifestRow({
    row: ROW, verdict: 'exact', confidence: 95, evidence: 'exact model name', ...ARGS,
  })
  assert.equal(approved.would_write?.is_valid, true)
  assert.equal(approved.would_write?.rejected_reason, null)
})

/**
 * A pass has to be undoable as a SET. That needs one stored key that selects
 * exactly this pass and nothing else, plus the established rejection reasons —
 * `rejected_reason` keeps its constant and the semantic reason lives in
 * `explain`, exactly as `/admin/match` writes it.
 */
test('every write carries the established reason and one reversible key', () => {
  for (const verdict of ['accessory', 'wanted_ad', 'wrong'] as const) {
    const row = planManifestRow({ row: ROW, verdict, confidence: 95, evidence: 'e', ...ARGS })
    const planned = row.would_write
    assert.ok(planned, `${verdict} must plan a write`)
    assert.equal(planned!.is_valid, false)
    assert.equal(planned!.rejected_reason, REJECTION_REASON)

    const decision = (planned!.explain as any).admin_decision
    assert.equal(decision.decision, 'rejected')
    assert.equal(decision.rejection_reason, REJECTION_REASON_FOR[VERDICT_DISPOSITION[verdict]])
    assert.equal(decision.decision_source, decisionSource('test'))
    // Nobody decided this by hand; claiming an actor would forge an audit trail.
    assert.equal(decision.actor_user_id, null)
  }

  assert.equal(decisionSource('2026-09-20'), 'pan-95/qualification-2026-09-20')
  assert.notEqual(decisionSource('a'), decisionSource('b'))
})

/**
 * Qualifying a match must not destroy the evidence that produced it. A
 * SYNONYM/80 row that a later pass confirms stays SYNONYM/80 — overwriting it
 * with the manual FUZZY/1 placeholder would erase why the match existed.
 */
test('qualification keeps the matcher provenance it qualified', () => {
  const planned = planManifestRow({
    row: ROW, verdict: 'wrong', confidence: 95, evidence: 'sibling owns it',
    competingSlug: 'fender-american-ultra-ii-telecaster', ...ARGS,
  }).would_write

  assert.equal(planned?.method, 'SYNONYM')
  assert.equal(planned?.score, 80)
  assert.equal((planned!.explain as any).matcher, 'synonym')
  // The sibling is recorded, and nothing is written against it.
  assert.equal((planned!.explain as any).admin_decision.competing_slug,
    'fender-american-ultra-ii-telecaster')
  assert.equal(planned?.product_id, 'product-1')
})

/**
 * The deterministic guard REPORTS; it does not decide.
 *
 * Measured on this backlog it fires on 1.0% of rows and is wrong on five of
 * eighteen, all of them complete instruments whose seller named a serviced
 * component — a 49.903 DKK TR-909 among them. So a guard hit must not be able
 * to override the judge, and the finding must survive into the manifest either
 * way so a human can see what fired and disagree.
 */
test('the guard signals but cannot veto the judge', () => {
  assert.equal(deterministicSignal('Roland SH-101 cover'), 'part_or_accessory:cover')
  assert.equal(deterministicSignal('Roland SH-101 ønskes kjøpt.'), 'wanted_or_non_sale:ønskes')
  assert.equal(deterministicSignal('Roland Juno-106 61-Key Synthesizer'), null)

  const flagged: QualificationRow = {
    ...ROW,
    listing_title: 'Roland TR-909 Rhythm Composer eprom v4',
  }
  assert.equal(buildIdentityPayload(flagged).deterministic_signal, 'part_or_accessory:eprom')

  const kept = planManifestRow({
    row: flagged, verdict: 'exact', confidence: 90, evidence: 'complete unit', ...ARGS,
  })
  assert.equal(kept.deterministic_signal, 'part_or_accessory:eprom')
  assert.equal(kept.would_write?.is_valid, true)
})
