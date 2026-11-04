/**
 * scripts/rematch-configs/pan320-roland-vt-vp.ts — PAN-320, the Roland voice transformers and the Boutique vocoder: the 4
 * rows the PAN-320 promote file moves from `known` to `supported`, and the 4 VP rows already supported, with their
 * LINE_BOUNDARIES entries. The Boss VT-1 existed as `known` with no model name (the PAN-320 identity file gives it "VT-1");
 * the create file adds the Roland VT-3, VT-4 and VP-03. The owner's "VP-303, VP-505, VP-707" are no Roland models: the
 * vocoders are the VP-330, VP-550 and VP-770 (and the VP-9000 VariPhrase), all supported before this ticket.
 *
 * Today's unmatched cohort (production, 2026-11-04): about 20 Reverb and DBA titles that name a VT; Roland and Boss are in
 * the DBA brand net.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-320',
  pan: 'pan320',
  brand: 'the Roland VT voice transformers and the VP-03 (PAN-320)',

  /** No family, so no held cohort. */
  labels: [],

  /** The rows the PAN-320 promote file moves from `known` to `supported`, verbatim. */
  promoted: ['boss-vt-1-voice-transformer', 'roland-vt-3', 'roland-vt-4', 'roland-vp-03'],

  /** Supported before the ticket; the VP-330 boundary now refuses the Boutique and the VP-03. */
  supportedToday: ['roland-vp-330', 'roland-vp-550', 'roland-vp-770', 'roland-vp-9000'],

  /** The unmatched cohort: active titles that name a VT or a VP. */
  lines: [
    { line: 'vt', names: /(?<![a-z0-9])vt[-\s]?[134](?![0-9])/i, ilike: ['%vt-1%', '%vt-3%', '%vt-4%', '%vt1%', '%vt3%', '%vt4%'] },
    { line: 'vp', names: /(?<![a-z0-9])vp[-\s]?(?:03|330|550|770|9000)(?![0-9])/i, ilike: ['%vp-03%', '%vp03%', '%vp-330%', '%vp330%', '%vp-550%', '%vp-770%', '%vp-9000%'] },
  ],
}

export default config
