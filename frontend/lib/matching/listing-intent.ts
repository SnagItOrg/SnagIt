/**
 * Non-product listing intent — deterministic, lexical, evidence-derived.
 *
 * THE PROBLEM: the matcher keys on brand + model tokens, and a listing for a
 * *part of* a product contains exactly the same tokens as the product itself.
 * "Fender Jazz Bass pickups" and "Juno 106 voice chips" both clear the brand
 * proof that lets a score-70 model match become trusted. A trusted row is
 * `is_valid=NULL`, which /api/product/[slug] and /intel treat as trusted
 * immediately — so a 400 DKK pickup set lands in the price evidence for a
 * 9,000 DKK bass. Deferring to a later AI/admin pass does not make that safe,
 * because the row is visible the moment it is written.
 *
 * EVIDENCE. Every token below was derived by enumerating the ~1,682 listings
 * that the matcher would otherwise have accepted as safe automatic matches
 * across the live DBA and Kleinanzeigen backlogs, then grouping the observed
 * false positives by lexical pattern. Tokens with zero observed hits
 * (ersatzteil, teile, knob/knap/knopf, poti, schrauben, platine) were
 * deliberately NOT included: this guard is limited to patterns the production
 * data actually demonstrates.
 *
 * RE-MEASURED 2026-08-29 against the 14 canonical public products (455
 * rendered rows). The German list was checked again and is STILL not adopted:
 * `ersatzteil`, `regler`, `knopf`, `schieberegler`, `abdeckung`, `platine`,
 * `schaltplan` and `reservedel` return **zero** hits, and `tasten` returns one
 * — a trade offer already rejected on other grounds. Accessory noise on this
 * cohort is 98% Reverb, and Reverb lists in English. Adding German tokens now
 * would be adopting a supplied list rather than deriving one, and every
 * unexercised token is a latent false rejection.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* A PART TOKEN
 *
 * Accessory-INCLUSION vocabulary — case, koffer, kasse, gigbag, zubehör,
 * tilbehør, box, manual, incl, inkl, with, med, mit — is absent by design.
 * A complete instrument sold WITH a case is a complete instrument.
 *   "Fender Jazz Bass with case"                  -> eligible
 *   "Fender Telecaster incl. Koffer und Zubehör"  -> eligible
 *   "Fender Jazz Bass pickups"                    -> deferred
 *
 * NO "COMPLETE INSTRUMENT NOUN" ESCAPE. An earlier draft exempted titles
 * containing guitar/gitarre/synthesizer. Measured against the real backlog it
 * rescued 6 genuine parts for every 4 genuine instruments — "Guitar Pickup,
 * Fender 1978 Stratocaster", "Fender Stratocaster elguitar hals" and
 * "E-Gitarre Pickup Set Org. Fender Stratocaster komplett" all escaped. The
 * escape was removed and this class now fails closed. The recall cost is
 * measured and accepted: complete instruments whose titles describe a neck or
 * body material ("...Roasted Maple Neck", "...Ash Body", "...Seymour Duncan
 * Pickups") are deferred rather than matched. Deferred writes NO ROW, so the
 * listing stays recoverable by a later run or by human review.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type NonProductIntent = 'part_or_accessory' | 'wanted_or_non_sale'

export interface IntentFinding {
  intent: NonProductIntent
  /** The literal token that fired, for auditability. */
  token: string
}

/**
 * Component/part vocabulary (en / da / de). A listing whose title names one of
 * these is offering the COMPONENT, not the instrument.
 *
 * Observed counts on the proposed-safe backlog at the time of derivation:
 *   pickup(s)/pickupper/picupper/tonabnehmer   DBA 16  KA 28
 *   neck / hals                                DBA 12  KA 22
 *   body / krop / korpus                       DBA  7  KA 13
 *   bridge / brücke / bro / sadel / saddle(s)  DBA  2  KA  5
 *   strings / saiten / strenge                 DBA  0  KA  4
 *   chip(s)                                    DBA  0  KA  1   ("Juno 106 voice chips")
 *   netzteil                                   DBA  0  KA  1
 */
const PART_TOKENS: readonly string[] = [
  // pickups
  'pickup', 'pickups', 'pickupper', 'picupper', 'tonabnehmer',
  // neck
  'neck', 'hals',
  // body
  'body', 'krop', 'korpus',
  // bridge / saddle
  'bridge', 'brücke', 'bruecke', 'bro', 'sadel', 'saddle', 'saddles',
  // strings
  'strings', 'saiten', 'strenge',
  // electronics
  'chip', 'chips', 'netzteil',
]

