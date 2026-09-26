/**
 * Non-product listing intent — deterministic, lexical, evidence-derived.
 *
 * THE PROBLEM: the matcher keys on brand + model tokens, and a listing for a
 * *part of* a product contains exactly the same tokens as the product itself.
 * "Fender Jazz Bass pickups" and "Juno 106 voice chips" both clear the brand
 * proof that lets a score-70 model match become trusted. Such a row is written
 * `is_valid=NULL`, which /api/product/[slug] and /intel SHOW on the wall the
 * moment it exists — so a 400 DKK pickup set appears under a 9,000 DKK bass.
 * Since PAN-93 it cannot reach a median (`isPriceEvidence` in
 * lib/price-populations), but it is still visible immediately, so deferring to
 * a later AI/admin pass does not make writing it safe.
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
 * EXTENDED 2026-09-20 (PAN-96) to the supported GUITAR cohort, which no
 * previous measurement covered: the 14 canonical products of the paragraph
 * above are synths, drum machines and studio gear. One token was derived —
 * `pickguard` — and it needed a mechanism neither existing class provides. The
 * counts, the exclusions and the reasoning are with ACCESSORY_TOKENS below.
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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GUITARS — measured 2026-09-20 (PAN-96). `pickguard` is the whole addition.
 *
 * The 2026-08-29 cohort was 14 canonical public products: synthesizers, drum
 * machines, electric pianos and studio gear. No guitar was in it, so no guitar
 * vocabulary was ever derived. Re-measured against the SUPPORTED guitar cohort
 * — 17 active+supported rows under `acoustic-guitars/`, `bass-guitars/` and
 * `electric-guitars/` that hold matches, 3,016 rows, 1,110 of them unreviewed
 * and therefore trusted downstream:
 *
 *   pickguard     189 rows   188 adjudicated false,   1 true
 *   fingerboard    96 rows     6 false,              31 true
 *   fretboard      11 rows     0 false,               5 true
 *   humbucker       6 rows     4 false,               0 true
 *   tuner           4 rows     4 false,               0 true  (ONE distinct title)
 *   knob/knobs      3 rows
 *   pots            2 rows
 *   truss rod / fret(s) / tremolo / strap / inlay / logo / sticker /
 *   harness / control plate / screws                1–2 rows each
 *   scratchplate / slagbræt / schlagbrett / machine head / mechaniken /
 *   whammy / tailpiece / capo / plectrum / binding  0 rows
 *
 * One token clears the bar by two orders of magnitude. The rest are the noise
 * floor, and several are refused on evidence rather than on volume:
 *
 *   fingerboard  "FENDER - Jim Root Jazzmaster Ebony Fingerboard Flat Black
 *                 - 0115300706"                     15,102 DKK, complete
 *   fretboard    "Fender Mustang Bass 1978 Maple Fretboard Blonde"
 *                                                   18,365 DKK, complete
 *   humbucker    "1996 Gibson ES-335 Dot - Figured Vintage Sunburst | USA Good
 *                 Wood Era Semi-Hollow 57 Classic Humbucker | OHSC"
 *                                                   27,288 DKK, complete
 *   knob(s)      "...Jaguar Black w/ Anodized Pickguard, Buzz Stop Bar, Hat
 *                 Knobs LIMITED MODEL"               8,053 DKK, complete
 *                 (already excluded on synth evidence above; the guitar cohort
 *                  agrees rather than adding a new reason)
 *   pots         both observed rows already fire on the `pickup` PART_TOKEN,
 *                so the token would add no coverage and only new risk
 *   tuner        4 rows are 3 duplicates of one part listing. One distinct
 *                title is an observation, not a pattern.
 *   pickguards   1 row  — "Fender Pickguard Standard Jazz Bass Black 3-Ply -
 *                Pickguards for Bass". It contains the SINGULAR too, so the
 *                plural adds zero coverage.
 *   scratchplate 1 row  — "Custom Pickguard for Fender Precision Bass – Unique
 *                Guitar Laser Engraved Wooden Scratchplate". Same: the
 *                singular `pickguard` already catches it.
 *
 * WHY `pickguard` IS AN ACCESSORY TOKEN AND NOT A PART TOKEN. A part token
 * fires unconditionally, and genuine complete guitars name a pickguard as a
 * feature they are sold WITH:
 *
 *   "Gibson Les Paul (Murphy Lab / Heavy Aged) « Green Lemon Faded » 70th
 *    anniversary of the Les Paul Model with signed pickguard by Les Paul"
 *                                                  78,098 DKK -> product
 *   "Gibson Custom Shop Paul Jackson Jr. CS-346 Semi-Hollow Honeyburst
 *    w/ OHSC & Pickguard"                          26,213 DKK -> product
 *   "Custom Pickguard For Fender Telecaster Custom Built Billie Joe Armstrong
 *    - Black/White/Black .090\""                       ~300 DKK -> accessory
 *
 * The inclusion-marker rule below separates the first two from the third on
 * `with` and `w/`, exactly as it does for `cover` and `manual`.
 * ─────────────────────────────────────────────────────────────────────────
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
  'pickguard',
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
  'inkl', 'inkl.', 'incl', 'incl.', 'including', 'included', 'includes', 'inklusive',
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
 *
 * BOTH boundaries (PAN-151 round 2). Until then only the left one was tested,
 * so a marker fired as the PREFIX of any word: `con` in "Control", "Condition",
 * "Condenser"; `med` in "Medallion"; `mit` in "MITSUBISHI"; `with` in
 * "without". Measured over all 116,229 production titles against the supported
 * index, 2 matched decisions change and 11,054 are identical. Both changes are
 * "Roland TR-909 MITSUBISHI EPROM V4.0 latest firmware upgrade", a chip, now
 * deferred. 36 intent findings change:
 *   - 31 now defer correctly — covers, manuals, sliders, potentiometers and
 *     EPROMs such as "… CONTROL FX - New Rotary potentiometer" and "Black
 *     Plastic Control Cavity Cover Back Plate for Gibson SG";
 *   - `includes` and `inklusive` had been markers only by that accident, so
 *     they are now named. Without them five complete instruments would defer,
 *     two of them matched: "Yamaha DX7 … - Includes Original RAM Cartridge",
 *     "*Includes ROM3 Cartridge* Yamaha DX7 …", "Yamaha DX7S Synthesizer
 *     Inklusive Sound Cartridge", "Roland Fantom-X8 … (includes … keyboard
 *     cover)", "Elektron Digitone 1 - includes … dust cover";
 *   - MEASURED RECALL COST, ACCEPTED: five complete instruments were retained
 *     only because "Condition" or "Controller" preceded the noun, and now
 *     defer: "Waldorf micro Q - … - Excellent Condition - Manual", "Alesis ion
 *     - … Excellent Condition - Original Case - Manual", "Korg micro X
 *     Synthesizer Controller - … - Manual", "Novation FLkey 37 MIDI Keyboard
 *     Controller [DUST COVER INCLUDED!]" and "Teenage Engineering OP-Z
 *     Synthesizer - Good condition, replacement power knob". None is a
 *     supported product, and deferral writes no row.
 */
