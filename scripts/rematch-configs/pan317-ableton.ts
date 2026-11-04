/**
 * scripts/rematch-configs/pan317-ableton.ts — PAN-317, Ableton's hardware: the 5 rows the PAN-317 promote file moves from
 * `known` to `supported`, with their LINE_BOUNDARIES entries. `ableton-push` (the 2013 Push, model "Push") existed as
 * `known` since the KG import, with no CSP; the PAN-317 identity file anchors it to Reverb's page 1857. The PAN-317 create
 * file adds the Push 2, the Push 3 controller, the Push 3 standalone and the Move. Price decides identity (Reverb's sold
 * population, 2025): Push 1 $210, Push 2 $388, Push 3 controller $790, Push 3 standalone $1,406, Move $399. No family:
 * "Ableton Push" would be the 2013 row's own name.
 *
 * Today's unmatched cohort (production, 2026-11-04): about 190 Reverb titles and 1 DBA title that name a Push; Ableton is
 * not in the DBA brand net. The only matches on `ableton-push` today are eight push-button parts, all rejected.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-317',
  pan: 'pan317',
  brand: 'Ableton Push and Move (PAN-317)',

  /** No family, so no held cohort. */
  labels: [],

  /** The rows the PAN-317 promote file moves from `known` to `supported`, verbatim. */
  promoted: ['ableton-push', 'ableton-push-2', 'ableton-push-3', 'ableton-push-3-standalone', 'ableton-move'],

  /** No Ableton row is supported today. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name a Push or the Move with the maker. */
  lines: [{ line: 'ableton', names: /ableton\W+(?:push|move)/i, ilike: ['%ableton%'] }],
}

export default config
