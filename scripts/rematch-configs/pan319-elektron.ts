/**
 * scripts/rematch-configs/pan319-elektron.ts — PAN-319, Elektron: the 19 rows the PAN-319 promote files move from `known` to
 * `supported`, with their LINE_BOUNDARIES entries. Nine existed as `known` since the KG import (the Analog Heat +FX
 * clean-marked: its write is the owner's); the PAN-319 identity file gives the Model:Cycles and Monomachine their Reverb
 * pages and the Machinedrum and Monomachine the model names sellers write. The PAN-319 create file adds the Analog Keys,
 * Digitakt II, Digitone II, Digitone Keys and Analog Heat. Price decides identity (Reverb's sold population, same year):
 * Digitakt II +54 %, Digitone II +120 %, Heat +FX +55 % are rows of their own; the Analog Heat MkII (+13 %), the Syntakt E25
 * and the Machinedrum / Monomachine generations are their row's.
 *
 * The Analog Four, Analog Rytm and Octatrack (part 2, manager 2026-11-04: option A): MkII sells +40–160 % over MkI. The
 * imported slugs sit on Reverb's MkII pages and hold the MkII verdicts, so the pan319b files make them the MkII rows (model
 * "… MKII"; the empty `elektron-analogrytmMKII` duplicate retired into the Rytm) and create the Analog Four MkI and
 * Octatrack MkI. The Analog Four is clean-marked, so its pair is the owner's (pan319b-clean-OWNER).
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
    // pan319b-promote: the Rytm and Octatrack MkII rows and the Octatrack MkI pan319b-create made.
    'elektron-analog-rytm', 'elektron-octatrack', 'elektron-octatrack-mki',
    // pan319b-clean-OWNER: the Analog Four (clean-marked) and its MkI, on the owner's word only.
    'elektron-analog-four', 'elektron-analog-four-mki',
  ],

  /** No Elektron row is supported today. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name an Elektron box. */
  lines: [{
    line: 'elektron',
    names: /digitakt|digitone|syntakt|tonverk|model\s?:?\s?(?:samples|cycles)|machine\s?drum|mono\s?machine|analog\s?(?:keys|heat|four|rytm)|octatrack/i,
    ilike: ['%digitakt%', '%digitone%', '%syntakt%', '%tonverk%', '%model:samples%', '%model:cycles%', '%model samples%', '%model cycles%', '%machinedrum%', '%monomachine%', '%analog keys%', '%analog heat%', '%analog four%', '%analog rytm%', '%octatrack%'],
  }],
}

export default config
