/**
 * scripts/rematch-configs/pan302-telefunken-neumann.ts — PAN-302, the microphones: Telefunken (the AKG-built vintage
 * ELA M 250 / 251 and Telefunken Elektroakustik's reissues and own lines) and the Neumann classics, with the Neumanns
 * sold under the Telefunken badge. The 31 rows the PAN-302 promote file moves from `known` to `supported`, with their
 * LINE_BOUNDARIES entries:
 *   - 18 Telefunken rows: `telefunken-ela-m-251` (known since PAN-230; the PAN-302 create file moves it to Reverb's
 *     vintage 251E page) and 17 the create file adds — the ELA M 251E, U47, C12 and ELA M 260 reissues, the R-F-T
 *     AK-47, AR-51 and M16, the Alchemy TF11, TF17, TF29, TF39, TF47 and TF51, the M80, M81 and M82 dynamics, the M60;
 *   - 13 Neumann rows: 8 the create file adds (M 149, M 49, M 49 V, U 89, TLM 170, KM 86, KM 54, KM 56) and 5 listing-
 *     title rows the identity file re-anchors as model rows (M 147, KU 100, TLM 67, BCM 705, V 402).
 * Price decides identity (Reverb's sold population, 2026-10-26): the vintage ELA M 251 (~$20–35k) and the 251E
 * ($10,800) are two rows; the U 48 is the U 47's row on either side (vintage ~$13k / ~$15k, reissue ~$8,500 / ~$8,000);
 * the M 49 V ($7,200) is not the M 49 ($11,000); the KM 53 (n = 4) is the KM 54's row; the TF29 is the CU-29 renamed.
 * Two navigation families: `telefunken-ela-m-251-condenser` and `telefunken-alchemy`.
 *
 * Re-decided too: the Neumann U 47 (its boundary now requires Neumann or a vintage word, and refuses the Elektroakustik
 * reissue, the fet spellings and the parts trade; "U48" is its identifier) and both U 67 rows (a TLM 67 is refused;
 * "Telefunken U67" reaches the vintage U 67 through its alias).
 *
 * The unmatched cohort: production holds few Telefunken microphone titles today (the Reverb sweep queries kg rows only,
 * so the new rows hold no Reverb title until the first sweep after the promotion; DBA had a TF29 and a "Telefunken U47
 * AE" on 2026-10-26), and every Neumann title, as the PAN-202 config reads them.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-302',
  pan: 'pan302',
  brand: 'Telefunken and the Neumann classics — the microphones (PAN-302)',

  /** The two families are navigation families with no row, so no held cohort. */
  labels: [],

  /** The rows the PAN-302 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // The ELA M 251: the vintage original (existing row) and the Elektroakustik reissue.
    'telefunken-ela-m-251', 'telefunken-ela-m-251e',
    // Telefunken Elektroakustik's other reissues.
    'telefunken-u47', 'telefunken-c12', 'telefunken-ela-m-260',
    // R-F-T.
    'telefunken-ak-47', 'telefunken-ar-51', 'telefunken-m16',
    // The telefunken-alchemy family.
    'telefunken-tf11', 'telefunken-tf17', 'telefunken-tf29', 'telefunken-tf39', 'telefunken-tf47', 'telefunken-tf51',
    // The dynamics and the M60.
    'telefunken-m80', 'telefunken-m81', 'telefunken-m82', 'telefunken-m60',
    // Neumann: the eight rows the create file adds, then the five re-anchored title rows.
    'neumann-m-149', 'neumann-m-49', 'neumann-m-49-v', 'neumann-u89', 'neumann-tlm-170', 'neumann-km-86', 'neumann-km-54',
    'neumann-km-56',
    'neumann-m-147', 'neumann-ku-100', 'neumann-tlm-67', 'neumann-bcm-705', 'neumann-v-402',
  ],

  /** Supported before the ticket; their boundaries or aliases change. */
  supportedToday: ['neumann-u47', 'neumann-u67', 'neumann-u67-reissue'],

  /** The unmatched cohort: active titles that name either maker. */
  lines: [
    { line: 'telefunken', names: /telefunken/i, ilike: ['%telefunken%'] },
    { line: 'neumann', names: /neumann/i, ilike: ['%neumann%'] },
  ],
}

export default config
