/**
 * scripts/rematch-configs/pan321-vocoders.ts — PAN-321, the vocoders of other makers: the 15 rows the PAN-321 promote file
 * moves from `known` to `supported`, with their LINE_BOUNDARIES entries. The Korg VC-10, DVP-1, microKORG and microKORG XL
 * existed as `known` (the identity file names the DVP-1); the create file adds the microKORG S and microKORG 2, the
 * DigiTech Talker, and the TC Helicon VoiceLive 2, 3, 3 Extreme, Play, Play GTX, Touch, Touch 2 and Rack, on the two
 * kg_brand rows the PAN-321 brands file adds. Price decides identity (Reverb's sold population, same year): the
 * VoiceLive 2 Extreme and microKORG XL+ are their row's; the microKORG S, 3 Extreme, Play GTX and Touch 2 are not.
 *
 * Today's unmatched cohort (production, 2026-11-04): about 140 Reverb and 10 DBA titles that name a microKORG, VC-10 or
 * DVP-1; DigiTech and TC Helicon have no brand row yet, so no title of theirs is in production as theirs.
 */

import type { RematchConfig } from '../rematch-brand'

const config: RematchConfig = {
  ticket: 'PAN-321',
  pan: 'pan321',
  brand: 'the Korg, DigiTech and TC Helicon vocoders (PAN-321)',

  /** No family, so no held cohort. */
  labels: [],

  /** The rows the PAN-321 promote file moves from `known` to `supported`, verbatim. */
  promoted: [
    'korg-vc-10', 'korg-dvp-1', 'korg-microkorg', 'korg-microkorgxl', 'korg-microkorg-s', 'korg-microkorg-2',
    'digitech-talker',
    'tc-helicon-voicelive-2', 'tc-helicon-voicelive-3', 'tc-helicon-voicelive-3-extreme', 'tc-helicon-voicelive-play',
    'tc-helicon-voicelive-play-gtx', 'tc-helicon-voicelive-touch', 'tc-helicon-voicelive-touch-2', 'tc-helicon-voicelive-rack',
  ],

  /** Supported before the ticket: none. */
  supportedToday: [],

  /** The unmatched cohort: active titles that name one of these vocoders. */
  lines: [{
    line: 'vocoders',
    names: /micro\s?korg|vc[-\s]?10(?![0-9])|dvp[-\s]?1(?![0-9])|talker|voice\s?live/i,
    ilike: ['%microkorg%', '%micro korg%', '%vc-10%', '%vc10%', '%dvp-1%', '%talker%', '%voicelive%', '%voice live%'],
  }],
}

export default config
