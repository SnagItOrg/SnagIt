/**
 * scripts/rematch-configs/yamaha.ts — Yamaha DX7 (PAN-252): the brand's config for scripts/rematch-brand.ts.
 *
 * PAN-252 is a rule change — a breath controller sold on its own is an accessory — not a promotion:
 * nothing is promoted and no family label is involved. The config re-decides the unreviewed live
 * matches on the one supported DX row, `yamaha-dx7`, and the unmatched DX7 titles, so the dry run
 * shows what the rule changes before anything is written.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-252',
  pan: 'pan252',
  brand: 'Yamaha',

  /** No family label row is part of this pass. */
  labels: [],

  /** Nothing is promoted. */
  promoted: [],

  /** The supported DX7 row (f68bc299-4ab7-401d-bef4-81126714eafc); the other DX rows were `known` on 2026-10-07. */
  supportedToday: ['yamaha-dx7'],

  /** The unmatched cohort: active titles that name the DX7 — DX7, DX 7, DX-7, and the DX7II / DX7s forms. */
  lines: [
    { line: 'dx7', names: /(?<![a-z0-9])dx[\s-]?7(?![0-9])/i, ilike: ['%dx7%', '%dx 7%', '%dx-7%'] },
  ],
}

export default config
