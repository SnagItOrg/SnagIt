/**
 * /admin/match — why an exact match was labelled `Måske`.
 *
 * THE TRACE, against b2ee39c and live data on 2026-08-30.
 *
 * `Måske` is rendered from `score: 'maybe'`, and the route had three producers
 * of that value:
 *
 *   A. the bare `catch {}` around the classifier call, which assigned
 *      `{ score: 'maybe', reason: 'Kunne ikke vurdere' }` to the WHOLE batch;
 *   B. `scores[l.id]?.score ?? 'maybe'`, for an id sent but not returned —
 *      `maybe` with an EMPTY reason;
 *   C. the model genuinely answering `"maybe"` with a real sentence.
 *
 * The reported card read `Måske / Kunne ikke vurdere`. That string occurs
 * exactly once in the repository, inside A. So the classifier threw, and every
 * listing in the sweep — the exact RE-201, the Boss RE-20, the padded cover,
 * the wanted ad, the Stratocaster — was given the same badge. The label was
 * OPERATIONAL, not semantic.
 *
 * A also swallowed the exception, so which failure fired was unrecoverable
 * from the deployed system. These fixtures pin each failure to a distinct,
 * named outcome so the next real sweep reports the cause instead of hiding it.
 *
 * Listing ids and titles below are real rows read from production.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  classifierStatus,
  interpretClassifierMessage,
  providerFailure,
  verdictFor,
  type ClassifierMessage,
  type Verdict,
} from '../../frontend/lib/admin-match-classifier'

/* ------------------------------------------------------------------ *
 * Fixtures — real listings, real ids, for product `roland-re-201`
 * ------------------------------------------------------------------ */

type Fixture = {
  key: string
  id: string
  source: string
  title: string
  /** What a working classifier should say about this row for RE-201. */
  expected: Verdict
}

const FIXTURES: readonly Fixture[] = [
  { key: 'exact_re201', id: '0870d178-8889-4225-a79a-c7a1b6b5176c', source: 'blocket',
    title: 'Roland RE-201 Space Echo', expected: 'yes' },
  { key: 'exact_re201_reordered', id: '9c812ac3-a096-406e-a72e-262d33391c19', source: 'blocket',
    title: 'Roland Space Echo RE-201', expected: 'yes' },
  { key: 'exact_sh101', id: 'a9215ae0-20c1-48ec-aa93-d3794b294680', source: 'kleinanzeigen',
    title: 'Roland SH-101 Red + MIDI Serviced Vintage + Case', expected: 'no' },
  { key: 'related_re20', id: '2adc03d3-5fc6-49e7-afbd-fc99eb7f5683', source: 'dba.dk',
    title: 'Boss RE-20 Space Echo effektpedal til guitar', expected: 'no' },
  { key: 'accessory_cover', id: '4253dc92-b1f0-4db1-a418-045b0277b470', source: 'reverb',
    title: 'Tuki Padded Cover for Roland RE201 Space Echo (rola105p)', expected: 'no' },
  { key: 'wanted_ad', id: '693d8589-ccf7-4ff6-99fe-d5cd2703a49a', source: 'finn',
    title: 'Roland SH-101 ønskes kjøpt.', expected: 'no' },
  { key: 'replacement_part', id: '809c0090-ea05-4d0d-9141-0043f802ffd3', source: 'reverb',
    title: 'Original refurbished Roland RE-201 Space Echo Tape Delay replacement motor',
    expected: 'no' },
  { key: 'unrelated_guitar', id: '6589c8bf-122c-4a02-94e7-fab4f75d8bad', source: 'dba.dk',
    title: '1971 Stratocaster', expected: 'no' },
]

const BATCH_IDS = FIXTURES.map((f) => f.id)

/** A well-formed reply that answers every fixture. */
function healthyReply(): ClassifierMessage {
  return {
    stop_reason: 'end_turn',
    content: [{
      type: 'text',
      text: JSON.stringify({
        results: FIXTURES.map((f) => ({
          id: f.id,
          score: f.expected,
          reason: `fixture verdict for ${f.key}`,
        })),
      }),
    }],
  }
}

/* ------------------------------------------------------------------ *
 * 1. The semantic path still works
 * ------------------------------------------------------------------ */

test('fixtures: a healthy reply resolves every listing to its own verdict', () => {
  const outcome = interpretClassifierMessage(healthyReply(), BATCH_IDS)
  assert.equal(outcome.status, 'ok')

  for (const f of FIXTURES) {
    const v = verdictFor(outcome, f.id)
    assert.equal(v.score, f.expected, `${f.key} should score ${f.expected}`)
    assert.equal(v.scored, true, `${f.key} must be marked as actually scored`)
  }

  const status = classifierStatus(outcome, BATCH_IDS.length)
  assert.deepEqual(status, { status: 'ok', failure: null, unscored: 0 })
})

