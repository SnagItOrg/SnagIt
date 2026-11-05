/**
 * scripts/rematch-configs/pan315-sp-dr.ts — PAN-315, the Roland SP samplers and the Boss DR drum machines: the 12 rows
 * the PAN-315 promote file moves from `known` to `supported`, and the 5 supported rows its identity file re-anchors,
 * with their LINE_BOUNDARIES entries. Three Boss rows exist as `known` since the KG import (SP-202, SP-303, SP-505);
 * the PAN-315 create file adds the Roland SP-555 and SP-606 and the Boss DR-550, DR-660, DR-670, DR-770, DR-880, DR-3
 * and DR-5. The DR-55, DR-110 (the public `boss-dr-110-dr-rhythm`), DR-220 and DR-202 rows were supported and public
 * with no model name, so they never matched; the identity file gives them their code. Price decides identity (Reverb's
 * sold population, 2026-11-02): the SP-808EX (+9 %), the DR-220A / DR-220E (+5 %) and the DR-550 MkII (+21 %) are their
 * base row's. Three navigation families: `boss-dr`, `boss-sp` and `roland-sp`.
 *
 * Today's unmatched cohort (production, 2026-11-02): ~195 Reverb and DBA titles that name one of these units, and
 * about 60 power supplies, knobs, switches, cards, manuals and multi-model part lists, which the boundaries refuse or
 * the intent layer defers. A title that names Roland on a Boss row ("Roland SP-505") defers as a brand mismatch.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-315',
  pan: 'pan315',
  brand: 'the Roland SP samplers and the Boss DR drum machines (PAN-315)',

  /** The three families are navigation families with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-315 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // The boss-sp family.
    'boss-sp-202-dr-sample', 'boss-sp-303-dr-sample', 'boss-sp-505',
    // The roland-sp family.
    'roland-sp-555', 'roland-sp-606',
    // The boss-dr family.
    'boss-dr-550', 'boss-dr-660', 'boss-dr-670', 'boss-dr-770', 'boss-dr-880', 'boss-dr-3', 'boss-dr-5',
  ],

  /** Supported before the ticket; the identity file gives the four DR rows their model name and the SP-808 its EX. */
  supportedToday: ['roland-sp-808', 'boss-dr-55-dr-rhythm', 'boss-dr-110-dr-rhythm', 'boss-dr-220-dr-rhythm', 'boss-dr-202-dr-groove'],

  /** The unmatched cohort: active titles that name a line, in the forms sellers write. */
  lines: [
    { line: 'sp', names: /(?<![a-z0-9])sp[-\s]?(?:202|303|505|555|606|808)(?![0-9])/i, ilike: ['%sp-202%', '%sp202%', '%sp-303%', '%sp303%', '%sp-505%', '%sp505%', '%sp-555%', '%sp555%', '%sp-606%', '%sp606%', '%sp-808%', '%sp808%', '%sp 808%'] },
    { line: 'dr', names: /(?<![a-z0-9])dr[-\s]?(?:55|110|220|550|660|670|770|880|202|3|5)(?![0-9])/i, ilike: ['%dr-55%', '%dr55%', '%dr-110%', '%dr 110%', '%dr-220%', '%dr220%', '%dr-550%', '%dr-660%', '%dr660%', '%dr-670%', '%dr-770%', '%dr770%', '%dr-880%', '%dr-202%', '%dr-3 %', '%dr-5 %', '%dr. rhythm%', '%dr. groove%', '%dr. sample%'] },
  ],
}

export default config
