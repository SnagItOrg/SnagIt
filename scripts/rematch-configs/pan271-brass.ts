/**
 * scripts/rematch-configs/pan271-brass.ts — PAN-271, the brass section, trumpets first: the 12 rows the PAN-271 promote
 * file moves from `known` to `supported` (created 2026-10-19 with a verified Reverb CSP each), with their LINE_BOUNDARIES
 * entries. One config across two brands because the pass is one section of the catalogue; the lines are the Yamaha YTR
 * series and the Bach Stradivarius bells.
 *
 * Today's unmatched cohort is small (8 active DBA trumpet titles, 0 on the other sources — Bach is not in the DBA brand
 * net and the explicit product sets hold no brass), so the dry run mostly shows the Yamaha rows taking their first titles.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-271',
  pan: 'pan271',
  brand: 'Brass (PAN-271)',

  /** `bach-stradivarius` is a navigation family with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-271 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    'yamaha-ytr-232', 'yamaha-ytr-1335', 'yamaha-ytr-2320', 'yamaha-ytr-2330', 'yamaha-ytr-2335',
    'yamaha-ytr-4335gii', 'yamaha-ytr-8310z', 'yamaha-ytr-8335', 'yamaha-ytr-8345',
    'bach-stradivarius-37', 'bach-stradivarius-43', 'bach-stradivarius-72',
  ],

  /** No trumpet row was supported before the ticket. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name a YTR model, the Stradivarius line or a Bach 180/190 code. */
  lines: [
    { line: 'ytr', names: /(?<![a-z0-9])ytr[\s-]?\d{3,4}/i, ilike: ['%ytr%'] },
    { line: 'stradivarius', names: /stradivarius|(?<![a-z0-9])strad(?![a-z])/i, ilike: ['%stradivarius%', '%strad %', '%strad-%'] },
    // The bore-and-finish codes without the word: "Bach 180S37", "LR180S37", "18037", "190S37", "170S43GYR".
    { line: 'bach-180', names: /(?<![a-z0-9])(?:lr|lt)?1[789]0?(?:s|ml)?(?:37|43|72)(?![0-9])/i, ilike: ['%18037%', '%180s37%', '%180ml37%', '%18043%', '%180s43%', '%180ml43%', '%18072%', '%180s72%', '%180ml72%', '%lr180%', '%lt180%', '%190s%', '%19037%', '%170s43%'] },
  ],
}

export default config
