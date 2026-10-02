/**
 * scripts/rematch-configs/rickenbacker.ts — Rickenbacker (PAN-222): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan222-rickenbacker-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-222',
  pan: 'pan222',
  brand: 'Rickenbacker',

  /** Rickenbacker has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-222 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The three rows Rickenbacker had (4001, 4003, 360/12) and the 4003S PAN-222 step 2 created.
   */
  promoted: ['rickenbacker-360-12', 'rickenbacker-4001', 'rickenbacker-4003', 'rickenbacker-4003s'],

  /** No Rickenbacker row is supported today. */
  supportedToday: [],


  /** The unmatched cohort: active titles that name Rickenbacker (the boundary's RICKENBACKER_NAMED). */
  lines: [
    { line: 'rickenbacker', names: /(?<![a-z])rickenbacker/i, ilike: ['%rickenbacker%'] },
  ],
}

export default config
