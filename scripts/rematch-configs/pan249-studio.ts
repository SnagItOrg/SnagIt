/**
 * scripts/rematch-configs/pan249-studio.ts — the PAN-249 studio-gear pass: the rows the PAN-249 promote SQL moves from
 * `known` to `supported` (10 created with a verified Reverb CSP on 2026-10-07, plus the ARP Solina, the Fairchild 670 and
 * the Kush Clariphonic that already existed), each with its LINE_BOUNDARIES entry where titles demanded one. One config
 * across brands, because the pass is one studio's 33 ads, not a brand; the lines are the models' names. `dbx-160` is
 * left out on purpose: its row is anchored on the 160XT page while every bare "dbx 160" title is a 1970s VU unit, so
 * promoting it would price the wrong product (owner's call, listed on PAN-249).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-249',
  pan: 'pan249',
  brand: 'Studio gear (PAN-249)',

  /** No family label rows, so no held cohort. */
  labels: [],

  /** The rows the PAN-249 promote SQL moves from `known` to `supported`, verbatim. */
  promoted: [
    'ua-la-4', 'ua-la-610', 'lexicon-200', 'roland-dep-5', 'ssl-xlogic-multichannel-compressor', 'altec-436',
    'focusrite-red-3', 'anthony-demaria-labs-adl-1500', 'amek-9098-eq', 'joemeek-sc2',
    'arp-solina-string-ensemble', 'fairchild-670', 'kush-clariphonic',
  ],

  /** None of the pass's rows was supported before it. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name one of the models. */
  lines: [
    { line: 'la-4', names: /(?<![\w-])la[\s-]?4(?![\w-])/i, ilike: ['%la-4%', '%la 4%', '%la4%'] },
    { line: 'la-610', names: /(?<![\w-])la[\s-]?610(?![\w-])/i, ilike: ['%la-610%', '%la 610%', '%la610%'] },
    { line: 'lexicon-200', names: /(?<![\w-])lexicon\s+(?:model\s+)?200(?![\w-])/i, ilike: ['%lexicon%200%'] },
    { line: 'dep-5', names: /(?<![\w-])dep[\s-]?5(?![\w-])/i, ilike: ['%dep-5%', '%dep 5%', '%dep5%'] },
    { line: 'xlogic-multichannel', names: /multichannel\s+comp/i, ilike: ['%multichannel%comp%'] },
    { line: 'altec-436', names: /altec.*(?<![\w-])436[a-c]?(?![\w-])/i, ilike: ['%altec%436%'] },
    { line: 'red-3', names: /focusrite.*(?<![\w-])red[\s-]?3(?![\w-])/i, ilike: ['%focusrite%red%'] },
    { line: 'adl-1500', names: /demaria|(?<![\w-])adl[\s-]?1500(?![\w-])/i, ilike: ['%demaria%', '%adl 1500%', '%adl1500%'] },
    { line: '9098', names: /(?<![\w-])9098(?![\w-])/i, ilike: ['%9098%'] },
    { line: 'sc2', names: /joe\s?meek/i, ilike: ['%joemeek%', '%joe meek%'] },
    { line: 'solina', names: /solina/i, ilike: ['%solina%'] },
    { line: '670', names: /fairchild/i, ilike: ['%fairchild%'] },
    { line: 'clariphonic', names: /clariphonic/i, ilike: ['%clariphonic%'] },
  ],
}

export default config
