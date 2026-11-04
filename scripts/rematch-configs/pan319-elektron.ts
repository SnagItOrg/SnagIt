/**
 * scripts/rematch-configs/pan319-elektron.ts — PAN-319, Elektron: the 14 rows the PAN-319 promote files move from `known` to
 * `supported`, with their LINE_BOUNDARIES entries. Nine existed as `known` since the KG import (the Analog Heat +FX
 * clean-marked: its write is the owner's); the PAN-319 identity file gives the Model:Cycles and Monomachine their Reverb
 * pages and the Machinedrum and Monomachine the model names sellers write. The PAN-319 create file adds the Analog Keys,
 * Digitakt II, Digitone II, Digitone Keys and Analog Heat. Price decides identity (Reverb's sold population, same year):
 * Digitakt II +54 %, Digitone II +120 %, Heat +FX +55 % are rows of their own; the Analog Heat MkII (+13 %), the Syntakt E25
 * and the Machinedrum / Monomachine generations are their row's.
 *
 * NOT here: the Analog Four, Analog Rytm and Octatrack. Their imported rows sit on Reverb's MkII pages and their verdicts
 * are mostly MkII, while MkII sells +40–160 % over MkI; which row is which generation waits on the owner (PAN-319).
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-319',
  pan: 'pan319',
  brand: 'Elektron (PAN-319)',

  /** No family, so no held cohort. */
  labels: [],

  /** The rows the PAN-319 promote files move from `known` to `supported`, verbatim. */
  promoted: [
    // pan319-promote: imported rows not clean-marked, and the five pan319-create made.
    'elektron-digitakt', 'elektron-digitone', 'elektron-syntakt', 'elektron-model-samples', 'elektron-model-cycles',
    'elektron-machinedrum-sps-1', 'elektron-monomachine-sfx-6', 'elektron-tonverk',
    'elektron-analog-keys', 'elektron-digitakt-ii', 'elektron-digitone-ii', 'elektron-digitone-keys', 'elektron-analog-heat',
    // pan319-clean-OWNER: clean-marked, on the owner's word only.
    'elektron-analog-heat-fx',
  ],

  /** No Elektron row is supported today. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name an Elektron box. */
  lines: [{
    line: 'elektron',
    names: /digitakt|digitone|syntakt|tonverk|model\s?:?\s?(?:samples|cycles)|machine\s?drum|mono\s?machine|analog\s?(?:keys|heat)/i,
    ilike: ['%digitakt%', '%digitone%', '%syntakt%', '%tonverk%', '%model:samples%', '%model:cycles%', '%model samples%', '%model cycles%', '%machinedrum%', '%monomachine%', '%analog keys%', '%analog heat%'],
  }],
}

export default config
