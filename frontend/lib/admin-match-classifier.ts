/**
 * /admin/match — reading the relevance classifier's reply.
 *
 * THE PRODUCTION DEFECT, traced 2026-08-30 at b2ee39c.
 *
 * The candidate route wrapped the whole classifier round-trip in one bare
 * `catch {}` that bound nothing, logged nothing, and assigned every listing in
 * the batch `{ score: 'maybe', reason: 'Kunne ikke vurdere' }`. The card layer
 * renders `maybe` as `Måske`, so an operator looking at an exact
 * `Roland RE-201 Space Echo` saw the same badge the model emits when it is
 * genuinely undecided.
 *
 * That string is the proof. `Kunne ikke vurdere` occurs exactly once in the
 * repository — in that catch — so the reported `Måske / Kunne ikke vurdere`
 * cannot have come from the model. It is an OPERATIONAL failure wearing a
 * SEMANTIC label.
 *
 * Worse, the catch discarded the exception, so the deployed system could not
 * say WHICH failure it was. A provider 429, an empty content block, a response
 * truncated at `max_tokens` and a prose preamble ahead of the JSON all
 * collapsed into the same four Danish words. This module exists to stop that
 * collapse: it names the failure, and it keeps "the model said maybe" and "the
 * classifier could not answer" as different facts.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It does not retry, does not widen
 * `max_tokens`, does not touch the prompt and does not change the model. Which
 * exception actually fires in production is still unproven — the old code
 * destroyed the evidence — and `truncated` below is what will prove or refute
 * the leading hypothesis from the next real sweep instead of from inference.
 *
 * Deliberately import-free, like `admin-match-query.ts`, so the root
 * `tsx --test` harness can exercise it with no build step.
 */

export type Verdict = 'yes' | 'maybe' | 'no'

/**
 * Why the classifier produced no usable verdicts.
 *
 * Closed set, ordered by how early it can be detected. Each value is a distinct
 * remediation: `provider_error` is a availability problem, `truncated` is a
 * budget problem, `unparseable` is a prompt-adherence problem, and
 * `schema_invalid` is a contract problem.
 */
export type ClassifierFailure =
  | 'provider_error'
  | 'empty_response'
  | 'truncated'
  | 'unparseable'
  | 'schema_invalid'

/** One verdict as the model returned it. */
export type ScoredVerdict = { score: Verdict; reason: string }

export type ClassifierOutcome =
  | {
      status: 'ok'
      verdicts: Record<string, ScoredVerdict>
      /**
       * Ids that were sent but came back without a verdict.
       *
       * A non-empty list here is NOT a failure of the whole batch — the rest of
       * the verdicts are real — but it is also not a semantic `maybe`, and the
       * old code could not tell the two apart because it defaulted a missing id
       * to `maybe` with an empty reason string.
       */
      unscored: string[]
    }
  | { status: 'degraded'; failure: ClassifierFailure; detail: string }

/**
 * The structural subset of an Anthropic message this module reads.
 *
 * Declared locally rather than imported from the SDK so the module stays
 * import-free and so a fixture can express a shape the SDK's types forbid —
 * an empty `content` array, a missing `stop_reason` — which is precisely the
 * class of response that produced the incident.
 */
export type ClassifierMessage = {
  content?: Array<{ type?: string; text?: string }> | null
  stop_reason?: string | null
}

