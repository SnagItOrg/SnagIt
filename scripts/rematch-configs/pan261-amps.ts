/**
 * scripts/rematch-configs/pan261-amps.ts — the PAN-261 amp section: the rows the PAN-261 promote files move from
 * `known` to `supported` (11 created on 2026-10-13 with a verified Reverb CSP, 16 re-anchored that existed as
 * `known` since PAN-178), each with its LINE_BOUNDARIES entry. One config across brands because the pass is one
 * section of the catalogue, not a brand; the lines are the models' names. `roland-jc-120` is left out: it is
 * clean-marked, which the promote guard refuses, so its promote waits for the owner's word (listed on PAN-261).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-261',
  pan: 'pan261',
  brand: 'Amps (PAN-261)',

  /** No family label rows, so no held cohort. */
  labels: [],

  /** The rows the PAN-261 promote files move from `known` to `supported`, verbatim (tonight's three and the morning's). */
  promoted: [
    'soldano-slo-100', 'hiwatt-dr103', 'fender-pro-reverb',
    'fender-twin-reverb-vintage', 'fender-65-twin-reverb-reissue', 'fender-tone-master-twin-reverb',
    'fender-deluxe-reverb-vintage', 'fender-65-deluxe-reverb-reissue', 'fender-68-custom-deluxe-reverb', 'fender-tone-master-deluxe-reverb',
    'fender-princeton-reverb-vintage', 'fender-65-princeton-reverb-reissue', 'fender-tone-master-princeton-reverb',
    'fender-super-reverb', 'fender-vibrolux-reverb', 'fender-bassman', 'fender-5e3-tweed-deluxe',
    'fender-blues-junior', 'fender-blues-junior-iii', 'fender-blues-junior-iv',
    'vox-ac30-vintage', 'marshall-super-lead-plexi', 'marshall-jcm800-2203', 'marshall-jcm800-2204',
    'mesa-boogie-dual-rectifier', 'peavey-6505', 'ampeg-svt',
  ],

  /** The 5150 shares the 6505's line and keeps its PAN-230 boundary; its live matches are re-decided too. */
  supportedToday: ['peavey-5150'],

  /** The unmatched cohort: active titles that name one of the models. */
  lines: [
    { line: 'twin-reverb', names: /twin[\s-]?reverb/i, ilike: ['%twin reverb%', '%twin-reverb%'] },
    { line: 'super-reverb', names: /super\s+reverb/i, ilike: ['%super reverb%'] },
    { line: 'deluxe-reverb', names: /deluxe\s+reverb/i, ilike: ['%deluxe reverb%'] },
    { line: 'princeton-reverb', names: /princeton\s+reverb/i, ilike: ['%princeton reverb%'] },
    { line: 'vibrolux', names: /vibrolux/i, ilike: ['%vibrolux%'] },
    { line: 'pro-reverb', names: /(?<![\w-])pro\s+reverb/i, ilike: ['%pro reverb%'] },
    { line: 'bassman', names: /bassman/i, ilike: ['%bassman%'] },
    { line: 'blues-junior', names: /blues\s+j(?:unio)?r/i, ilike: ['%blues junior%', '%blues jr%'] },
    { line: 'tweed-deluxe', names: /tweed\s+deluxe|(?<![\w-])5e3(?![\w-])/i, ilike: ['%tweed deluxe%', '%5e3%'] },
    { line: 'ac30', names: /(?<![\w-])ac[\s-]?30(?![\w-]|\d)/i, ilike: ['%ac30%', '%ac-30%', '%ac 30%'] },
    { line: 'plexi', names: /plexi|super\s?lead|(?<![\w-])1959(?![\w-])/i, ilike: ['%plexi%', '%super lead%', '%superlead%', '%1959%'] },
    { line: 'jcm800', names: /(?<![\w-])220[34](?![\w-])/i, ilike: ['%2203%', '%2204%'] },
    { line: 'rectifier', names: /dual\s+rectifier/i, ilike: ['%dual rectifier%'] },
    { line: '5150', names: /(?<![\w-])(?:5150|6505)(?![\w-])/i, ilike: ['%5150%', '%6505%'] },
    { line: 'dr103', names: /dr[\s-]?103/i, ilike: ['%dr103%', '%dr-103%', '%dr 103%'] },
    { line: 'slo', names: /slo[\s-]?100/i, ilike: ['%slo-100%', '%slo 100%', '%slo100%'] },
    { line: 'svt', names: /ampeg.*(?<![\w-])svt(?![\w-])/i, ilike: ['%ampeg%svt%'] },
  ],
}

export default config
