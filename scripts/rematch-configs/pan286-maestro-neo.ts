/**
 * scripts/rematch-configs/pan286-maestro-neo.ts — PAN-286, Maestro vintage pedals and the Neo Instruments Ventilator
 * family: the 25 rows the PAN-286 promote file moves from `known` to `supported` (the three Echoplex rows that exist as
 * `known` since PAN-230, 18 Maestro rows and 4 Neo Instruments rows created on 2026-10-21 with a verified Reverb page
 * each, plus the new kg_brand neo-instruments), with their LINE_BOUNDARIES entries. Three navigation families:
 * `fuzz-tone` (FZ-1A / FZ-1B / FZ-1S), `echoplex` (EP-1–EP-4) and `ventilator` (the four Neo rows).
 *
 * Today's unmatched cohort: ~45 Reverb Echoplex titles (the rest of the 174 "maestro" titles are Gibson guitars with
 * a Maestro Vibrola, Formanta synths and Echoplex parts, none of which names a pedal row), and nothing for the other
 * pedals or for Neo Instruments, because neither brand is in the DBA net and the Reverb sweep queries kg rows only.
 * The dry run therefore shows the Echoplex rows taking their titles and the rest waiting for the first sweep.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-286',
  pan: 'pan286',
  brand: 'Maestro vintage pedals and Neo Instruments (PAN-286)',

  /** `fuzz-tone`, `echoplex` and `ventilator` are navigation families with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-286 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // The echoplex family: the three that existed as `known` and the created EP-2.
    'maestro-echoplex-ep-1', 'maestro-echoplex-ep-2', 'maestro-echoplex-ep-3', 'maestro-echoplex-ep-4',
    // The fuzz-tone family and the other fuzzes.
    'maestro-fuzz-tone-fz-1a', 'maestro-fuzz-tone-fz-1b', 'maestro-fuzz-tone-fz-1s',
    'maestro-fuzz-mfz-1', 'maestro-fuzz-phazzer', 'maestro-bass-brassmaster',
    // Phase, ring modulation, filters, octave, wah, boost.
    'maestro-phase-shifter-ps-1', 'maestro-phase-shifter-ps-1a', 'maestro-phase-shifter-ps-1b',
    'maestro-phaser-mp-1', 'maestro-mini-phase-mps-2', 'maestro-ring-modulator-rm-1',
    'maestro-filter-sample-hold-fsh-1', 'maestro-parametric-filter-mpf-1', 'maestro-octave-box',
    'maestro-boomerang-bg-2', 'maestro-full-range-booster-frb-1',
    // The ventilator family.
    'neo-instruments-ventilator', 'neo-instruments-ventilator-ii', 'neo-instruments-mini-vent', 'neo-instruments-micro-vent',
  ],

  /** No Maestro or Neo Instruments row was supported before the ticket. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name a line, in the forms sellers write. */
  lines: [
    { line: 'echoplex', names: /echo\s?plex|(?<![a-z])ep[-\s]?[1-4](?![a-z0-9])/i, ilike: ['%echoplex%', '%echo plex%', '%ep-1%', '%ep-2%', '%ep-3%', '%ep-4%', '%ep1 %', '%ep2 %', '%ep3 %', '%ep4 %'] },
    { line: 'fuzz-tone', names: /fuzz[-\s]?tone|(?<![a-z])fz[-\s]?1/i, ilike: ['%fuzz-tone%', '%fuzz tone%', '%fuzztone%', '%fz-1%', '%fz1%'] },
    { line: 'maestro-fuzz', names: /(?<![a-z])mfz|phazzer|brassmaster|brass master/i, ilike: ['%mfz%', '%phazzer%', '%brassmaster%', '%brass master%'] },
    { line: 'maestro-phase', names: /phase\s?shifter|(?<![a-z])ps[-\s]?1|(?<![a-z])mp[-\s]?1(?![0-9])|mini[-\s]?phase|(?<![a-z])mps[-\s]?2/i, ilike: ['%phase shifter%', '%ps-1%', '%mp-1%', '%mini-phase%', '%mini phase%', '%mps-2%'] },
    { line: 'maestro-filters', names: /ring\s?mod|(?<![a-z])rm[-\s]?1|sample\s?\/?\s?hold|(?<![a-z])fsh[-\s]?1|parametric|(?<![a-z])mpf[-\s]?1|octave\s?box|boomerang|(?<![a-z])bg[-\s]?2|full\s?range|(?<![a-z])frb[-\s]?1/i, ilike: ['%ring mod%', '%rm-1%', '%sample%hold%', '%fsh-1%', '%parametric%', '%mpf-1%', '%octave box%', '%boomerang%', '%bg-2%', '%full range%', '%frb-1%'] },
    { line: 'ventilator', names: /ventilator|mini\s?vent|micro\s?vent/i, ilike: ['%ventilator%', '%mini vent%', '%minivent%', '%micro vent%', '%microvent%'] },
  ],
}

export default config
