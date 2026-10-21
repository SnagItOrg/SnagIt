/**
 * scripts/rematch-configs/pan280-boutique-pedals.ts — PAN-280, boutique pedals: the 68 rows the PAN-280 promote file
 * moves from `known` to `supported` (3 Strymon rows that existed as `known` since 2026-04/09 and are anchored to their
 * Reverb page by the identity file, 65 created on 2026-10-20 with a verified Reverb page each), with their
 * LINE_BOUNDARIES entries. One config across three brands because the pass is one ticket; the lines are the brand words,
 * because a pedal title names its brand and its model and little else.
 *
 * Today's unmatched cohort: 22 active DBA titles name Strymon or EarthQuaker (the DBA brand net holds `strymon` only;
 * `earthquaker-devices` and `hologram-electronics` join it by an owner decision on the ticket), 2 Finn, 333 + 51
 * Reverb. The dry run shows the Strymon rows taking their first local titles.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-280',
  pan: 'pan280',
  brand: 'Boutique pedals (PAN-280)',

  /** No family label rows, so no held cohort. */
  labels: [],

  /** The rows the PAN-280 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    // Strymon: the three rows that existed as `known` (anchored by the identity file) and the 22 created.
    'strymon-big-sky', 'strymon-nightsky', 'strymon-timeline',
    'strymon-bigsky-mx', 'strymon-timeline-mx', 'strymon-volante', 'strymon-iridium', 'strymon-mobius',
    'strymon-el-capistan', 'strymon-flint', 'strymon-deco', 'strymon-dig', 'strymon-bluesky', 'strymon-lex',
    'strymon-ola', 'strymon-brigadier', 'strymon-orbit', 'strymon-riverside', 'strymon-sunset', 'strymon-compadre',
    'strymon-cloudburst', 'strymon-zelzah', 'strymon-ultraviolet', 'strymon-ob-1', 'strymon-fairfax',
    // EarthQuaker Devices: 41 rows.
    'earthquaker-devices-plumes', 'earthquaker-devices-life-pedal', 'earthquaker-devices-avalanche-run',
    'earthquaker-devices-rainbow-machine', 'earthquaker-devices-afterneath', 'earthquaker-devices-dispatch-master',
    'earthquaker-devices-hoof', 'earthquaker-devices-hoof-reaper', 'earthquaker-devices-hizumitas',
    'earthquaker-devices-pyramids', 'earthquaker-devices-westwood', 'earthquaker-devices-palisades',
    'earthquaker-devices-ghost-echo', 'earthquaker-devices-spatial-delivery', 'earthquaker-devices-bit-commander',
    'earthquaker-devices-data-corrupter', 'earthquaker-devices-sea-machine', 'earthquaker-devices-grand-orbiter',
    'earthquaker-devices-arpanoid', 'earthquaker-devices-organizer', 'earthquaker-devices-special-cranker',
    'earthquaker-devices-arrows', 'earthquaker-devices-astral-destiny', 'earthquaker-devices-silos',
    'earthquaker-devices-aurelius', 'earthquaker-devices-the-warden', 'earthquaker-devices-zoar',
    'earthquaker-devices-blumes', 'earthquaker-devices-park-fuzz', 'earthquaker-devices-erupter',
    'earthquaker-devices-acapulco-gold', 'earthquaker-devices-tone-job', 'earthquaker-devices-hummingbird',
    'earthquaker-devices-swiss-things', 'earthquaker-devices-talons', 'earthquaker-devices-aqueduct',
    'earthquaker-devices-bellows', 'earthquaker-devices-dirt-transmitter', 'earthquaker-devices-the-depths',
    'earthquaker-devices-fuzz-master-general', 'earthquaker-devices-levitation',
    // Hologram Electronics: the two the owner named.
    'hologram-electronics-microcosm', 'hologram-electronics-chroma-console',
  ],

  /** No pedal row of these brands was supported before the ticket. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name one of the three brands, in the forms sellers write. */
  lines: [
    { line: 'strymon', names: /strymon/i, ilike: ['%strymon%'] },
    { line: 'earthquaker', names: /earth\s?quaker|(?<![a-z])eqd(?![a-z])/i, ilike: ['%earthquaker%', '%earth quaker%', '%eqd %', '%eqd-%'] },
    { line: 'hologram', names: /hologram/i, ilike: ['%hologram%'] },
  ],
}

export default config
