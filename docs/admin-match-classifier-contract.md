# /admin/match — classifier status contract

Written during the `audit/admin-match-classifier` diagnostic, base `b2ee39c`.
This file records the **client contract change that was deliberately not made**
on that branch, and the ordering constraint that governs when it may be.

## What was wrong

`GET /api/admin/match/candidates` wrapped the whole relevance round-trip in one
bare `catch {}`. Every listing in the batch was assigned
`{ score: 'maybe', reason: 'Kunne ikke vurdere' }`, and the card renders `maybe`
as `Måske`. An exact `Roland RE-201 Space Echo` therefore carried the badge that
means *the model is undecided* when what had happened was *the model never
answered*. The exception was not bound, so the deployed system could not say
which failure it was.

`score: 'maybe'` had three unrelated producers:

| # | Producer | `reason` | Meaning |
|---|---|---|---|
| A | the bare catch | `Kunne ikke vurdere` | classifier unavailable — **operational** |
| B | `scores[id] ?? 'maybe'` | `''` (empty) | id sent, no verdict returned |
| C | the model | a real sentence | genuinely undecided — **semantic** |

The reported card read `Måske / Kunne ikke vurdere`, and that string occurs in
exactly one place in the repository. The label was A.

## What the server now returns

`score` is **unchanged** and stays inside `'yes' | 'maybe' | 'no'`. Two additive
fields carry the distinction:

```ts
// per candidate
scored: boolean          // false = no verdict arrived for this listing

// per response
classifier: {
  status:  'ok' | 'degraded'
  failure: null | 'provider_error' | 'empty_response'
           | 'truncated' | 'unparseable' | 'schema_invalid'
  unscored: number       // listings sent that came back without a verdict
}
```

A client that ignores both behaves exactly as it does today. That is why they
are safe to ship ahead of the UI.

`classifier.status === 'degraded'` means **no verdict in this response is real**.
`status === 'ok'` with `unscored > 0` means the verdicts that are present are
real and that many listings simply were not answered.

## The client contract change — NOT implemented here

The card must stop rendering an unavailable classifier as `Måske`. The change
is small and is stated exactly so it can be made in one pass:

1. `frontend/app/admin/match/page.tsx` reads `classifier` from the response and
   keeps it in reducer state alongside `candidates`.
2. When `classifier.status === 'degraded'`, the score column renders a fourth,
   non-verdict state — not a member of `scoreLabel`. Suggested copy, via
   `lib/i18n.ts` rather than a literal: `Ikke vurderet`, neutral colour, with
   the failure available on hover. It must not reuse the `Måske` amber.
3. Individual cards with `scored === false` under `status === 'ok'` render the
   same non-verdict state.
4. The "godkend alle med score yes" style bulk affordances, if any are added
   later, must be disabled while `status === 'degraded'`.

**Ordering constraint.** `score` may only be widened past `'yes' | 'maybe' |
'no'` *after* step 1–3 ship. `page.tsx` indexes `scoreLabel[c.score]` and then
reads `.color` off the result, so a fourth value reaching today's client throws
at render. The server therefore keeps `maybe` until the client can hold the
distinction.

## What was deliberately not changed

- **The model.** Still `claude-haiku-4-5-20251001`. A model change requires
  comparative fixtures and measured evidence.
- **The prompt.** Byte-identical.
- **`max_tokens: 1024`.** This is the leading hypothesis for which exception
  fires — an output budget arithmetic puts roughly 21 results in 1024 tokens,
  while `SCORING_BATCH` is 50 and a live `roland-re-201-space-echo` sweep sends
  29 — but it is a hypothesis, because the old code destroyed the evidence.
  `failure: 'truncated'` is detected from `stop_reason === 'max_tokens'`, ahead
  of the parse, precisely so the next real sweep settles it from data. Raise the
  budget when the logs say `truncated`, not before.
- **Retries.** None added. A retry would mask the failure rate that has to be
  measured first.
