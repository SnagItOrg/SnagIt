/**
 * scripts/rematch-configs/ssl.ts — SSL (PAN-205): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan205-ssl-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-205',
  pan: 'pan205',
  brand: 'SSL',

  /** SSL has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-205 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The 14 known SSL model rows and the 4 step-2 models. Not here: the owner's clean-marked
   * UC1 duplicate (decision 1), the Connex and the Japanese "500 Series VHD Preamp" rows.
   */
  promoted: [
    'ssl-12', 'ssl-18', 'ssl-2', 'ssl-2-mkii', 'ssl-2-plus', 'ssl-2-plus-mkii', 'ssl-b-dyn', 'ssl-big-six',
    'ssl-fusion', 'ssl-six', 'ssl-six-channel', 'ssl-uc1', 'ssl-uf1', 'ssl-uf8', 'ssl-ultraviolet-eq',
    'ssl-vhd', 'ssl-vhd-pre', 'ssl-xlogic-alpha-vhd-pre',
  ],

  /** No SSL row is supported today. */
  supportedToday: [],


  /**
   * The unmatched cohort: active titles that name SSL ("SSL", "Solid State Logic", "Sol ID State Logic",
   * "Solid Stage Logic": the boundary's SSL_NAMED). Seymour Duncan's SSL-2 pickups and the accessories
   * stay in scope on purpose: `decideMatch` refuses or defers them, which is the auditable outcome.
   */
  lines: [
    {
      line: 'ssl',
      names: /(?<![a-z])ssl|solid\s+sta(?:te|ge)\s+logic|sol\s+id\s+state\s+logic/i,
      ilike: ['%ssl%', '%solid state logic%', '%solid stage logic%', '%sol id state logic%'],
    },
  ],
}

export default config
