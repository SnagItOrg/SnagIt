/**
 * scripts/rematch-configs/sequential.ts — PAN-221: Sequential, Sequential Circuits and Dave Smith
 * Instruments, one maker under three brand rows (owner decision 2 of 2026-10-04). The rows the
 * PAN-221 promote SQL moves from `known` to `supported`, each with its LINE_BOUNDARIES entry, plus
 * the three supported today; the lines are the models' names as the 1,305 active titles write them.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-221',
  pan: 'pan221',
  brand: 'Sequential (three eras)',

  /** The Prophet navigation family is a families.ts concept with no kg_product row, so there is no held cohort. */
  labels: [],

  /**
   * The rows the PAN-221 promote SQL moves from `known` to `supported`, verbatim: the five clean
   * keyboards, the OB-6, the drum machines, the vintage Sequential Circuits rows with a Reverb page
   * and demand, the Dave Smith Instruments rows, and the rows step 2 creates (the desktop modules,
   * the Pro 3 SE, the Prophet X, the Mopho x4). Left out on purpose: the TOM (one complete unit in
   * the pool, and "Tom" is Tom Oberheim on every OB-6 box), Max, MultiTrak, Split-8, Prelude, Fugue,
   * Studio 440, Prophet 3000, Prophet Remote, the Poly Evolver Rack and the Fourm (no page, or fewer
   * than 3 complete units in the pool).
   */
  promoted: [
    'sequential-prophet-6', 'sequential-prophet-6-desktop', 'sequential-prophet-5-desktop', 'sequential-prophet-10-desktop',
    'sequential-prophet-rev2', 'sequential-take-5', 'sequential-take-5-desktop', 'sequential-trigon-6', 'sequential-trigon-6-desktop',
    'sequential-pro-3', 'sequential-pro-3-se', 'sequential-ob-6', 'sequential-ob-6-desktop', 'sequential-prophet-x',
    'sequential-drumtraks',
    'sequential-circuits-prophet-5', 'sequential-circuits-prophet-600', 'sequential-circuits-pro-one', 'sequential-circuits-prophet-vs',
    'sequential-circuits-six-trak', 'sequential-circuits-prophet-2000', 'sequential-circuits-prophet-t8',
    'dave-smith-instruments-mopho', 'dave-smith-instruments-mopho-x4', 'dave-smith-instruments-evolver', 'dave-smith-instruments-poly-evolver',
    'dave-smith-instruments-mono-evolver', 'dave-smith-instruments-tempest', 'dave-smith-instruments-tetra', 'dave-smith-instruments-prophet-08',
    'davesmithinstruments-pro2',
  ],

  /** Supported before the ticket: their unreviewed live matches are re-decided too. */
  supportedToday: ['sequential-prophet-5', 'sequential-prophet-10', 'sequential-circuits-prophet-10'],

  /** The unmatched cohort: active titles that name one of the models. */
  lines: [
    { line: 'prophet-5', names: /prophet[\s-]*(?:5|five)(?![\w-])/i, ilike: ['%prophet-5%', '%prophet 5%', '%prophet5%', '%prophet five%'] },
    { line: 'prophet-6', names: /prophet[\s-]*(?:6|six)(?![\w-])/i, ilike: ['%prophet-6%', '%prophet 6%', '%prophet6%', '%prophet six%'] },
    { line: 'prophet-10', names: /prophet[\s-]*(?:10|ten)(?![\w-])/i, ilike: ['%prophet-10%', '%prophet 10%', '%prophet10%', '%prophet ten%'] },
    { line: 'prophet-rev2', names: /prophet[\s-]*rev[\s.-]*2(?![\w-])|(?<![\w-])rev[\s-]?2(?![\w-])/i, ilike: ['%rev2%', '%rev 2%', '%rev-2%'] },
    { line: 'prophet-x', names: /prophet[\s-]*x(?![\w-])/i, ilike: ['%prophet x%', '%prophet-x%'] },
    { line: 'prophet-08', names: /prophet[\s-]*['’]?08(?![\w-])/i, ilike: ['%prophet 08%', "%prophet '08%", '%prophet-08%', '%prophet ’08%'] },
    { line: 'prophet-600', names: /prophet[\s-]*600(?![\w-])/i, ilike: ['%prophet 600%', '%prophet-600%', '%prophet600%'] },
    { line: 'prophet-2000', names: /prophet[\s-]*2000(?![\w-])/i, ilike: ['%prophet 2000%', '%prophet-2000%'] },
    { line: 'prophet-vs', names: /prophet[\s-]*vs(?![\w-])/i, ilike: ['%prophet vs%', '%prophet-vs%'] },
    { line: 'prophet-t8', names: /prophet[\s-]*t[\s-]?8(?![\w-])/i, ilike: ['%prophet t8%', '%prophet-t8%', '%prophet t-8%'] },
    { line: 'ob-6', names: /(?<![\w-])ob[\s-]?6(?![\w-])/i, ilike: ['%ob-6%', '%ob 6%', '%ob6%'] },
    { line: 'take-5', names: /take[\s-]*(?:5|five)(?![\w-])/i, ilike: ['%take 5%', '%take-5%', '%take5%', '%take five%'] },
    { line: 'trigon-6', names: /trigon/i, ilike: ['%trigon%'] },
    { line: 'pro-3', names: /(?<![\w-])pro[\s-]*3(?![\w-])/i, ilike: ['%pro 3%', '%pro-3%', '%pro3%'] },
    { line: 'pro-2', names: /(?<![\w-])pro[\s-]*2(?![\w-])/i, ilike: ['%pro 2%', '%pro-2%', '%pro2%'] },
    { line: 'pro-one', names: /(?<![\w-])pro[\s-]*(?:one|1)(?![\w-])/i, ilike: ['%pro-one%', '%pro one%', '%pro-1%', '%pro 1%'] },
    { line: 'drumtraks', names: /drum[\s-]*traks/i, ilike: ['%drumtraks%', '%drum traks%', '%drum-traks%'] },
    { line: 'six-trak', names: /six[\s-]*trak/i, ilike: ['%six-trak%', '%six trak%', '%sixtrak%'] },
    { line: 'mopho', names: /mopho/i, ilike: ['%mopho%'] },
    { line: 'evolver', names: /evolver/i, ilike: ['%evolver%'] },
    { line: 'tempest', names: /tempest/i, ilike: ['%tempest%'] },
    { line: 'tetra', names: /(?<![\w-])tetra(?![\w-])/i, ilike: ['%tetra%'] },
  ],
}

export default config
