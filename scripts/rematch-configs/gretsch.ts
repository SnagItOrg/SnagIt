/**
 * scripts/rematch-configs/gretsch.ts — Gretsch (PAN-218): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan218-gretsch-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-218',
  pan: 'pan218',
  brand: 'Gretsch',

  /** Gretsch has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-218 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The G5420T and the 14 models PAN-218 step 2 created. Not here: the four generic rows
   * (Country Gentleman, Duo Jet, G6120 Chet Atkins, G6136 White Falcon), an open owner question.
   */
  promoted: [
    'gretsch-g5420t-electromatic', 'gretsch-g5420t-electromatic-classic',
    'gretsch-g6120t-55-vintage-select-chet-atkins', 'gretsch-g6120t-59-vintage-select-chet-atkins',
    'gretsch-g6122t-59-vintage-select-country-gentleman', 'gretsch-g6122t-62-vintage-select-country-gentleman',
    'gretsch-g6122t-players-edition-country-gentleman',
    'gretsch-g6128t-53-vintage-select-duo-jet', 'gretsch-g6128t-57-vintage-select-duo-jet',
    'gretsch-g6128t-59-vintage-select-duo-jet', 'gretsch-g6128t-gh-george-harrison-duo-jet',
    'gretsch-g6136-1958-stephen-stills-white-falcon', 'gretsch-g6136-55-vintage-select-falcon',
    'gretsch-g6136t-59-vintage-select-falcon', 'gretsch-g6136t-mgc-michael-guy-chislett-falcon',
  ],

  /** No Gretsch row is supported today. */
  supportedToday: [],


  /**
   * The unmatched cohort: active titles that name Gretsch (the boundary's GRETSCH_NAMED). Greco
   * copies, cases and pickguards stay in scope on purpose: `decideMatch` refuses or defers them,
   * which is the auditable outcome.
   */
  lines: [
    { line: 'gretsch', names: /(?<![a-z])gretsch/i, ilike: ['%gretsch%'] },
  ],
}

export default config