/**
 * ACCESSORY head-nouns — the second measured class, and the reason this file
 * needed a second mechanism rather than a longer PART_TOKENS list.
 *
 * Measured 2026-08-29 on the 14 canonical public products: 146 of 455 rendered
 * rows (32.1%) were already adjudicated `is_valid = false`, and the residual
 * trusted noise clusters on a small set of head-nouns — `cover` (7 rows),
 * `manual`, `cartridge(s)`, `replacement`, plus the slider/potentiometer/
 * bender/eprom family that dominates the adjudicated set on Juno-60, Juno-106,
 * Jupiter-8, TR-808 and TR-909.
 *
 * WHY THESE ARE NOT PART_TOKENS. A `PART_TOKEN` fires unconditionally, which is
 * right for `pickup` and `neck` — nobody sells a synthesizer *with* a spare
 * neck. It is wrong for these, because every one of them also appears in the
 * title of a COMPLETE instrument sold with the accessory:
 *
 *   "Roland SH-101 cover"                                        -> accessory
 *   "SJÆLDEN BLÅ Roland SH-101 - Nyserviceret & inkl. Original Manual" -> product
 *   "Korg MS-20 Mini keyboard cover"                             -> accessory
 *   "Yamaha DX7 - Komplett med Flightcase, ROM-kassetter och manual" -> product
 *
 * The second and fourth are real listings at real prices; rejecting them would
 * remove exactly the bargains Klup exists to surface. Price cannot separate
 * them either — the SH-101 above is 7,500 DKK against a ~15,000 DKK band, which
 * is what an unusually cheap genuine instrument looks like.
 *
 * DELIBERATELY EXCLUDED, each because a measured full-product title uses it:
 *   knob      "Emu SP1200 ... Big Knobs w/case", "Voyager ... GOLD KNOB"
 *   psu       "TR-606 Drumatix plus Roland Silver Case & PSU"
 *   adapter   "Roland Juno 60 + midi adapter +psu"
 *   spare     "Roland RE-501 Chorus Echo - Spare Tapes - Pro Serviced"
 *   grip      "Roland SH-101 RED + Modulation Grip", "...+ handgrip"
 *   parts     "Roland TR-909 ... BAD SHAPE For Parts / Repair" is a whole unit
 *   key(s)    "61-Key", "64-Key" appear in most full-product titles
 * The narrow compound `modgrip` IS included: it names the accessory itself.
 */
const ACCESSORY_TOKENS: readonly string[] = [
  'cover',
  'manual',
  'cartridge', 'cartridges',
  'replacement',
  'slider', 'sliders',
  'potentiometer', 'poti',
  'bender',
  'eprom', 'eproms',
  'modgrip',
]

/**
 * Inclusion markers — the vocabulary that turns "an accessory" into "a product
 * sold with an accessory".
 *
 * POSITION IS THE WHOLE RULE. A marker suppresses an accessory token only when
 * it appears EARLIER in the title, because that is what distinguishes the two
 * readings:
 *
 *   "Yamaha DX7 inkl Case, Cover, Cartridges"   inkl(11) < cover(24)  -> product
 *   "Casio RZ-1 SOUND KIT EPROM with Sp12..."   eprom(21) > with(27)  -> accessory
 *
 * A global "does the title contain 'with'?" test gets the second one wrong: the
 * EPROM is the head noun and `with` merely lists what it is compatible with.
 * Requiring the marker to precede the accessory noun costs one index comparison
 * and is the difference between a rule and a guess.
 *
 * Pure conjunctions — `og`, `och`, `und`, `and` — are NOT markers. They join
 * two accessories as readily as a product and an accessory, and treating them
 * as inclusion would have retained "Yamaha DX7 original operators manual og
 * performance notes", which is an accessory-only listing.
 */
const INCLUSION_MARKERS: readonly string[] = [
  'inkl', 'inkl.', 'incl', 'incl.', 'including', 'included',
  'with', 'w/', 'med', 'mit', 'con',
  'komplett', 'komplet', 'complete', 'fullt', 'full set',
  'plus', '+', '&',
]

/**
 * Index of the earliest inclusion marker, or -1.
 *
 * `+`, `&` and `w/` are matched literally because they are punctuation, not
 * words; the rest are matched on word boundaries so `medium` is not `med` and
 * `within` is not `with`.
 */
