/**
 * scripts/rematch-configs/heritage.ts — Heritage (PAN-224): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan224-heritage-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-224',
  pan: 'pan224',
  brand: 'Heritage',

  /** Heritage has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-224 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The two rows Heritage had (H-150, H-535) and the 4 models PAN-224 step 2 created.
   */
  promoted: [
    'heritage-h-150', 'heritage-standard-ii-h-150', 'heritage-custom-shop-core-h-150',
    'heritage-h-535', 'heritage-custom-shop-core-h-535', 'heritage-h-535-artisan-aged',
  ],

  /** No Heritage row is supported today. */
  supportedToday: [],


  /**
   * The unmatched cohort: active titles that carry a Heritage model code. Not every title that says
   * "Heritage": 263 of those are other makers' guitars in "Heritage Cherry Sunburst", which this pass
   * has no business deciding. The boundaries still require Heritage's name.
   */
  lines: [
    { line: 'heritage', names: /(?<![\w-])h[\s-]?(?:150|535)(?![\w-])/i, ilike: ['%h-150%', '%h150%', '%h 150%', '%h-535%', '%h535%', '%h 535%'] },
  ],
}

export default config
