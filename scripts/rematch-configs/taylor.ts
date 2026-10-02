/**
 * scripts/rematch-configs/taylor.ts — Taylor (PAN-225): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan225-taylor-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-225',
  pan: 'pan225',
  brand: 'Taylor',

  /** Taylor has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-225 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The three rows Taylor had (314ce, 814ce, GS Mini) and the 14 models PAN-225 step 2 created.
   */
  promoted: [
    'taylor-314ce', 'taylor-314ce-studio', 'taylor-next-generation-314ce', 'taylor-builders-edition-314ce',
    'taylor-814ce', 'taylor-814ce-dlx', 'taylor-next-generation-814ce', 'taylor-builders-edition-814ce',
    'taylor-next-generation-builders-edition-814ce',
    'taylor-gs-mini', 'taylor-gs-mini-mahogany', 'taylor-gs-mini-e-mahogany', 'taylor-gs-mini-e-koa', 'taylor-gs-mini-e-koa-plus',
    'taylor-gs-mini-e-rosewood', 'taylor-gs-mini-e-rosewood-plus', 'taylor-gs-mini-e-special-edition',
  ],

  /** No Taylor row is supported today. */
  supportedToday: [],


  /** The unmatched cohort: active titles that name Taylor (the boundary's TAYLOR_NAMED). */
  lines: [
    { line: 'taylor', names: /(?<![a-z])taylor(?![a-z])/i, ilike: ['%taylor%'] },
  ],
}

export default config
