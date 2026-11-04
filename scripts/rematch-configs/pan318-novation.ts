/**
 * scripts/rematch-configs/pan318-novation.ts — PAN-318, Novation's Circuit and Bass Station lines: the 9 imported rows
 * the PAN-318 promote files move from `known` to `supported`, with their LINE_BOUNDARIES entries. No row is created.
 * The identity file gives the 2015 Circuit and the 1993 Bass Station their own Reverb pages (they held the Circuit
 * Rhythm's and the Bass Station II's) and names the Super Bass Station. The Circuit Rhythm (clean-marked), Circuit Tracks
 * and Bass Station II (pending) are the owner's file. The Circuit Tracks and Rhythm are two products (+10 % apart); the
 * AFX Station sells +48 % over the Bass Station II.
 *
 * Today's unmatched cohort (production, 2026-11-04): about 180 active Reverb titles that name a Circuit or Bass Station
 * and hold no match; Novation is not in the DBA brand net. Three AI-verified Bass Station Rack titles sit on the 1993
 * keyboard row; the runner never moves them.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-318',
  pan: 'pan318',
  brand: 'Novation Circuit and Bass Station (PAN-318)',

  /** No family, so no held cohort. */
  labels: [],

  /** The rows the PAN-318 promote files move from `known` to `supported`, verbatim. */
  promoted: [
    // pan318-promote.
    'novation-Circuit', 'novation-circuit_mono_station', 'novation-bass-station', 'novation-bass-station-rack',
    'novation-super-bass-station', 'novation-afx-station',
    // pan318-reviewed-OWNER: clean-marked or pending, on the owner's word only.
    'novation-circuit-rhythm', 'novation-novation-circuit-tracks', 'novation-novation-bass-station-ii',
  ],

  /** No Novation row is supported today. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name a Circuit or a Bass Station. */
  lines: [
    { line: 'circuit', names: /novation\W+(?:circuit)/i, ilike: ['%circuit%'] },
    { line: 'bass-station', names: /bass\s?station|afx\s?station/i, ilike: ['%bass station%', '%bassstation%', '%afx station%'] },
  ],
}

export default config
