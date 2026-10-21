/**
 * scripts/rematch-configs/pan291-oto-ensoniq.ts — PAN-291, Oto Machines and the Ensoniq samplers and outboard: the 17
 * rows the PAN-291 promote file moves from `known` to `supported`, with their LINE_BOUNDARIES entries. Seven Ensoniq
 * rows exist since the KG import (ASR-10, ASR-X, ASR-X Pro, EPS, EPS-16 Plus, Mirage DSK-8, Mirage DSK-1); the
 * PAN-291 create file adds the EPS-16 Plus rack, the Mirage DMS-8 / DMS-1 rack, the DP/2, DP/4 and DP/4+ and the five
 * OTO Machines rows (Biscuit, BIM, BAM, BOUM, Bébé Chérie) with the new kg_brand oto-machines. Price decides identity
 * (Reverb's sold population, 2026-10-21): the ASR-10 keyboard and rack are one row, the EPS-16 Plus keyboard and rack
 * two, the DP/4 and DP/4+ two. The DP/4+ and the Bébé Chérie have no Reverb page and carry their sold evidence
 * instead. Four navigation families: `ensoniq-asr-sampler`, `ensoniq-eps-sampler`, `ensoniq-mirage-sampler` and
 * `ensoniq-dp-effects`.
 *
 * Today's unmatched cohort: ~650 Reverb Ensoniq titles, about 60 % of them disks, OS EPROMs, emulators, expanders and
 * parts, which the boundaries refuse; one DBA Oto ad and three DBA Ensoniq EPS ads, neither brand being in the DBA
 * net. The DP and Oto rows hold no Reverb title yet, because the Reverb sweep queries kg rows only: they wait for the
 * first sweep.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-291',
  pan: 'pan291',
  brand: 'Oto Machines and the Ensoniq samplers and outboard (PAN-291)',

  /** The four families are navigation families with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-291 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // The ensoniq-asr-sampler family.
    'ensoniq-asr-10', 'ensoniq-asr-x', 'ensoniq-asr-x-pro',
    // The ensoniq-eps-sampler family.
    'ensoniq-eps', 'ensoniq-eps-16-plus', 'ensoniq-eps-16-plus-rack',
    // The ensoniq-mirage-sampler family.
    'ensoniq-mirage-dsk-8', 'ensoniq-mirage-dsk-1', 'ensoniq-mirage-dms-8',
    // The ensoniq-dp-effects family.
    'ensoniq-dp-4', 'ensoniq-dp-4-plus', 'ensoniq-dp-2',
    // OTO Machines: no family.
    'oto-machines-biscuit', 'oto-machines-bim', 'oto-machines-bam', 'oto-machines-boum', 'oto-machines-bebe-cherie',
  ],

  /** No Ensoniq or Oto Machines row was supported before the ticket. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name a line, in the forms sellers write. */
  lines: [
    { line: 'asr', names: /(?<![a-z])asr[-\s]?(?:10|x)/i, ilike: ['%asr-10%', '%asr 10%', '%asr10%', '%asr-x%', '%asr x%', '%asrx%'] },
    { line: 'eps', names: /(?<![a-z])eps(?![a-z])/i, ilike: ['%ensoniq%eps%', '%eps%ensoniq%'] },
    { line: 'mirage', names: /(?<![a-z])(?:dsk|dms)[-\s]?[18]|mirage/i, ilike: ['%ensoniq%mirage%', '%dsk-8%', '%dsk-1%', '%dms-8%', '%dms-1%'] },
    { line: 'dp', names: /(?<![a-z])dp\s?[/-]?\s?[24]/i, ilike: ['%dp/4%', '%dp-4%', '%dp4%', '%dp/2%', '%dp-2%', '%dp2%'] },
    { line: 'oto', names: /(?<![a-z])oto(?![a-z])/i, ilike: ['%oto machines%', '%oto bim%', '%oto bam%', '%oto boum%', '%oto biscuit%'] },
  ],
}

export default config
