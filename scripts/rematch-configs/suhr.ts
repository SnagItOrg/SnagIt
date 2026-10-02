/**
 * scripts/rematch-configs/suhr.ts — Suhr (PAN-223): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan223-suhr-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-223',
  pan: 'pan223',
  brand: 'Suhr',

  /** Suhr has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-223 promote SQL moves from `known` to `supported`: the same reviewed list,
   * verbatim. The two rows Suhr had (Classic S, Classic T) and the 7 models PAN-223 step 2 created.
   */
  promoted: [
    'suhr-classic-s', 'suhr-classic-s-antique', 'suhr-classic-s-paulownia', 'suhr-classic-s-studio', 'suhr-custom-shop-classic-s',
    'suhr-classic-t', 'suhr-classic-t-antique', 'suhr-custom-shop-classic-t', 'suhr-mateus-asato-signature-classic-t',
  ],

  /** No Suhr row is supported today. */
  supportedToday: [],


  /** The unmatched cohort: active titles that name Suhr (the boundary's SUHR_NAMED). */
  lines: [
    { line: 'suhr', names: /(?<![a-z])suhr(?![a-z])/i, ilike: ['%suhr%'] },
  ],
}

export default config
