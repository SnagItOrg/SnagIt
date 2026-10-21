/**
 * scripts/rematch-configs/pan293-modern-classics.ts — PAN-293, the modern classics: Eventide's pedals and racks, FMR
 * Audio's Really Nice units, TC Electronic's 2290 and 1210 and the Tube-Tech line. The 42 rows the PAN-293 promote file
 * moves from `known` to `supported`, with their LINE_BOUNDARIES entries:
 *   - 25 Eventide rows the PAN-293 create file adds (the Instant Phaser without a Reverb page, on its sold evidence);
 *   - 3 FMR Audio rows on the new kg_brand fmr-audio (RNC1773, RNP8380, RNLA7239);
 *   - the TC Electronic 2290 (known since PAN-230) and the 1210 Spatial Expander (created, no Reverb page);
 *   - 12 Tube-Tech rows: five model rows that exist as `known` (CL 1A, CL 2A, ME 1B, MP 2A, SSA 2A) and seven listing-title
 *     rows the PAN-293 identity file re-anchors as model rows (PE 1C, MP 1A, MEC 1A, SMC 2B, SMC 2BM, HLT 2A, EQ 1A).
 * Price decides identity (Reverb's sold population, 2026-10-21): the H9 Max and Core are two rows ($560 / $320), the
 * H3500 is the H3000's row (+15 %), and the LCA 2A, PE 1B and ME 1A are their successors' rows. Two navigation
 * families: `eventide-factor-pedals` and `eventide-h9-pedals`.
 *
 * The Eventide H3000 and H910 and the Tube-Tech CL 1B and LCA 2B were supported before the ticket and had no boundary
 * that read their parts and plug-ins; their unreviewed live matches are re-decided too.
 *
 * Today's unmatched cohort is small: the Reverb sweep queries kg rows only, so the pedals, FMR units and the 1210 hold
 * no Reverb title until the first sweep after the promotion. What production holds (SELECT, 2026-10-21): 67 active
 * titles that say Eventide (nearly all H3000 / H910 units, switches, EPROMs and plug-ins, which the boundaries refuse),
 * 18 that carry a 2290 or 1210, none that name FMR, and 111 that name Tube-Tech.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-293',
  pan: 'pan293',
  brand: 'Eventide, FMR Audio, TC Electronic and Tube-Tech — the modern classics (PAN-293)',

  /** The two families are navigation families with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-293 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // The eventide-h9-pedals family, and the H90.
    'eventide-h9-max', 'eventide-h9-core', 'eventide-h90',
    // The eventide-factor-pedals family.
    'eventide-timefactor', 'eventide-pitchfactor', 'eventide-modfactor', 'eventide-space',
    // The dot9 pedals, the Rose and the Knife Drop.
    'eventide-blackhole', 'eventide-micropitch', 'eventide-ultratap', 'eventide-tricerachorus', 'eventide-riptide',
    'eventide-rose', 'eventide-knife-drop',
    // The racks.
    'eventide-eclipse', 'eventide-h8000', 'eventide-h7600', 'eventide-h949', 'eventide-h969', 'eventide-dsp4000',
    'eventide-h9000', 'eventide-orville', 'eventide-omnipressor', 'eventide-sp2016', 'eventide-instant-phaser',
    // FMR Audio.
    'fmr-audio-rnc', 'fmr-audio-rnp', 'fmr-audio-rnla',
    // TC Electronic.
    'tc-electronic-2290', 'tc-electronic-1210',
    // Tube-Tech: the five model rows that exist, then the seven re-anchored ones.
    'tube-tech-cl-1a', 'tube-tech-cl2a', 'tube-tech-me-1b', 'tube-tech-mp-2a', 'tube-tech-ssa-2a',
    'tube-tech-pe-1c', 'tube-tech-mp-1a', 'tube-tech-mec-1a', 'tube-tech-smc-2b', 'tube-tech-smc-2bm', 'tube-tech-hlt-2a',
    'tube-tech-eq-1a',
  ],

  /** Supported before the ticket; their boundaries are new (Eventide) or tightened (Tube-Tech). */
  supportedToday: ['eventide-h3000', 'eventide-h910', 'tube-tech-cl1b', 'tube-tech-lca-2b'],

  /** The unmatched cohort: active titles that name a line, in the forms sellers write. */
  lines: [
    { line: 'eventide', names: /eventide/i, ilike: ['%eventide%'] },
    { line: 'fmr-audio', names: /(?<![a-z])(?:fmr|rnc|rnp|rnla)(?![a-z])|really\s+nice/i, ilike: ['%fmr%', '%really nice%', '%rnc%', '%rnp%', '%rnla%'] },
    { line: 'tc-electronic', names: /(?<![0-9])(?:2290|1210)(?![0-9])/, ilike: ['%2290%', '%1210%'] },
    { line: 'tube-tech', names: /tube[\s-]?tech|lydkraft/i, ilike: ['%tube%tech%', '%tubetech%', '%lydkraft%'] },
  ],
}

export default config
