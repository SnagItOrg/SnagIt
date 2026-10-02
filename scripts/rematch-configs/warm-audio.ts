/**
 * scripts/rematch-configs/warm-audio.ts — Warm Audio (PAN-203): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan203-warm-audio-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-203',
  pan: 'pan203',
  brand: 'Warm Audio',

  /** Warm Audio has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-203 promote SQL moves from `known` to `supported`: the same
   * reviewed list, verbatim. Not here: the owner-held "clean" WA12 MKII, the pair
   * rows (WA-2A Stereo Pair, WA-84 Stereo Pair, WA-87 R2 TS), and the held rows
   * (WA-47T, WA-47F, WA76-D2, WA-WL, the "LDC 87 Type" and French small-diaphragm titles).
   */
  promoted: [
    'warm-audio-wa-19', 'warm-audio-wa-251', 'warm-audio-wa-2mpx',
    'warm-audio-wa-412', 'warm-audio-wa-47jr', 'warm-audio-wa-47jr-se',
    'warm-audio-wa-67', 'warm-audio-wa-84', 'warm-audio-wa-87-r2',
    'warm-audio-wa-87jr', 'warm-audio-wa-87jr-se', 'warm-audio-wa-cx24',
    'warm-audio-wa273', 'warm-audio-wa2a', 'warm-audio-wa47',
    'warm-audio-wa73', 'warm-audio-wa73-eq', 'warm-audio-wa76',
    'warm-audio-wa87', 'warm-audio-warm-audio-wa-1b', 'warm-audio-warm-audio-wa-44',
    'warm-audio-warm-audio-wa-8000', 'warm-audio-warm-audio-wa-cx12', 'warm-audio-warm-audio-wa-mpx',
    'warm-audio-warm-audio-wa273-eq', 'warm-audio-warm-bender',
  ],

  /**
   * Rows supported TODAY whose live matches the PAN-203 boundaries change: none.
   * The clone guard on the Neumann, 1176, LA-2A, Neve 1073 and CL 1B rows changes
   * no live match on them (measured on all 655).
   */
  supportedToday: [],


  /**
   * The unmatched cohort: active titles that name Warm Audio. Other makers' listings
   * that mention Warm Audio ("Revive Audio Modified: Warm Audio WA73") stay in scope
   * on purpose: `decideMatch` defers or rejects them, which is the auditable outcome.
   */
  lines: [
    { line: 'warm-audio', names: /warm\s*audio/i, ilike: ['%warm%audio%'] },
  ],
}

export default config
