/**
 * scripts/rematch-configs/guild.ts — Guild (PAN-226): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan226-guild-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-226',
  pan: 'pan226',
  brand: 'Guild',

  /** Guild has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-226 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The row Guild had (D-55) and the D-55E PAN-226 step 2 created.
   */
  promoted: ['guild-d-55', 'guild-d-55e'],

  /** No Guild row is supported today. */
  supportedToday: [],


  /** The unmatched cohort: active titles that name Guild (the boundary's GUILD_NAMED). */
  lines: [
    { line: 'guild', names: /(?<![a-z])guild(?![a-z])/i, ilike: ['%guild%'] },
  ],
}

export default config