test('fixtures: the two exact RE-201 spellings are not degraded to maybe', () => {
  const outcome = interpretClassifierMessage(healthyReply(), BATCH_IDS)
  for (const key of ['exact_re201', 'exact_re201_reordered']) {
    const f = FIXTURES.find((x) => x.key === key)!
    const v = verdictFor(outcome, f.id)
    assert.equal(v.score, 'yes')
    assert.notEqual(v.reason, 'Kunne ikke vurdere')
  }
})

test('fixtures: accessory, part, wanted ad and unrelated title stay separable', () => {
  const outcome = interpretClassifierMessage(healthyReply(), BATCH_IDS)
  for (const key of ['accessory_cover', 'replacement_part', 'wanted_ad', 'unrelated_guitar', 'related_re20']) {
    const f = FIXTURES.find((x) => x.key === key)!
    assert.equal(verdictFor(outcome, f.id).score, 'no', key)
  }
})

test('a genuine semantic maybe is preserved, and is marked as scored', () => {
  const msg: ClassifierMessage = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({
      results: [{ id: BATCH_IDS[0], score: 'maybe', reason: 'Titlen nævner ikke båndet.' }],
    }) }],
  }
  const outcome = interpretClassifierMessage(msg, [BATCH_IDS[0]])
  const v = verdictFor(outcome, BATCH_IDS[0])
  assert.equal(v.score, 'maybe')
  assert.equal(v.scored, true)
  assert.equal(classifierStatus(outcome, 1).status, 'ok')
})

/* ------------------------------------------------------------------ *
 * 2. Every failure path is named, and none is a semantic maybe
 * ------------------------------------------------------------------ */

test('provider throw is provider_error, never a verdict', () => {
  const outcome = providerFailure(new Error('529 overloaded_error'))
  assert.equal(outcome.status, 'degraded')
  assert.equal(outcome.status === 'degraded' && outcome.failure, 'provider_error')
  assert.match(outcome.status === 'degraded' ? outcome.detail : '', /overloaded/)
})

test('truncation is detected from stop_reason, BEFORE the parse error masks it', () => {
  // A reply cut at max_tokens: valid JSON prefix, no closing brackets.
  const cut = JSON.stringify({ results: FIXTURES.map((f) => ({ id: f.id, score: 'yes', reason: 'x' })) })
    .slice(0, 120)
  const msg: ClassifierMessage = { stop_reason: 'max_tokens', content: [{ type: 'text', text: cut }] }

  const outcome = interpretClassifierMessage(msg, BATCH_IDS)
  assert.equal(outcome.status === 'degraded' && outcome.failure, 'truncated',
    'truncation must not be reported as unparseable')

  // Same bytes without the stop_reason signal fall through to the parse error,
  // which is why the ordering above is load-bearing rather than cosmetic.
  const unsignalled = interpretClassifierMessage(
    { stop_reason: 'end_turn', content: [{ type: 'text', text: cut }] }, BATCH_IDS)
  assert.equal(unsignalled.status === 'degraded' && unsignalled.failure, 'unparseable')
})

test('an empty content array is empty_response, not a TypeError', () => {
  const outcome = interpretClassifierMessage({ stop_reason: 'end_turn', content: [] }, BATCH_IDS)
  assert.equal(outcome.status === 'degraded' && outcome.failure, 'empty_response')
})

test('a non-text first block is empty_response', () => {
  const outcome = interpretClassifierMessage(
    { stop_reason: 'end_turn', content: [{ type: 'tool_use' }] }, BATCH_IDS)
  assert.equal(outcome.status === 'degraded' && outcome.failure, 'empty_response')
})

test('a prose preamble ahead of the JSON is unparseable', () => {
  const outcome = interpretClassifierMessage({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Here are the results:\n{"results":[]}' }],
  }, BATCH_IDS)
  assert.equal(outcome.status === 'degraded' && outcome.failure, 'unparseable')
})

test('a fenced reply is tolerated and still yields verdicts', () => {
  const body = JSON.stringify({ results: [{ id: BATCH_IDS[0], score: 'yes', reason: 'ok' }] })
  const outcome = interpretClassifierMessage({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '```json\n' + body + '\n```' }],
  }, [BATCH_IDS[0]])
  assert.equal(outcome.status, 'ok')
  assert.equal(verdictFor(outcome, BATCH_IDS[0]).score, 'yes')
})

test('well-formed JSON about something else is schema_invalid, not 8 abstentions', () => {
  const wrongShape = interpretClassifierMessage({
    stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdicts":[]}' }],
  }, BATCH_IDS)
  assert.equal(wrongShape.status === 'degraded' && wrongShape.failure, 'schema_invalid')

  // Right shape, ids from a different batch: zero resolve.
  const wrongIds = interpretClassifierMessage({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({
      results: [{ id: 'not-a-listing-id', score: 'yes', reason: 'x' }],
    }) }],
  }, BATCH_IDS)
  assert.equal(wrongIds.status === 'degraded' && wrongIds.failure, 'schema_invalid')
})

