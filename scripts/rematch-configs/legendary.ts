/**
 * scripts/rematch-configs/legendary.ts — the PAN-230 step-5 tranches: the legendary rows with live
 * demand (3+ unmatched active titles naming them, measured 2026-10-03) that the PAN-230 promote SQL
 * moves from `known` to `supported`, each with its LINE_BOUNDARIES entry. One config across brands,
 * because the pass is the legendary list, not a brand; the lines are the models' names.
 *
 * Tranche 1 (14 rows) was promoted on 2026-10-04 and sits in `supportedToday`; tranche 2 (6 rows) is
 * `promoted` until its promote SQL has run, after which it moves down here too.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-230',
  pan: 'pan230',
  brand: 'Legendary gear (step 5)',

  /** No family label rows, so no held cohort. */
  labels: [],

  /**
   * Tranche 2: the rows the second PAN-230 promote SQL moves from `known` to `supported`, verbatim —
   * Manley's three standard versions, the 2007– API 550A, the vintage Neve 1073 module and the "Metal
   * Knob" 33609. Their brands still carry pending import duplicates (Manley 47, API 66, Neve 45): those
   * are `known`, never match targets, and a brand pass of their own. Left out on purpose: Neve 1081
   * (no CSP), 1084 and 1066 (every title in the pool is a parts lot), the EHX Small Stone (the vintage
   * V1–V3, Russian and Nano pedals need a split decision), Wurlitzer 200 (no CSP) and the Pultec
   * EQP-1A (its only demand is Manley-branded).
   */
  promoted: ['api-550a', 'manley-elop', 'manley-massive-passive', 'manley-variable-mu', 'neve-1073', 'neve-33609'],

  /** Tranche 1, promoted 2026-10-04: their unreviewed live matches are re-decided too (the stale cohort). */
  supportedToday: [
    'ampex-atr-102', 'fender-6g15-reverb-unit', 'marshall-2555-silver-jubilee', 'mxr-m117r-flanger',
    'neumann-km-84', 'peavey-5150', 'roland-sdd-320-dimension-d', 'shure-sm57', 'shure-sm7b',
    'sony-c-37a', 'sony-c800g', 'suhr-pt100', 'ua-la-2a', 'ua-la-3a',
  ],

  /** The unmatched cohort: active titles that name one of the models. */
  lines: [
    { line: 'atr-102', names: /(?<![\w-])atr[\s-]?102(?![\w-])/i, ilike: ['%atr-102%', '%atr 102%', '%atr102%'] },
    { line: '6g15', names: /(?<![\w-])6g[\s-]?15(?![\w-])/i, ilike: ['%6g15%', '%6g-15%', '%6g 15%'] },
    { line: '2555', names: /silver[\s-]*jubilee|(?<![\w-])2555(?![\w-])/i, ilike: ['%silver jubilee%', '%2555%'] },
    { line: 'm117r', names: /(?<![\w-])m[\s-]?117[\s-]?r?(?![\w-])/i, ilike: ['%m117%', '%m-117%'] },
    { line: 'km-84', names: /(?<![\w-])km[\s-]?84/i, ilike: ['%km 84%', '%km84%', '%km-84%'] },
    { line: '5150', names: /(?<![\w-])5150(?![\w-])/i, ilike: ['%5150%'] },
    { line: 'sdd-320', names: /(?<![\w-])sdd[\s-]?320(?![\w-])|dimension[\s-]*d(?![\w-])/i, ilike: ['%sdd-320%', '%sdd 320%', '%sdd320%', '%dimension d%'] },
    { line: 'sm57', names: /(?<![\w-])sm[\s-]?57/i, ilike: ['%sm57%', '%sm-57%', '%sm 57%'] },
    { line: 'sm7b', names: /(?<![\w-])sm[\s-]?7b(?![\w-])/i, ilike: ['%sm7b%', '%sm-7b%', '%sm 7b%'] },
    { line: 'c-37a', names: /(?<![\w-])c[\s-]?37a(?![\w-])/i, ilike: ['%c-37a%', '%c37a%', '%c 37a%'] },
    { line: 'c800g', names: /(?<![\w-])c[\s-]?800[\s-]?g(?![\w-])/i, ilike: ['%c800g%', '%c-800g%', '%c 800g%', '%c800-g%'] },
    { line: 'pt100', names: /(?<![\w-])pt[\s-]?100(?![\w-])/i, ilike: ['%pt100%', '%pt-100%', '%pt 100%'] },
    { line: 'la-2a', names: /(?<![\w-])la[\s-]?2a(?![\w-])/i, ilike: ['%la-2a%', '%la2a%', '%la 2a%'] },
    { line: 'la-3a', names: /(?<![\w-])la[\s-]?3a(?![\w-])/i, ilike: ['%la-3a%', '%la3a%', '%la 3a%'] },
    // Tranche 2.
    { line: 'massive-passive', names: /massive[\s-]*passive/i, ilike: ['%massive passive%', '%massive-passive%'] },
    { line: 'variable-mu', names: /variable[\s-]*mu(?![\w-])/i, ilike: ['%variable mu%', '%variable-mu%'] },
    { line: 'elop', names: /(?<![\w-])elop(?![a-z])/i, ilike: ['%elop%'] },
    { line: '550a', names: /(?<![\w-])550[\s-]?a(?![\w-])/i, ilike: ['%550a%', '%550 a%', '%550-a%'] },
    { line: '1073', names: /(?<![\w-])1073(?![\w-])/i, ilike: ['%1073%'] },
    { line: '33609', names: /(?<![\w-])33609(?![\w-])/i, ilike: ['%33609%'] },
  ],
}

export default config
