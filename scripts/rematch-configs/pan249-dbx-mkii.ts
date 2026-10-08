/**
 * scripts/rematch-configs/pan249-dbx-mkii.ts — PAN-249's second promote: the dbx 160 family (the 1970s VU unit re-anchored
 * on its own Reverb page, and the 160A, 160X and 160XT created as rows on 2026-10-08) and the Universal Audio LA-610 MkII
 * (CSP 1969, 57+ live titles). Their LINE_BOUNDARIES entries refuse the plug-ins, pairs and bundles measured on the live
 * titles; the MkII shares the classic LA-610's line, so the classic is re-decided too.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-249',
  pan: 'pan249b',
  brand: 'dbx 160 family + LA-610 MkII (PAN-249)',

  /** No family label rows, so no held cohort. */
  labels: [],

  /** The rows the PAN-249 second promote SQL moves from `known` to `supported`, verbatim. */
  promoted: ['dbx-160', 'dbx-160a', 'dbx-160x', 'dbx-160xt', 'universal-audio-la-610-mkii'],

  /** The classic LA-610 shares the MkII's line. */
  supportedToday: ['ua-la-610'],

  /** The unmatched cohort: active titles that name one of the models. */
  lines: [
    { line: 'dbx-160', names: /dbx.*(?<![\w-])160|(?<![\w-])160.*dbx/i, ilike: ['%dbx%160%', '%160%dbx%'] },
    { line: 'la-610', names: /(?<![\w-])la[\s-]?610(?![\w-])/i, ilike: ['%la-610%', '%la 610%', '%la610%'] },
  ],
}

export default config
