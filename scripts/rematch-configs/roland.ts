/**
 * scripts/rematch-configs/roland.ts — Roland (PAN-200): the brand's config for scripts/rematch-brand.ts.
 * The lists are the ones scripts/pan200-roland-rematch.ts carried, verbatim (PAN-229).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-200',
  pan: 'pan200',
  brand: 'Roland',

  /** Roland's family slugs are not rows, so no held cohort. */
  labels: [],

  /**
   * The rows the PAN-200 promote SQL moves from `known` to `supported`: the same
   * reviewed list, verbatim. Not here: rows with no verified CSP, the owner-held
   * "clean" rows and the Cube Street cluster, HS-60 (it shares the Juno-106 page),
   * the MDH-STG pad mount, two listing-title rows and the D2 (a two-character
   * model name the matcher cannot use).
   */
  promoted: [
    'roland-SP-404', 'roland-cube-lite', 'roland-d-110',
    'roland-d-20', 'roland-d-50', 'roland-d-550',
    'roland-d-70', 'roland-dj-70', 'roland-em101',
    'roland-fantom-s', 'roland-fantom-x6', 'roland-fantom-x8',
    'roland-fantom-xa', 'roland-gr-300', 'roland-gr-700',
    'roland-jc-120h', 'roland-jc-22', 'roland-jc-85',
    'roland-jd-08', 'roland-jd-800', 'roland-jd-990',
    'roland-jd-xa', 'roland-jp-08', 'roland-jp-8000',
    'roland-jp-8080', 'roland-ju-06', 'roland-ju-06a',
    'roland-juno-106s', 'roland-juno-d', 'roland-juno-d6',
    'roland-juno-d7', 'roland-juno-d8', 'roland-juno-di',
    'roland-juno-ds-61', 'roland-juno-g', 'roland-juno-stage',
    'roland-juno-x', 'roland-jupiter-50', 'roland-jupiter-6',
    'roland-jupiter-80', 'roland-jupiter-xm', 'roland-jv-1000',
    'roland-jv-1010', 'roland-jv-1080', 'roland-jv-2080',
    'roland-jv-30', 'roland-jv-880', 'roland-jv-90',
    'roland-jx-03', 'roland-jx-08', 'roland-jx-1',
    'roland-jx-10', 'roland-jx-305', 'roland-jx-3p',
    'roland-jx-8p', 'roland-kc-200', 'roland-kc-400',
    'roland-mc-09', 'roland-mc-202', 'roland-mc-303',
    'roland-mc-307', 'roland-mc-505', 'roland-mc-808',
    'roland-mc-909', 'roland-mks-10', 'roland-mks-30',
    'roland-mks-50', 'roland-mks-7', 'roland-mks-70',
    'roland-mks-80', 'roland-mobile-cube', 'roland-mrs-2',
    'roland-mt-32', 'roland-pdx-6', 'roland-r-70',
    'roland-r-8', 'roland-re-150', 'roland-re-301',
    'roland-rs-09', 'roland-rs-101', 'roland-rs-202-strings',
    'roland-rs-50', 'roland-rs-505-paraphonic', 'roland-s-10',
    'roland-s-220', 'roland-s-330', 'roland-s-50',
    'roland-s-770', 'roland-saturn-09', 'roland-sh-01-gaia',
    'roland-sh-01a', 'roland-sh-09', 'roland-sh-1',
    'roland-sh-1000', 'roland-sh-2', 'roland-sh-2000',
    'roland-sh-201', 'roland-sh-32', 'roland-sh-3a',
    'roland-sh-5', 'roland-sh-7', 'roland-sp-404-mkii',
    'roland-sp-404a', 'roland-sp-404sx', 'roland-sp-808',
    'roland-sre-555', 'roland-svc-350', 'roland-tb-303',
    'roland-tr-06', 'roland-tr-08', 'roland-tr-09',
    'roland-tr-626', 'roland-tr-727', 'roland-tr-8s',
    'roland-u-110', 'roland-u-20', 'roland-v-synth',
    'roland-vp-330', 'roland-vp-550', 'roland-vp-770',
    'roland-vp-9000', 'roland-w-30', 'roland-xp-10',
    'roland-xp-30', 'roland-xp-50', 'roland-xp-60',
    'roland-xp-80', 'roland-xv-3080', 'roland-xv-5080',
  ],

  /**
   * Rows supported TODAY whose live matches the PAN-200 boundaries change (the
   * regression table on the PR): Boutique listings leave `roland-juno-106` and
   * `roland-tr-606`, a case leaves `roland-juno-60`, merch and a "for parts" unit
   * leave `roland-tr-909`. Their live matches are re-decided like the promoted
   * rows' (the stale cohort).
   */
  supportedToday: ['roland-juno-106', 'roland-juno-60', 'roland-tr-606', 'roland-tr-909'],


  /**
   * The unmatched cohort: active titles that name Roland. Other makers' listings
   * that mention Roland stay in scope on purpose: `decideMatch` defers or rejects
   * them, which is the auditable outcome.
   */
  lines: [
    { line: 'roland', names: /roland/i, ilike: ['%roland%'] },
  ],
}

export default config