function earliestInclusionMarker(text: string): number {
  let earliest = -1
  for (const marker of INCLUSION_MARKERS) {
    let idx: number
    if (/^[+&]$/.test(marker) || marker === 'w/') {
      idx = text.indexOf(marker)
    } else {
      const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = new RegExp(`(?<![\\w-])${escaped}`, 'i').exec(text)
      idx = m ? m.index : -1
    }
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx
  }
  return earliest
}

/** Index of a whole-word token, or -1. Same boundary rule as `containsWord`. */
function wordIndex(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').exec(text)
  return m ? m.index : -1
}

/**
 * `pickup` in its SHIPPING sense is not a part.
 *
 * Found by the dry run for this change, not by inspection: "Roland TR-909
 * tr909 Rhythm Composer Drum Machine 1984 - Local Pickup Only" is a complete
 * TR-909 at 48,144 DKK, deferred because `pickup` is a PART_TOKEN. Measured
 * across all active listings: 409 titles contain `pickup`, and **48 of them
 * mean collection in person** — Memorymoog at 73,824 DKK, an LM-1 at 119,406
 * DKK, a Rhodes Mark II 73 at 13,803 DKK on a canonical product. Every one was
 * being refused as a guitar pickup.
 *
 * The phrase forms are fixed and unambiguous, so the exception is a phrase
 * test rather than a weakening of the token: `pickup` on its own still defers.
 */
const PICKUP_SHIPPING_PHRASES: readonly RegExp[] = [
  /local\s*pick[\s-]?up/i,
  /pick[\s-]?up\s*only/i,
]

function isShippingPickup(text: string): boolean {
  return PICKUP_SHIPPING_PHRASES.some((re) => re.test(text))
}

/**
 * Wanted / non-sale intent (da / de / en). The listing is a request TO BUY,
 * not an offer to sell, so it is not evidence of a price at all.
 *
 * Observed: DBA 2 (`SØGER`, `SØGES`), Kleinanzeigen 16 (`Suche`, `SUCHE:`,
 * `[Suche]`, `gesucht`).
 */
const WANTED_TOKENS: readonly string[] = [
  // Danish
  'søges', 'soges', 'søger', 'soger', 'købes', 'kobes', 'ønskes', 'onskes', 'efterlyses',
  // German
  'suche', 'suchen', 'gesucht',
  // English
  'wanted', 'wtb',
]

/**
 * Explicit offer markers that override a wanted token.
 *
 * Evidence: exactly one observed listing —
 *   "BIETE: Korg MS-20 Vintage (IC35 / OTA) --> SUCHE: Synthesizer"
 * — is an OFFER of the MS-20 that also states what the seller wants in trade.
 * Kept deliberately minimal; `tausch` is NOT an offer marker and is NOT a
 * wanted marker, because "Tausch möglich" appears on ordinary sales.
 */
const OFFER_MARKERS: readonly string[] = ['biete']

/**
 * Word-boundary token test. `-` and `_` count as word characters so a token
 * cannot fire inside a hyphenated compound, and a model name containing one of
 * these strings as a substring is never affected:
 *   "Bassbreaker"  does not match `bass`
 *   "Bridgeport"   does not match `bridge`
 *   "Chipset"      does not match `chip`
 */
function containsWord(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(text)
}

/**
 * Returns the first non-product signal in `title`, or null when the title
 * reads as an offer of the complete product.
 *
 * Precedence: wanted/non-sale is checked first — a request to buy a pickup is
 * reported as `wanted_or_non_sale`, which is the more fundamental reason the
 * listing is not price evidence.
 */
export function detectNonProductIntent(title: string): IntentFinding | null {
  const text = title.toLowerCase()

  const hasOfferMarker = OFFER_MARKERS.some((m) => containsWord(text, m))
  if (!hasOfferMarker) {
    for (const token of WANTED_TOKENS) {
      if (containsWord(text, token)) return { intent: 'wanted_or_non_sale', token }
    }
  }

  const shippingPickup = isShippingPickup(text)
  for (const token of PART_TOKENS) {
    if (shippingPickup && (token === 'pickup' || token === 'pickups')) continue
    if (containsWord(text, token)) return { intent: 'part_or_accessory', token }
  }

  // Accessory head-nouns, suppressed by an inclusion marker that PRECEDES them.
  // Checked after PART_TOKENS so the unconditional class keeps its exact
  // previous behaviour and reports the same token.
  const markerAt = earliestInclusionMarker(text)
  for (const token of ACCESSORY_TOKENS) {
    const at = wordIndex(text, token)
    if (at === -1) continue
    if (markerAt !== -1 && markerAt < at) continue
    return { intent: 'part_or_accessory', token }
  }

  return null
}
