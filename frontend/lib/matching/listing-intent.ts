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

  for (const token of PART_TOKENS) {
    if (containsWord(text, token)) return { intent: 'part_or_accessory', token }
  }

  return null
}
