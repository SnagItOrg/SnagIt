/**
 * scripts/rematch-configs/pan290-lexicon-korg-sdd.ts — PAN-290, the Lexicon classics and the Korg SDD delay family: the
 * 32 rows the PAN-290 promote file moves from `known` to `supported` (the four Lexicon rows that exist as `known` since
 * PAN-230 — the 224, 480L, PCM 42 and Prime Time 93 — and the two Korg SDD-3000 rows that exist since 2026-08-26, plus 26
 * rows created on 2026-10-21: 22 Lexicon and 4 Korg, all with a verified Reverb page except the Super Prime Time, the PCM
 * 92, the SDD-1000 and the DL8000R, which carry their sold evidence instead), with their LINE_BOUNDARIES entries. Price
 * decides identity: the 224 / 224X / 224XL are one row, the codes its identifiers; the 300 and 300L, the PCM96 and its
 * Surround, the LXP-15 and its II, the MX400 and the MX400XL, and the SDD-3000 rack and pedal are two rows each. Five
 * navigation families: `lexicon-pcm`, `prime-time`, `lexicon-lxp`, `lexicon-mx` and `korg-sdd`.
 *
 * The Lexicon 200 was supported before the ticket (PAN-249); its boundary now refuses a spaced "MX 200" / "MS 200", so
 * its unreviewed live matches are re-decided too.
 *
 * Today's unmatched cohort: ~90 Reverb titles and 9 DBA ads that say "lexicon" (most of the Reverb ones are 480L parts,
 * MX200 power supplies and plug-ins, which name no row), and ~30 that name an SDD (most of them SDD-3000-PDL pedals).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-290',
  pan: 'pan290',
  brand: 'Lexicon classics and the Korg SDD delay family (PAN-290)',

  /** The five families are navigation families with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-290 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // The four that existed as `known` (PAN-230).
    'lexicon-224', 'lexicon-480l', 'lexicon-pcm-42', 'lexicon-prime-time',
    // The big reverbs.
    'lexicon-300', 'lexicon-300l', 'lexicon-960l',
    // The lexicon-pcm family (the PCM 42 above).
    'lexicon-pcm-41', 'lexicon-pcm-60', 'lexicon-pcm-70', 'lexicon-pcm-80', 'lexicon-pcm-81', 'lexicon-pcm-90',
    'lexicon-pcm-91', 'lexicon-pcm-92', 'lexicon-pcm-96', 'lexicon-pcm-96-surround',
    // The prime-time family (the Model 93 above).
    'lexicon-prime-time-ii', 'lexicon-super-prime-time',
    // The lexicon-lxp and lexicon-mx families.
    'lexicon-lxp-1', 'lexicon-lxp-5', 'lexicon-lxp-15', 'lexicon-lxp-15-ii',
    'lexicon-mx200', 'lexicon-mx300', 'lexicon-mx400', 'lexicon-mx400xl',
    // The korg-sdd family (the two SDD-3000 rows existed as `known`) and the DL8000R.
    'korg-sdd-1000', 'korg-sdd-2000', 'korg-sdd-3000-rackmount', 'korg-sdd-3000-pedal', 'korg-dl8000r',
  ],

  /** The Lexicon 200 (PAN-249), whose boundary this ticket tightens. */
  supportedToday: ['lexicon-200'],

  /** The unmatched cohort: active titles that name a line, in the forms sellers write. */
  lines: [
    { line: 'lexicon-224', names: /(?<![\w-])224(?:[\s-]?xl?)?(?![\w-])/i, ilike: ['%lexicon%224%'] },
    { line: 'lexicon-reverbs', names: /(?<![\w-])(?:480|960|m?300)(?:[\s-]?l)?(?![\w-])/i, ilike: ['%lexicon%480%', '%lexicon%960%', '%lexicon%300%'] },
    { line: 'lexicon-pcm', names: /pcm[\s-]?\d{2}/i, ilike: ['%lexicon%pcm%'] },
    { line: 'prime-time', names: /prime[\s-]?(?:ii[\s-]?)?time|model[\s-]?9[357]/i, ilike: ['%prime%time%', '%primetime%', '%model 9_%'] },
    { line: 'lexicon-lxp', names: /lxp[\s-]?\d/i, ilike: ['%lxp%'] },
    { line: 'lexicon-mx', names: /(?<![\w-])mx[\s-]?[234]00/i, ilike: ['%lexicon%mx%'] },
    { line: 'korg-sdd', names: /sdd[\s-]?\d{4}|dl[\s-]?8000/i, ilike: ['%sdd%', '%dl8000%', '%dl-8000%'] },
  ],
}

export default config
