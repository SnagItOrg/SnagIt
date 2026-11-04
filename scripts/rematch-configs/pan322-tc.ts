/**
 * scripts/rematch-configs/pan322-tc.ts — PAN-322, TC Electronic's TonePrint pedals and later racks and TC Helicon's vocal
 * pedals: the 21 rows the PAN-322 create file adds and the promote file moves to `supported`, with their LINE_BOUNDARIES
 * entries; the 2290 and 1210 racks are supported since PAN-293 and unchanged. Price decides identity (Reverb's sold
 * population, same year): the Flashback 2 and Minis are the Flashback's; the X4s, the Hall of Fame 2, the M-One XL and
 * the G-Major 2 are rows of their own. TC Helicon is the brand PAN-321 adds; its file runs first.
 *
 * Today's unmatched cohort (production, 2026-11-04): about 20 active DBA titles and a few Reverb ones; TC Electronic is in
 * the DBA brand net.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-322',
  pan: 'pan322',
  brand: 'TC Electronic pedals and racks, TC Helicon vocal pedals (PAN-322)',

  /** No family, so no held cohort. */
  labels: [],

  /** The rows the PAN-322 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    'tc-electronic-flashback', 'tc-electronic-flashback-x4', 'tc-electronic-hall-of-fame', 'tc-electronic-hall-of-fame-2',
    'tc-electronic-hall-of-fame-2-x4', 'tc-electronic-corona', 'tc-electronic-vortex', 'tc-electronic-shaker', 'tc-electronic-viscous-vibe',
    'tc-electronic-m5000', 'tc-electronic-g-force', 'tc-electronic-m-one', 'tc-electronic-m-one-xl', 'tc-electronic-m300',
    'tc-electronic-m3000', 'tc-electronic-d-two', 'tc-electronic-g-major', 'tc-electronic-g-major-2',
    'tc-helicon-harmony-singer', 'tc-helicon-mic-mechanic', 'tc-helicon-perform-v',
  ],

  /** Supported before the ticket: the PAN-293 racks, untouched. */
  supportedToday: ['tc-electronic-2290', 'tc-electronic-1210'],

  /** The unmatched cohort: active titles that name one of these units. */
  lines: [{
    line: 'tc',
    names: /flashback|hall\s+of\s+fame|corona|vortex|shaker|viscous|m\s?-?5000|g\s?-?force|m\s?-?one|m\s?-?300|m\s?-?3000|d\s?-?two|g\s?-?major|harmony\s+singer|mic\s+mechanic|perform\s?-?v/i,
    ilike: ['%flashback%', '%hall of fame%', '%corona%', '%vortex%', '%shaker%', '%viscous%', '%m5000%', '%g-force%', '%g force%', '%m-one%', '%m300%', '%m3000%', '%d-two%', '%g-major%', '%g major%', '%harmony singer%', '%mic mechanic%', '%perform-v%'],
  }],
}

export default config
