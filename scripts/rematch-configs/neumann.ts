/**
 * scripts/rematch-configs/neumann.ts — Neumann (PAN-202): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan202-neumann-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-202',
  pan: 'pan202',
  brand: 'Neumann',

  /** Neumann has no family label rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-202 promote SQL moves from `known` to `supported`: the same
   * reviewed list, verbatim. Not here: rows with no verified CSP (MCM 114 since
   * step 1), the owner-held "clean" rows (TLM 107, KMS 105, KH 870), the pair row
   * SKM 184 and every Studio Set / pair row, the EA 87 and SG 287 accessories, and
   * the dirty single-model rows (M 147, BCM 705, KU 100, TLM 67, V 402).
   */
  promoted: [
    'neumann-kh-120-a', 'neumann-kh-120-ii', 'neumann-kh-80',
    'neumann-km-184', 'neumann-kms-104', 'neumann-kms-104-plus',
    'neumann-mt-48', 'neumann-ndh-20', 'neumann-neumann-u47-fet-collectors-edition',
    'neumann-tlm-102', 'neumann-tlm-103', 'neumann-tlm-49',
    'neumann-u47', 'neumann-u47-fet', 'neumann-u67',
    'neumann-u67-reissue', 'neumann-u87',
  ],

  /**
   * Rows supported TODAY whose live matches the PAN-202 boundaries change (the
   * regression table on the PR): stereo pairs, two "1977-85" pre-Ai units and a
   * "needs repair" unit on the public `neumann-u87ai`. Its live matches are
   * re-decided like the promoted rows' (the stale cohort).
   */
  supportedToday: ['neumann-u87ai'],


  /**
   * The unmatched cohort: active titles that name Neumann. Other makers' listings
   * that mention Neumann ("Warm Audio WA-87 R2 … U87 Style") stay in scope on
   * purpose: `decideMatch` defers or rejects
   * them, which is the auditable outcome.
   */
  lines: [
    { line: 'neumann', names: /neumann/i, ilike: ['%neumann%'] },
  ],
}

export default config