test('an unrecognised score value is dropped, never coerced to maybe', () => {
  const outcome = interpretClassifierMessage({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ results: [
      { id: BATCH_IDS[0], score: 'yes', reason: 'good' },
      { id: BATCH_IDS[1], score: 'probably', reason: 'invented verdict' },
    ] }) }],
  }, [BATCH_IDS[0], BATCH_IDS[1]])

  assert.equal(outcome.status, 'ok')
  assert.equal(verdictFor(outcome, BATCH_IDS[0]).scored, true)
  const coerced = verdictFor(outcome, BATCH_IDS[1])
  assert.equal(coerced.score, 'maybe')
  assert.equal(coerced.scored, false, 'an invented verdict must not read as a real maybe')
})

/* ------------------------------------------------------------------ *
 * 3. Partial replies: a missing id is unscored, not a silent maybe
 * ------------------------------------------------------------------ */

test('an id sent but not returned is unscored, and is counted', () => {
  const partial: ClassifierMessage = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({
      results: FIXTURES.slice(0, 3).map((f) => ({ id: f.id, score: f.expected, reason: 'r' })),
    }) }],
  }
  const outcome = interpretClassifierMessage(partial, BATCH_IDS)
  assert.equal(outcome.status, 'ok')
  assert.equal(outcome.status === 'ok' && outcome.unscored.length, FIXTURES.length - 3)

  const missing = verdictFor(outcome, FIXTURES[7].id)
  assert.equal(missing.score, 'maybe')
  assert.equal(missing.scored, false)

  const status = classifierStatus(outcome, BATCH_IDS.length)
  assert.equal(status.status, 'ok')
  assert.equal(status.unscored, 5)
})

test('batch position never decides a verdict — only the id does', () => {
  // Same verdicts, reversed order. Position-based mapping would invert them.
  const reversed: ClassifierMessage = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({
      results: [...FIXTURES].reverse().map((f) => ({ id: f.id, score: f.expected, reason: 'r' })),
    }) }],
  }
  const outcome = interpretClassifierMessage(reversed, BATCH_IDS)
  for (const f of FIXTURES) {
    assert.equal(verdictFor(outcome, f.id).score, f.expected, f.key)
  }
})

/* ------------------------------------------------------------------ *
 * 4. Degraded batches are uniformly degraded — the reported symptom
 * ------------------------------------------------------------------ */

test('a degraded batch marks EVERY fixture unscored, reproducing the incident', () => {
  const outcome = providerFailure(new Error('fetch failed'))
  for (const f of FIXTURES) {
    const v = verdictFor(outcome, f.id)
    assert.equal(v.score, 'maybe')
    assert.equal(v.reason, 'Kunne ikke vurdere')
    assert.equal(v.scored, false)
  }
  const status = classifierStatus(outcome, BATCH_IDS.length)
  assert.equal(status.status, 'degraded')
  assert.equal(status.failure, 'provider_error')
  assert.equal(status.unscored, FIXTURES.length)
})

test('score stays inside yes|maybe|no so the deployed client cannot crash', () => {
  const degraded = providerFailure(new Error('x'))
  const allowed = new Set(['yes', 'maybe', 'no'])
  assert.ok(allowed.has(verdictFor(degraded, BATCH_IDS[0]).score))
  const ok = interpretClassifierMessage(healthyReply(), BATCH_IDS)
  for (const f of FIXTURES) assert.ok(allowed.has(verdictFor(ok, f.id).score))
})

/* ------------------------------------------------------------------ *
 * 5. The route no longer destroys the evidence
 * ------------------------------------------------------------------ */

const ROUTE = readFileSync(
  join(__dirname, '../../frontend/app/api/admin/match/candidates/route.ts'), 'utf8')

test('route: the evidence-destroying bare catch is gone', () => {
  assert.ok(!/}\s*catch\s*\{\s*\n\s*\/\/ Haiku failed/.test(ROUTE),
    'the blanket "Haiku failed — show all as maybe" catch must not return')
  assert.ok(!/catch\s*\{\s*$/m.test(ROUTE.split('interpretClassifierMessage')[0] ?? ''),
    'no unbound catch may precede the classifier interpretation')
})

test('route: the route never assigns the fallback verdict itself', () => {
  // The string may appear in the route's prose — that comment is the record of
  // the incident. What must not come back is the ASSIGNMENT.
  const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(code.includes('Kunne ikke vurdere'), false,
    'the operator-visible fallback belongs to the classifier module alone')
  assert.equal(/scores\[[^\]]+\]\s*=/.test(code), false,
    'the ad-hoc scores map must be gone')
})

test('route: the classifier outcome reaches the log and the response', () => {
  assert.match(ROUTE, /classifier_status|classifier:/,
    'the degraded/ok distinction must be observable')
  assert.match(ROUTE, /interpretClassifierMessage/)
  assert.match(ROUTE, /providerFailure/)
})