export function earliestInclusionMarker(text: string): number {
  let earliest = -1
  for (const marker of INCLUSION_MARKERS) {
    let idx: number
    if (/^[+&]$/.test(marker) || marker === 'w/') {
      idx = text.indexOf(marker)
    } else {
      const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').exec(text)
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
 * `<colour> pickguard` is a SPECIFICATION, not a head noun.
 *
 * THE INCLUSION-MARKER RULE IS NOT SUFFICIENT HERE, and this is the only place
 * in the file where that is true. 76 already-approved listings priced
 * 3,491–4,725 DKK name the pickguard as one item in a comma- or dash-separated
 * spec list, with no marker anywhere before it:
 *
 *   "Fender Standard Precision Bass, Laurel Fingerboard, White Pickguard, Black"
 *   "Fender Standard Jazz Bass, Maple Fingerboard, Black Pickguard, Black"
 *   "FENDER Standard Stratocaster HSS, Laurel Fingerboard, Black Pickguard, Black"
 *
 * These survived the 2026-09-20 sweep only because it was scoped to
 * `is_valid IS NULL` and they were already `true`. Without this exception the
 * next unreviewed listing of that shape — a stock Fender catalogue title, the
 * single most common complete-guitar title form on Reverb — is refused.
 *
 * THE COLOUR LIST IS MEASURED, NOT SUPPLIED. Grouping every pickguard listing
 * in the match pool by the word immediately preceding the noun:
 *
 *   white pickguard        57 true    1 false
 *   black pickguard        19 true    0 false
 *   tortoise pickguard      0 true    2 false
 *   parchment pickguard     0 true    1 false
 *   custom pickguard        0 true  237 false
 *   guitar pickguard        0 true   27 false
 *   bevel pickguard         0 true   15 false
 *
 * 57 + 19 = the whole genuine class. `tortoise` and `parchment` are colours
 * too, and every observed listing that uses them is a part — a stock instrument
 * ships white or black, and a replacement guard is where the exotic finishes
 * live. Adopting them because they are "also colours" would be adopting a
 * supplied list rather than deriving one, which this file refuses elsewhere.
 *
 * `/` IS A BOUNDARY, deliberately. A ply stack is not a colour name:
 *   "Epiphone SG Traditional Pro 3 Ply White/Black/White Pickguard"  -> accessory
 * `wordIndex` treats `-` and `_` as word characters but not `/`, so without
 * this the trailing `White` would read as a specification. The one false
 * negative of the whole rule is the sole `white pickguard` row adjudicated
 * false — "Fender Standard Jazz Bass White Pickguard 3-Color Sunburst" at
 * 4,436 DKK, which is the same title shape and the same price as 30+ of its
 * approved siblings and was rejected by hand with "This is a listing for a
 * pickguard accessory, not the actual bass guitar." That row is an adjudication
 * inconsistency, not a counter-example, and is the reason to prefer a rule.
 *
 * MEASURED RECALL COST, ACCEPTED. One complete instrument in the pool names a
 * pickguard with neither a marker nor a colour before it:
 *   "1971 Fender Mustang Bass - All Original Except Pickguard"  12,696 DKK
 * It is now deferred. Deferral writes NO ROW, so the listing stays recoverable
 * by a later run or by human review — the same trade the neck/body class
 * already makes. A negation marker for one observation would be vocabulary
 * this file has no evidence for.
 */
const PICKGUARD_SPEC_PHRASE = /(?<![\w/-])(?:white|black)\s+pickguard(?![\w-])/i

function isColourSpecPickguard(text: string): boolean {
  return PICKGUARD_SPEC_PHRASE.test(text)
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
    // The one token whose own evidence needs a second suppressor. Applied here
    // rather than by weakening the token, exactly as `isShippingPickup` is.
    if (token === 'pickguard' && isColourSpecPickguard(text)) continue
    return { intent: 'part_or_accessory', token }
  }

  return null
}
