/**
 * scripts/rematch-configs/prs.ts — PRS (PAN-220): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan220-prs-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-220',
  pan: 'pan220',
  brand: 'PRS',

  /** PRS has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-220 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The four rows PRS had (Custom 22, Custom 24, McCarty 594, Silver Sky) and the 11 models
   * PAN-220 step 2 created.
   */
  promoted: [
    'prs-custom-22', 'prs-custom-22-piezo', 'prs-custom-22-soapbar', 'prs-se-custom-22-semi-hollow',
    'prs-custom-24', 'prs-custom-24-08', 'prs-custom-24-piezo', 'prs-custom-24-semi-hollow',
    'prs-mccarty-594', 'prs-mccarty-594-hollowbody-ii', 'prs-mccarty-594-singlecut',
    'prs-s2-mccarty-594', 'prs-s2-mccarty-594-singlecut', 'prs-s2-mccarty-594-thinline',
    'prs-silver-sky',
  ],

  /** No PRS row is supported today. */
  supportedToday: [],


  /** The unmatched cohort: active titles that name PRS (the boundary's PRS_NAMED). */
  lines: [
    { line: 'prs', names: /(?<![a-z])prs(?![a-z])|paul reed smith/i, ilike: ['%prs%', '%paul reed smith%'] },
  ],
}

export default config
