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
  buildPriceContext,
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
  price_context: buildPriceContext(14754, [
    12000, 13000, 14000, 15000, 16000, 17000, 18000, 26001, 30000,
  ]),
  listing_price_dkk: 14754,
  listing_currency: 'DKK',
  listing_url: 'https://example.invalid/listing',
  prior_explain: { matcher: 'synonym' },
}

const ARGS = { decidedAt: '2026-09-20T00:00:00.000Z', runId: 'test' }

/**
 * THE STRUCTURAL GUARANTEE, INVERTED.
 *
 * This test used to fail if any key matched `/price|dkk|currency/`. That was
 * the wrong invariant: the thing to keep out is a price THRESHOLD, and the
 * first design mistook withholding context for refusing to threshold on it.
 * Measured, that cost the only strong signal for a part whose title reads like
 * the product — a 293 DKK "1978 Gibson Les Paul Custom 1-ply Cream W/Bracket"
 * approved `exact` at confidence 88 against a 30.266 DKK median.
 *
 * So the same structure now pins the opposite promise: the price context is
 * present, correctly shaped, and reaches the judge along with the identity a
 * title-only judge could not otherwise have.
 */
test('the judge is given identity AND the price context', () => {
  const payload = buildIdentityPayload(ROW)
  assert.deepEqual(Object.keys(payload).sort(), [...MODEL_PAYLOAD_KEYS].sort())

  // The three numbers the owner asked for: the listing, the product, the ratio.
  assert.equal(payload.price_context.listing_price_dkk, 14754)
  assert.equal(payload.price_context.product_median_dkk, 16000)
  assert.equal(payload.price_context.listing_pct_of_median, 92.2)
  assert.equal(payload.price_context.adjudicated_n, 9)
  // A band needs MIN_BAND_N=8; this population has nine, so it carries one.
  assert.equal(payload.price_context.product_q1_dkk, 14000)
  assert.equal(payload.price_context.product_q3_dkk, 18000)

  // Identity that a title-only judge could not otherwise have.
  assert.equal(payload.candidate_brand, 'Fender')
  assert.deepEqual(payload.sibling_products.map((s) => s.slug), [
    'fender-american-ultra-ii-telecaster',
  ])

  // The human vetoing the row sees the same two numbers the judge reasoned from.
  const manifest = planManifestRow({ row: ROW, verdict: 'exact', confidence: 90, evidence: 'x', ...ARGS })
  assert.equal(manifest.listing_price_dkk, 14754)
  assert.equal(manifest.product_median_dkk, 16000)
  assert.equal(manifest.listing_pct_of_median, 92.2)
})

/**
 * The context must not invent a market level it does not have.
 *
 * Three ways it can fail, and all three fail to null rather than to a number:
 * a listing with no stated price (on dba.dk a "byttes"/"vurderes solgt" row
 * arrives as 0 — three sit in the 2026-09-20 manifest, and a ratio of 0.0%
 * would manufacture the exact false reject this design exists to prevent), a
 * product below `MIN_DESCRIPTIVE_MEDIAN_N` confirmations, and a product with
 * enough for a median but not for a band.
 */
test('price context fails to null, never to a number', () => {
  const noPrice = buildPriceContext(0, [10000, 11000, 12000, 13000])
  assert.equal(noPrice.listing_price_dkk, null)
  assert.equal(noPrice.listing_pct_of_median, null)
  assert.equal(noPrice.product_median_dkk, 11500)

  const thin = buildPriceContext(5000, [10000, 12000])
  assert.equal(thin.listing_price_dkk, 5000)
  assert.equal(thin.product_median_dkk, null)
  assert.equal(thin.listing_pct_of_median, null)
  assert.equal(thin.adjudicated_n, 2)

  // n=4: a median is descriptive, a Q1-Q3 band is not yet earned.
  const medianOnly = buildPriceContext(5000, [10000, 12000, 14000, 16000])
  assert.equal(medianOnly.product_median_dkk, 13000)
  assert.equal(medianOnly.product_q1_dkk, null)
  assert.equal(medianOnly.product_q3_dkk, null)

  // Nulls and non-prices in the population are not observations.
  const dirty = buildPriceContext(1000, [null, 0, -5, 10000, 20000, 30000])
  assert.equal(dirty.adjudicated_n, 3)
  assert.equal(dirty.product_median_dkk, 20000)
  assert.equal(dirty.listing_pct_of_median, 5)
})

/**
 * PRICE IS EVIDENCE, NOT A GATE. Nothing in this module may turn a ratio into
 * a verdict — that is the prohibition the owner actually wanted, and it is the
 * one that survives. The SH-101 case is the proof: 7.500 DKK against a ~15.000
 * median is 50%, and it must still be able to come out `exact` with a write
 * planned, exactly like a listing at 100%.
 */
test('a low ratio cannot reject on its own', () => {
  const bargain: QualificationRow = {
    ...ROW,
    listing_title: 'Roland SH-101 - Nyserviceret',
    listing_price_dkk: 7500,
    price_context: buildPriceContext(7500, [
      12000, 13000, 14000, 15000, 15000, 16000, 17000, 18000,
    ]),
  }
  assert.equal(bargain.price_context.listing_pct_of_median, 50)

  const approved = planManifestRow({
    row: bargain, verdict: 'exact', confidence: 90, evidence: 'SH-101 named exactly', ...ARGS,
  })
  assert.equal(approved.verdict, 'exact')
  assert.equal(approved.would_write?.is_valid, true)
  assert.equal(approved.listing_pct_of_median, 50)
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
