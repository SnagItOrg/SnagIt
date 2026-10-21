/**
 * scripts/rematch-configs/pan282-memory-man.ts — PAN-282, the Electro-Harmonix Memory Man line: the 12 rows the
 * PAN-282 promote file moves from `known` to `supported` (5 that existed as `known` since migration 056 and are
 * renamed, re-categorised and anchored to their Reverb page by the identity file; 7 created on 2026-10-21 with a
 * verified Reverb page each), with their LINE_BOUNDARIES entries. Nine are the `memory-man` family; the Memory Boy,
 * Deluxe Memory Boy and Memory Toy are their own products outside it (owner, 2026-10-21).
 *
 * Today's unmatched cohort: 136 Reverb titles (108 active) name a Memory Man, Memory Boy or Memory Toy; DBA holds none
 * because `electro-harmonix` was not in its brand net until this change (owner approval on PAN-282). The dry run shows
 * the 1100-TT, 550-TT, XO and Nano rows taking their Reverb titles; the vintage, reissue and non-deluxe rows wait for
 * a title that names an era.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-282',
  pan: 'pan282',
  brand: 'Electro-Harmonix Memory Man (PAN-282)',

  /** `memory-man` is a navigation family with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-282 promote file moves from `known` to `supported`, verbatim (post-identity slugs). */
  promoted: [
    // The memory-man family: the five that existed as `known` (vintage renamed from ehx-deluxe-memory-man-vintage-mn3005)
    // and the four created.
    'ehx-deluxe-memory-man-vintage', 'ehx-deluxe-memory-man-xo', 'ehx-deluxe-memory-man-1100-tt', 'ehx-deluxe-memory-man-550-tt',
    'ehx-memory-man-nano',
    'ehx-memory-man', 'ehx-deluxe-memory-man-reissue', 'ehx-deluxe-memory-man-tap-tempo', 'ehx-memory-man-stereo-hazarai',
    // Outside the family: the three created.
    'ehx-memory-boy', 'ehx-deluxe-memory-boy', 'ehx-memory-toy',
  ],

  /** No Memory row was supported before the ticket. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name a Memory Man, Memory Boy or Memory Toy, in the forms sellers write. */
  lines: [
    { line: 'memory-man', names: /memory\s?man|deluxe\s?mm|(?<![a-z])dmm(?![a-z])|hazarai/i, ilike: ['%memory man%', '%memoryman%', '%deluxe mm%', '%dmm %', '%dmm-%', '%hazarai%'] },
    { line: 'memory-boy', names: /memory\s?boy/i, ilike: ['%memory boy%', '%memoryboy%'] },
    { line: 'memory-toy', names: /memory\s?toy/i, ilike: ['%memory toy%', '%memorytoy%'] },
  ],
}

export default config
