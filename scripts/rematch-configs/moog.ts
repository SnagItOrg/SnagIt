/**
 * scripts/rematch-configs/moog.ts — Moog (PAN-199): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan199-moog-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-199',
  pan: 'pan199',
  brand: 'Moog',

  /** Moog has no family label rows (`minimoog` and `moogerfooger` are not rows), so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-199 promote SQL moves from `known` to `supported`: the same
   * reviewed list, verbatim. Not here: rows with no verified CSP (EP-1, Vocoder,
   * Minitmoog, Synthesizer 1c/2c/3c, the Geddy Lee edition) and the three
   * owner-held "clean" rows (Labyrinth ×2, Subsequent 25).
   */
  promoted: [
    'moog-cp-251', 'moog-dfam', 'moog-etherwave-theremin',
    'moog-grandmother', 'moog-labyrinth', 'moog-liberation',
    'moog-little-phatty', 'moog-matriarch', 'moog-mavis',
    'moog-memory-plus', 'moog-memorymoog', 'moog-mf-101-lowpass-filter',
    'moog-mf-102', 'moog-mf-103', 'moog-mf-104',
    'moog-mf-104m', 'moog-mf-104z', 'moog-mf-105',
    'moog-mf-105m-midi-murf', 'moog-micromoog', 'moog-minimoog-model-d-2022',
    'moog-minimoog-voyager', 'moog-minimoog-voyager-old-school', 'moog-minimoog-voyager-rme',
    'moog-minimoog-voyager-xl', 'moog-minitaur', 'moog-moog-messenger',
    'moog-moog-subsequent-37', 'moog-mother-32', 'moog-multimoog',
    'moog-muse', 'moog-one-16-voice', 'moog-one-8-voice',
    'moog-opus-3', 'moog-polymoog-203a', 'moog-prodigy',
    'moog-rogue', 'moog-satellite', 'moog-sirin',
    'moog-slim-phatty', 'moog-sonic-six', 'moog-spectravox',
    'moog-sub_phatty', 'moog-subharmonicon', 'moog-subsequent-25',
    'moog-taurus-3', 'moog-taurus-i', 'moog-taurus-ii',
    'moog-theremini',
  ],

  /**
   * Rows supported TODAY whose decisions the PAN-199 boundaries change: the
   * 2022– titles leave `moog-model-d`, parts leave `moog-source`, a plug-in
   * leaves `moog-minimoog`. Their live matches are re-decided like the promoted
   * rows' (the stale cohort).
   */
  supportedToday: ['moog-minimoog', 'moog-model-d', 'moog-source'],


  /**
   * The unmatched cohort: active titles that name Moog. Other makers' listings
   * that mention Moog stay in scope on purpose: `decideMatch` defers or rejects
   * them, which is the auditable outcome.
   */
  lines: [
    { line: 'moog', names: /moog/i, ilike: ['%moog%'] },
  ],
}

export default config
