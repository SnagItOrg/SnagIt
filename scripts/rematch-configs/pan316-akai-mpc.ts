/**
 * scripts/rematch-configs/pan316-akai-mpc.ts — PAN-316, the Akai MPCs: the 22 rows the PAN-316 promote files move from
 * `known` to `supported`, with their LINE_BOUNDARIES entries. Eleven existed as `known` since the KG import, eight of
 * them clean-marked (the MPC3000, 3000LE, 2000, 2000XL, 1000, 5000, Live II and One: their write is the owner's, in
 * its own gated file); the PAN-316 create file adds the MPC Live, Live III, Key 61, Key 37, Key 37 G2, One G2, X SE,
 * XL, Sample, MPC500 and MPC4000. Price decides identity (Reverb's sold population, same year, 2026-11-04): the MPC60
 * II, the MPC2000XL MCD / SE and the MPC One+ are their base row's. One navigation family: `akai-mpc`.
 *
 * Today's unmatched cohort (production, 2026-11-04): Reverb titles only — Akai is not in the DBA brand net, so no
 * Danish title names an MPC. About 900 Reverb titles hold an older match on these rows from before they were `known`.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-316',
  pan: 'pan316',
  brand: 'the Akai MPCs (PAN-316)',

  /** The family is a navigation family with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-316 promote files move from `known` to `supported`, verbatim. */
  promoted: [
    // pan316-promote: two imported rows and the eleven pan316-create made, plus the MPC2500 pan316-identity anchors.
    'akai-mpc60', 'akai-mpc-x', 'akai-mpc2500',
    'akai-mpc-live', 'akai-mpc-live-iii', 'akai-mpc-key-61', 'akai-mpc-key-37', 'akai-mpc-key-37-g2', 'akai-mpc-one-g2',
    'akai-mpc-x-se', 'akai-mpc-xl', 'akai-mpc-sample', 'akai-mpc500', 'akai-mpc4000',
    // pan316-clean-OWNER: the eight clean-marked rows, on the owner's word only.
    'akai-mpc3000', 'akai-mpc3000le', 'akai-mpc2000', 'akai-mpc2000xl', 'akai-mpc1000', 'akai-mpc-5000', 'akai-mpc-live-ii',
    'akai-mpc-one',
  ],

  /** No MPC row is supported today. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name an MPC, in the forms sellers write. */
  lines: [
    {
      line: 'mpc',
      names: /(?<![a-z0-9])mpc[-\s]?(?:60|3000|2000|1000|2500|500|4000|5000|live|one|x|xl|key|sample)(?![a-z])/i,
      ilike: ['%mpc%'],
    },
  ],
}

export default config