/** Model replies are asked for as bare JSON; a fence is tolerated, not required. */
function stripFence(raw: string): string {
  return raw
    .replace(/^\s*```json\s*/i, '')
    .replace(/^\s*```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

const VERDICTS: readonly string[] = ['yes', 'maybe', 'no']

/**
 * Map a thrown value from the provider call onto the failure taxonomy.
 *
 * Everything the SDK throws — transport, 4xx, 5xx, abort — is one operational
 * state from this route's point of view: no verdicts arrived. The distinction
 * that matters to an operator is captured in `detail`, which carries the
 * message only. The provider payload never travels with it.
 */
export function providerFailure(error: unknown): ClassifierOutcome {
  const detail =
    error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : 'unknown provider error'
  return { status: 'degraded', failure: 'provider_error', detail }
}

/**
 * Turn one classifier reply into either verdicts or a named failure.
 *
 * ORDER IS LOAD-BEARING. `stop_reason === 'max_tokens'` is checked BEFORE the
 * parse, because a truncated reply is also an unparseable one and the parse
 * error would otherwise mask the budget problem behind a prompt-adherence
 * diagnosis. Truncation is the one failure the response tells us about
 * directly; it must not be inferred second-hand.
 */
export function interpretClassifierMessage(
  msg: ClassifierMessage | null | undefined,
  batchIds: readonly string[],
): ClassifierOutcome {
  if (!msg) {
    return { status: 'degraded', failure: 'empty_response', detail: 'no message returned' }
  }

  if (msg.stop_reason === 'max_tokens') {
    return {
      status: 'degraded',
      failure: 'truncated',
      detail: `stop_reason=max_tokens for ${batchIds.length} listings`,
    }
  }

  const block = msg.content?.[0]
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    return {
      status: 'degraded',
      failure: 'empty_response',
      detail: block ? `first block type=${String(block.type)}` : 'no content blocks',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(block.text))
  } catch (error) {
    return {
      status: 'degraded',
      failure: 'unparseable',
      detail: error instanceof Error ? error.message : 'JSON.parse failed',
    }
  }

  const results = (parsed as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) {
    return {
      status: 'degraded',
      failure: 'schema_invalid',
      detail: 'results is not an array',
    }
  }

  /**
   * A row whose `score` is not one of the three verdicts is dropped rather than
   * coerced. Coercing an unrecognised value to `maybe` would reintroduce the
   * exact conflation this module exists to remove — it would just move it one
   * level down.
   */
  const verdicts: Record<string, ScoredVerdict> = {}
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const { id, score, reason } = row as { id?: unknown; score?: unknown; reason?: unknown }
    if (typeof id !== 'string' || id.length === 0) continue
    if (typeof score !== 'string' || !VERDICTS.includes(score)) continue
    verdicts[id] = {
      score: score as Verdict,
      reason: typeof reason === 'string' ? reason : '',
    }
  }

  /**
   * Not one of the ids we sent came back: the reply is well-formed JSON about
   * something else. That is a contract failure, not 30 abstentions.
   *
   * The test is against THE BATCH, not against `verdicts`. A reply full of
   * ids from another sweep — or hallucinated ones — populates `verdicts`
   * while resolving nothing we asked about, and counting those would let a
   * total mismatch pass as a merely partial one.
   */
  const unscored = batchIds.filter((id) => !(id in verdicts))
  if (batchIds.length > 0 && unscored.length === batchIds.length) {
    return {
      status: 'degraded',
      failure: 'schema_invalid',
      detail: `0 of ${batchIds.length} ids resolved`,
    }
  }

  return { status: 'ok', verdicts, unscored }
}

/**
 * What one candidate card should carry.
 *
 * `score` stays inside the existing `yes | maybe | no` union on purpose. The
 * deployed client indexes a lookup table with it and would throw on a fourth
 * value, so widening the union is a CLIENT CONTRACT CHANGE and is deliberately
 * not made here. `scored` is the additive, non-breaking field that lets a
 * future client tell a real `maybe` from an unavailable classifier; an existing
 * client ignores it.
 */
export type CandidateVerdict = {
  score: Verdict
  reason: string
  /** False when no verdict was received for this listing. */
  scored: boolean
}

export function verdictFor(outcome: ClassifierOutcome, id: string): CandidateVerdict {
  if (outcome.status === 'degraded') {
    return { score: 'maybe', reason: 'Kunne ikke vurdere', scored: false }
  }
  const hit = outcome.verdicts[id]
  if (!hit) return { score: 'maybe', reason: '', scored: false }
  return { score: hit.score, reason: hit.reason, scored: true }
}

/** The additive response envelope. Counts and enum values only. */
export type ClassifierStatus = {
  status: 'ok' | 'degraded'
  failure: ClassifierFailure | null
  /** Listings sent to the classifier that came back without a verdict. */
  unscored: number
}

export function classifierStatus(
  outcome: ClassifierOutcome,
  batchSize: number,
): ClassifierStatus {
  if (outcome.status === 'degraded') {
    return { status: 'degraded', failure: outcome.failure, unscored: batchSize }
  }
  return { status: 'ok', failure: null, unscored: outcome.unscored.length }
}
