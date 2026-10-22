/**
 * Shared listing-to-product matching logic.
 *
 * Accepts a Supabase client and an array of listing IDs to match.
 * Used by:
 *   - scripts/match-listings.ts  (manual runs)
 *   - app/api/cron/scrape/route.ts  (automatic after each scrape)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  detectBrandCollision,
  brandCollisionReason,
  containsBrandToken,
  detectCatalogueBrands,
  detectOfferedBrand,
  makerNamed,
  makerOf,
  sameMaker,
  tokenFollowedByReference,
  tokenIsObjectOfFor,
  tokenInModelList,
  wordIndexOf,
  OFFERED_BRAND_LEAD_WORDS,
  type BrandCollision,
} from './brand-guard'
import { detectNonProductIntent, earliestInclusionMarker, type NonProductIntent } from './listing-intent'
// The family-label rule is owned by lib/catalogue.ts — the same module that
// owns the canonical predicate — so both gates refuse the same six slugs for
// the same reason instead of holding two opinions (PAN-84).
import { isFamilyLabelSlug } from '../catalogue'
import { currentSlug } from '../slug-renames'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Listing {
  id:    string
  title: string
}

interface Identifier {
  product_id: string
  type:       string
  value:      string
}

interface Synonym {
  alias:           string
  canonical_query: string | null
}

export interface Product {
  id:             string
  slug:           string
  canonical_name: string
  model_name:     string | null
  /** Lowercased `kg_brand.name`; null when the product has no brand row. */
  brand_name:     string | null
  /**
   * `kg_product.status`. REQUIRED, not optional: making it mandatory forces
   * every construction site to state eligibility explicitly, so a new caller
   * cannot silently inherit "unknown status" and have it treated as eligible.
   * Only the exact string `'active'` is eligible — see MATCHABLE_STATUS.
   */
  status:         string | null
  /**
   * `kg_product.support_state` (migration 056). REQUIRED for the same reason as
   * `status`. Identity (`status`) says "this is a verified music product";
   * SUPPORT says "this product is in the frozen launch cohort and may receive
   * automatic matches". They are different questions and the KG holds far more
   * verified products than the launch cohort — see MATCHABLE_SUPPORT_STATE.
   */
  support_state:  string | null
}

export interface MatchCandidate {
  product_id: string
  method:     'EAN' | 'SKU' | 'MODEL' | 'SYNONYM' | 'FUZZY'
  score:      number
  explain:    Record<string, unknown>
}

/**
 * Minimum score at which an automatic match may be written as trusted.
 *
 * EVIDENCE FOR THIS EXACT VALUE — the existing scoring contract is:
 *   95  kg_identifier SKU/MODEL — a curated identifier token
 *   80  synonym alias (match_type='alias') — a curated alias
 *   70  kg_product.model_name token — the ONLY tier with no curation behind it
 *   (100 FUZZY is produced by the admin curation routes, never by this core.)
 *
 * The 70 tier is exactly the class the dry run showed to be unsafe: 76 DBA and
 * 342 Kleinanzeigen proposals, including cross-brand instruments ("ESP J-Four
 * Jazz Bass" -> Fender Jazz Bass, "Ibanez Performer PF100" -> Crumar
 * Performer), parts and wanted ads. 80 is therefore the narrowest threshold
 * that excludes the observed failure class without touching either curated
 * tier.
 */
export const AUTO_CONFIDENCE_MIN = 80

/**
 * Why a listing produced no trusted automatic match. Deferred outcomes write
 * NO ROW — they are re-evaluated on a later run, or picked up by human review.
 */
export type DeferralReason =
  /** >1 distinct product shares the top score and no brand evidence separates them. */
  | 'ambiguous_tie'
  /** Best score is below AUTO_CONFIDENCE_MIN and the product's own brand is absent. */
  | 'low_confidence'
  /** The title names a different catalogue brand than every surviving candidate. */
  | 'brand_mismatch'
  /** The title offers a part/accessory, or is a wanted ad — not the product itself. */
  | 'non_product_intent'
  /** The tied products are duplicate KG rows for the same (brand, model). */
  | 'product_data_conflict'
  /** The tie comes from an identifier term that several products can claim. */
  | 'shared_identifier_conflict'
  /** The title offers a different maker's product and merely REFERENCES this one. */
  | 'copy_or_reference'

/**
 * Outcome of evaluating one listing title against the knowledge graph.
 * The five kinds are mutually exclusive; see DECISION PRECEDENCE in decideMatch.
 *
 *   matched  — a single product is the unambiguous, brand-compatible,
 *              sufficiently-confident winner. Row written, is_valid unset.
 *   rejected — a hard licensed-subsidiary brand collision (Epiphone/Gibson,
 *              Squier/Fender) left nothing admissible. Row written with
 *              is_valid=false so the decision stays auditable.
 *   deferred — unsafe for automation. NO ROW.
 *   none     — no candidate at all. NO ROW.
 */
export type MatchDecision =
  | { kind: 'matched';  best: MatchCandidate; admissible: MatchCandidate[]; brandEvidence: string | null }
  | { kind: 'rejected'; best: MatchCandidate; collision: BrandCollision }
  | {
      kind: 'deferred'
      reason: DeferralReason
      candidates: MatchCandidate[]
      detail: string
      /** Present only when reason === 'non_product_intent'. */
      intent?: NonProductIntent
    }
  | { kind: 'none' }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Shared token-boundary regex, so runtime matching and the shared-identifier
 *  audit can never diverge on what "contains" means. */
function tokenRegex(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i')
}

/**
 * Multi-word identity names that a title must never have split (PAN-52 D6,
 * PAN-153). Each is a sub-brand or series name, so each is identity-forming,
 * and each shares a word with a real model name:
 *
 *   'Custom Shop'    "Fender Telecaster Custom Shop 52" names a Custom Shop
 *                    Telecaster; "Telecaster Custom" (supported) only borrows
 *                    the "Custom" of "Custom Shop". Gibson Les Paul Custom has
 *                    the same collision ("Les Paul Custom Shop R8").
 *   'Classic Player' "Custom Shop Classic Player Stratocaster" is a Classic
 *                    Player; "Player Stratocaster" borrows its "Player".
 *
 * A reviewed code list, like families.ts (D1(a)): the KG cannot supply it,
 * because it holds no Classic Player row and "Custom Shop" appears only in
 * listing-title rows. Add a phrase only with a measured collision.
 */
export const IDENTITY_PHRASES: readonly string[] = ['custom shop', 'classic player']

const IDENTITY_PHRASE_RES = IDENTITY_PHRASES.map(
  (p) => new RegExp(`(?<![\\w-])${p.replace(/ /g, '\\s+')}(?![\\w-])`, 'gi'),
)

/**
 * True when `token` occurs in `text` as itself: at least one token-boundary
 * occurrence that no identity phrase straddles. A phrase straddles an
 * occurrence when the two overlap and the phrase reaches outside it, i.e. the
 * occurrence took one of the phrase's words. A phrase lying wholly inside the
 * occurrence (an alias that spells out "Custom Shop") does not straddle it.
 */
function containsToken(text: string, token: string): boolean {
  if (token.length < 3) return false
  const phrases = IDENTITY_PHRASE_RES.flatMap((re) =>
    Array.from(text.matchAll(re), (m) => [m.index!, m.index! + m[0].length]),
  )
  const occurrences = new RegExp(tokenRegex(token).source, 'gi')
  return Array.from(text.matchAll(occurrences)).some((m) => {
    const start = m.index!
    const end = start + m[0].length
    return !phrases.some(([ps, pe]) => ps < end && pe > start && (ps < start || pe > end))
  })
}

/** A whole word or phrase, on the same boundary rule as `tokenRegex`. Exported for the brand wall (PAN-271). */
export function cue(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i')
}

/**
 * A four-digit year in [from, to]. "2016-2017" and "1970s" count; a model
 * number does not ("Korg PE-2000", "SH-2000"), so no word or hyphen before it.
 */
function yearCue(from: number, to: number): RegExp {
  const years = Array.from({ length: to - from + 1 }, (_, i) => String(from + i))
  return new RegExp(`(?<![\\w-])(?:${years.join('|')})(?!\\d)`)
}

const cues = (...phrases: string[]): RegExp[] => phrases.map(cue)

/** A decade model name — "'50s", "50's", "60s" — never a bare "1950s" year. */
const DECADE_MODEL = /(?<![\w'’])['’]?[56]0['’]?s(?![\w-])/i

/**
 * Where a supported product's NAME is also a LINE: what else in the line a
 * title can name (PAN-154, owner decisions 2026-09-26). Each field is a
 * measured cue, not a vocabulary:
 *
 *   otherMembers  the title names another member of the line, so it is never
 *                 this product ("Minimoog Voyager", "Model D Reissue 2016").
 *   accessories   head-nouns seen on this product's matched titles that are
 *                 not the instrument. An inclusion marker before one keeps the
 *                 title, exactly as ACCESSORY_TOKENS in listing-intent.ts does
 *                 ("1973 Minimoog Model D w/ Road Case" is a Minimoog). They
 *                 live here rather than there because they are measured on
 *                 these products only; `case` globally would defer every
 *                 "Jazz Bass, hard case".
 *   requires      fail closed: without one of these the title is not this
 *                 product. Used where the bare name reads as another member —
 *                 a plain "Sequential Prophet-10" is the 2020 model, never
 *                 evidence for the 1980 one.
 *
 * A reviewed code list, like IDENTITY_PHRASES and families.ts: the KG cannot
 * supply it, because the line boundary lives in prose
 * (`match_page_boundary` in data/klup-launch-cohort-frozen.csv). Add a cue
 * only with a measured title behind it.
 */
interface LineBoundary {
  /** Members of one line share this name; see decideMatch step 5b. */
  line: string
  otherMembers: readonly RegExp[]
  /** A noun as a whole word or phrase, or a RegExp where the noun is a code with a number (ROLAND_CARD_CODE). */
  accessories?: readonly (string | RegExp)[]
  requires?: readonly RegExp[]
  /**
   * A title naming one of these is a bundle OF the product, so its accessory nouns are the
   * extras and refuse nothing (PAN-202: a "U 87 Ai …, WS87 Windscreen, Shock Mount, XLR Cable
   * Bundle" or a "Studio Set" stays exactly as origin/main decides it, owner decision pending).
   */
  bundles?: readonly RegExp[]
}

/**
 * Measured on moog-minimoog and moog-model-d titles, 2026-09-26. The cases are
 * named by their product lines (Moog's SR and ATA series), not by a bare
 * `case`: "Moog Model D Limited Edition Robert Moog 2026 Free Moog Case" is an
 * instrument, and "free" is not an inclusion marker.
 */
const MOOG_ACCESSORIES: readonly string[] = [
  'sr case', 'sr series', 'ata', 'hard case', 'flightcase',
  'power supply', 'fuse', 'service manual',
  'transistor', 'bushing', 'sheets', 'brochure', 'sticker',
]

/**
 * A year of the Minimoog Model D's 2022– run (PAN-199): "(2022) 2022 - Present",
 * "2023 Reissue", "new 2024", "Tribute Edition 2026". Measured: every production
 * title that names the run carries one; titles with no year name neither run.
 */
const MINIMOOG_2022_RUN = yearCue(2022, 2039)

/** The later MF-104s: "MF-104M", "MF 104M", "MF-104z", "MF-104S" (PAN-199). */
const MF_104_LATER = /(?<![\w-])mf[-\s]?104\s?(?:m|z|sd?)(?![\w-])/i

/**
 * PAN-199. Parts and accessories measured on the 1,872 active titles that name
 * a Moog line (read-only snapshot 2026-09-30), on every Moog row the promotion
 * would make a match target. The vintage rows attract them most: 9 of 16
 * Satellite titles were PCBs, harnesses and panels. Suppressed, like
 * MOOG_ACCESSORIES, by an inclusion marker before them ("w/ New Membrane Panel").
 */
const MOOG_PARTS: readonly string[] = [
  ...MOOG_ACCESSORIES,
  'pcb', 'mainboard', 'wiring harness', 'resistor matrix', 'control panel', 'face panel', 'membrane',
  'connector', 'connectors', 'connector cable', 'ribbon cables', 'power cable', 'power jack',
  'power switch', 'power transformer', 'voltage regulator', 'ic', 'led mounting clip',
  'recapping kit', 'chassis', 'switch caps', 'contacts', 'contact strips', 'bushings', 'mod wheel',
  'j wire', 'black keys', 'fatar keyboard', 'pointer knob', 'encoder knob', 'encoder housing',
  'knob kit', 'nut', 'gig bag',
  'side panels', 'rack ears', 'rackmount kit', 'rack kit', 'rack stand', 'raised stand',
  'overlay', 'staubschutzcover', 'flight case', 'eurorack case', 'dvd', 'service information',
  "mode d'employ", 'mode d’employ',
]

/**
 * PAN-199. Never the instrument, whatever precedes them: a marker cannot rescue
 * these, and some Moog names carry one ("Memorymoog PLUS Owners Manual",
 * "Prodigy Plus (Moog clone)", "Satellite complete wood case", "Complete Set -
 * Keyboard Rubber Contacts - Moog Memorymoog").
 */
const MOOG_NEVER: readonly RegExp[] = cues(
  'clone', 'inspired', 'inspire', 'plug-in', 't-shirt', 'promotional ad', 'loops', 'noise generator',
  'rubber contacts',
  'wood case', 'firmware', 'owners manual', 'technical service information',
)

/** A Moog member of `line` (PAN-199): refuses `otherMembers`, MOOG_NEVER and MOOG_PARTS. */
const moog = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...MOOG_NEVER], accessories: MOOG_PARTS,
})

/**
 * PAN-200. Parts and accessories measured on the 5,353 active titles that name
 * Roland (read-only snapshot 2026-10-01), on every Roland row the promotion
 * would make a match target. Roland has a large parts trade: tact switches,
 * boards, displays, ROM cards, patch banks, tape-echo service parts. Suppressed,
 * like MOOG_PARTS, by an inclusion marker before them ("+ Flight Case",
 * "w/ original front panel"). Deliberately NOT here, each measured on an
 * instrument title it would have refused:
 *   bare `case`, `flight case`, `hard case`  "Flight Case Included", "(Serviced / Hard Case)"
 *   `stand`, `keyboard stand`                 Danish "i pen stand" (its condition); a retailer's
 *                                             "Synthesizer, Keyboard Stand, Bench" bundle
 *   `display`, `screen`, `library`            "New Display + Memory Card", "Full Serviced / Library"
 *   `firmware`, `upgrade`                     a Tauntek-upgraded Jupiter-6; "MIDI upgrade optional"
 *   `decksaver`, `carry bag`                  a retailer's "- Decksaver Kit" is the unit
 *   `battery`, `psu`, `power supply`          "new internal battery", "upgraded PSU", "new power supply"
 *   `switches`, `motor`, `boards`             "NEW SWITCHES", "Re-Capped, Motor", "Expansion Boards"
 *   `programmer`                              "D-50 and PG-1000 programmer"
 */
const ROLAND_PARTS: readonly (string | RegExp)[] = [
  'board', 'key contact', 'mainboard', 'motherboard', 'pcb', 'pwb',
  'knob', 'knobs', 'button', 'buttons', 'switch', 'caps', 'springs', 'screws', 'spacers',
  'bracket', 'inlet', 'escutcheon', 'battery holder', 'battery door', 'rubber foot', 'feet', 'backlight', 'sensor',
  'screw', 'holder', 'magnet', 'patch list', 'note key', 'display mod', 'prom', 'staubschutzcover', 'cavo',
  'subchasis', 'grip', 'grib', 'dimm', 'sdram', 'capuchons', 'bedienungsanleitung', 'instandsetzung', 'wartung',
  'panel', 'panels', 'side panels', 'lcd', 'oled', 'display upgrade', 'graphic display', 'led display',
  'oled display', 'lcd display', 'power supply unit', 'power supply board', 'power cable', 'power cord', 'power adapter',
  'ac adapter', 'dram adapter', 'power transformer', 'internal cables', 'internal wiring', 'flat cable',
  'ribbons', 'transistor', 'cpu', 'ic', 'rom', 'pot', 'pots', 'potentiometers',
  'rom card', 'sound card', 'synthesizer card', 'memory card', 'data card', 'ram card', 'expansion card', 'card reader',
  'expansion board', 'sound library', 'patches', 'data disk', 'disk', 'disks', 'floppy drive', 'data tape', 'upgrade kit',
  'data-tape', 'cd rom', 'chart',
  'gig bag', 'carrying case', 'carry case', 'outer case', 'thon', 'portable storage', 'angle stand', 'desktop stand', 'sampler stand', 'riser',
  'ks-j8', 'rack ears', 'rack ear', 'pad mount', 'mounting plate',
  'service kit', 'rebuild kit', 'repair kit', 'tape loops', 'tape echo loops', 'pinch roller', 'roller', 'solenoid', 'bearing',
  'latches', 'thumb nuts', 'vu meter', 'felts', 'sticker', 'magnets', 'catalog', 'poster',
  // PAN-266. A wave-expansion card for the host module, in Danish and as Reverb writes it: "Roland SN‑U110‑08 –
  // PCM expansionskort" (DBA 12816052, matched to roland-u-110 on 2026-10-16 and rejected by the manager),
  // "Roland SR-JV80-02 Orchestral ekspansionsboard til synth", "SN-U110-11 Sound Effects PCM Data Card for U-110".
  'expansionskort', 'ekspansionsboard', 'pcm card', 'pcm data card', 'pcm kort', 'wave expansion',
  // The card named by its own code with its number: SN-U110-01…12 (U-110 / U-220 / D-70), SR-JV80-01…99 (JV / XP / XV),
  // SRX-01…12 (XV / Fantom). A code alone can no longer reach the host (its hyphens keep "U110" glued, see
  // foldHyphens), so this refuses the title that names both, "Roland U-110 - SN-U110-07 Expansion Card", while a
  // module sold with a card keeps its marker: "ROLAND JV-1080 w/SR-JV80-06" is the JV-1080 (trusted production match).
  /(?<![\w-])(?:sn-u110|sr-jv80|srx)-\d{2}(?![\w-])/i,
]

/**
 * PAN-200. Never the instrument, whatever precedes them: "Full set of 39
 * Pushbuttons Tact Switches" and "Complete set (20 pcs) - sliders" carry an
 * inclusion marker, and a unit sold "For Parts / Repair" or "an Bastler" is not
 * price evidence for a working one. The eight-digit number is Roland's part
 * number: "ORIGINAL Roland Dual Button, Black (22495209) for D-10 & D-20".
 */
const ROLAND_NEVER: readonly RegExp[] = [
  ...cues(
    't-shirt', 'tshirt', 'shirt', 'for parts', 'for repair', 'parts only', 'donor', 'not working', 'bastler',
    'clone', 'repro', 'replica', 'plug-in', 'editor', 'digital download', 'bank set', 'synth patches',
    'tact switch', 'tact switches', 'pushbutton', 'pushbuttons', 'myvolts', 'compatible', 'pcs',
    'contact rubber', 'rubber contacts', 'assy', 'assembly', 'sample pack', 'pdf', 'pcb set', 'panel switches',
    'empty case', 'patch notes', 'many more', 'style', 'non-functioning', 'lot', 'two pack', 'three pack',
    'four pack', 'prong', 'sound source unlimited', 'similar to', 'eurorack', 'aus roland', 'psu till', 'promo 12',
    'rolling rack', 'ceramic', 'service notes', 'documents', 'edit map', 'data cassette', 'taster',
    'non-functional',
  ),
  // "Roland S-220 parts - encoder", "Roland Parts - U-20 Display", "Sequencer Part: Black TAP Button";
  // never "Full original parts – Fully Serviced".
  /(?:\d|roland|sequencer)\s+parts?\s*[-–:]/i,
  /\d\s?pcs(?![\w-])/i,
  // Several units: "2 Roland PDX-6 V-Drum Pads", "Roland PDX-6 Pads(3)".
  /^\W*[2-9]\s+roland(?![\w-])/i,
  /pads?\s?\(\s?[2-9]\s?\)/i,
  /(?<![\w-])\d{8}(?:[a-z]\d)?(?![\w-])/i,
]

/** A Roland member of `line` (PAN-200): refuses `otherMembers`, ROLAND_NEVER and ROLAND_PARTS. */
const roland = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...ROLAND_NEVER], accessories: ROLAND_PARTS,
})

/** A Boutique (2015–) re-creation: "Roland Boutique JU-06 JUNO-106 Sound Module" is the JU-06. */
const BOUTIQUE = cue('boutique')
/** The JU-06 / JU-06A Boutique Junos. */
const JU_06 = /(?<![\w-])ju[-\s]?06a?(?![\w-])/i
/** TR-08 (Boutique), TR-8 (AIRA), TR-8S — never "TR-808" or "TR 808". */
const TR_08 = /(?<![\w-])tr[-\s]?0?8s?(?![\w-])/i
/** The TR-06 (Boutique TR-606). */
const TR_06 = /(?<![\w-])tr[-\s]?06(?![\w-])/i
/** Boss's RE-2, RE-20 and RE-202 Space Echo pedals — never "RE-201". */
const RE_2 = /(?<![\w-])re[-\s]?20?2?(?![\w\d-])/i
/** A Mark II: "MKII", "MK2", "Mk II", "MKⅡ". */
const MK_II = [cue('mkii'), cue('mk2'), cue('mk ii'), cue('mkⅱ')]

/**
 * PAN-203, the clone guard (direction 1). Warm Audio builds copies of other makers' classics
 * and names the original in its titles: "WA-87 R2 (Nickel) U87 Style", "WA76 1176 Compressor
 * Rev. D", "WA73 Single Channel Neve 1073-Style", "WA-1B Tube Tech CL1B-Style", "WA-2A LA2a".
 * A title naming Warm Audio, or a Warm Audio model number, is never the original, whether or
 * not it says "style" or "clone". Refused on every Neumann row (NEUMANN_NEVER) and on the
 * Universal Audio 1176 / LA-2A, Neve 1073 and Tube-Tech CL 1B rows below. The model numbers
 * carry no trailing boundary so "WA-87jr", "WA73-EQ" and "WA87R2" count.
 */
const WARM_AUDIO_COPY: readonly RegExp[] = [
  cue('warm audio'),
  /(?<![\w-])wa[\s-]?(?:47|67|87|251|14|8000|84|19|44|73|273|412|2a|76|12|2?mpx|1b|cx[\s-]?(?:12|24))/i,
]

/**
 * PAN-202. Neumann parts and accessories, measured on the active titles that name
 * Neumann (read-only snapshot 2026-10-01) against every Neumann row the promotion
 * would make a match target. Suppressed, like ROLAND_PARTS, by an inclusion marker
 * before them ("U67 1965 - with Power Supply/Cable/Shock Mount", "+ Box").
 * Studio Set / Set Z / mic + mount bundles are NOT here (owner decision pending,
 * PAN-202 decision 3): a bundle of the mic is left exactly as origin/main decides it.
 */
const NEUMANN_PARTS: readonly string[] = [
  'capsule', 'kapsel', 'head grill', 'grill', 'grille', 'housing',
  'shockmount', 'shock mount', 'elastic', 'spider', 'swivel', 'stand mount', 'desktop stand',
  'table stand', 'stand extension', 'wall mount', 'bracket', 'clamp', 'isolation pads',
  'windscreen', 'foam', 'pop filter', 'cable', 'kabel', 'connector', 'transformer', 'power supply',
]

/**
 * PAN-202. Never the instrument, whatever precedes them: a unit sold for parts or
 * needing repair is not price evidence for a working one (the Roland "for parts"
 * class), and a logo, a replica, another maker's "U87 Style" mic or the MT 48's MIDI
 * adapter is not the product.
 */
const NEUMANN_NEVER: readonly RegExp[] = [
  ...cues(
    'for parts', 'for repair', 'needs repair', 'parts only', 'not working', 'defect', 'defekt', 'broken',
    'replica', 'clone', 'style', 'compatible with', 'diy', 'logo', 'not tested', 'nicht getestet', 'midi adapter',
    // another maker's mic that names a Neumann as its model: "JJ Audio Huskey Pup 47: … a smaller version …"
    'version of', 'based on', 'inspired by', 'similar to',
    // a head or capsule assembly, a lot of parts: "U67 Head with Assembly and KK67 Capsule",
    // "U67 Tube KK 67 microphone head set", "U67 lotto parts original ( five pz)"
    'head with', 'head set', 'head assembly', 'microphone head', 'lotto', 'pz',
  ),
  // PAN-203: a Warm Audio copy that names the Neumann it copies ("WA-87 R2 U87", "WA-47F U47 FET").
  ...WARM_AUDIO_COPY,
  // "Neumann KMS104 KMS105 Badge (Red)": a badge sold as a part, never "Purple Badge - West Berlin Era".
  /(?<![\w-])badge\s*\(/i,
  // A title that LEADS with a Neumann part number is that part: the EA 87 / EA 1 / EA 4 mounts,
  // the SG 287 swivel mount, the WS 87 windscreen, the MF 4 stand, the BV 8 transformer, the
  // NU 67 power supply, K 47 / K 67 / KK 67 / K 87 / K 870 capsules ("Neumann EA87 (Nickel)
  // (U87ai dedicated suspension)", "Neumann BV08 Genuine Neumann U47 Transformer"). Later in a
  // title the same name is an included extra ("U87Ai & EA87", "U87Ai U87. EA87 Mount"), a mic
  // + EA 87 bundle that decision 3 leaves alone.
  /^\W*(?:neumann\s+)?(?:genuine\s+|original\s+)?(?:ea[\s-]?(?:87|1|4)|sg[\s-]?287|ws[\s-]?87|mf[\s-]?4|bv[\s-]?0?8|nu[\s-]?67\s?v?|kk?[\s-]?(?:47|67|87|870))(?![\w-])/i,
]

/**
 * PAN-202 decision 2. Several units are never the single mic or monitor: "Factory Matched
 * Pair", "Stereo Set", "KM 184 MT STEREO SET Coppia di Microfoni", "KH 80 DSP - Pair",
 * "2x Neumann KH120 II", "Two Neumann KM 184 mt", "U47 fet microphones x 3". The pair rows
 * (neumann-skm-184) are their own products and carry no boundary.
 */
const NEUMANN_PAIR: readonly RegExp[] = [
  ...cues('pair', 'matched pair', 'stereo pair', 'stereo set', 'stero set', 'stereoset', 'coppia', 'paar'),
  /(?<![\w-])stereo\s+(?:\w+\s+)?set(?![\w-])/i,
  /(?<![\w-])(?:[2-9]\s?x|x\s?[2-9])(?![\w-])/i,
  /^\W*(?:[2-9]|two|three|four)\s+(?:x\s+)?neumann(?![\w-])/i,
]

/**
 * PAN-202 decision 3. A bundle of the mic: Studio Set, Set Z, a kit, a package, a retailer's
 * "… Bundle". Its accessory nouns are the extras (LineBoundary.bundles).
 */
const NEUMANN_BUNDLE: readonly RegExp[] = cues('bundle', 'set', 'kit', 'package', 'pak', 'paket')

/** A Neumann member of `line` (PAN-202): refuses `otherMembers`, NEUMANN_NEVER and NEUMANN_PARTS. */
const neumann = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...NEUMANN_NEVER], accessories: NEUMANN_PARTS, bundles: NEUMANN_BUNDLE,
})
/** A single mic or monitor: also refuses NEUMANN_PAIR. */
const neumannSingle = (line: string, ...otherMembers: RegExp[]): LineBoundary =>
  neumann(line, ...otherMembers, ...NEUMANN_PAIR)

/** Several monitors: "KH 120 II Studio Monitors", "(monitor speakers)", "KH 80 + KH750 5.1 Surround Sound System". */
const MONITORS = cues('monitors', 'speakers', 'surround')

/** "U 87 Ai" in every spelling: "U87Ai", "U87 AI", "U 87Ai", "U-87 Ai", "U87A i" (a seller's "U 87 A i"). */
const U87_AI = /(?<![\w-])u[\s-]?87[\s-]?a[\s-]?i(?![\w-])/i
/**
 * The pre-Ai U 87 (frozen boundary, neumann-u87ai: "U 87 Ai (1986-) ONLY; the vintage
 * U 87/U87i is a different circuit and price"): a year 1967–1985, a '60s/'70s decade,
 * "U87i" / "U 87 i", or "NOT Ai". A bare "1980s" is not one: "U 87 A i 1980s ... 2nd
 * Generation" is a 1986–89 Ai.
 */
const U87_PRE_AI: readonly RegExp[] = [
  /(?<![\w-])(?:196[7-9]|197\d|198[0-5])(?![\ds])/,
  /(?<![\w'’])['’]?(?:19)?[67]0['’]?s(?![\w-])/i,
  /(?<![\w-])u[\s-]?87[\s-]?i(?![\w-])/i,
  cue('not ai'),
]
/** The U 47 fet (1969–86) and its 2014 Collector's Edition: "U47 FET", "U 47 fet", "U47FET". */
const U47_FET = [cue('fet'), /(?<![\w-])u[\s-]?47[\s-]?fet(?![\w-])/i]
/** "Collector's Edition", "Collectors Edition", "Collector’s". */
const COLLECTOR = /(?<![\w-])collector(?:['’]?s)?(?![\w-])/i
/** The U 67 reissue (2018–; sold as the "U 67 Set"): never the 1960–71 original. */
const U67_REISSUE: readonly RegExp[] = [
  ...cues('reissue', 're-issue', 'b-stock', 'open box', 'warranty'), yearCue(2018, 2039),
]
/** The original U 67: a vintage word, a year to 2017, or the Telefunken badge. */
const U67_VINTAGE: readonly RegExp[] = [...cues('vintage', 'telefunken', 'nos'), yearCue(1950, 2017)]
const U67_VINTAGE_ANY = new RegExp(`(?:${U67_VINTAGE.map((r) => r.source).join('|')})`, 'i')
/** U 67 rebuilds by other makers ("Neumann / Max Kircher U 67", "Max Kirchner U67 re-issue"). */
const U67_REBUILD: readonly RegExp[] = cues('kircher', 'kirchner', 'u60', 'u 60', 'm269', 'm 269', 'sm-69', 'sm 69')

/**
 * PAN-203. Warm Audio parts and accessories, measured on the titles that name Warm Audio
 * (read-only snapshot 2026-10-01) against every Warm Audio row the promotion makes a match
 * target: flight cases (Reverb lists them for the WA-47, WA-67, WA-87 R2 and WA-251), knobs,
 * mounts, cables, power supplies, boom arms. Not `capsule` ("WA-44 … Dual Capsule" and "WA-CX24
 * Dual Capsule" are the mics), not `transformer` ("WA273-EQ … Hand Wired UK Carnhill Transformer")
 * and not a bare `case` ("WA-8000 … black carrying case included"; a case alone says "case for"). Suppressed by an inclusion marker before
 * them ("w/ Tweed Case, PSU …", "+Shockmount"); a bundle keeps its extras (WARM_AUDIO_BUNDLE).
 */
const WARM_AUDIO_PARTS: readonly string[] = [
  'flight case', 'knob', 'knobs', 'shockmount', 'shock mount', 'cable', 'cables',
  'power supply', 'psu', 'pop filter', 'boom arm', 'mic stand', 'tube only',
]

/**
 * PAN-203. Never the Warm Audio product, whatever precedes them: a unit for parts or repair,
 * a modified or upgraded unit ("Revive Audio Modified: …", "M7 Capsule ZenPro Mod Edition", "WA-8000
 * Upgraded by Erikson Labs w. Sony Capsule"), which is not price evidence for a stock one, and the clone
 * guard's direction 2: a title that LEADS with the maker of an original Warm Audio copies is that
 * maker's product ("Neumann U87 Ai … (not WA-87)", "Universal Audio 1176LN vs WA76").
 */
const WARM_AUDIO_NEVER: readonly RegExp[] = [
  ...cues(
    'for parts', 'for repair', 'needs repair', 'parts only', 'not working', 'defect', 'defekt', 'broken',
    'modified', 'modded', 'mod', 'mod edition', 'zenpro', 'upgraded', 'full upgrade', 'replacement capsule',
    // an aftermarket transformer fitted to the mic: "TAB-Funkenwerk AMI T13 Transformer Warm Audio WA-87 R2"
    'ami t13',
    'flight case for', 'case for', 'knob for',
  ),
  /^\W*(?:the\s+)?(?:neumann|telefunken|universal\s+audio|urei|teletronix|(?:ams\s+)?neve|tube[\s-]?tech|akg|api|pultec|manley)(?![\w-])/i,
]

/**
 * PAN-203. Several units are never the single unit: "Pair (2x)", "Stereo Pair", "Coppia Stereo",
 * "(2-pack)", "(3-pack)", "(5-pack) Bundle", a leading "(2) Warm Audio" or "2 X Warm Audio". The
 * pair rows (WA-2A Stereo Pair, WA-84 Stereo Pair, WA-87 R2 TS) are their own products. An "Nx"
 * followed by an accessory noun is a count of extras, not of units ("& 2x Shockmount").
 */
const WARM_AUDIO_PAIR: readonly RegExp[] = [
  ...cues('pair', 'matched pair', 'stereo pair', 'stereo set', 'coppia', 'paar', 'two-pack', 'twin pack'),
  /(?<![\w-])(?:[2-9]\s?x|x\s?[2-9])(?![\w-])(?!\s*(?:shock|cable|xlr|mount|case|tube))/i,
  /(?<![\w-])[2-9][\s-]?pack(?![\w-])/i,
  /^\W*\(?[2-9]\)?\s*(?:x\s+)?(?:pcs\s+)?warm(?![\w-])/i,
]

/** PAN-203: a bundle of the product keeps its extras, as PAN-202 decision 3 left Neumann bundles. */
const WARM_AUDIO_BUNDLE: readonly RegExp[] = cues('bundle', 'kit', 'package', 'promo bundle')

/** A Warm Audio member of `line` (PAN-203): refuses `otherMembers` and WARM_AUDIO_NEVER; parts unless bundled. */
const warmAudio = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...WARM_AUDIO_NEVER], accessories: WARM_AUDIO_PARTS, bundles: WARM_AUDIO_BUNDLE,
})
/** A single unit (mic, one-channel preamp or compressor, pedal): also refuses WARM_AUDIO_PAIR. */
const warmAudioSingle = (line: string, ...otherMembers: RegExp[]): LineBoundary =>
  warmAudio(line, ...otherMembers, ...WARM_AUDIO_PAIR)

/** The WA-87 R2 (2020–): "R2", "R2B", "R2N", "WA87R2", a "2020 - Present" or later year on the R1 row. */
const WA87_R2: readonly RegExp[] = [
  /(?<![\w-])(?:wa[\s-]?87[\s-]?)?r2[bn]?(?![\w-])/i, /2020\s*[-–]\s*present/i, yearCue(2021, 2039),
]
/** A "jr" (WA-87jr, WA-47jr, 2020– FET): "jr", "JR", “jr”, "Jrb", "Jrn", "Jrseb", "WA-87jr". */
const WA_JR: readonly RegExp[] = [/(?<![\w])jr(?:se)?[bn]?(?![\w-])/i]
/** The jr SE (cardioid-only): "SE", "SE-B", "SE-N", "WA-87JR-SE", "Jrse…", and its "Studio Essential(s)" name. */
const WA_JR_SE: readonly RegExp[] = [
  /(?<![\w-])se(?:[\s-]?[bn])?(?![\w-])/i, /jr[\s-]?se(?:[\s-]?[bn])?(?![\w-])/i,
  ...cues('studio essential', 'studio essentials'),
]
/** The limited WA-87 R2 TS titanium stereo pair. */
const WA87_TS: readonly RegExp[] = cues('ts', 'titanium')
/**
 * The fet WA-47F, and the WA-47T: the limited titanium edition ("WA-47T Limited-Edition … Titanium
 * Finish"), held as its own row until the owner decides it is the WA-47 in another finish. Its
 * titles without the "T" ("WA-47 … 2024 - Present - Titanium") are held with it.
 */
const WA47_F_T: readonly RegExp[] = [/(?<![\w-])wa[\s-]?47[\s-]?[ft](?![\w-])/i, ...cues('fet', 'titanium')]
/** EQ versions: "WA73-EQ", "WA73 EQ", "WA73EQ", "Preamp & EQ", "Equalizer", and the WA73-500 module. */
const WA_EQ: readonly RegExp[] = [/(?<![\w-])wa[\s-]?2?73[\s-]?eq/i, ...cues('eq', 'equalizer', 'equaliser', 'w/eq')]
/** The two-channel WA76-D2 / -A2 and the "WA76 … Stereo Pair". */
const WA76_STEREO: readonly RegExp[] = [/(?<![\w-])wa[\s-]?76[\s-]?[ad]?2(?![\w-])/i, /(?<![\w-])[ad]2(?![\w-])/i, ...cues('dual', 'stereo')]
/** The two-channel WA-2MPX, never the single WA-MPX. */
const WA_2MPX: readonly RegExp[] = [/(?<![\w-])(?:wa[\s-]?)?2[\s-]?mpx/i, cue('dual')]
/** WA-84 pairs written without "pair": "Coppia", "Stereo", Reverb's "CP" (coppia) SKU, the omni pair. */
const WA84_PAIR: readonly RegExp[] = [...cues('stereo', 'cp', 'omni')]

/**
 * PAN-204, era policy (manager decision 2026-10-01). A Martin row is the guitar built from 1970
 * on: years and Standard Series generations (Reimagined 2017, the 2025 refresh) are facets. A
 * build year 1898–1969 is another price class (median of our base titles: 0-18 1947–69 39,260 DKK
 * against 13,673 for 2017+; a 1942 D-28 at 855,842 against about 23,000), so it is refused, and so
 * is Brazilian rosewood, the pre-1970 back-and-sides wood. Vintage stays unmatched; no vintage row
 * exists. A year that names a modern model is not a build year: "Authentic 1937", and a 1930s year
 * before the finish or the edition it names ("1933 Ambertone", "1935 Sunburst", "Satin 1935 Burst",
 * "1937 Joe Bonamassa Sunburst", "1955 CFM IV 70th"). A serial or SKU digit run is not a year.
 */
const MARTIN_VINTAGE: readonly RegExp[] = [
  /(?<![\w#.-])(?<!authentic\s+)(?:189[89]|19[0-5]\d|196\d)(?![\d\w])(?![\s-]*(?:ambertone|amberburst|sunburst|burst|joe\s+bonamassa|cfm))/i,
  // "c.1928" writes the year after a full stop.
  /(?<![\w-])c\.\s?(?:189[89]|19[0-5]\d|196\d)(?!\d)/i,
  cue('brazilian'),
]

/**
 * PAN-204. Never a C.F. Martin guitar, whatever else the title says: other companies and people
 * named Martin, measured on the titles that say "martin" (read-only snapshot 2026-10-01) — the
 * MartinLogan speakers, the Martin Band Instrument Company's Committee trumpet, Martin Sound (the
 * Neve Flying Faders automation), Chris Martin (an IKEA chair), Mario Martin (a Stratocaster),
 * Martin Barre (a Gibson LG-2) — and a converted guitar ("0-18 KH c.1928 Koa Conversion"), which
 * is not price evidence for a stock one. Martin case model numbers ("C331", "12C350", "C545EC";
 * Reverb lists them as accessories) are refused outright; a bare `case` never is, because 176
 * guitar titles say "w/ case", "OHSC" or "Hardshell Case".
 */
const MARTIN_NEVER: readonly RegExp[] = [
  /martin\s*logan/i,
  ...cues('committee', 'martin sound', 'chris martin', 'mario martin', 'martin barre', 'conversion'),
  /(?<![\w-])(?:\d{1,2})?c\d{3}(?:ec)?(?![\w-])/i,
]

/**
 * PAN-204. Merchandise and parts named by a Martin model, marker-suppressible like every
 * `accessories` list: the "D-28 Silhouette Lighted Wall Clock" (measured) and the Thomann "D-28
 * keychain" (the page `martin-d-28` pointed at). Never `strings` ("D-28 Billy Strings") and never
 * a bare `case`.
 */
const MARTIN_PARTS: readonly string[] = ['clock', 'keychain', 'key chain', 'key ring']

/**
 * PAN-262. Shenandoah was Martin's 1983–93 line of imported bodies finished in Nazareth, sold under
 * the Standard Series style numbers ("1984 Martin D-18 Shenandoah"). It is a Martin, but none of
 * these rows, and another price class.
 */
const MARTIN_SHENANDOAH = cue('shenandoah')

/** A Martin member of `line` (PAN-204): refuses `otherMembers`, the vintage years, MARTIN_NEVER and Shenandoah. */
const martin = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...MARTIN_VINTAGE, ...MARTIN_NEVER, MARTIN_SHENANDOAH], accessories: MARTIN_PARTS,
})

/**
 * PAN-262. Martin's style codes written without the hyphen: "Martin D28 Reimagined", "Martin HD28",
 * "Martin OM28". The model tier reads "D-28" and its space form "D 28", never "D28", so such a title
 * named nothing; this writes the hyphen back before anything reads the title. Only in a title that
 * names Martin, and only the D, HD, OM and 000 sizes: a bare "018" or "0018" reads as a serial as
 * readily as a 0-18 or 00-18. A suffix keeps the code glued ("D28E"), so it stays another model,
 * exactly as "D-28E" does.
 */
const MARTIN_NAMED = /(?<![\w-])martin(?![\w-])/i
const MARTIN_GLUED_CODE = /(?<![\w-])(d|hd|om|000)(\d{2})(?![\w-])/gi
export function hyphenateMartinCodes(text: string): string {
  return MARTIN_NAMED.test(text) ? text.replace(MARTIN_GLUED_CODE, '$1-$2') : text
}

/**
 * PAN-266. A model code in the one form every spelling reduces to, so a title and a KG row are
 * compared on the code and not on where the seller put a hyphen or a space. Sellers write
 * "SP404 MKII", "SP-404 MK2", "SP 404MKII" and "SP-404MKII" for the row whose `model_name` is
 * "SP-404MKII"; the model tier read the KG spelling and its space form only, so the first two
 * named nothing (DBA 24878338, the owner's third ad) and "Roland TR808", "Juno106", "MS20", "DS1",
 * "SH01a" and "U87 Ai" named nothing either. The Martin fix above was the first instance of this
 * class, done as one brand's rewrite; this is the rule.
 *
 * Lower case; a space between a letter and a following digit ("tr808" -> "tr 808"); a hyphen as a
 * space; and a generation as its numeral ("mk 2", "mk-ii", "404mk2", "MKII" -> "ii", so "SP-404MKII"
 * and "Blues Junior III" read their "Mk2" and "mk3" titles alike). What follows the
 * digits stays glued — a letter run ("d28e", "404sx", "87ai"), a hyphenated number ("dx7-2",
 * "g6122t-62", "2-1176") or a hyphenated short suffix ("wa73-eq"): the suffix is part of the code,
 * so "D28E", "DX7-2" and "WA73-EQ" still are not the D-28, the DX7 and the WA73, exactly as "D-28E" is not —
 * while the KG's own "SP-404SX" and "U 87 Ai" reduce to "sp 404sx" and "u 87 ai", and the title
 * that spells them the same way lands. A hyphenated WORD after the digits is a word
 * ("Juno-60-Keyboard" -> "juno 60 keyboard").
 */
/**
 * PAN-266. "Jr." is "Junior" in a title, as "Blues Jr.", "Pro Jr" and "Les Paul Jr" are written:
 * three of the ten Blues Junior ads on DBA on 2026-10-15 wrote "Blues Jr.", and none matched.
 * Read by the model tier only, on a copy of the title: the boundary cues keep reading "jr" as
 * written, because Warm Audio names its products that way ("WA-87jr", PAN-203).
 */
const JUNIOR_ABBREVIATION = /(?<![a-z])jr\.?(?![a-z])/g
export function expandJunior(text: string): string {
  return text.replace(JUNIOR_ABBREVIATION, 'junior')
}

/**
 * PAN-266. A seller's hyphen may be U+2010 (HYPHEN) or U+2011 (NON-BREAKING HYPHEN), which no `-` test
 * reads: "Roland SN‑U110‑08 – PCM expansionskort" (DBA 12816052) was the only SN-U110 card title in
 * production to reach roland-u-110, because its "U110" stood free between two characters that were
 * neither word nor hyphen. Folded to `-` before anything reads the title; an en or em dash is a
 * separator ("SN-U110-08 – PCM") and stays.
 */
export function foldHyphens(text: string): string {
  return text.replace(/[‐‑]/g, '-')
}

export function modelCodeForm(text: string): string {
  return foldHyphens(text)
    .toLowerCase()
    .replace(/(?<![a-z])mk[\s-]?(?:2|ii|ⅱ)(?![a-z0-9])/g, ' ii')
    .replace(/(?<![a-z])mk[\s-]?(?:3|iii)(?![a-z0-9])/g, ' iii')
    .replace(/(?<![a-z])mk[\s-]?(?:4|iv)(?![a-z0-9])/g, ' iv')
    .replace(/([a-z0-9]*)-(?=([a-z0-9]*))/g, (m, before: string, after: string) =>
      /\d/.test(before) && /^(?:\d|[a-z]{1,3}$)/.test(after) ? m : `${before} `)
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What a Standard Series base row refuses (PAN-204): the series and builds Martin sells under the
 * same body and style number. Custom Shop is a category of builds, not one model, so its titles
 * stay unmatched ("Custom Shop", "CTM", "Expert", "Custom Artist", and a bare "Custom" as in "OM-28
 * Custom Adirondack"). Each cue was read against the base titles of the snapshot.
 */
const MARTIN_SERIES: readonly RegExp[] = cues(
  'custom', 'custom shop', 'ctm', 'expert', 'custom artist',
  'authentic', 'modern deluxe', 'satin', 'marquis', 'street legend', 'streetlegend',
  'signature', 'limited edition', 'special edition', 'cfm', '70th', 'semiquincentennial',
)
/** A Martin Custom Shop build carrying a series name ("Custom Shop D-28 Authentic 1937 … Stage 1 Ambertone"). */
const MARTIN_CUSTOM: readonly RegExp[] = cues('custom shop', 'ctm', 'expert', 'stage 1')

/**
 * PAN-205. SSL's own name: "SSL" (also run into a model, "SSL2+", "SSL12", "Sslbigsix"), "Solid State
 * Logic", and the misspellings measured on SSL titles, "Sol ID State Logic" and "Solid Stage Logic".
 * Every SSL row requires one (manager decision 2026-10-01, brand co-occurrence): the model names are
 * short or common words ("SiX", "Fusion", "UF8", "SSL 2"), and a title without the maker is not
 * evidence. "Solid State" alone is not the maker ("Roland CUBE LITE Solid State Guitar Combo").
 */
const SSL_NAMED: readonly RegExp[] = [/(?<![a-z])ssl/i, /solid\s+sta(?:te|ge)\s+logic/i, /sol\s+id\s+state\s+logic/i]

/**
 * PAN-205. Accessories named by an SSL product, measured on the SSL titles (read-only snapshot
 * 2026-10-01), marker-suppressible like every `accessories` list: "UC1 … with Decksaver … Cover and
 * UC1 Rack Kit" is the UC1 with extras; "Decksaver Solid State Logic Big Six Cover" is a cover. Not a
 * bare `desk` ("Six Mixer SSL Mic Pre Compressor Analog Desk" is the mixer), not a bare `case` ("SiX …
 * with Case"), not a bare `mount` ("Rack Mount Kit" is caught by its own words).
 */
const SSL_PARTS: readonly string[] = [
  'decksaver', 'cover', 'dust cover', 'glowcenter', 'glocoder', 'glomute', 'gloviz', 'glow buttons', 're:surface kit',
  'rack kit', 'rackmount kit', 'rack mount kit', 'rack mount', 'rack ears', 'mise en rack',
  'studio desk', 'controller desk', 'caddy', 'snake', 'carry case', 'custom carry case', 'protective case',
  'task light', 'stream deck', 'tablet mount', 'mount brackets', 'insert', 'inserts', 'stand', 'stands',
  'enclosure', 'mixer case', 'pot', 'pots', 'timecode', 'power supply',
]

/**
 * PAN-205. Never the SSL product, whatever precedes them: a unit for parts, something made FOR an SSL
 * product ("BSD DESK FOR SSL UF8", "Rack Kit for SSL UF8", "Snake for SSL Six, Matrix2, XL Desk",
 * "GloCoder for SSL SIX / BIG SIX / ORIGIN"), and a title that leads with another maker: the accessory
 * makers (Decksaver, Bazel, BSD, Mogami, Hosa, uonron, Restand) and the makers whose words collide with
 * SSL model names (Moog Sonic Six, Sequential Six-Trak, Alesis Fusion, Rupert Neve Designs R6 "Six
 * Space", Korg PolySix), and API ("API 500-8B HC 8-Slot Lunchbox with … SSl G Bus Compressor").
 * No SSL row is a plug-in or software: no software-only SSL listing exists, and "plug-in" is how SSL
 * names the UC1 hardware, so it is not a cue here (the PAN-196 decision).
 */
const SSL_NEVER: readonly RegExp[] = [
  ...cues(
    'for parts', 'for repair', 'parts only', 'not working', 'defect', 'defekt', 'broken',
    'case for', 'cover for', 'kit for', 'for ssl', 'for solid state logic', 'compatible with',
    // Seymour Duncan's Strat pickups are named SSL-1 … SSL-7 ("Seymour Duncan Ssl 2 Vntg Flat For Strat Rwrp").
    'seymour duncan', 'duncan', 'pickup', 'pickups', 'strat', 'stratocaster',
  ),
  /^\W*(?:the\s+)?(?:decksaver|bazel|bsd|mogami|hosa|uonron|restand|m!xbling|3dwaves|mixingtable|seymour|moog|sequential|alesis|korg|rupert\s+neve|api|warm\s+audio)(?![\w-])/i,
]

/**
 * PAN-205. Several units, or several SSL products, are never one unit: "2 x Solid State Logic SSL B-Dyn",
 * "Two SSL SiX Ch Modules", "FOUR (4) Solid State Logic SiX CH", "4K B-DYN 611B PAIR", "SSL 18 and
 * Alpha 8 Combo", "UF8 + UC1 + UF1 … Complete setup". SSL's part numbers end in X1 / X2 / X3
 * ("729731 X2 500 Series Vhd+ Preamp", "729752X2 - BiG SiX", "726490X3"), which are not quantities:
 * an "x2" right after a digit never counts. Neither does a channel count ("2x2", "2 x 2 USB").
 * A "1 of 2" split sale is one unit and is not refused.
 */
const SSL_MULTI: readonly RegExp[] = [
  ...cues('pair', 'stereo pair', 'matched pair', 'combo', 'complete setup', 'set of'),
  /(?<![\w-])[2-9]\s?x(?!\s?\d)(?![\w-])/i,
  /(?<![\w-])(?<!\d\s?)x\s?[2-9](?![\w-])/i,
  /(?<![\w-])[2-9][\s-]?pack(?![\w-])/i,
  /(?<![\w-])(?:two|three|four|five|eight)\s+(?:\(\d\)\s+)?(?:ssl|solid\s+state|sol\s+id|uf\s?-?[18]|uc\s?-?1|b-?dyn|vhd)/i,
  // A digit before a model is a count ("2 UF8"); a digit before "SSL" is not ("8 SSL Preamps", "incl 2 SSL Plugins").
  /(?<![\w-])[2-9]\s+(?:uf\s?-?[18]|uc\s?-?1|b-?dyn|vhd)/i,
]

/** Gretsch named (PAN-218). A Greco or Epiphone title that only cites "(Gretsch 6120)" carries no Gretsch model code. */
const GRETSCH_NAMED: readonly RegExp[] = [/(?<![a-z])gretsch/i]
/**
 * A Custom Shop build of a production model is another, far dearer guitar: "Gretsch Custom Shop
 * G6128T-GH George Harrison Tribute Duo Jet" (its own Reverb CSP), "Stephen Stern Masterbuilt".
 */
const GRETSCH_CUSTOM: readonly RegExp[] = cues('custom shop', 'masterbuilt', 'masterbuild', 'tribute')
/** A Gretsch member of `line`: Gretsch named, refuses `otherMembers` and the Custom Shop builds. */
const gretsch = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...GRETSCH_CUSTOM], requires: GRETSCH_NAMED,
})

/** PRS named (PAN-220): "Custom 22" and "Custom 24" are other makers' words too. */
const PRS_NAMED: readonly RegExp[] = [/(?<![a-z])prs(?![a-z])/i, cue('paul reed smith')]
/** The import (SE) and Stevensville (S2) series: other guitars at a fraction of the Core price. */
const PRS_SERIES: readonly RegExp[] = cues('se', 's2')
/** "Semi-Hollow", "Semi Hollow Body", "Hollowbody II": a chambered or hollow build is its own model. */
const PRS_HOLLOW: readonly RegExp[] = [/(?<![\w-])semi[\s-]?hollow/i, /(?<![\w-])hollow\s?body/i]
/** "Singlecut", "Single Cut", the measured typo "Singelcut", "594SC", "SC594". */
const PRS_SINGLECUT: readonly RegExp[] = [/(?<![\w-])sing(?:le|el)\s?cut/i, /(?<![a-z])sc\s?594|594\s?sc(?![a-z])/i]
/** The piezo models: "Custom 22 Piezo", "P22", "P24", "… 10-Top Piezo". */
const PRS_PIEZO: readonly RegExp[] = [cue('piezo'), /(?<![\w-])p2[24](?![\w-])/i]
/** "Custom 24-08", "Custom 24 08": the eight-way switching model, never a "Custom 24 2008". */
const PRS_24_08 = /(?<![\w-])24[\s-]?08(?!\d)/
/**
 * Silver Sky parts, measured on the 52 active part titles that name it (2026-10-02). Saddles, tuner
 * screws and the bridge arm are already deferred by PART_TOKENS. Marker-suppressible like every list.
 */
const PRS_SILVER_SKY_PARTS: readonly string[] = ['knob', 'knobs', 'pickguard', 'switch cap', 'nut', 'tremolo arm', 'kit']
/** A PRS member of `line`: PRS named, refuses `otherMembers` and Private Stock (one-off custom builds). */
const prs = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, cue('private stock')], requires: PRS_NAMED,
})
/** A Core (USA) member: also refuses the SE and S2 series. */
const prsCore = (line: string, ...otherMembers: RegExp[]): LineBoundary => prs(line, ...otherMembers, ...PRS_SERIES)

/** Rickenbacker named (PAN-222): its model names are bare numbers ("4001", "4003", "360/12"). */
const RICKENBACKER_NAMED: readonly RegExp[] = [/(?<![a-z])rickenbacker/i]
/** Measured on the bass titles: "Thumb Rest for Older 4001 Series", "4003 Scratchplate", "4001 Wiring". */
const RICKENBACKER_PARTS: readonly string[] = ['thumb rest', 'scratchplate', 'wiring']
/** A Rickenbacker member of `line`: Rickenbacker named, refuses `otherMembers`; parts unless after a marker. */
const rickenbacker = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers, accessories: RICKENBACKER_PARTS, requires: RICKENBACKER_NAMED,
})

/** Suhr named (PAN-223): "Classic S" and "Classic T" are ordinary words. */
const SUHR_NAMED: readonly RegExp[] = [/(?<![a-z])suhr(?![a-z])/i]
/** A signature model is another guitar: Mateus Asato, Ian Thornley, Andre Nieri. */
const SUHR_SIGNATURE: readonly RegExp[] = cues('signature', 'asato')
/** "Custom Shop Classic S", "Classic S Custom", "Custom Order": a custom build, its own row and price. */
const SUHR_CUSTOM = cue('custom')
/** A Suhr member of `line`: Suhr named, refuses `otherMembers`. */
const suhr = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({ line, otherMembers, requires: SUHR_NAMED })

/** Heritage named (PAN-224). A Gibson in "Heritage Cherry Sunburst" carries no Heritage model code. */
const HERITAGE_NAMED: readonly RegExp[] = [/(?<![a-z])heritage(?![a-z])/i]
/** "Standard II" or "Standard-II", the 2024 generation: its own model beside the Standard. */
const HERITAGE_STANDARD_II = /(?<![\w-])standard[\s-]+ii(?![\w-])/i
/** Custom Shop builds: "Custom Shop Core", "Custom Core", "Custom Shop Factory Special", "Custom Shop Relic". */
const HERITAGE_CUSTOM: readonly RegExp[] = cues('custom', 'core', 'factory special')
/** A Heritage member of `line`: Heritage named, refuses `otherMembers`. */
const heritage = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({ line, otherMembers, requires: HERITAGE_NAMED })

/** Taylor named (PAN-225): "GS Mini" and the model numbers are short. */
const TAYLOR_NAMED: readonly RegExp[] = [/(?<![a-z])taylor(?![a-z])/i]
/** "Builder's Edition", "Builders Edition", "Builders Ed.": the bevelled-armrest build, its own model and price. */
const TAYLOR_BUILDERS = /(?<![\w-])builder['’]?s?\s+ed(?:ition)?(?![a-z])/i
/** "Next Generation", "Next-Gen": the 2025 generation, its own Reverb page. */
const TAYLOR_NEXT_GEN = /(?<![\w-])next[\s-]?gen(?:eration)?(?![\w-])/i
/** The GS Mini woods are different instruments; "GS Mini e Koa" is the electro model written with a space. */
const TAYLOR_GS_MINI_OTHER: readonly RegExp[] = [...cues('mahogany', 'koa', 'rosewood', 'special edition', 'ltd', 'bass'), /mini\s+e(?![\w-])/i]
/** A Taylor member of `line`: Taylor named, refuses `otherMembers`. */
const taylor = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({ line, otherMembers, requires: TAYLOR_NAMED })

/** Guild named (PAN-226): "D-55" alone is a short code. */
const GUILD_NAMED: readonly RegExp[] = [/(?<![a-z])guild(?![a-z])/i]
/** A Guild member of `line`: Guild named, refuses `otherMembers`. */
const guild = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({ line, otherMembers, requires: GUILD_NAMED })

/** An SSL member of `line` (PAN-205): SSL named, refuses `otherMembers` and SSL_NEVER; parts unless after a marker. */
const ssl = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...SSL_NEVER], accessories: SSL_PARTS, requires: SSL_NAMED,
})
/** A single SSL unit: also refuses SSL_MULTI. Every promoted SSL row is one. */
const sslSingle = (line: string, ...otherMembers: RegExp[]): LineBoundary => ssl(line, ...otherMembers, ...SSL_MULTI)

/** The 2020 SSL 2+ (and its MKII): "SSL 2+", "SSL2+", "SSL 2 Plus", never the SSL 2. */
const SSL_2_PLUS = /ssl\s?-?2\s?(?:\+|plus)(?![\w])/i
/** The 2025 MKII revisions: "MKII", "MkII", "Mk II", "Mk.II", "Mk2", "Mark II", and the typo "MK11". */
const SSL_MK2: readonly RegExp[] = [/(?<![\w-])mk\s?\.?\s?(?:ii|2|11|ll)(?![\w-])/i, /(?<![\w-])mark\s?(?:ii|2)(?![\w-])/i]
/** A UF1 / UF8 / UC1 in any spelling ("UF-8", "UF 8", "uc1"), for the controller sets. */
const SSL_UF1 = /(?<![\w-])uf\s?-?1(?![\w-])/i
const SSL_UF8 = /(?<![\w-])uf\s?-?8(?![\w-])/i
const SSL_UC1 = /(?<![\w-])uc\s?-?1(?![\w-])/i
/** The ALPHA 8 converter, sold in bundles with the SSL 18 (and the 12): another product. */
const SSL_ALPHA_8 = /(?<![\w-])alpha\s?-?8(?![\w-])/i
/** The XLogic / Alpha / X-Rack VHD units, never the 500-series VHD Pre or VHD+. */
const SSL_XLOGIC: readonly RegExp[] = cues('alpha', 'xlogic', 'x-logic', 'x-rack', 'xr627')
/** The SiX CH 500-series channel strip ("SiX CH", "SiX Channel 500", "Channel Strip", "500-Series … Module"),
 * never the mixer; the mixer's "Six-Channel" (hyphen) and "6-Channel" are not it. */
const SSL_SIX_CH: readonly RegExp[] = [
  /six\s+(?:ch|channel)(?![\w-])/i, ...cues('channel strip', '500', '500-series', '500 series', 'module', 'lunchbox'),
]

/** A title that names the 1980–84 Prophet-10: Circuits/SCI, "vintage", its years or Rev 1–3. */
const PROPHET_10_VINTAGE =
  /(?<![\w-])(?:circuits|sci|vintage|19(?:7[89]|8[0-6])|rev\.?\s*[1-3](?!\d))(?![\w-])/i
/** A title that names the 2020 Prophet-10: Rev 4, Reissue, Desktop, Module, New, or 2019 on. */
const PROPHET_10_2020 =
  /(?<![\w-])(?:rev\.?\s*4|reissue|desktop|module|new|20(?:19|[23]\d))(?![\w\d-])/i

// ── PAN-221: Sequential, three eras, one maker ────────────────────────────
/**
 * A title that names a 1978–84 Prophet-5 (the Prophet-10 split, applied to its sibling under
 * owner decision 1 of 2026-10-02): Rev 1–3, SCI, "Circuits", "vintage" or a year of the run.
 */
const PROPHET_5_VINTAGE =
  /(?<![\w-])(?:circuits|sci|vintage|19(?:7[89]|8[0-4])|rev\.?\s*[1-3](?!\d))(?![\w-])/i
/** A title that names the 2020 Prophet-5: Rev 4, Reissue, Desktop, Module, New, or 2020 on. */
const PROPHET_5_2020 =
  /(?<![\w-])(?:rev\.?\s*4|reissue|desktop|module|new|20(?:2\d|3\d))(?![\w\d-])/i
/** The desktop / module version of a Sequential keyboard: its own Reverb page and price. */
const SEQ_DESKTOP = cues('desktop', 'module', 'modul', 'tabletop')
/**
 * Sequential, Sequential Circuits and Dave Smith Instruments parts and accessories, measured on
 * the 1,305 active titles naming them (2026-10-04): the parts trade outnumbers the units on every
 * vintage row (switches, side panels, EPROM sets, batteries) and sits on the new ones as stands and
 * controllers. Only what listing-intent.ts does not already read (covers, manuals, EPROMs, presets,
 * fuses, pots and sliders defer there, auditably). Marker-aware, so "DrumTraks with 30 EPROM
 * sounds" and "Tempest … + Decksaver" stay the instrument.
 */
const SEQ_PARTS: readonly string[] = [
  'knob', 'knobs', 'knob set', 'knob caps', 'pushbuttons', 'switch', 'switches', 'bushing', 'bushings', 'contacts',
  'contact strip', 'sides', 'side panels', 'wood panels', 'panels', 'enclosure', 'rom', 'firmware', 'os', 'ics', 'pcb',
  'transformer', 'power supply', 'psu', 'battery', 'cable', 'patches', 'sounds', 'sound set', 'sample pack',
  'binary files', 'badge', 'stand', 'controller', 'emulator', 'display', 'upgrade', 'kit', 'decksaver',
]

/** `cue`, unless `stronger` also appears anywhere in the title. */
function unlessAlso(cue: RegExp, stronger: RegExp): RegExp {
  return new RegExp(`${cue.source}(?!.*${stronger.source})(?<!${stronger.source}.*)`, 'i')
}

/** A member of `line` that refuses titles naming one of `otherMembers`; with none, it only joins the line. */
const member = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({ line, otherMembers })

/** The five-string: "Jazz Bass V", "Precision Bass® V", "5-string". */
const FIVE_STRING = /bass\W?\s+v(?![\w-])|(?<![\w-])5[-\s]?str/i

/**
 * Fender's 2025 Standard series shares its name with the Mexican Standard of
 * 1991–2018, and sellers mostly write it bare: "Fender Standard Jazz Bass -
 * Black". Only the new series has a laurel board or a 2025-on year, so that is
 * required, and an American or Mexican Standard, or an older year, is refused.
 */
const STANDARD_2025: Pick<LineBoundary, 'requires' | 'otherMembers'> = {
  requires: [...cues('laurel', 'lrl'), yearCue(2025, 2039)],
  otherMembers: [...cues('american', 'usa', 'mexico', 'mexican', 'mex', 'mim'), yearCue(1950, 2023)],
}

/** A '70s or '80s model name — "70s Explorer", "Flying V 70's" — never a bare "1970s" year. */
const DECADE_70S_80S = /(?<![\w'’])['’]?[78]0['’]?s(?![\w-])/i

/**
 * A two-digit Gibson reissue year — "'61", "63 SG Special", "´58" — never part
 * of a four-digit year or a serial number.
 */
const SHORT_YEAR = (decade: 5 | 6): RegExp =>
  new RegExp(`(?<![\\w\\d#-])['’‘´]?${decade}\\d(?![\\w\\d'’-])`, 'i')

/** Gibson Custom Shop and its reissue programmes: a model, never the base (PAN-198). */
const GIBSON_CUSTOM: readonly RegExp[] = cues(
  'custom shop', 'custom', 'historic', 'reissue', 'vos', 'murphy lab', 'murphy-lab',
  'm2m', 'made to measure', 'made 2 measure',
)

/**
 * PAN-230 step 5 (measured on the unmatched titles of the legendary rows, 2026-10-03). A pair, a
 * trio or a lot of one unit: the Neumann pair cues plus what Shure and Sony sellers write ("Sony
 * C-37A … Pair w PSU's", "Matched Trio Neumann Km84", "LOT OF 7 ORIGINAL CABLES Sony C37A").
 */
const PAIR_OR_LOT: readonly RegExp[] = [...NEUMANN_PAIR, ...cues('trio', 'matched trio', 'lot', 'lot of', 'set of', 'qty', 'quantity')]
/** A UAD or other plug-in listing that names the hardware it models: software is never the unit (PAN-214). */
const UAD_SOFTWARE: readonly RegExp[] = cues('plug-in', 'plugin', 'plug in', 'uad', 'download', 'activation card', 'activation', 'native', 'vst', 'aax')
/** A vacuum tube sold for the unit ("1 x NOS 6AU6A … ~ Sony C800g", "NOS KEN-RAD 6K6GT … Fender 6G15"). */
const TUBE_LISTING: readonly RegExp[] = cues(
  'nos', 'new old stock', '6au6', '6au6a', '12at7', '12at7wa', '12at7wc', '12ax7', 'ecc81', 'ecc83', 'ef94',
  '6k6', '6k6gt', '6v6', '7025', 'tubes', 'valves', 'tube only', 'tube set',
)
/** PAN-249: a dbx 160 plug-in, a pair, or a count before the brand ("2 dbx 160 1980s - black"). */
const DBX_160_NOT_THE_UNIT: readonly RegExp[] = [...UAD_SOFTWARE, ...PAIR_OR_LOT, /^\W*(?:[2-9]|two|three|four)\s+(?:x\s+)?dbx(?![\w-])/i]
/** Mic parts sold alone (a windscreen "for SM7, SM7A, and SM7B", a capsule, connectors) unless after a marker. */
const MIC_PARTS: readonly string[] = [
  'grille', 'grill', 'screen', 'windscreen', 'windscreens', 'cable set', 'cable', 'cables', 'clip', 'mic clip', 'pouch',
  'case', 'bag', 'stand', 'mount', 'shock mount', 'shockmount', 'adapter', 'cartridge', 'capsule', 'transformer',
  'connector', 'connectors', 'psu', 'power supply', 'foam', 'pop filter',
]
/** Amp parts: the retube kits and covers that dominate the 5150 and 2555 titles. */
const AMP_PARTS: readonly string[] = [
  'retube', 'tube kit', 'kit', 'tubes', 'valves', 'cover', 'footswitch', 'handle', 'handles', 'grill', 'grille',
  'logo', 'badge', 'knob', 'knobs', 'faceplate', 'chassis', 'transformer', 'transformers', 'trannies', 'panel',
]
/** Pedal parts. */
const PEDAL_PARTS: readonly string[] = ['cover', 'knob', 'knobs', 'footswitch', 'pcb', 'adapter', 'power supply', 'box only', 'manual']
/** Outboard parts and papers sold alone (a Massive Passive's spare band, an ELOP's manual) unless after a marker. */
const STUDIO_PARTS: readonly string[] = ['manual', 'faceplate', 'knob', 'knobs', 'tubes', 'tube set', 'power supply', 'psu', 'rack ears', 'cover', 'spare']
/**
 * PAN-230 tranche 2, Neve. Another maker's module that names the Neve it copies, measured on the
 * unmatched 1073 / 1081 / 33609 titles: "BAE 1073 Mic Pre/EQ Pair", "Audio maintenance Limited AML NEVE
 * 1073", "Vintech Audio X81 … Neve 1081 clone", "Chandler Limited LTD-1 … Neve clone", "Rupert Neve Designs
 * Shelford Channel … based off of Rupert's classic", "BAKU Pro Audio NEVE 1073 2-SLOT 3U RACK".
 */
const NEVE_CLONES: readonly RegExp[] = cues(
  'bae', 'brent averill', 'aml', 'audio maintenance', 'vintech', 'heritage audio', 'golden age', 'aurora', 'chandler',
  'shelford', 'rupert neve designs', 'baku', 'cranborne', 'clone', 'copy', 'copys', 'style', 'type', 'like', 'ala', '1023', '1075',
)
/** A title that names other 80-series modules beside the one in question is a parts lot or a console, not the unit. */
const NEVE_OTHER_MODULES: readonly RegExp[] = cues('1081', '1084', '1066', '1272', '2254', '31102', '33135', '33115', '35102', '31105', 'bcm-10', 'console', 'sidecar')
/** The Neve parts trade: screws, panels, connectors, transformers, empty racks, option cards, service mods. */
const NEVE_PARTS: readonly string[] = [
  'screw', 'screws', 'thumb screws', 'panel', 'side panel', 'blank panel', 'connector', 'connectors', 'amphenol', 'power supply', 'psu',
  'faceplate', 'switch', 'switches', 'caps', 'button', 'transformer', 'carnhill', 'marinair', 'rack', 'lunchbox', 'option card', 'card',
  'service', 'mod', 'kit', 'board',
]

/**
 * PAN-261. The amp trade's extras beyond AMP_PARTS, measured on the section's 1,938 titles: an output
 * transformer or recap kit for a Twin, a capacitor or pot set and a turret board for a JCM800, a Vox vent
 * or voltage selector, speakers, a flightcase sold alone ("Flightcase til Fender Bassman"), a slip cover.
 * A bundle keeps them: the inclusion-marker rule in lineBoundaryRefusal leaves "Twin Reverb m hardcase"
 * and "2203 + Cassa 1960AX" alone. Panter's G1 dry run (2026-10-14) added Fender's "Blues Junior Harmonica
 * with Necklace Lanyard" (a mouth harmonica) and a Danish "og" joining two products before any inclusion
 * marker ("Fender USA Stratocaster og Fender Blues Junior."); after a marker, "m cover og footswitch" stays.
 */
const AMP_ACCESSORIES: readonly string[] = [
  ...AMP_PARTS, 'tube', 'tube set', 'valve', 'valves', 'retube', 'recap', 'recap kit', 'capacitor', 'capacitors', 'capacitor set', 'cap set',
  'resistor', 'resistor set', 'pot', 'pots', 'pot set', 'turret', 'turret board', 'headshell', 'head shell', 'gehäuse', 'cabinet only', 'speaker', 'speakers',
  'reverb tank', 'tank', 'choke', 'strap', 'fixings', 'vent', 'vents', 'voltage selector', 'switch', 'power lead', 'power cord', 'cable', 'cables',
  'flightcase', 'flight case', 'road case', 'safe case', 'gig bag', 'gigbag', 'clamshell', 'slip cover', 'stand', 'manual', 'schematic',
  'sticker', 'pedal', 'overdrive pedal', 'di box', 'plugin', 'plug-in', 'cabinet', 'ata', 'anvil', 'poster', 'jewel', 'pilot light', 'lens',
  'transformator', 'udgangstransformator', 'udgangs transformator', 'harmonica', 'harmonicas', 'mundharmonika', 'lanyard',
  // A collectible lapel pin of an amp ("Marshall 1959 SLP Plexi Amplifier Head Collectible Lapel Pin", PAN-261 I2).
  'lapel', 'lapel pin',
  // A cover maker's tagline on a Tone Master listing (panter's I1, 2026-10-15): "… | Ultimate Amp Protection Made in the U.S.A."
  'amp protection',
]
/** A replacement speaker for the JC-120 / JC-120H, sold by its spec: "Roland 12\" 16 ohm 30-105A JC-120H" (panter's I1). */
const JC_SPEAKER: readonly string[] = ['ohm', 'ohms', 'højttaler', 'højtaler']
/** A two-digit year as the reissues write it: "'65 Twin Reverb", "65 Twin Reverb", "’68 Custom"; "1965" is not one. */
const YY = (yy: string): RegExp => new RegExp(`(?<![\\w-])['’‘]?${yy}(?![\\w-])`)
const REISSUE: readonly RegExp[] = cues('reissue', 're-issue', 'ri', 'avri')
const TONE_MASTER: readonly RegExp[] = cues('tone master', 'tonemaster')
const CUSTOM_68: readonly RegExp[] = [YY('68'), cue('68 custom')]
const CUSTOM_64: readonly RegExp[] = [YY('64'), cue('64 custom')]
/** A Boss "Legend series" pedal named for the amp (FBM-1 '59 Bassman, FDR-1 '65 Deluxe Reverb), 40 of 75 Bassman titles. */
const BOSS_LEGEND: readonly RegExp[] = cues('boss', 'fbm-1', 'fbm1', 'fdr-1', 'fdr1', 'legend series')
/** Another maker's amp built like it, or a kit of it: "guyatone twin reverb", "Amp-N Custom 5E3", "Mojotone JCM 800 2204 Marshall Clone". */
const AMP_COPY: readonly RegExp[] = cues('guyatone', 'music man', 'musicman', 'clone', 'kit', 'style', 'tribute', 'amp-n', 'mojotone', 'ceriatone')
/** A guitar sold with the amp ("Fender Telecaster Vinteras Roadworn + Fender blues junior förstärkare"): the price is the pair's. */
const BLUES_JUNIOR_NOT: readonly RegExp[] = [...BOSS_LEGEND, ...AMP_COPY, ...PAIR_OR_LOT, ...TUBE_LISTING, ...cues('hot rod', 'pro junior', 'blues deluxe', 'blues deville', 'junior collection', 'stratocaster', 'telecaster')]
/**
 * PAN-261 round 2. The '68 Custom series (2013–) is silverface-styled, but a drip edge (1968–69 only) or a title
 * that calls the amp silverface / blackface is the original's: "Fender Princeton Reverb 68 silverface drip edge"
 * writes the year the way the reissue does and is not the reissue.
 */
const CUSTOM_68_NOT: readonly RegExp[] = cues('drip edge', 'silverface', 'silver face', 'blackface', 'black face')
/** Every Bassman that is neither the tweed 5F6 nor the '59 LTD: the blackface and silverface heads, the numbered bass Bassmans. */
const BASSMAN_OTHERS: readonly RegExp[] = [
  ...TONE_MASTER, ...BOSS_LEGEND, ...AMP_COPY, ...PAIR_OR_LOT, ...TUBE_LISTING,
  ...cues('blackface', 'black panel', 'silverface', 'silver face', 'drip edge', 'piggyback', 'head', 'super bassman',
    'ten', 'twenty', 'fifty', 'pro', 'ts', 'neo', 'rumble', '10', '20', '50', '70', '100', '100t', '135', '150', '250', '300', '400', '410', '500', '800', '115', '1200'),
]
/**
 * What no member of the 1959 line is: the Randy Rhoads, the Studio Vintage SV20, the 50-watt 1987, a JCM / JTM,
 * a 1960 cabinet or a stack, a kit or a boutique copy, an overdrive pedal named for it.
 */
const PLEXI_OTHERS: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY,
  ...cues('1959rr', 'rr', 'randy rhoads', 'studio vintage', 'sv20', 'sv20h', 'sv20c', 'sv212',
    '1987', '1987x', '2203', '2204', 'jcm', 'jcm800', 'jcm 800', 'jtm', 'jtm45', 'jtm 45', '1962', 'bluesbreaker', 'stack', 'half stack', 'full stack', 'cabinet', 'cab', '4x12', '1960', '1960a', '1960b', '1960ax', '1960bx',
    'pedal', 'overdrive', 'metropoulos', 'germino', 'friedman', 'sozo', 'k&e', 'straight 8'),
]
/** The 1959HW (2005–, CSP 6050) and the 1959SLP (1993–, CSP 24221): each the other's refusal and its own requirement. */
const PLEXI_HW: readonly RegExp[] = cues('hw', '1959hw', 'handwired', 'hand-wired', 'hand wired')
const PLEXI_SLP: readonly RegExp[] = cues('slp', '1959slp')
/** What neither SLO-100 row is: the SLO-30, the rack SLO-100R, a mini, a pedal, a cabinet or a stack, a plug-in. */
const SLO_OTHERS: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY, ...UAD_SOFTWARE,
  ...cues('slo-30', 'slo 30', 'slo30', 'slo-100r', 'slo 100r', 'slo-100x', 'slo-100+', 'mini', 'pedal', 'cab', 'cabinet', '4x12', '2x12', 'combo', 'half stack', 'stack', 'astro', 'avenger', 'hot rod', 'hr50'),
]
/** The 6505+ written with a space ("Peavey 6505 + topteil"), which `cue('6505+')` cannot see. */
const PEAVEY_6505_PLUS = /(?<![\w-])6505\s?\+/i
/** What no 6505 head is: the 5150 (its own rows), the MH / Mini / Piranha, a cabinet, a combo, a module or a preamp. */
const PEAVEY_6505_OTHERS: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...AMP_COPY,
  ...cues('5150', 'mh', 'mini', 'micro', 'piranha', 'invective', '6534', 'synergy', 'module', 'preamp', 'cab', '412', '4x12', '212', '2x12', '112', '1x12', 'combo', 'slant', 'straight', 'evh'),
]
/**
 * The Korg-era AC30 Custom lines, each its own Reverb page: the C2 (2010–, CSP 4) and the CC2 Custom Classic
 * (2005–10, CSP 63762) are the rows; the C2X / CC2X Blue Alnico, the CC1, the CH / CCH heads, the HW, VR, S1,
 * VT and the Brian May are refused. Both refuse the AC15 / AC10 / AC4 family and a year before their run.
 */
const AC30_CUSTOM_OTHERS: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY,
  ...cues('hw', 'hw2', 'hwx', 'vr', 's1', 'c1', 'vtx', 'vt', 'ch', 'cch', 'cc1', 'bm', 'brian may', 'tv', 'head', '1x12', 'amplug', 'mini', 'pathfinder', 'korg',
    'ac15', 'ac-15', 'ac10', 'ac-10', 'ac4', 'ac-4', 'ac50', 'ac-50', 'ac100', 'ac-100', 'top boost', 'jmi', 'vintage edition'),
  // The same sub-models written glued to the AC30 ("AC30CC1", "AC30HW2", "AC30CH").
  /(?<![\w-])ac-?30\s?(?:cc1|cch|ch|hw\w*|vr|s1|c1|vt\w*|bm)(?![\w-])/i,
]
const AC30_C2 = /(?<![\w-])ac-?30\s?c2(?![\w-])/i
const AC30_C2X = /(?<![\w-])ac-?30\s?c2x(?![\w-])/i
const AC30_CC2 = /(?<![\w-])ac-?30\s?cc2(?![\w-])/i
const AC30_CC2X = /(?<![\w-])ac-?30\s?cc2x(?![\w-])/i
/** A Fender blackface original (1963–67; the silverface years stay with it): never a reissue, the Tone Master, a '68 / '64 Custom, a Boss pedal or a 1982-on year. */
const fenderVintageAmp = (line: string, ...more: RegExp[]): LineBoundary => ({
  line,
  otherMembers: [...REISSUE, ...TONE_MASTER, ...CUSTOM_68, ...CUSTOM_64, YY('65'), YY('57'), YY('59'), YY('62'), ...BOSS_LEGEND, ...AMP_COPY, ...PAIR_OR_LOT, ...TUBE_LISTING, ...cues('tremolux', 'vibro champ', 'vibro-champ', 'bandmaster', 'showman', 'b15n', 'b-15n'), yearCue(1982, 2039), ...more],
  accessories: AMP_ACCESSORIES,
})
/** A reissue row of the same line: it requires its own cue and refuses the others; a vintage-year title is the original's. */
const fenderReissueAmp = (line: string, requires: readonly RegExp[], ...more: RegExp[]): LineBoundary => ({
  line,
  requires,
  otherMembers: [...BOSS_LEGEND, ...AMP_COPY, ...PAIR_OR_LOT, ...TUBE_LISTING, yearCue(1963, 1981), ...more],
  accessories: AMP_ACCESSORIES,
})
const marshallJcm800 = (own: string, ...others: string[]): LineBoundary => ({
  line: 'jcm800',
  otherMembers: [
    ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY,
    ...cues(...others, `${own}x`, `${own}kk`, `${own}zw`, `${own}ms`, 'kerry king', 'zakk wylde', 'reissue', 're-issue', 'sc20', 'sc20h', 'sc20c', 'studio classic',
      '4210', '2205', '2210', '2555', 'jcm900', 'jcm 900', 'jcm2000', 'jcm 2000', 'dsl', 'tsl', 'combo', '2x12', '1x12', 'stack', 'half stack', 'full stack', '1959', 'super lead', 'plexi', 'jmp', 'anniversary',
      // Owner decision 2026-10-14 (PAN-261): a head sold with its cabinet is a bundle whose price is the pair's, so a
      // cabinet in the title refuses the row whether it comes before or after an inclusion marker, as on the plexi rows.
      '1960', '1960a', '1960b', '1960ax', '1960bx', '1982a', '1982b', 'cab', 'cabinet', 'kabinet', 'cassa', '4x12', '412'),
  ],
  accessories: [...AMP_ACCESSORIES, 'tb'],
})
// ── PAN-271: the brass section, trumpets first ────────────────────────────
/**
 * What the trumpet trade sells beside the horn, measured on the 96 DBA, 789 Finn and 99 Blocket titles
 * that name a trumpet (read-only, 2026-10-19): 30 of DBA's 74 unique titles were mouthpieces, mutes,
 * method books and sheet music. A case, a bag or a stand is NOT here: "Trompet i etui" sells the horn and
 * "i" is no inclusion marker, and the Norwegian "topp stand" is a condition; a case sold alone names its
 * model after "til" or "for", which the matcher already reads. Marker-aware, as every accessory list is:
 * "YTR-2330 trompet med mundstykke" keeps the trumpet. Exported so the brand wall (lib/brand-wall.ts) refuses
 * exactly what the rows refuse.
 */
export const BRASS_ACCESSORIES: readonly string[] = [
  'mouthpiece', 'mouthpieces', 'mundstykke', 'mundstykker', 'munnstykke', 'munnstykker', 'munstycke', 'munstycken', 'mundstück',
  'mute', 'mutes', 'sordin', 'dæmper', 'silent brass', 'leadpipe', 'lead pipe', 'ventilolie', 'valve oil', 'slide grease',
  'cleaning rod', 'cleaning snake', 'bore brush', 'maintenance kit', 'trim kit', 'lyre',
  'noder', 'nodehæfte', 'nodebog', 'noter', 'nothäfte', 'notenheft', 'bog', 'book', 'bok', 'method', 'skole', 'cd', 'lp', 'dvd', 'vinyl',
]
/** A Yamaha YTR row: the model number is the whole identity, so only the trade's extras and a lot refuse. */
const ytr = (): LineBoundary => ({ line: 'ytr', otherMembers: PAIR_OR_LOT, accessories: BRASS_ACCESSORIES })
/**
 * A Bach Stradivarius bell (37, 43, 72) is a Bb trumpet row: the Stradivarius trombones (36, 42, 50), cornets (181,
 * 184), C trumpets (C180 / 229) and flugelhorns are other products; the Mt. Vernon and New York eras and a
 * Corporation bell are collector pieces priced apart from the row (a row for them is an owner decision); and
 * "Bach" is also the composer, so a recording, a score or an organ is refused by name. Measured on the 18 DBA
 * "stradivarius" titles (12 of them violins) and the Finn / Blocket Bach titles of 2026-10-19.
 */
const BACH_NOT_THIS_TRUMPET: readonly RegExp[] = [
  ...PAIR_OR_LOT,
  ...cues('basun', 'trækbasun', 'trombone', 'tenortrombone', 'tenor trombone', 'bastrombone', 'bass trombone',
    'kornet', 'kornett', 'cornet', 'flugelhorn', 'flygelhorn', 'piccolo', 'piccolotrompet', 'sousafon', 'sousaphone', 'tuba', 'euphonium',
    'c-trompet', 'c trompet', 'c trumpet', 'c-trumpet', '229', 'c180', 'c190',
    'mt vernon', 'mt. vernon', 'mount vernon', 'new york', 'corporation', 'mercedes',
    'violin', 'fiol', 'viola', 'cello', 'orgel', 'organ', 'kantate', 'cantata', 'brandenburg', 'j.s.', 'js bach', 'johann sebastian'),
]
const stradivarius = (): LineBoundary => ({ line: 'stradivarius', otherMembers: BACH_NOT_THIS_TRUMPET, accessories: BRASS_ACCESSORIES })

/**
 * Korg's ARP 2600 reissue (PAN-266, G4 round 4): the 2600 FS (2020) and the 2600 M (2021), sold as "Korg ARP 2600 FS".
 * Its row `arp-korg-arp-2600` carries the ARP brand like the 1971 original, and a Korg title names two catalogue brands,
 * so the brand elimination cannot separate the two; this cue does. "_" ends the code ("ARP 2600 M_Analog Synthesizer").
 */
const KORG_ARP_2600: readonly RegExp[] = [cue('korg'), /(?<![\w-])2600\s?-?(?:fs|m)(?![a-z\d-])/i]

// ── PAN-280: boutique pedals — Strymon, EarthQuaker Devices, Hologram Electronics ───────────
/**
 * What the pedal trade sells beside the pedal, measured on the 33 DBA, 50 Finn, 30 Blocket and 333 Reverb titles that
 * name Strymon and the 27 DBA titles that name EarthQuaker (read-only, 2026-10-20): a power supply in three languages
 * ("Strymon strømforsyning - 9V DC center negativ"), a Decksaver after the model (a leading one is refused by the
 * intent layer already), a key chain, the Zuma / Ojai mounting and expansion kits and Strymon's own footswitches.
 * Marker-aware like every accessory list: "TimeLine Delay With Multi Switch" and "El Capistan V1 + Favorite Switch"
 * keep the pedal.
 */
const PEDAL_EXTRAS: readonly string[] = [
  ...PEDAL_PARTS, 'psu', 'strømforsyning', 'strömförsörjning', 'strømforsyning', 'netzteil', 'decksaver', 'key chain', 'keychain',
  'mounting kit', 'mounting brackets', 'expansion kit', 'multiswitch', 'multi switch', 'miniswitch', 'mini switch', 'favorite switch',
]
/**
 * Never the pedal: a lot, the maker's plug-in of it ("Strymon BigSky Plugin", UAD_SOFTWARE), a Eurorack module of it
 * (EarthQuaker's Afterneath module, Strymon's Magneto and StarLab) and another maker's copy.
 */
const PEDAL_NEVER: readonly RegExp[] = [...PAIR_OR_LOT, ...UAD_SOFTWARE, ...cues('eurorack', 'module', 'clone', 'kopi')]
/** A pedal row whose model word is its whole identity: the trade's extras and PEDAL_NEVER refuse, nothing else. */
const pedal = (line: string, ...more: RegExp[]): LineBoundary => ({ line, otherMembers: [...PEDAL_NEVER, ...more], accessories: PEDAL_EXTRAS })
/**
 * Strymon's MX generation (BigSky MX 2024, TimeLine MX 2026) is its own row with its own Reverb page: the original
 * refuses "MX" and the MX row requires it, so a title naming both resolves to the MX (step 5b). A V1 / V2 refresh of
 * the other Strymon pedals is the same row (owner, 2026-10-03: the row is the model), so no V cue is read there.
 */
// A trailing dash is part of the seller's punctuation, not of the word: "Strymon Big Sky MX- New!" (Reverb, 2026-10-20).
const STRYMON_MX: readonly RegExp[] = [/(?<![\w-])mx(?![\w]|-\w)/i]
const strymonMx = (line: string): LineBoundary => ({ line, requires: STRYMON_MX, otherMembers: PEDAL_NEVER, accessories: PEDAL_EXTRAS })

// ── PAN-282: the Electro-Harmonix Memory Man line ───────────────────────────────────────────
/**
 * Nine rows share one line and four of them share the model name "Deluxe Memory Man", the way `moog-model-d` and
 * `moog-minimoog-model-d-2022` share "Model D": the pedal has carried that name since 1976, so the era is read here,
 * not from the model name. Each cue is measured on the 136 Reverb titles that name a Memory Man, Memory Boy or
 * Memory Toy (production SELECT, 2026-10-21; DBA holds none today) and on the Reverb page of each row.
 *
 * The vintage unit (owner, 2026-10-21): a bare "Deluxe Memory Man" never goes to it — it needs a year of its run
 * (1976–84: the Reticon SAD1024 four-knob EH 7550 / EH 1307 of 1976–78 and the Panasonic MN3005 five-knob EH 7850 /
 * EH 1343 of 1978–84 are one row), "vintage", a face colour or an EH model number. The Reissue (1996–2007, the "big
 * box", EC 2000 / EC 2002) needs one of its years or words; the 2008– XO needs "XO" or a year from 2008; the Tap Tempo
 * (Panasonic MN3005) needs "tap tempo" or a bare "TT", and the 1100-TT and 550-TT are their own model names. A bare
 * "Deluxe Memory Man" with no era word therefore names no row: recall cost accepted, no era is wrong.
 */
const MM_VINTAGE: readonly RegExp[] = [
  yearCue(1970, 1989), DECADE_70S_80S,
  ...cues('vintage', 'blue face', 'blueface', 'silver face', 'silverface', 'black face', 'blackface', 'sad1024', 'sad 1024', 'reticon', 'squelch'),
  // Reverb's finish for the '70s unit: "1977 - Silver / Blue" (owner's screenshot, 2026-10-21).
  /(?<![\w-])(?:silver\s*\/\s*blue|blue\s*\/\s*silver)(?![\w-])/i,
  /(?<![\w-])eh[-\s]?(?:7500|7550|7810|7850|1307|1309|1338|1343)[a-c]?(?![\w-])/i,
  /(?<![\w-])(?:7550|7850)[a-c]?(?![\w-])/i,
]
/**
 * The pedal trade's extras, except that a knob COUNT is how a seller tells the four-knob SAD1024 unit from the
 * five-knob MN3005 one ("deluxe memory man vintage 4 knobs", Reverb 2026-10-21): a knob not preceded by a count
 * is still a knob for sale ("Black Knob for Hot Tubes, Hot Wax, MEL9, Deluxe Memory Man XO").
 */
const MM_EXTRAS: readonly (string | RegExp)[] = [
  ...PEDAL_EXTRAS.filter((noun) => noun !== 'knob' && noun !== 'knobs'), /(?<![\w-])(?<!\d[\s-])knobs?(?![\w-])/i,
]
/** The 1996–2007 reissue: its years, "reissue", the "big box" collectors call it, and the EC 2000 / EC 2002 boards. */
const MM_REISSUE: readonly RegExp[] = [
  yearCue(1996, 2007), /(?<![\w'’])['’]?90['’]?s(?![\w-])/i,
  ...cues('reissue', 'big box', 'bigbox', '1990s', 'ec2000', 'ec-2000', 'ec 2000', 'ec2002', 'ec-2002', 'ec 2002'),
]
/** The 2008– Deluxe Memory Man in the XO chassis: "XO" (sellers' word; EHX's own page calls it the Deluxe Memory Man) or a year of its run. */
const MM_XO: readonly RegExp[] = [cue('xo'), yearCue(2008, 2039)]
/** The Tap Tempo model: "tap tempo" or a bare "TT"; "1100-TT" and "550-TT" are the two later models (MM_TT_CODES). */
const MM_TAP_TEMPO: readonly RegExp[] = cues('tap tempo', 'tap-tempo', 'taptempo', 'tt')
/** "1100-TT", "1100 TT", "1100TT", a bare "1100" or "550" — never "550ms". */
const MM_TT_CODES: readonly RegExp[] = [/(?<![\w-])(?:1100|550)(?:[-\s]?tt)?(?![\w-])/i]
const MM_NANO: readonly RegExp[] = cues('nano')
/** The Stereo Memory Man with Hazarai (2007–); "stereo" alone also names the vintage EH 7811 Stereo Memory Man, which Klup holds no row for. */
const MM_HAZARAI: readonly RegExp[] = cues('hazarai', 'smmh', 'stereo')
/** The Memory Boy, Deluxe Memory Boy and Memory Toy: their own rows outside the line (owner: a different name and price class). */
const MM_SMALL: readonly RegExp[] = cues('boy', 'toy')
/** A Memory Man row: the line's other members and the pedal trade's extras refuse; `requires` is the row's era cue. */
const memoryMan = (requires: readonly RegExp[] | undefined, ...others: (readonly RegExp[])[]): LineBoundary => ({
  line: 'memory-man', otherMembers: [...PEDAL_NEVER, ...others.flat()], accessories: MM_EXTRAS, ...(requires ? { requires } : {}),
})

// ── PAN-286: Maestro vintage pedals (1962–79) and the Neo Instruments Ventilator family ─────
/**
 * Maestro was Gibson's effects brand from the 1962 Fuzz-Tone to Norlin's end in 1979, then nothing until the 2022
 * relaunch (Ranger, Comet, Orbit …), which Klup holds no row for. Every vintage row's model_name IS the code the
 * seller writes ("FZ-1A", "PS-1B", "EP-3" — the `boss-dm-2` form, because the model tier reads model_name as one
 * phrase and sellers put the code before or after the line word: "Maestro PS-1 Phase Shifter", "Maestro EP-4 Echo
 * Plex"), with the brand word required for the 70 floor; a row `requires` its code where the bare line word also
 * names a sibling or a relaunch pedal (a bare "Maestro Fuzz" or "Maestro Phaser" — DBA, 2026-10-21 — names no row).
 * Measured on the 174
 * production titles that say "maestro" (2026-10-21: ~110 Gibson / Epiphone guitars with a Maestro Vibrola, which
 * name no pedal model and stay with their guitar rows; 3 Formanta Maestro synths; ~45 Echoplex units and ~10
 * Echoplex parts and preamp copies) and on the Reverb sold titles behind each row.
 *
 * A year from 2000 on a vintage Maestro title is a copy or the relaunch ("Loophole Pedals Maestro Parametric Filter
 * MPF1 2026", "The Latent Audio Lemon Maestro Bass Brassmaster Octave Fuzz 2019"): the brand made nothing between
 * 1979 and 2022. Reverb's own "1970 - 1991" run on the EP-3 ends before that.
 */
const MAESTRO_MODERN: readonly RegExp[] = [yearCue(2000, 2039)]
/**
 * Never a vintage Maestro unit: a lot ("3 Maestro pedals : Fuzz Phazzer + Wha Wha + Volume", "Gibson ES-335 60s +
 * 2 Maestro Pedals & Case"), another maker's copy in the words sellers use ("Catalinbread Epoch Boost … Reproduction
 * of the famous Maestro Echoplex EP-3 Tape Echo Preamp Circuit", "DCW Pedals Exoplex … Maestro EP-3 Echoplex Style
 * Preamp", "Canterbury Audio Apollo Fuzz-Tone (Maestro fz-1 REPLICA)", "KVFX KVFZ-1 Skuzz-Tone (Maestro FZ-1
 * Fuzz-Tone) Handmade"), the plug-in of it. Not PEDAL_NEVER's "module": a seller calls an Echoplex a "Delay Module"
 * (Reverb, 2026-10-21) and the tape echo is one.
 */
const MAESTRO_NEVER: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...UAD_SOFTWARE, ...MAESTRO_MODERN,
  ...cues('clone', 'kopi', 'replica', 'reproduction', 'preamp', 'style', 'circuit', 'variant', 'pedals', 'eurorack', 'handmade', 'hand-made', 'hand built', 'handbuilt'),
]
/**
 * What the Maestro trade sells beside the unit (production Reverb titles, 2026-10-21): the Echoplex's thumb screws,
 * lid decal, bumper sticker, knobs, Tuki cover and footswitch ("PEDAL ONLY for Maestro Echoplex EP-3"), the PS-1's
 * PSFS footswitch, a dealer sheet, paperwork, an empty shell. Marker-aware: "… EP-3 Solid State w/Footswitch" and
 * "Fully working Maestro Echoplex EP-1 … with Original footswitch" keep the unit.
 */
const MAESTRO_PARTS: readonly string[] = [
  ...PEDAL_EXTRAS, 'thumb screws', 'thumb screw', 'screws', 'decal', 'decals', 'sticker', 'bumper sticker', 'lid',
  'cartridge', 'cartridges', 'dealer sheet', 'paperwork', 'shell', 'shell only', 'enclosure', 'pedal only',
  'foot switch', 'stand', 'parts',
]
/** A vintage Maestro row: the unit's code or line word is its identity; copies, lots, a modern year and the parts refuse. */
const maestro = (line: string, requires?: readonly RegExp[], ...others: RegExp[]): LineBoundary => ({
  line, otherMembers: [...MAESTRO_NEVER, ...others], accessories: MAESTRO_PARTS, ...(requires ? { requires } : {}),
})
/**
 * A sibling's code names the sibling unless the seller negates it: "Maestro Fuzz Tone FZ-1 NOT FZ-1A Real Deal
 * Original" (Reverb sold title, 2026-10-21) is the 1962 FZ-1. A negated code neither refuses the row it is NOT nor
 * satisfies the row it names: `code` carries the lookbehind.
 */
const NOT_NEGATED = '(?<!not\\s)(?<!not\\sthe\\s)(?<!not\\san\\s)(?<!not\\sa\\s)'
const code = (pattern: string): RegExp => new RegExp(`(?<![\\w-])${NOT_NEGATED}${pattern}(?![a-z0-9])`, 'i')
/** "FZ-1A", "FZ 1A", "FZ1-A", "FZ-1 A" — never "FZ-1AB"; the letter tells the three Fuzz-Tone rows apart. */
const FZ = (letter: string): RegExp => code(`fz[-\\s]?1[-\\s]?${letter}`)
/** The 2022 Fuzz-Tone FZ-M and the 1960s Canadian FZ-2: no row. */
const FZ_OTHERS: readonly RegExp[] = [/(?<![\w-])fz[-\s]?(?:m|2)(?![a-z0-9])/i, cue('mfz')]
/** "PS-1A" / "PS1-A" / "PS-1 B", or with `[ab]?` any of the three PS-1 codes — the one Phase Shifter row. */
const PS = (letter: string): RegExp => code(`ps[-\\s]?1[-\\s]?${letter}`)
/** "EP-3", "EP3", "EP 3" — never "EP-103" (Dunlop's Echoplex Delay, its own brand) or "EP-6T". */
const EP = (n: number): RegExp => new RegExp(`(?<![\\w-])ep[-\\s]?${n}(?![a-z0-9])`, 'i')
const EP_OTHERS = (n: number): RegExp[] => [1, 2, 3, 4].filter((m) => m !== n).map(EP).concat(cues('ep-6t', 'ep6t', 'em-1', 'groupmaster', 'ep-101', 'ep101', 'ep-103', 'ep103'))

/**
 * Neo Instruments' rotary-speaker simulators: the Ventilator (2009–13) and the Ventilator II (2014–) price 37 % apart
 * on Reverb's sold population (2026-10-21) and are two rows; the Mini Vent / Mini Vent II and the Micro Vent 16 /
 * 122 price within 15 % and are one row each (the Strymon V1 / V2 rule, owner 2026-10-03). The original takes a bare
 * "Ventilator" — Reverb's own page title is bare and every bare sold title was a V1 — and refuses "II" / "2"; the II
 * requires it. "Remote" is the footswitch sold for either ("Ventilator Remote II Footswitch for Ventilator II") and a
 * bundle marker keeps the unit ("Ventilator II with Ventilator Remote & Remote II").
 */
const VENT_II: readonly RegExp[] = [/(?<![\w-])(?:ii|2|mk\s?(?:2|ii))(?![\w-])/i]
const VENT_SMALL: readonly RegExp[] = cues('mini', 'micro', 'minivent', 'microvent', 'drive in')
const VENT_PARTS: readonly string[] = [...PEDAL_EXTRAS, 'remote', 'remote ii', 'venrem', 'halfmoon', 'half moon', 'fs-6']
const neoVent = (requires: readonly RegExp[] | undefined, ...others: RegExp[]): LineBoundary => ({
  line: 'ventilator', otherMembers: [...PEDAL_NEVER, ...others], accessories: VENT_PARTS, ...(requires ? { requires } : {}),
})

// ── PAN-290: the Lexicon classics and the Korg SDD delay family ─────
/**
 * Lexicon names its units by bare numbers and short codes ("224", "480L", "300", "PCM 70", "LXP-15", "MX200"), and
 * sellers write several in one title: a LARC remote "for 224XL/480L/300L/M300", a "Model 200 Reverberator (Like 224
 * 480L)", a "PCM 60 Reverb With 224 Sound". A row therefore refuses every OTHER line's code: a title that names two
 * Lexicon units names no row (fail-closed; the reference titles are the recall cost). Each line's code, measured on
 * the 105 production titles that say "lexicon", the 9 Lexicon ads live on DBA and the Reverb sold titles behind each
 * row (2026-10-21). A bare number never reads inside another code: "MX200", "MPX 200", "MS 200" and "PCM 70" are not
 * the 200 or the 70; "M300" is the 300 (sellers write both for the one unit, at one price).
 */
const NOT_LEX_PREFIX = '(?<![\\w-])(?<!(?:mx|mpx|ms|pcm|lxp|io)[\\s-])'
const LEX_LINE_CODES: Readonly<Record<string, RegExp>> = {
  '200': new RegExp(`${NOT_LEX_PREFIX}(?:model[\\s-])?200(?![\\w-])`, 'i'),
  '224': /(?<![\w-])224(?:[\s-]?xl?)?(?![\w-])/i,
  '300': new RegExp(`${NOT_LEX_PREFIX}(?:m[\\s-]?)?300(?:[\\s-]?l)?(?![\\w-])`, 'i'),
  '480l': /(?<![\w-])480(?:[\s-]?l)?(?![\w-])/i,
  '960l': /(?<![\w-])960(?:[\s-]?l)?(?![\w-])/i,
  'pcm': /(?<![\w-])pcm[\s-]?\d{2}(?![\w-])/i,
  'prime-time': /prime[\s-]?(?:ii[\s-]?)?time|(?<![\w-])model[\s-]?9[357](?![\w-])/i,
  'lxp': /(?<![\w-])lxp[\s-]?\d/i,
  'mx': /(?<![\w-])mx[\s-]?\d{3}/i,
}
/**
 * Never a Lexicon unit: a lot, the software (the UAD "Lexicon 224 Digital Reverb Plug-In", Lexicon's own "PCM Native
 * Reverb Plug-In Bundle" and "LXP Native Reverb", a UAD-2 card "with 23 plug ins … Lexicon 224"), and the Lexicon units
 * Klup holds no row for — the MPX processors (DBA's two live "Lexicon MPX 100"), the Reflex sold "with 224XL Sound",
 * the Alex, the Vortex, the JamMan.
 */
const LEX_NEVER: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...UAD_SOFTWARE, /(?<![\w-])mpx/i, /(?<![\w-])uad-2(?![\w])/i,
  // A Lexicon sold beside another maker's unit: "Kemper Profiler rack guitar preamp / effektprocessor + Lexicon PCM 90
  // effekt" (DBA, 3,000 kr for both).
  /(?:\+|&|(?<![\w-])(?:og|and|plus))\s*lexicon(?![\w-])/i,
  ...cues('plugins', 'plug-ins', 'plug ins', 'software', 'ilok', 'reflex', 'alex', 'vortex', 'jamman'),
]
/**
 * The Lexicon parts trade (production Reverb titles, 2026-10-21): a LARC sold alone ("Lexicon LARC Remote for
 * 224XL/480L/300L/M300", "224x REMOTE ONLY"), the 480L's cartridges and memory cards, NVS and extender cards, EPROMs
 * and firmware, PCM 41 / 42 knob caps and jacks, the Prime Time's panel, memory PCB and transformer, batteries,
 * manuals, power supplies. Marker-aware: "224X Digital Reverberator with LARC" and "480L … with LARC Remote" keep the
 * unit, so a LARC is refused only where it leads the title or is sold "only". Not a bare `card`: "Lexicon 480 m. Larc,
 * Classic Card" (DBA, 31,000 kr) is the unit with its card.
 */
const LEX_PARTS: readonly (string | RegExp)[] = [
  /^\W*(?:lexicon\s+)?larc(?![\w-])/i, 'remote only', 'larc only', 'remote control', 'larc cable', 'cable', 'card for',
  'cartridge', 'cart', 'memory card', 'nvs card', 'extender card', 'hsp card', 'eprom', 'eproms', 'firmware', 'rom chip',
  'battery', 'manual', 'service manual', 'knob', 'knobs', 'knob cap', 'encoder', 'pcb', 'front panel', 'panel',
  'transformer', 'power transformer', 'power supply', 'adapter', 'psu', 'switch', 'phone jack', 'brochure',
  'product guide', 'faceplate', 'rack ears',
]
/**
 * A Lexicon row: the codes of every other group and LEX_NEVER refuse, as do `siblings` within its own group. Every
 * Lexicon row is ONE line, `lexicon`, the 200 included: the code form reads "MX200" as "mx 200" and "M300" as "m 300",
 * so the 200 and the MX200 are both candidates on an MX200 title, and only a refusal within one line separates them
 * (step 5b) instead of deferring the title as a two-product tie.
 */
const lexicon = (group: string, requires: readonly RegExp[] | undefined, ...siblings: RegExp[]): LineBoundary => ({
  line: 'lexicon',
  otherMembers: [...LEX_NEVER, ...Object.entries(LEX_LINE_CODES).filter(([g]) => g !== group).map(([, re]) => re), ...siblings],
  accessories: LEX_PARTS,
  ...(requires ? { requires } : {}),
})
const PCM = (n: number): RegExp => new RegExp(`(?<![\\w-])pcm[\\s-]?${n}(?![\\w-])`, 'i')
const PCM_OTHERS = (n: number): RegExp[] => [41, 42, 60, 70, 80, 81, 90, 91, 92, 96].filter((m) => m !== n).map(PCM)
/** "Prime Time II", "Prime Time 2", "Prime II Time Model 95" (a Reverb sold title), "Model 95". */
const PRIME_TIME_II = /prime[\s-]?time[\s-]?(?:ii|2)(?![\w-])|prime[\s-]ii[\s-]time|(?<![\w-])model[\s-]?95(?![\w-])/i
const SUPER_PRIME_TIME = /(?<![\w-])super[\s-]?prime|(?<![\w-])model[\s-]?97(?![\w-])/i
const LXP = (n: number): RegExp => new RegExp(`(?<![\\w-])lxp[\\s-]?${n}(?![\\w-])`, 'i')
/** "LXP-15 II", "LXP-15 Version II" (Reverb's own page title), "LXP 15 MkII". */
const LXP_15_II = /(?<![\w-])lxp[\s-]?15[\s-]?(?:ii|2|mk[\s-]?(?:ii|2)|v(?:ersion)?[\s-]?(?:ii|2))(?![\w-])/i
const MX = (n: number): RegExp => new RegExp(`(?<![\\w-])mx[\\s-]?${n}(?![\\w-])`, 'i')
const MX_400XL = /(?<![\w-])mx[\s-]?400[\s-]?xl(?![\w-])/i

/**
 * Korg's SDD delays: the SDD-1000 (1983), SDD-2000 (1985) and SDD-3000 (1982) racks and the 2014 SDD-3000 pedal
 * ("SDD-3000-PDL"). The rack and the pedal share the model name sellers write, "SDD-3000", and price apart ($1,000 vs
 * $300 on Reverb's sold population, 2026-10-21): the pedal requires its word, its code or a year from 2014; a bare
 * "Korg SDD-3000" is the rack — DBA's bare "SDD 3000 Korg Delay," asks 7,000 kr, the rack's price, and the pedal's
 * sellers name it a pedal. "SDD" is never "SD": Korg's analog SD-200 / SD-400 and Roland's SDE-3000 share no token.
 * A copy names the rack it copies ("DTS SDD-3KP Pre-Amplifier (based on the Korg SDD-3000)", "Korg SDD-1200 Vintage
 * Digital Delay Rack (Sdd-3000's Hot Cousin)") and is no row.
 */
const SDD = (n: number): RegExp => new RegExp(`(?<![\\w-])sdd[\\s-]?${n}(?![\\w-])`, 'i')
const SDD_OTHERS = (n: number): RegExp[] => [1000, 1200, 2000, 3000, 3300].filter((m) => m !== n).map(SDD)
const SDD_PEDAL: readonly RegExp[] = [/pedal|(?<![a-z])pdl(?![a-z])|(?<![\w-])stomp/i, yearCue(2014, 2039)]
const SDD_NEVER: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...UAD_SOFTWARE,
  ...cues('dts', '3kp', 'sdd-3kp', 'preamp', 'pre-amp', 'pre-amplifier', 'based on', 'cousin', 'clone', 'kopi'),
]
/** The SDD parts trade: tactile and power switches, batteries, service manuals on DVD, power supplies. Marker-aware. */
const SDD_PARTS: readonly string[] = [
  ...PEDAL_EXTRAS, 'switch', 'switches', 'tactile switch', 'power switch', 'battery', 'manuals', 'service manual',
  'service manuals', 'brochure', 'brochures', 'dvd',
]
const sdd = (line: string, requires: readonly RegExp[] | undefined, ...others: RegExp[]): LineBoundary => ({
  line, otherMembers: [...SDD_NEVER, ...others], accessories: SDD_PARTS, ...(requires ? { requires } : {}),
})

// ── PAN-291: Oto Machines and the Ensoniq samplers and outboard ─────────────
/**
 * `code` as a whole word, only in a title that also names `maker` (before or after it). Every PAN-291 row requires
 * its own code this way: the codes are short or common words that other things carry ("EPS Cement lättbetong 50
 * liter", "ESP The Mirage Custom Shop", "Epiphone Biscuit-8E", "Roland DP-2" damper pedal), and an identifier needs
 * no brand word, so the boundary supplies it. As a `requires` cue the matched code is blanked before the marker
 * search, so the "Plus" of "EPS 16 Plus" or "DP/4 Plus" is never read as "sold with" (the PAN-261 6505+ rule).
 */
const withMaker = (maker: string, code: string): RegExp =>
  new RegExp(`(?<=${maker}[\\s\\S]*)(?<![\\w-])(?:${code})(?![\\w-])|(?<![\\w-])(?:${code})(?![\\w-])(?=[\\s\\S]*${maker})`, 'i')
/** "Ensoniq", and "Ensonic" as two DBA ads spelled it on 2026-10-21 ("Ensonic KT-76", "Ensonic SQ1 Plus"). */
const ENSONIQ = '(?<![a-z])ensoni[qc](?![a-z])'
const ensoniqCode = (code: string): RegExp => withMaker(ENSONIQ, code)
/**
 * Never an Ensoniq unit, whatever precedes it: the PAN-200 vocabulary (tact switches, "for parts", "not working",
 * clones, lots), measured on the 668 production titles that name Ensoniq, Oto, Mirage, ASR or EPS (2026-10-21), of
 * which about 60 % are not the unit.
 */
const ENSONIQ_NEVER: readonly RegExp[] = [
  ...ROLAND_NEVER, ...cues('one sheet', 'reference cards', 'poster', 'book', 'scsi interface clone', 'needs repair', 'broken', 'partially working', 'non functioning', 'no sound'),
  // A part sold for every model of a line ("AC Line Filter for Ensoniq ESQ-1 (both), ESQ-M, Mirage (all)") and the
  // Transoniq Hacker, the Ensoniq users' newsletter ("Transoniq Hacker Ensoniq Mirage Operations").
  /\(\s*(?:all|both)(?:\s+versions)?\s*\)/i, ...cues('transoniq hacker', 'line filter'),
]
/**
 * What the Ensoniq trade sells beside the unit, marker-aware (production titles, 2026-10-21): the floppy sound
 * libraries and boot disks, the OS EPROMs and upgrades, the floppy emulators, the OEX output expanders, the ME / FB
 * memory expanders and flash banks, covers, rack ears, keys, sliders, faders, encoders, jacks, transformers, power
 * supplies and the battery. "Ensoniq ASR-10 with SCSI and Gotek USB emulator", "… EPS-16 Plus Sampler with PREMIUM
 * GoTek FlashFloppy Emulator + HUGE Sample Library!" and "Mirage DSK-8 … Working with Disks!" keep the unit. Taken
 * out of ROLAND_PARTS, each measured on an Ensoniq unit it refused: `lcd` and `oled` ("Purple LCD Screen", "DP/2 OLED
 * screen, aluminum caps, new battery"), `caps`. Deliberately not here: a bare `os` or `firmware` ("DP/4 … Latest OS +
 * Manuals", "v1.15 Firmware Latest!"), a bare `floppy`, `gotek` or `emulator` ("Mirage DSK-8 … 1984 - Gotek floppy"),
 * `disc` ("Waveboy Effects Disc, Purple Screen"), `display` ("Purple Display Version - 16MB") and `ram` ("ASR-X Pro
 * 66MB RAM / 8 Outs / EXP-3"); a `key` after a key count is the keybed ("ASR 10 KEYBOARD SAMPLER 16 meg/61 key"), and
 * a title that ends in "floppy" sells the drive ("Ensoniq ASR-10 Rackmount  floppy", 540 kr).
 */
const ENSONIQ_PARTS: readonly (string | RegExp)[] = [
  ...ROLAND_PARTS.filter((p) => p !== 'lcd' && p !== 'oled' && p !== 'caps'),
  'floppy disk', 'floppy disks', 'floppy emulator', 'floppy drive emulator', 'diskets', 'diskettes', 'discs',
  'boot disk', 'disk drive', 'sample library', 'library', 'sound disk', 'sound disks', 'operating system', 'os upgrade',
  'os update', 'eprom', 'cover', 'dust cover', 'output expander', 'expander', 'memory expansion', 'memory cartridge',
  'cartridge', 'card', 'flash bank', 'flashbank', /(?<!(?:25|37|49|61|76|88)[\s-]?)(?<![\w-])keys?(?![\w-])/i, /(?<!gotek\s)(?<![\w-])floppy\s*$/i,
  'potentiometer', 'slider', 'fader',
  'faders', 'trafo', 'transformer', 'power supply', 'wheel assembly', 'cooling fan', 'jack', 'jack board', 'din jack',
  'cable', 'encoder', 'data encoder', 'scsi card', 'displayboard', 'ears', 'converter', 'battery only', 'replacement battery',
]
/** An Ensoniq row: it requires its code in a title that names Ensoniq; the other members, parts and papers refuse. */
const ensoniq = (line: string, code: string, ...others: RegExp[]): LineBoundary => ({
  line, otherMembers: [...others, ...ENSONIQ_NEVER], accessories: ENSONIQ_PARTS, requires: [ensoniqCode(code)],
})
/** The ASR-10 (keyboard and rack, "ASR-10R"), the ASR-X and its Pro; the ASR-88 is the 88-key ASR-10 and has no row. */
const ASR_10 = /(?<![\w-])asr[-\s]?10(?![0-9])/i
const ASR_X = /(?<![\w-])asr[-\s]?x(?![a-z0-9])/i
const ASR_88 = /(?<![\w-])as[r]?[-\s]?88(?![0-9])/i
/** "EPS-16 Plus", "EPS 16+", "EPS16+" and the bare "EPS-16" (Ensoniq made no other); and the EPS-M, the classic EPS's rack (3 sold on Reverb, no row). */
const EPS_16 = /(?<![\w-])eps[-\s]?16(?![0-9])/i
const EPS_16_PLUS = 'eps[-\\s]?16(?:[-\\s]?(?:\\+|plus))?'
const EPS_M = /(?<![\w-])eps[-\s]?m(?![a-z0-9])/i
/** "Rack", "Rackmount", "Rack-mount", "Rack Mount". */
const RACK_WORD = '(?<![\\w-])rack(?:[-\\s]?mount)?(?![\\w-])'
const RACK = new RegExp(RACK_WORD, 'i')
/** The EPS-16 Plus code in a title that also says rack, on either side of it. */
const EPS_16_PLUS_RACK = `(?:${EPS_16_PLUS})(?=[\\s\\S]*${RACK_WORD})|(?<=${RACK_WORD}[\\s\\S]*)(?:${EPS_16_PLUS})`
/** The Mirage keyboards (DSK-8 1984, DSK-1 1986) and racks (DMS-8 1985, DMS-1 1986). */
const DSK = (n: string): RegExp => new RegExp(`(?<![\\w-])dsk[-\\s]?${n}(?![0-9])`, 'i')
const DMS = /(?<![\w-])dms[-\s]?[18](?![0-9])/i
/** A DMS code, or "Mirage" with the rack word ("Ensoniq Mirage rack", "Ensoniq MIRAGE Rack W/ Gotek USB", Reverb sold). */
const MIRAGE_RACK = `dms[-\\s]?[18]|mirage(?=[\\s\\S]*${RACK_WORD})`
/** "DP/4", "DP-4", "DP4", "DP 4"; the DP/4+ ("DP/4+", "DP/4 Plus"). */
const DP = (n: string): string => `dp\\s?[/-]?\\s?${n}`
const DP_4_PLUS = new RegExp(`(?<![\\w-])${DP('4')}\\s?(?:\\+|plus)`, 'i')

/**
 * OTO Machines (Paris, 2009–): the Biscuit, the BIM / BAM / BOUM desktop trio and the Bébé Chérie mixer. Sellers write
 * "OTO Machines", "Oto" and "OTO BAM Reverb" (DBA, 2026-10-21); every row requires its own word beside "Oto", because
 * "Biscuit" is an Epiphone resonator on DBA and BIM / BAM are three letters. A title naming two of the trio is a
 * bundle ("OTO Machines BIM & BAM Bundle!", Reverb sold) and names no row.
 */
const OTO = '(?<![a-z])oto(?![a-z])'
const OTO_WORDS: Readonly<Record<string, RegExp>> = {
  biscuit: cue('biscuit'), bim: cue('bim'), bam: cue('bam'), boum: cue('boum'), 'bebe-cherie': /(?<![\w-])b[eé]b[eé][-\s]?ch[eé]rie(?![\w-])/i,
}
const OTO_PARTS: readonly string[] = [...PEDAL_EXTRAS, 'stand', 'stands', 'deck saver', 'rack ears', 'rack kit']
const oto = (line: keyof typeof OTO_WORDS, code: string): LineBoundary => ({
  line: `oto-${line}`,
  otherMembers: [...PEDAL_NEVER, ...Object.entries(OTO_WORDS).filter(([w]) => w !== line).map(([, re]) => re)],
  accessories: OTO_PARTS,
  requires: [withMaker(OTO, code)],
})

// ── PAN-293: Eventide, FMR Audio, TC Electronic and Tube-Tech ──────────────
/**
 * Eventide's units, each by the word sellers write for it (Reverb sold and live titles, production titles, DBA,
 * 2026-10-21). Every Eventide row requires its own word beside "Eventide" (`withMaker`): "Space" is a Roland Space
 * Echo, "Rose" a Floyd Rose, "Eclipse" a guitar finish and "H9" a Shure wireless band ("Shure BLX288/SM58-H9"). All
 * Eventide rows are ONE line, `eventide`, so a refusal inside the line separates two units a title names (step 5b)
 * instead of deferring it as a two-product tie.
 */
const EVENTIDE = '(?<![a-z])eventide(?![a-z])'
const EV: Readonly<Record<string, RegExp>> = {
  h90: /(?<![\w-])h[\s-]?90(?![0-9])/i,
  h9: /(?<![\w-])h[\s-]?9(?![0-9])/i,
  h9max: /(?<![\w-])h[\s-]?9[\s-]?max(?![\w-])/i,
  // The tier word may stand apart from the code: "Eventide H9 Harmonizer Standard Multi-Effect Pedal".
  h9core: /(?<![\w-])core(?![\w-])/i,
  h9standard: /(?<![\w-])standard(?![\w-])/i,
  timefactor: /time[\s-]?factor/i,
  pitchfactor: /pitch[\s-]?factor/i,
  modfactor: /mod[\s-]?factor/i,
  space: /(?<![\w-])space(?![\w-])/i,
  blackhole: /black[\s-]?hole/i,
  micropitch: /micro[\s-]?pitch/i,
  ultratap: /ultra[\s-]?tap/i,
  tricerachorus: /tricera[\s-]?chorus/i,
  riptide: /(?<![\w-])riptide(?![\w-])/i,
  rose: /(?<![\w-])rose(?![\w-])/i,
  knifedrop: /knife[\s-]?drop/i,
  eclipse: /(?<![\w-])eclipse(?![\w-])/i,
  h8000: /(?<![\w-])h[\s-]?8000/i,
  h7600: /(?<![\w-])h[\s-]?7600/i,
  h3500: /(?<![\w-])h[\s-]?3500/i,
  h3000: /(?<![\w-])h[\s-]?3000/i,
  h949: /(?<![\w-])h[\s-]?949(?![0-9])/i,
  h969: /(?<![\w-])h[\s-]?969(?![0-9])/i,
  h910: /(?<![\w-])h[\s-]?910(?![0-9])/i,
  dsp4000: /(?<![\w-])dsp[\s-]?4000/i,
  h9000: /(?<![\w-])h[\s-]?9000/i,
  orville: /(?<![\w-])orville(?![\w-])/i,
  omnipressor: /omnipressor/i,
  sp2016: /(?<![\w-])sp[\s-]?2016(?![0-9])/i,
  instantphaser: /instant[\s-]?phaser/i,
}
/**
 * Never an Eventide unit: the plug-ins of the same names (Eventide sells the H910, H949, Omnipressor, Instant Phaser,
 * SP2016, Blackhole, MicroPitch, UltraTap and the H3000 as plug-ins: "Eventide H910 Harmonizer® Plug-In (Download)",
 * "Clockworks Bundle H910 H949 Omnipressor SP2016 (Activation Card)", "H3000 Factory Mk II", "H3000 Band Delays"), a
 * pair or a lot, a unit sold for parts, another maker's copy, and the expression pedals sold "for the H9" ("Mission
 * Engineering EP1-H9").
 */
const EV_NEVER: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...UAD_SOFTWARE,
  /(?<![\w-])h[\s-]?3000\s+(?:factory|band\s+delays)/i,
  // "Clockworks" alone is Eventide's 1970s name ("Eventide Clockworks Instant Phaser PS-101"); the plug-in bundle is not.
  /clockworks\s+(?:bundle|legacy)/i,
  ...cues('bundle', 'ilok', 'anthology', 'parts', 'for parts', 'parts only', 'repair', 'not working', 'broken', 'for repair',
    'needs repair', 'non functioning', 'non-functioning', 'as is', 'as-is', 'clone', 'kopi', 'replica', 'emulation', 'eurorack'),
]
/**
 * The Eventide parts and papers trade (production and Reverb sold titles, 2026-10-21), marker-aware: the H3000 / H3500
 * / H8000 front switches and caps, the battery-backed RAM and its batteries, ROM sets, EPROM and OS upgrades ("H3000 to
 * H3500B-DFX MAXIMUM Preset OS Upgrade!"), the sampler board, the H9000's Dante card, the EVE/NET remote, service
 * manuals and schematics, transformers, power supplies, and the pedals' footswitches, expression pedals, stands and
 * covers. "H9 Max with Mission Expression Pedal" and "H9000 … with Dante Expansion Card" keep the unit; a bare
 * `upgraded` is the unit ("H3000 Upgraded to H3500B-DFX").
 */
const EV_PARTS: readonly string[] = [
  ...PEDAL_EXTRAS, 'switch', 'switches', 'switch cap', 'pushbutton', 'push button', 'battery', 'batteries', 'battery backed ram',
  'nvram', 'sram', 'rom set', 'serom', 'dante card', 'expansion card', 'dante expansion card',
  'eprom', 'eproms', 'os upgrade', 'upgrade', 'upgrade kit', 'service manual', 'schematics', 'transformer', 'sampler board',
  'expression pedal', 'expression', 'eve/net', 'eve / net', 'eve net', 'remote control', 'cable', 'faceplate', 'rack ears',
  'power cord', 'stand', 'lamp set', 'led display',
]
/**
 * An Eventide row: its own word beside "Eventide"; EV_NEVER and the named units of the line refuse. Unlike `withMaker`,
 * a hyphen may follow the code: "H3000-D/SE", "H3000-B" and "TimeFactor-Delay" are the unit.
 */
const eventide = (code: string, refuses: readonly (keyof typeof EV)[], ...more: RegExp[]): LineBoundary => ({
  line: 'eventide',
  otherMembers: [...EV_NEVER, ...refuses.map((k) => EV[k]), ...more],
  accessories: EV_PARTS,
  requires: [new RegExp(`(?<=${EVENTIDE}[\\s\\S]*)(?<![\\w-])(?:${code})(?![a-z0-9])|(?<![\\w-])(?:${code})(?![a-z0-9])(?=[\\s\\S]*${EVENTIDE})`, 'i')],
})
/** The Factor pedals, the dot9 pedals and the Rose name no other unit; the H9s carry their algorithms by name. */
const EV_PEDALS: readonly (keyof typeof EV)[] = [
  'h90', 'h9', 'timefactor', 'pitchfactor', 'modfactor', 'space', 'blackhole', 'micropitch', 'ultratap', 'tricerachorus',
  'riptide', 'rose', 'knifedrop',
]
const evPedal = (self: keyof typeof EV, code: string, ...also: (keyof typeof EV)[]): LineBoundary =>
  eventide(code, EV_PEDALS.filter((k) => k !== self && !also.includes(k)))
/** The rack units name no other rack unit, except where the listed predecessor is a reference. */
const EV_RACKS: readonly (keyof typeof EV)[] = [
  'eclipse', 'h8000', 'h7600', 'h3500', 'h3000', 'h949', 'h969', 'h910', 'dsp4000', 'h9000', 'orville', 'omnipressor',
  'sp2016', 'instantphaser',
]
const evRack = (self: keyof typeof EV, code: string, also: readonly (keyof typeof EV)[] = [], ...more: RegExp[]): LineBoundary =>
  eventide(code, EV_RACKS.filter((k) => k !== self && !also.includes(k)), ...more)

/**
 * FMR Audio (Texas): the RNC1773 Really Nice Compressor, the RNP8380 Really Nice Preamp and the RNLA7239 Really Nice
 * Leveling Amplifier. Sellers write "FMR RNC", "FMR Audio RNC 1773", "FMR Really Nice Compressor" and "Really Nice
 * Compressor RNC1773" (Reverb sold, 2026-10-21). A row requires its code beside "FMR", or its full "Really Nice" name:
 * "RNC" and "RNP" are three letters ("Rupert Neve Designs Rnp2 Mbc Portico II", production). The 500-series RNC500 and
 * RNLA500 are other units; a pair is no single-unit price.
 */
const FMR = '(?<![a-z])fmr(?![a-z])'
const FMR_NEVER: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...UAD_SOFTWARE, /(?<![\w-])rn(?:c|la)[\s-]?500/i, /(?<![\w-])500[\s-]?series/i,
  ...cues('rupert neve', 'portico', 'for parts', 'not working', 'broken', 'as is', 'as-is', 'clone', 'kopi', 'kit', 'diy'),
]
const FMR_PARTS: readonly string[] = ['power supply', 'psu', 'adapter', 'wall wart', 'rack ears', 'rack kit', 'rack mount kit', 'manual', 'cable', 'knob', 'knobs']
const FMR_WORDS: Readonly<Record<string, RegExp>> = {
  rnc: /(?<![\w-])rnc(?![a-z])|really\s+nice\s+comp/i,
  rnp: /(?<![\w-])rnp(?![a-z])|really\s+nice\s+(?:mic\s+)?pre/i,
  rnla: /(?<![\w-])rnla(?![a-z])|really\s+nice\s+level/i,
}
const fmr = (self: keyof typeof FMR_WORDS, code: string, name: RegExp): LineBoundary => ({
  line: 'fmr-audio',
  otherMembers: [...FMR_NEVER, ...Object.entries(FMR_WORDS).filter(([k]) => k !== self).map(([, re]) => re)],
  accessories: FMR_PARTS,
  requires: [withMaker(FMR, code), name],
})

/**
 * TC Electronic's classic racks: the 2290 Dynamic Digital Delay (1985) and the 1210 Spatial Expander (1980s, the
 * stereo chorus / flanger rack). Sellers write "TC Electronic 2290", "T.C. Electronic 2290", "TC 2290" and "TC2290".
 * Each row requires its number beside "TC": "1210" is also Technics' turntable and "2290" a stock number. The
 * reissues that share the number are other units: the 2290 P pedal (2023, $249 on Reverb against the rack's $1,584)
 * and the 2290-DT / 1210-DT desktop plug-in controllers; so are the 0144 controller pedal, rack stands and switches.
 */
const TC = '(?<![a-z])t\\.?\\s?c\\.?(?=[\\s-]*(?:electronics?(?![a-z])|\\d{4}))'
const TC_NEVER: readonly RegExp[] = [
  ...PAIR_OR_LOT, ...UAD_SOFTWARE, /(?:2290|1210)[\s-]?(?:p|dt)(?![a-z0-9])/i,
  ...cues('pedal', 'stompbox', 'desktop', 'toneprint', 'for parts', 'not working', 'broken', 'clone', 'kopi', 'replica'),
]
const TC_PARTS: readonly string[] = [
  'switch', 'push button', 'pushbutton', 'battery', 'battery replacement kit', 'controller', 'remote', 'power supply',
  'manual', 'service manual', 'stand', 'rack ears', 'eprom', 'firmware', 'knob', 'knobs', 'faceplate',
]
const TC_RACKS: Readonly<Record<string, RegExp>> = { '2290': /(?<![0-9])2290(?![0-9])/, '1210': /(?<![0-9])1210(?![0-9])/ }
const tcRack = (self: keyof typeof TC_RACKS): LineBoundary => ({
  line: 'tc-electronic',
  otherMembers: [...TC_NEVER, ...Object.entries(TC_RACKS).filter(([k]) => k !== self).map(([, re]) => re)],
  accessories: TC_PARTS,
  requires: [new RegExp(`${TC}[\\s\\S]*?(?<![0-9])${self}(?![0-9])|(?<![0-9])${self}(?![0-9])[\\s\\S]*${TC}`, 'i')],
})

/**
 * Tube-Tech (Lydkraft, Copenhagen, 1985–): each model by its code as sellers write it ("CL 1B", "CL1B", "CL-1B",
 * "CL2-A"), beside "Tube-Tech", "Tube Tech", "TubeTech" or "Lydkraft". All Tube-Tech rows are one line, `tube-tech`:
 * a title naming two models is a rack bundle ("MEC 1A + MP 2A + LCA 2B … + Rack") and names neither, except where a
 * title names a later model as what the unit preceded ("CL 1A … Vintage Rare Lydkraft pre CL1B", "PE 1B … PE 1C").
 */
const TUBE_TECH = '(?<![a-z])(?:tube[\\s-]?tech|lydkraft)(?![a-z])'
const ttCode = (letters: string, digit: string, suffix: string): string => `${letters}[\\s-]?${digit}[\\s-]?${suffix}`
const TT_CODES: Readonly<Record<string, string>> = {
  cl1a: ttCode('cl', '1', 'a'), cl1b: ttCode('cl', '1', 'b'), cl2a: ttCode('cl', '2', 'a'),
  lca2a: ttCode('lca', '2', 'a'), lca2b: ttCode('lca', '2', 'b'),
  pe1b: ttCode('pe', '1', 'b'), pe1c: ttCode('pe', '1', 'c'), me1a: ttCode('me', '1', 'a'), me1b: ttCode('me', '1', 'b'),
  eq1a: ttCode('eq', '1', 'a'), mp1a: ttCode('mp', '1', 'a'), mp2a: ttCode('mp', '2', 'a'), mec1a: ttCode('mec', '1', 'a'),
  mmc1a: ttCode('mmc', '1', 'a'), smc2b: ttCode('smc', '2', 'b'), smc2bm: ttCode('smc', '2', 'bm'), hlt2a: ttCode('hlt', '2', 'a'),
  ssa2a: ttCode('ssa', '2', 'a'),
}
const TT_WORD = (k: string): RegExp => new RegExp(`(?<![\\w-])${TT_CODES[k]}(?![a-z0-9])`, 'i')
/** Never a Tube-Tech unit: a Warm Audio copy ("WA-1B Tube Tech CL1B-Style"), a plug-in, a pair, a modified unit (owner). */
const TT_NEVER: readonly RegExp[] = [
  ...WARM_AUDIO_COPY, ...UAD_SOFTWARE, ...PAIR_OR_LOT,
  ...cues('modified', 'modded', 'mod', 'upgraded', 'for parts', 'not working', 'broken', 'needs repair', 'as is', 'as-is',
    'clone', 'kopi', 'replica', 'mastering suite', 'couple of'),
]
const TT_PARTS: readonly string[] = [
  'manual', 'faceplate', 'knob', 'knobs', 'power supply', 'psu', 'rack ears', 'cover', 'spare', 'tube set', 'opto cell',
  'transformer', 'power cable',
]
const tubeTech = (self: keyof typeof TT_CODES, ...also: (keyof typeof TT_CODES)[]): LineBoundary => ({
  line: 'tube-tech',
  otherMembers: [...TT_NEVER, ...Object.keys(TT_CODES).filter((k) => k !== self && !also.includes(k)).map(TT_WORD)],
  accessories: TT_PARTS,
  requires: [withMaker(TUBE_TECH, [self, ...also].map((k) => TT_CODES[k]).join('|'))],
})

export const LINE_BOUNDARIES: Readonly<Record<string, LineBoundary>> = {
  // The ORIGINAL Model D, 1970–81. Owner: "Minimoog → vintage only".
  'moog-minimoog': {
    line: 'minimoog',
    otherMembers: [
      cue('voyager'),
      cue('reissue'), cue('re-issue'),
      // Any year from 1990 on is a Voyager (2002–) or a reissue (2016–).
      yearCue(1990, 2039),
      // Editions of the reissue.
      cue('geddy lee'), cue('tribute'),
      ...MOOG_NEVER,
    ],
    accessories: MOOG_PARTS,
  },
  // The 2016 reissue. Frozen boundary: "2016 REISSUE only". PAN-199 (manager
  // decision 2026-09-30): the 2022– re-run is its own product,
  // `moog-minimoog-model-d-2022`, so a 2022-or-later year refuses here. A title
  // with no year stays here, as before: nothing in it separates the runs.
  'moog-model-d': {
    line: 'minimoog',
    otherMembers: [
      cue('voyager'),
      // Vintage originals: the production years, and the words sellers use.
      yearCue(1969, 1985), cue("70's"), cue("80's"),
      cue('vintage'), cue('original'),
      cue('early model'), cue('late model'), cue('early version'),
      // A signature edition with its own KG row (moog-minimoog-model-d-geddy-lee).
      cue('geddy lee'),
      MINIMOOG_2022_RUN,
      ...MOOG_NEVER,
    ],
    accessories: MOOG_PARTS,
  },
  // PAN-199. The 2022– re-run (Reverb CSP 163810: new cabinet and upgrades).
  // Its model_name is "Model D", the reissue's own (the promote SQL sets it), so
  // it requires the year that proves the run; every other title keeps its old home.
  'moog-minimoog-model-d-2022': {
    ...moog('minimoog', cue('voyager'), cue('geddy lee'), yearCue(1969, 2021)),
    requires: [MINIMOOG_2022_RUN],
  },
  // PAN-199. The Voyager line (2002–) joins the Minimoog line, so a Voyager title
  // the vintage row refuses resolves to the Voyager (step 5b). The base refuses
  // its separate models; its editions (Performer, Signature, Electric Blue,
  // Select, Anniversary) are the base.
  'moog-minimoog-voyager': moog(
    'minimoog', ...cues('xl', 'rme', 'rack mount', 'old school', 'oldschool', 'voyager os'),
  ),
  'moog-minimoog-voyager-xl': moog('minimoog'),
  'moog-minimoog-voyager-rme': moog('minimoog'),
  'moog-minimoog-voyager-old-school': moog('minimoog'),
  // PAN-199. The base MF-104 (2000–01) is not the MF-104M, MF-104Z or MF-104S(D),
  // which sellers also write "MF 104M" and "MF-104z ... mf104".
  'moog-mf-104': moog('mf-104', MF_104_LATER),
  'moog-mf-104m': moog('mf-104'),
  'moog-mf-104z': moog('mf-104'),
  // PAN-199. The Memorymoog Plus (MIDI + sequencer) is its own model.
  'moog-memorymoog': moog('memorymoog', cue('plus')),
  'moog-memory-plus': moog('memorymoog'),
  // PAN-199. The Subsequent 37 CV (Reverb CSP 48104) has no KG row: refused, not absorbed.
  'moog-subsequent-37-synth': moog('subsequent-37', cue('cv')),
  // PAN-199. The Sirin is "the Analog Messenger of Joy": that title is not the 2024 Messenger.
  'moog-messenger': moog('messenger', cue('sirin'), cue('messenger of joy')),
  'moog-sirin': moog('messenger'),
  // PAN-199. The Etherwave Plus (Reverb CSP 6630) has no KG row. A 2022 Etherwave
  // sold "like Etherwave PLUS" is this model.
  'moog-etherwave-theremin': moog('etherwave', /(?<!like\s)etherwave\s+(?:theremin\s+)?plus(?![\w-])/i),
  // PAN-199. Every other Moog row the promotion makes a match target, and the
  // supported Source: each its own line, with the Moog parts vocabulary.
  'moog-cp-251': moog('moog-cp-251'),
  'moog-dfam': moog('moog-dfam'),
  'moog-grandmother': moog('moog-grandmother'),
  'moog-labyrinth': moog('moog-labyrinth'),
  'moog-liberation': moog('moog-liberation'),
  'moog-little-phatty': moog('moog-little-phatty'),
  'moog-matriarch': moog('moog-matriarch'),
  'moog-mavis': moog('moog-mavis'),
  'moog-mf-101-lowpass-filter': moog('moog-mf-101-lowpass-filter'),
  'moog-mf-102': moog('moog-mf-102'),
  'moog-mf-103': moog('moog-mf-103'),
  'moog-mf-105': moog('moog-mf-105'),
  'moog-mf-105m-midi-murf': moog('moog-mf-105m-midi-murf'),
  'moog-micromoog': moog('moog-micromoog'),
  'moog-minitaur': moog('moog-minitaur'),
  'moog-mother-32': moog('moog-mother-32'),
  'moog-multimoog': moog('moog-multimoog'),
  'moog-muse': moog('moog-muse'),
  'moog-one-16-voice': moog('moog-one-16-voice'),
  'moog-one-8-voice': moog('moog-one-8-voice'),
  'moog-opus-3': moog('moog-opus-3'),
  'moog-polymoog-203a': moog('moog-polymoog-203a'),
  'moog-prodigy': moog('moog-prodigy'),
  'moog-rogue': moog('moog-rogue'),
  'moog-satellite': moog('moog-satellite'),
  'moog-slim-phatty': moog('moog-slim-phatty'),
  'moog-sonic-six': moog('moog-sonic-six'),
  'moog-source': moog('moog-source'),
  'moog-spectravox': moog('moog-spectravox'),
  'moog-sub_phatty': moog('moog-sub_phatty'),
  'moog-subharmonicon': moog('moog-subharmonicon'),
  'moog-subsequent-25': moog('moog-subsequent-25'),
  'moog-taurus-3': moog('moog-taurus-3'),
  'moog-taurus-i': moog('moog-taurus-i'),
  'moog-taurus-ii': moog('moog-taurus-ii'),
  'moog-theremini': moog('moog-theremini'),
  // ── PAN-200: Roland ──────────────────────────────────────────────────────
  // The public rows first: the frozen prose boundaries (data/klup-launch-cohort-frozen.csv,
  // owner-ratified) encoded, plus the Roland parts vocabulary. Then every row the PAN-200
  // promote SQL makes a match target, each in its line; the Boutique re-creations share
  // their original's line so a title naming both resolves to the Boutique (step 5b).
  // Frozen boundary: "Single page. Juno-6/60 are separate pages. HS-60 is the consumer-badged
  // 106 and shares this page." The Boutique JU-06 and the Juno-106S are other members.
  'roland-juno-106': roland('juno', JU_06, BOUTIQUE, /(?<![\w-])juno[-\s]?106\s?s(?![\w-])/i),
  // Frozen: "Distinct from Juno-6 (patch memory) and Juno-106 (MIDI)."
  'roland-juno-60': roland('juno', JU_06, BOUTIQUE),
  // Frozen: "Split from Juno-60/106."
  'roland-juno-6': roland('juno', JU_06, BOUTIQUE),
  // Frozen: "Distinct from Jupiter-6/-4 and from Jupiter-X/Xm." The Boutique JP-08 and the
  // MKS-80 Super Jupiter rack are other members.
  'roland-jupiter-8': roland('jupiter', /(?<![\w-])jp[-\s]?08(?![\w-])/i, BOUTIQUE, /(?<![\w-])jupiter[-\s]?x/i, cue('mks-80'), cue('super jupiter')),
  // Frozen: "Distinct from Jupiter-6/-8 and the Compuphonic badge variant." The Jupiter-4's own
  // panel reads Compuphonic (manager decision 2026-10-01), so that word is not a cue.
  'roland-jupiter-4': roland('jupiter'),
  // Frozen: "Exclude TR-08/TR-8/TR-8S and clones." Behringer's RD-8 and RD-9 are the clones by name.
  'roland-tr-808': roland('tr-808', TR_08, BOUTIQUE, cue('aira'), /(?<![\w-])rd[-\s]?[89](?![\w-])/i),
  // Frozen: "Exclude TR-09 (Boutique)."
  'roland-tr-909': roland('tr-909', /(?<![\w-])tr[-\s]?0?9(?![\w-])/i, BOUTIQUE, /(?<![\w-])rd[-\s]?9(?![\w-])/i),
  // Frozen: "Distinct from TR-626 and the TB-303 it was sold alongside." The Boutique TR-06
  // ("TR-06 Authentic TR-606 Boutique") is another member.
  'roland-tr-606': roland('tr-606', TR_06, BOUTIQUE),
  // Frozen: "SPLIT from TR-727 (different voice set, different buyer). Distinct from TR-06 Boutique."
  'roland-tr-707': roland('tr-707', TR_06, BOUTIQUE),
  // Frozen: "Exclude SH-01/SH-01A (Boutique) and SH-4d."
  'roland-sh-101': roland('sh-101', /(?<![\w-])sh[-\s]?01a?(?![\w-])/i, BOUTIQUE, /(?<![\w-])sh[-\s]?4\s?d(?![\w-])/i),
  // Frozen: "RE-201 only. Distinct from RE-101/RE-150/RE-301 (same gross-list family) and from
  // RE-2/RE-20 pedals." Boss makes the pedals (and the RE-202); "BOSS Roland Space Echo RE-201" is
  // still the RE-201, so the brand word is not a cue, the pedal names are.
  'roland-re-201': roland('space-echo', RE_2, /(?<![\w-])sre[-\s]?555(?![\w-])/i),
  // Frozen: "RE-501 Chorus Echo. SRE-555 is the rack sibling in the same gross-list family."
  'roland-re-501': roland('space-echo', /(?<![\w-])sre[-\s]?555(?![\w-])/i, RE_2),
  // PAN-230. The SDD-320 Dimension D rack (1979–87): never Boss's DC-2 / DC-2W Dimension C pedals.
  'roland-sdd-320-dimension-d': roland('sdd-320', /(?<![\w-])dc[\s-]?2w?(?![\w-])/i, ...cues('dimension c', 'rack ears')),
  // Frozen: "SPLIT from System-100M. The 100 is semi-modular; the 100M is a modular rack system."
  // The row is the Model 101 synthesizer (its CSP); the 102 expander, 103 mixer, 104 sequencer and
  // 109 speakers are the system's other pieces, priced apart.
  'roland-system-100': roland('system-100', /(?<![\w-])(?:system[-\s]?)?100[-\s]?m(?![\w-])/i, /(?<![\w-])model\s?10[2-9](?![\w-])/i),
  // The other public rows and every promoted row.
  'roland-alpha-juno-1': roland('alpha-juno'),
  'roland-alpha-juno-2': roland('alpha-juno'),
  'roland-d-50': roland('d-50', /(?<![\w-])d[-\s]?05(?![\w-])/i, BOUTIQUE),
  'roland-d-550': roland('d-50'),
  'roland-fantom-x6': roland('fantom-x'),
  'roland-fantom-x8': roland('fantom-x'),
  'roland-fantom-xa': roland('fantom-x'),
  'roland-jd-08': roland('jd-800'),
  // The Boutique JD-08 re-creates the JD-800; the Boutique JX-08 and JX-03 the JX-8P and JX-3P;
  // the D-05 the D-50; the TB-03 and the AIRA TB-3 the TB-303.
  'roland-jd-800': roland('jd-800', /(?<![\w-])jd[-\s]?08(?![\w-])/i, BOUTIQUE),
  'roland-ju-06': roland('juno'),
  'roland-ju-06a': roland('juno'),
  'roland-juno-106s': roland('juno'),
  'roland-juno-d': roland('juno-d'),
  'roland-juno-d6': roland('juno-d'),
  'roland-juno-d7': roland('juno-d'),
  'roland-juno-d8': roland('juno-d'),
  'roland-jp-08': roland('jupiter'),
  'roland-jupiter-50': roland('jupiter'),
  'roland-jupiter-6': roland('jupiter'),
  'roland-jupiter-80': roland('jupiter'),
  'roland-jupiter-xm': roland('jupiter'),
  'roland-jx-03': roland('jx-3p'),
  'roland-jx-3p': roland('jx-3p', /(?<![\w-])jx[-\s]?03(?![\w-])/i, BOUTIQUE),
  'roland-jx-08': roland('jx-8p'),
  'roland-jx-8p': roland('jx-8p', /(?<![\w-])jx[-\s]?08(?![\w-])/i, BOUTIQUE),
  'roland-cr-68': roland('roland-cr-68'),
  'roland-cr-78': roland('roland-cr-78'),
  'roland-cr-8000': roland('roland-cr-8000'),
  'roland-cube-lite': roland('roland-cube-lite'),
  'roland-d-110': roland('roland-d-110'),
  'roland-d-20': roland('roland-d-20'),
  'roland-d-70': roland('roland-d-70'),
  'roland-dj-70': roland('roland-dj-70'),
  'roland-em101': roland('roland-em101'),
  'roland-fantom-s': roland('roland-fantom-s'),
  'roland-gr-300': roland('roland-gr-300'),
  'roland-gr-700': roland('roland-gr-700'),
  // The JC-120H head is an amp: its parts are the amp trade's, and a speaker sold by its spec is not it (PAN-261).
  'roland-jc-120h': { ...roland('roland-jc-120h'), accessories: [...ROLAND_PARTS, ...AMP_ACCESSORIES, ...JC_SPEAKER] },
  'roland-jc-22': roland('roland-jc-22'),
  'roland-jc-85': roland('roland-jc-85'),
  'roland-jd-990': roland('roland-jd-990'),
  'roland-jd-xa': roland('roland-jd-xa'),
  'roland-jp-8000': roland('roland-jp-8000'),
  'roland-jp-8080': roland('roland-jp-8080'),
  'roland-juno-di': roland('roland-juno-di'),
  'roland-juno-ds-61': roland('roland-juno-ds-61'),
  'roland-juno-g': roland('roland-juno-g'),
  'roland-juno-stage': roland('roland-juno-stage'),
  'roland-juno-x': roland('roland-juno-x'),
  'roland-jv-1000': roland('roland-jv-1000'),
  'roland-jv-1010': roland('roland-jv-1010'),
  'roland-jv-1080': roland('roland-jv-1080'),
  'roland-jv-2080': roland('roland-jv-2080'),
  'roland-jv-30': roland('roland-jv-30'),
  'roland-jv-880': roland('roland-jv-880'),
  'roland-jv-90': roland('roland-jv-90'),
  'roland-jx-1': roland('roland-jx-1'),
  'roland-jx-10': roland('roland-jx-10'),
  'roland-jx-305': roland('roland-jx-305'),
  'roland-kc-200': roland('roland-kc-200'),
  'roland-kc-400': roland('roland-kc-400'),
  'roland-mc-09': roland('roland-mc-09'),
  'roland-mc-202': roland('roland-mc-202'),
  'roland-mc-303': roland('roland-mc-303'),
  'roland-mc-307': roland('roland-mc-307'),
  'roland-mc-505': roland('roland-mc-505'),
  'roland-mc-808': roland('roland-mc-808'),
  'roland-mc-909': roland('roland-mc-909'),
  'roland-mks-10': roland('roland-mks-10'),
  'roland-mks-30': roland('roland-mks-30'),
  'roland-mks-50': roland('roland-mks-50'),
  'roland-mks-7': roland('roland-mks-7'),
  'roland-mks-70': roland('roland-mks-70'),
  'roland-mks-80': roland('roland-mks-80'),
  'roland-mobile-cube': roland('roland-mobile-cube'),
  'roland-mrs-2': roland('roland-mrs-2'),
  'roland-mt-32': roland('roland-mt-32'),
  'roland-pdx-6': roland('roland-pdx-6'),
  'roland-r-70': roland('roland-r-70'),
  // The R-8 MKII (1992) is its own model, and so is the R-8M module ("Roland R 8 M").
  'roland-r-8': roland('roland-r-8', /(?<![\w-])r[-\s]?8\s?m(?![\w-])/i, ...MK_II),
  // The RS-09 MKII has its own Reverb CSP (81037).
  'roland-rs-09': roland('roland-rs-09', ...MK_II),
  'roland-rs-101': roland('roland-rs-101'),
  'roland-rs-202-strings': roland('roland-rs-202-strings'),
  'roland-rs-50': roland('roland-rs-50'),
  'roland-rs-505-paraphonic': roland('roland-rs-505-paraphonic'),
  'roland-s-10': roland('roland-s-10'),
  'roland-s-220': roland('roland-s-220'),
  'roland-s-330': roland('roland-s-330'),
  'roland-s-50': roland('roland-s-50'),
  'roland-s-770': roland('roland-s-770'),
  'roland-saturn-09': roland('roland-saturn-09'),
  'roland-sh-01-gaia': roland('roland-sh-01-gaia'),
  'roland-sh-09': roland('roland-sh-09'),
  'roland-sh-1': roland('roland-sh-1'),
  'roland-sh-1000': roland('roland-sh-1000'),
  'roland-sh-2': roland('roland-sh-2'),
  'roland-sh-2000': roland('roland-sh-2000'),
  'roland-sh-201': roland('roland-sh-201'),
  'roland-sh-32': roland('roland-sh-32'),
  'roland-sh-3a': roland('roland-sh-3a'),
  'roland-sh-5': roland('roland-sh-5'),
  'roland-sh-7': roland('roland-sh-7'),
  'roland-sp-808': roland('roland-sp-808'),
  'roland-svc-350': roland('roland-svc-350'),
  'roland-tb-303': roland('tb-303', /(?<![\w-])tb[-\s]?0?3(?![\w-])/i, BOUTIQUE, cue('aira'), cue('td-3'), cue('xoxbox'), cue('x0xb0x')),
  'roland-tr-626': roland('roland-tr-626'),
  'roland-u-110': roland('roland-u-110'),
  'roland-u-20': roland('roland-u-20'),
  // The V-Synth XT (rack) and GT are their own models; the 1980 SPV-355 is a "P/V Synth".
  'roland-v-synth': roland('roland-v-synth', /(?<![\w-])v[-\s]?synth\s?(?:xt|gt)(?![\w-])/i, /(?<![\w-])spv[-\s]?355(?![\w-])/i),
  'roland-vp-330': roland('roland-vp-330'),
  'roland-vp-550': roland('roland-vp-550'),
  'roland-vp-770': roland('roland-vp-770'),
  'roland-vp-9000': roland('roland-vp-9000'),
  'roland-w-30': roland('roland-w-30'),
  'roland-xp-10': roland('roland-xp-10'),
  'roland-xp-30': roland('roland-xp-30'),
  'roland-xp-50': roland('roland-xp-50'),
  'roland-xp-60': roland('roland-xp-60'),
  'roland-xp-80': roland('roland-xp-80'),
  'roland-xv-3080': roland('roland-xv-3080'),
  'roland-xv-5080': roland('roland-xv-5080'),
  'roland-sh-01a': roland('sh-101'),
  // The 2005 SP-404 is not the SX (2011), the A (2019) or the MKII (2021): "SP-404 MK2".
  'roland-sp-404': roland('sp-404', /(?<![\w-])sp[-\s]?404[-\s]?(?:sx|a|mk\s?(?:ii|2|Ⅱ))(?![\w-])/i, ...MK_II),
  'roland-sp-404-mkii': roland('sp-404'),
  'roland-sp-404a': roland('sp-404'),
  'roland-sp-404sx': roland('sp-404'),
  'roland-re-150': roland('space-echo'),
  'roland-re-301': roland('space-echo'),
  'roland-sre-555': roland('space-echo'),
  'roland-tr-06': roland('tr-606'),
  'roland-tr-727': roland('tr-707'),
  'roland-tr-08': roland('tr-808'),
  'roland-tr-8s': roland('tr-808'),
  'roland-tr-09': roland('tr-909'),
  // ── PAN-202: Neumann ─────────────────────────────────────────────────────
  // The public U 87 Ai first (its frozen prose boundary encoded), then every row the PAN-202
  // promote SQL makes a match target, each in its line. Pairs are refused on every single mic
  // and monitor (decision 2); Studio Sets and mic + mount bundles are left as origin/main
  // decides them (decision 3, owner pending).
  // Frozen: "U 87 Ai (1986-) ONLY; the vintage U 87/U87i is a different circuit and price."
  'neumann-u87ai': neumannSingle('u87', ...U87_PRE_AI),
  // The pre-Ai U 87 (1967–85, incl. the U 87 i): never an Ai, nor the anniversary editions
  // (Gold 1998, Rhodium 2017), whose titles often carry no "Ai".
  'neumann-u87': neumannSingle('u87', U87_AI, cue('ai'), yearCue(1986, 2039), ...cues('rhodium', 'anniversary', 'gold')),
  // The tube U 47 (1947–65): never the U 47 fet or its Collector's Edition, nor the U 47a
  // (K47 capsule, Nuvistor tube) or a rebuild. This holds at the SKU tier too: the row's own
  // "U47" identifier fires on "U47 FET", and the refusal removes that candidate (step 2).
  'neumann-u47': neumannSingle('u47', ...U47_FET, COLLECTOR, /(?<![\w-])u[\s-]?47\s?a(?![\w-])/i, ...cues('wagner', 'archut', 'bon scott')),
  // The vintage U 47 fet; the 2014 Collector's Edition is another member.
  'neumann-u47-fet': neumannSingle('u47', COLLECTOR, ...cues('bon scott')),
  // The Collector's Edition shares the fet's model name, so it fails closed without its name.
  'neumann-u47-fet-collectors-edition': { ...neumannSingle('u47'), requires: [COLLECTOR] },
  // The original U 67 (1960–71) and the 2018 reissue, sold as the "U 67 Set". A plain
  // "U67 Set" with no vintage word is the reissue.
  'neumann-u67': neumannSingle('u67', ...U67_REISSUE, ...U67_REBUILD, unlessAlso(cue('set'), U67_VINTAGE_ANY)),
  'neumann-u67-reissue': {
    ...neumannSingle('u67', ...U67_VINTAGE, ...U67_REBUILD),
    requires: [...U67_REISSUE, cue('set')],
  },
  // KH 120 A (2010–23), KH 120 II (2023–) and the digital-input KH 120 D.
  'neumann-kh-120-a': neumannSingle('kh120', /(?<![\w-])kh[\s-]?120[\s-]?(?:ii|2|mk\s?ii|mk\s?2|d)(?![\w-])/i, ...MK_II, ...MONITORS),
  'neumann-kh-120-ii': neumannSingle('kh120', /(?<![\w-])kh[\s-]?120[\s-]?d(?![\w-])/i, ...MONITORS),
  'neumann-kh-80': neumannSingle('kh-80', ...MONITORS),
  // KMS 104 and the KMS 104 Plus (extended low end) are separate models.
  'neumann-kms-104': neumannSingle('kms104', cue('plus'), /(?<![\w-])kms[\s-]?104[\s-]?d(?![\w-])/i),
  'neumann-kms-104-plus': neumannSingle('kms104'),
  // The single KM 184; the SKM 184 stereo set is its own row.
  'neumann-km-184': neumannSingle('km-184', /(?<![\w-])skm[\s-]?184/i),
  // PAN-230. The vintage KM 84 (1966–92, incl. the KM 84 i): never the KM 184 that replaced it,
  // the KM 83/85/86/88 siblings or the KM 284; trios are refused like pairs.
  'neumann-km-84': neumannSingle('km-84', /(?<![\w-])km[\s-]?(?:183|184|185|284|83|85|86|88|64)(?![\w-])/i, ...cues('trio', 'matched trio')),
  // The digital TLM 103 D (Solution-D) is not the TLM 103, nor are its anniversary editions
  // (Reverb lists the 25th and 75th apart: 169359, 13790, 146979).
  'neumann-tlm-103': neumannSingle('tlm-103', /(?<![\w-])tlm[\s-]?103[\s-]?d(?![\w-])/i, ...cues('anniversary', 'limited edition')),
  'neumann-tlm-102': neumannSingle('tlm-102'),
  'neumann-tlm-49': neumannSingle('tlm-49'),
  // Headphones and an interface: "pair" is not a quantity and "cable" is in the box.
  'neumann-ndh-20': member('ndh-20', ...NEUMANN_NEVER),
  'neumann-mt-48': member('mt-48', ...NEUMANN_NEVER),
  // ── PAN-203: Warm Audio ──────────────────────────────────────────────────
  // Every row the PAN-203 promote SQL makes a match target, each in its line. Pairs are refused
  // on every single unit; the pair rows are not promoted. Bundles keep their extras.
  // WA-87 line: the original WA-87 (2015–20), the R2 (2020–), the jr and the jr SE (2024–).
  // "WA-87" reads inside "WA-87 R2" and "WA-87 jr", so the R1 refuses both, and the TS pair.
  'warm-audio-wa87': warmAudioSingle('wa-87', ...WA87_R2, ...WA_JR, ...WA_JR_SE, ...WA87_TS),
  // (Not the SE cue on the R2: "WA87 R2 …, sE Reflection Filter X … Bundle" names sE Electronics.)
  'warm-audio-wa-87-r2': warmAudioSingle('wa-87', ...WA_JR, ...WA87_TS, cue('original version'), /\(original\)/i),
  'warm-audio-wa-87jr': warmAudioSingle('wa-87', ...WA_JR_SE),
  'warm-audio-wa-87jr-se': { ...warmAudioSingle('wa-87'), requires: WA_JR_SE },
  // WA-47 line: the tube WA-47 (incl. its titanium edition), the FET WA-47jr and jr SE; the
  // WA-47F and "WA-47T" have no target row and are refused on the tube WA-47.
  'warm-audio-wa47': warmAudioSingle('wa-47', ...WA_JR, ...WA_JR_SE, ...WA47_F_T),
  'warm-audio-wa-47jr': warmAudioSingle('wa-47', ...WA_JR_SE),
  'warm-audio-wa-47jr-se': { ...warmAudioSingle('wa-47'), requires: WA_JR_SE },
  // 1073 line: WA73 (one channel), WA73-EQ, WA273 (two channels), WA273-EQ. A title that says
  // "EQ" is never the plain preamp; the two-channel units may say "stereo" or "dual".
  'warm-audio-wa73': warmAudioSingle('wa73', ...WA_EQ, cue('500')),
  'warm-audio-wa73-eq': warmAudioSingle('wa73'),
  'warm-audio-wa273': warmAudio('wa73', ...WA_EQ),
  'warm-audio-wa273-eq': warmAudio('wa73'),
  // The single-channel WA76; the WA76-D2 / -A2 are two channels (no target row).
  'warm-audio-wa76': warmAudioSingle('wa76', ...WA76_STEREO),
  'warm-audio-wa-mpx': warmAudioSingle('wa-mpx', ...WA_2MPX),
  'warm-audio-wa-2mpx': warmAudio('wa-mpx'),
  'warm-audio-wa-84': warmAudioSingle('wa-84', ...WA84_PAIR),
  'warm-audio-wa2a': warmAudioSingle('wa-2a'),
  'warm-audio-wa-19': warmAudioSingle('wa-19'),
  'warm-audio-wa-67': warmAudioSingle('wa-67'),
  'warm-audio-wa-251': warmAudioSingle('wa-251'),
  'warm-audio-wa-cx24': warmAudioSingle('wa-cx24'),
  'warm-audio-wa-cx12': warmAudioSingle('wa-cx12'),
  'warm-audio-wa-8000': warmAudioSingle('wa-8000'),
  'warm-audio-wa-44': warmAudioSingle('wa-44'),
  'warm-audio-wa-1b': warmAudioSingle('wa-1b'),
  'warm-audio-wa-412': warmAudio('wa-412'),
  'warm-audio-warm-bender': warmAudioSingle('warm-bender'),
  // The clone guard on the originals Warm Audio copies (direction 1; the Neumann rows refuse
  // it through NEUMANN_NEVER). Each line is the row's own slug, so step 5b reads exactly as before.
  'universal-audio-urei-1176ln': member('universal-audio-urei-1176ln', ...WARM_AUDIO_COPY),
  // PAN-230. The hardware reissue (2000–, "Teletronix LA-2A Classic Leveling Amplifier"): never
  // the 2023 UAFX "Studio Compressor" pedal that carries the same name, a UAD plug-in, the LA-610
  // channel strip, a 1960s original (no row today, so it fails closed), a pair or a bundle.
  'ua-la-2a': member('ua-la-2a', ...WARM_AUDIO_COPY, ...UAD_SOFTWARE, ...PAIR_OR_LOT,
    ...cues('pedal', 'uafx', 'studio compressor', 'guitar', 'compact', 'bundle', 'overlay', 'dust cover', 'la-610', 'la 610', 'la610', '6176', '2-la-2', 'leveler collection'),
    yearCue(1960, 1999)),
  'universal-audio-teletronix-la-2a': member('universal-audio-teletronix-la-2a', ...WARM_AUDIO_COPY),
  // PAN-230 tranche 2. The vintage 1073 module (1970s, CSP 52862): never AMS Neve's reissues (1073 N / R / DPX /
  // DPA / SPX / OPX / LB / CH / CV), a clone, a module converted from a 2074, a dual or a pair, the parts trade
  // or a title that lists the other 80-series modules beside it.
  'neve-1073': {
    line: 'neve-1073',
    otherMembers: [
      ...WARM_AUDIO_COPY, ...UAD_SOFTWARE, ...PAIR_OR_LOT, ...NEVE_CLONES, ...NEVE_OTHER_MODULES,
      /(?<![\w-])1073\s?(?:n|r|dpx|dpa|spx|opx|lb|lbeq|ch|cv|cvr)(?![\w-])/i,
      ...cues('ams', 'reissue', 'horizontal', 'vertical', 'converted', 'dual', '2-channel', 'two', '33609'),
    ],
    accessories: NEVE_PARTS,
  },

  // ── PAN-204: Martin ──────────────────────────────────────────────────────
  // Every row the PAN-204 promote SQL makes a match target, plus the supported `martin-d-28`
  // (below, with its frozen boundary). One line per body size and style number: a series model's
  // name contains its base's ("D-28 Modern Deluxe" ⊃ "D-28"), so the base refuses the series word
  // and both share the line (step 5b). Body sizes never collide: the token boundary already keeps
  // "00-18" off "000-18", "0-18" off "00-18" and "D-28" off "HD-28", and refuses a suffixed model
  // ("000-28EC", "OM-28E", "D-42L", "HD-28V"). Base = Standard Series, 1970 on (MARTIN_VINTAGE).
  'martin-d-28-modern-deluxe': martin('d-28', ...MARTIN_CUSTOM),
  'martin-d-28-authentic-1937': martin('d-28', ...MARTIN_CUSTOM),
  'martin-d-28-satin': martin('d-28', ...MARTIN_CUSTOM),
  // An Artist Edition: "Custom Shop Artist Edition" names the same guitar, so no Custom Shop cue.
  'martin-d-28-billy-strings': martin('d-28'),
  'martin-d-18': martin('d-18', ...MARTIN_SERIES, cue('molly tuttle'), /(?<![\w-])super\s+d-?18(?![\w-])/i),
  'martin-d-18-authentic-1937': martin('d-18', ...MARTIN_CUSTOM),
  'martin-d-18-satin': martin('d-18', ...MARTIN_CUSTOM),
  'martin-d-18-molly-tuttle': martin('d-18'),
  'martin-hd-28': martin('hd-28', ...MARTIN_SERIES, /(?<![\w-])super\s+hd-?28(?![\w-])/i),
  'martin-000-18': martin('000-18', ...MARTIN_SERIES),
  'martin-000-18-modern-deluxe': martin('000-18', ...MARTIN_CUSTOM),
  'martin-000-28': martin('000-28', ...MARTIN_SERIES, cue('shawn mendes')),
  'martin-000-28-modern-deluxe': martin('000-28', ...MARTIN_CUSTOM),
  'martin-000-28-shawn-mendes': martin('000-28'),
  'martin-om-28': martin('om-28', ...MARTIN_SERIES),
  'martin-om-28-modern-deluxe': martin('om-28', ...MARTIN_CUSTOM),
  'martin-0-18': martin('0-18', ...MARTIN_SERIES),
  // The Joe Bonamassa 00-18 has no Reverb CSP and no row (owner): refused here, so it stays unmatched.
  'martin-00-18': martin('00-18', ...MARTIN_SERIES, ...cues('bonamassa', 'artist edition')),
  'martin-d-42-modern-deluxe': martin('d-42', ...MARTIN_CUSTOM),

  // ── PAN-205: SSL (Solid State Logic) ─────────────────────────────────────
  // Every row the PAN-205 promote SQL makes a match target. Each requires SSL's name (SSL_NAMED).
  // Generations share a line, and the shorter name refuses the longer one's word (step 5b):
  // SSL 2 / SSL 2 MKII / SSL 2+ / SSL 2+ MKII ("a bare SSL 2 is the MkI", manager decision 3), VHD Pre
  // (2015–20) / VHD+ (2021–) / XLogic Alpha VHD Pre, SiX / SiX Channel / BiG SiX, UF1 / UF8 / UC1.
  // No console row exists or is created (manager decision 7): every console-named SSL title is a part
  // (4000 pots, a 9000 timecode card) or a snake "for SSL Six, Matrix2, XL Desk". Nor a G-series bus
  // compressor row; one would have to require SSL and refuse "UC1" (whose titles name its bundled
  // "Bus Compressor" plug-in) and the API 2500 "Stereo Bus Compressor".
  'ssl-2': sslSingle('ssl-2', SSL_2_PLUS, ...SSL_MK2),
  'ssl-2-mkii': sslSingle('ssl-2', SSL_2_PLUS),
  'ssl-2-plus': sslSingle('ssl-2', ...SSL_MK2),
  'ssl-2-plus-mkii': sslSingle('ssl-2'),
  'ssl-12': sslSingle('ssl-12', SSL_ALPHA_8),
  'ssl-18': sslSingle('ssl-18', SSL_ALPHA_8),
  'ssl-uf1': sslSingle('ssl-uf', SSL_UF8, SSL_UC1),
  'ssl-uf8': sslSingle('ssl-uf', SSL_UF1, SSL_UC1),
  'ssl-uc1': sslSingle('ssl-uf', SSL_UF1, SSL_UF8),
  'ssl-b-dyn': sslSingle('ssl-b-dyn'),
  // The mixer. Its name is a number word: "Moog Sonic Six", "Six-Trak", "PolySix", the Rupert Neve R6
  // "Six Space" rack and the Doepfer "SIX STAGE" filter all reached it on origin/main's matcher.
  'ssl-six': sslSingle('ssl-six', ...SSL_SIX_CH, /big\s?six/i, ...cues('sonic', 'trak', 'six-trak', 'polysix', 'six space', 'r6', 'stage', 'fusion')),
  'ssl-six-channel': sslSingle('ssl-six'),
  'ssl-big-six': sslSingle('ssl-six'),
  'ssl-fusion': sslSingle('ssl-fusion', /bus\s?(?:\+|plus)/i, ...cues('alesis', '8hd', 'jazz', 'uveq', 'ultraviolet', 'uv eq')),
  'ssl-ultraviolet-eq': sslSingle('ssl-ultraviolet-eq'),
  'ssl-vhd': sslSingle('ssl-vhd', ...SSL_XLOGIC, ...cues('8 channels', 'rack-ready')),
  // The 2015–20 module. A 2021-on year is the VHD+ written without its "+" ("SSL VHD Pre 500-Series
  // Microphone Preamp 2021 - Present - Black", the VHD+ CSP's own Reverb title).
  'ssl-vhd-pre': sslSingle('ssl-vhd', ...SSL_XLOGIC, /vhd\s?(?:\+|plus)/i, yearCue(2021, 2039),
    ...cues('611', '611eq', '611dyn', '4-channel', '4 channel', 'quad')),
  'ssl-xlogic-alpha-vhd-pre': sslSingle('ssl-vhd'),
  // ── PAN-218: Gretsch ─────────────────────────────────────────────────────
  // Every row the PAN-218 promote SQL makes a match target: the G5420T and the 14 models step 2
  // created. Each is named by its model code ("G6128T-53"), so two members never share a title;
  // the one shared name is the G5420T, whose 2021 "Electromatic Classic" generation is its own row
  // and refuses on the earlier one (step 5b). The four generic rows (Country Gentleman, Duo Jet,
  // G6120 Chet Atkins, G6136 White Falcon) are not promoted and have no entry.
  'gretsch-g5420t-electromatic': gretsch('gretsch-g5420t', cue('classic')),
  'gretsch-g5420t-electromatic-classic': gretsch('gretsch-g5420t'),
  'gretsch-g6122t-62-vintage-select-country-gentleman': gretsch('gretsch-g6122'),
  'gretsch-g6122t-59-vintage-select-country-gentleman': gretsch('gretsch-g6122'),
  'gretsch-g6122t-players-edition-country-gentleman': gretsch('gretsch-g6122'),
  'gretsch-g6120t-55-vintage-select-chet-atkins': gretsch('gretsch-g6120'),
  'gretsch-g6120t-59-vintage-select-chet-atkins': gretsch('gretsch-g6120'),
  'gretsch-g6128t-gh-george-harrison-duo-jet': gretsch('gretsch-g6128'),
  'gretsch-g6128t-53-vintage-select-duo-jet': gretsch('gretsch-g6128'),
  'gretsch-g6128t-57-vintage-select-duo-jet': gretsch('gretsch-g6128'),
  'gretsch-g6128t-59-vintage-select-duo-jet': gretsch('gretsch-g6128'),
  'gretsch-g6136-55-vintage-select-falcon': gretsch('gretsch-g6136'),
  'gretsch-g6136t-59-vintage-select-falcon': gretsch('gretsch-g6136'),
  'gretsch-g6136-1958-stephen-stills-white-falcon': gretsch('gretsch-g6136'),
  'gretsch-g6136t-mgc-michael-guy-chislett-falcon': gretsch('gretsch-g6136'),

  // ── PAN-220: PRS ─────────────────────────────────────────────────────────
  // Every row the PAN-220 promote SQL makes a match target. Each requires PRS's name and refuses
  // Private Stock. Within a line the shorter name refuses the longer one's word (step 5b): a Core
  // "Custom 22" is not the Piezo, the Soapbar, a semi-hollow, a Singlecut or the 12-string; a Core
  // "McCarty 594" is not the Singlecut, the Hollowbody II or a Thinline; no Core row takes an SE or S2.
  'prs-custom-22': prsCore('prs-custom-22', ...PRS_HOLLOW, ...PRS_PIEZO, ...PRS_SINGLECUT, cue('soapbar'), /(?<![\w-])12[\s-]?string/i),
  'prs-custom-22-piezo': prsCore('prs-custom-22'),
  'prs-custom-22-soapbar': prsCore('prs-custom-22'),
  'prs-se-custom-22-semi-hollow': prs('prs-custom-22'),
  'prs-custom-24': prsCore('prs-custom-24', PRS_24_08, ...PRS_HOLLOW, ...PRS_PIEZO),
  'prs-custom-24-08': prsCore('prs-custom-24', ...PRS_HOLLOW, ...PRS_PIEZO),
  'prs-custom-24-semi-hollow': prsCore('prs-custom-24'),
  'prs-custom-24-piezo': prsCore('prs-custom-24'),
  // "PRS McCarty 594 Drop In - 2 volume, 2 Push/Pull Tone" is a wiring harness.
  'prs-mccarty-594': { ...prsCore('prs-mccarty-594', ...PRS_HOLLOW, ...PRS_SINGLECUT, cue('thinline')), accessories: ['drop in'] },
  'prs-mccarty-594-hollowbody-ii': prsCore('prs-mccarty-594'),
  'prs-mccarty-594-singlecut': prsCore('prs-mccarty-594'),
  'prs-s2-mccarty-594': prs('prs-mccarty-594', ...PRS_SINGLECUT, cue('thinline')),
  'prs-s2-mccarty-594-singlecut': prs('prs-mccarty-594'),
  'prs-s2-mccarty-594-thinline': prs('prs-mccarty-594'),
  'prs-silver-sky': { ...prsCore('prs-silver-sky'), accessories: PRS_SILVER_SKY_PARTS },

  // ── PAN-222: Rickenbacker ────────────────────────────────────────────────
  // Every row the PAN-222 promote SQL makes a match target. The token boundary already keeps the
  // suffixed models apart ("4003S", "360/12C63", "360/12W" are not "4003" or "360/12").
  // The 4001 V63 is the 1984-2000 vintage reissue, its own Reverb page; two titles, no row.
  'rickenbacker-4001': rickenbacker('rickenbacker-4001', cue('v63')),
  'rickenbacker-4003': rickenbacker('rickenbacker-4003'),
  'rickenbacker-4003s': rickenbacker('rickenbacker-4003'),
  'rickenbacker-360-12': rickenbacker('rickenbacker-360-12'),

  // ── PAN-223: Suhr ────────────────────────────────────────────────────────
  // Every row the PAN-223 promote SQL makes a match target. The production Classic S and Classic T
  // refuse the longer names in their line (Antique, Paulownia, Studio), a custom build and a
  // signature model. Vintage LE, Metallic and Roasted Pine editions stay on the production row.
  'suhr-classic-s': suhr('suhr-classic-s', ...cues('antique', 'paulownia', 'studio'), SUHR_CUSTOM, ...SUHR_SIGNATURE),
  'suhr-classic-s-antique': suhr('suhr-classic-s', SUHR_CUSTOM, ...SUHR_SIGNATURE),
  'suhr-classic-s-paulownia': suhr('suhr-classic-s'),
  'suhr-classic-s-studio': suhr('suhr-classic-s'),
  'suhr-custom-shop-classic-s': suhr('suhr-classic-s', cue('antique'), ...SUHR_SIGNATURE),
  'suhr-classic-t': suhr('suhr-classic-t', ...cues('antique', 'paulownia'), SUHR_CUSTOM, ...SUHR_SIGNATURE),
  'suhr-classic-t-antique': suhr('suhr-classic-t', SUHR_CUSTOM, ...SUHR_SIGNATURE),
  'suhr-custom-shop-classic-t': suhr('suhr-classic-t', cue('antique'), ...SUHR_SIGNATURE),
  'suhr-mateus-asato-signature-classic-t': suhr('suhr-classic-t'),
  // PAN-230. The PT100 head: its 2x12 and 4x12 cabinets are their own products, the PT15 IR another.
  'suhr-pt100': suhr('suhr-pt100', ...cues('cabinet', 'cab', '2x12', '212', '4x12', '412', 'speaker', 'pt15', 'pt-15', 'pt 15')),

  // ── PAN-224: Heritage ────────────────────────────────────────────────────
  // Every row the PAN-224 promote SQL makes a match target. "H-150" and "H-535" alone are the
  // Standard Collection; a title that names Standard II, a Custom Shop build or (on the H-535)
  // Artisan Aged is that model, or nothing where it has no row (Standard II H-535, Factory Special).
  'heritage-h-150': heritage('heritage-h-150', HERITAGE_STANDARD_II, ...HERITAGE_CUSTOM),
  'heritage-standard-ii-h-150': heritage('heritage-h-150', ...HERITAGE_CUSTOM),
  'heritage-custom-shop-core-h-150': heritage('heritage-h-150', HERITAGE_STANDARD_II, cue('factory special')),
  'heritage-h-535': heritage('heritage-h-535', HERITAGE_STANDARD_II, ...HERITAGE_CUSTOM, cue('artisan aged')),
  'heritage-custom-shop-core-h-535': heritage('heritage-h-535', HERITAGE_STANDARD_II),
  'heritage-h-535-artisan-aged': heritage('heritage-h-535', HERITAGE_STANDARD_II, ...HERITAGE_CUSTOM),

  // ── PAN-225: Taylor ──────────────────────────────────────────────────────
  // Every row the PAN-225 promote SQL makes a match target. The plain 314ce and 814ce refuse the
  // Studio, DLX, Builder's Edition, Next Generation and nylon models; V-Class, LTD and Special
  // Edition finishes stay on them. The plain GS Mini is the spruce-and-sapele original.
  'taylor-314ce': taylor('taylor-314ce', cue('studio'), TAYLOR_BUILDERS, TAYLOR_NEXT_GEN, cue('nylon')),
  'taylor-314ce-studio': taylor('taylor-314ce'),
  'taylor-next-generation-314ce': taylor('taylor-314ce', TAYLOR_BUILDERS),
  'taylor-builders-edition-314ce': taylor('taylor-314ce', TAYLOR_NEXT_GEN),
  // "814ce Gold Label" is the 2025 Gold Label collection, another guitar.
  'taylor-814ce': taylor('taylor-814ce', ...cues('dlx', 'deluxe', 'gold label'), TAYLOR_BUILDERS, TAYLOR_NEXT_GEN, cue('nylon')),
  'taylor-814ce-dlx': taylor('taylor-814ce', TAYLOR_BUILDERS, TAYLOR_NEXT_GEN),
  'taylor-next-generation-814ce': taylor('taylor-814ce', TAYLOR_BUILDERS),
  'taylor-builders-edition-814ce': taylor('taylor-814ce', TAYLOR_NEXT_GEN),
  'taylor-next-generation-builders-edition-814ce': taylor('taylor-814ce'),
  'taylor-gs-mini': taylor('taylor-gs-mini', ...TAYLOR_GS_MINI_OTHER),
  'taylor-gs-mini-mahogany': taylor('taylor-gs-mini'),
  'taylor-gs-mini-e-mahogany': taylor('taylor-gs-mini'),
  'taylor-gs-mini-e-koa': taylor('taylor-gs-mini', ...cues('plus', 'bass', 'ltd', 'deluxe')),
  'taylor-gs-mini-e-koa-plus': taylor('taylor-gs-mini'),
  'taylor-gs-mini-e-rosewood': taylor('taylor-gs-mini', ...cues('plus', 'ltd')),
  'taylor-gs-mini-e-rosewood-plus': taylor('taylor-gs-mini'),
  'taylor-gs-mini-e-special-edition': taylor('taylor-gs-mini'),

  // ── PAN-226: Guild ───────────────────────────────────────────────────────
  // The two rows the PAN-226 promote SQL makes match targets. The token boundary keeps the electro
  // "D-55E" off the D-55.
  // "1979 Guild Guitars Color promotional Ad Framed Guild D-55" is a framed advertisement.
  'guild-d-55': { ...guild('guild-d-55'), accessories: ['promotional'] },
  'guild-d-55e': guild('guild-d-55'),
  // Prophet-10 is split BY NAME (owner decision 2026-09-28): `sequential-prophet-10`
  // is the 2020 model, `sequential-circuits-prophet-10` the 1980–84 original.
  // The 2020 model is also sold as "Sequential" (Dave Smith Instruments renamed
  // itself in 2018), so the brand word cannot separate them; these cues do,
  // measured on all 163 production titles. A 2020 cue wins over a vintage one:
  // "Sequential Circuits Prophet 10 Desktop" is the 2021 desktop module.
  // PAN-221 adds the desktop module as its own member and the measured parts list.
  'sequential-prophet-10': {
    line: 'prophet-10',
    otherMembers: [unlessAlso(PROPHET_10_VINTAGE, PROPHET_10_2020), ...SEQ_DESKTOP],
    accessories: SEQ_PARTS,
  },
  'sequential-circuits-prophet-10': {
    line: 'prophet-10',
    requires: [PROPHET_10_VINTAGE],
    otherMembers: [PROPHET_10_2020],
    accessories: SEQ_PARTS,
  },

  // ── PAN-154 (2/2): option A, the name is the base model ───────────────────
  // Owner decision 2026-09-26, bases from the audit on the ticket. Bare years,
  // finish, handedness, case and added pickups are facets (PAN-52 D6) and are
  // never cues; series, sub-brand/Custom Shop, signature, generation and form
  // factor are. Every cue below was read against every matched title.

  // Base: J-45 Standard.
  'gibson-j-45': {
    line: 'j-45',
    otherMembers: [
      ...cues(
        'studio', 'special', 'faded', 'deluxe', 'century', 'avant garde',
        'rosewood', 'red spruce', 'long scale', '12-string', '12 string', '12 strings',
        'anniversary', 'limited edition',
        'custom', 'murphy lab', 'historic', 'm2m', 'banner', 'reissue', 'light aged', 'heavy aged',
        'slash', 'margo price', 'signature', 'artist', 'generation', '1950s', '1960s',
      ),
      DECADE_MODEL,
      // The model, not "with Original Hard Case".
      /(?<![\w-])j-45\s+original(?![\w-])/i,
    ],
  },
  // Base: Hummingbird Standard.
  'gibson-hummingbird': {
    line: 'hummingbird',
    otherMembers: [
      ...cues(
        'studio', 'special', 'faded', 'deluxe', 'ec', 'avant garde',
        'rosewood', 'walnut', 'koa', 'red spruce', 'elegant', 'golden era', 'fixed bridge',
        'custom', 'murphy lab', 'murphy-lab', 'historic', 'reissue', 'vos', 'light aged', 'heavy aged',
        'anniversary', 'limited edition',
        // PAN-198: a dealer's sinker-mahogany edition.
        'dealer select', 'sinker',
      ),
      // The model, not "with original Gibson Hardcase".
      /(?<![\w-])(?:hummingbird\s+(?:\d{4}\s+)?original|original\s+hummingbird)(?![\w-])/i,
    ],
    // Measured: Gibson's own merchandise and a CD reach this page by name.
    accessories: ['tee', 'cd'],
  },
  // Frozen boundary: "Lower tier."
  'gibson-les-paul-studio': {
    // One line with every PAN-198 Les Paul model (step 5b).
    line: 'les-paul',
    otherMembers: [
      ...cues(
        'session', 'faded', 'deluxe', 'tribute', 'double trouble', 'double cut', 'plus',
        'studio pro', 'lite', 'modern', 'platinum', 'gem', 'robot', 'swamp ash',
        'vintage mahogany', 'vintage mahogny', 'memphis', 'anniversary', 'custom',
      ),
      DECADE_MODEL,
    ],
  },
  // Frozen boundary: "P-90 tier." The single cut; the Double Cut is its own model.
  'gibson-les-paul-special': {
    line: 'les-paul',
    otherMembers: [
      ...cues(
        'dc', 'double cut', 'double cutaway', 'doublecut', 'dubble cut', 'dbl',
        // PAN-198: the Les Paul Junior Special, its own model.
        'junior',
        'tribute', 'faded', 'plus', 'sl', 'figured', 'jr', 'es',
        'custom', 'cs', 'murphy lab', 'historic', 'reissue', 'vos', 'aged',
      ),
      /['’‘](?:55|57|60)(?!\d)|special\s+55(?!\d)/,
    ],
    // Measured: a Canadian case maker's cases, and a Danish "kasse".
    accessories: ['kasse', 'canadian made', 'made in canada'],
  },
  // Base: the 1968–79 US original. Every original in production carries its
  // year; a Thinline without one is as often a Classic Series or a Vintera.
  'fender-telecaster-thinline': {
    // One line with the PAN-195 Telecaster models, so refusing it on "American
    // Vintage II 1972 Telecaster Thinline" is evidence for that model (step 5b).
    line: 'telecaster',
    requires: [yearCue(1968, 1979)],
    otherMembers: [
      ...cues(
        'custom', 'masterbuilt', 'journeyman', 'nocaster', 'limited', 'lim', 'fsr', 'select',
        'american vintage ii', 'american original', 'american professional', 'american deluxe',
        'american elite', 'deluxe', 'vintera', 'classic series', 'modern player', 'player',
        'traditional', 'japan', 'mij', 'cij', 'tn-70', 'tn-72', 'tn70', 'mex', 'cabronita',
        'suona', 'reissue', 'jim adkins',
      ),
      yearCue(1980, 2039),
    ],
  },
  // Frozen boundary: "Excludes Custom Shop." The reissues are other members too.
  'fender-telecaster-custom': {
    line: 'telecaster',
    otherMembers: [
      ...cues(
        'custom shop', 'journeyman', 'relic', 'road worn', 'nos', 'ltd', 'limited', 'fsr',
        'special edition', 'signature', 'american vintage ii', 'avri', 'american ultra',
        'classic', 'vintera', 'player', 'traditional', 'japan', 'mij', 'cij', 'tc-72',
        'mex', 'mexico', 'mexiko', 'fmt', 'hh', 'reissue',
      ),
      // "'72" names the reissue; an original says "1972". So does "American
      // Vintage 72'" — but not a 1971 original sold as "American Vintage 70s".
      /['’‘]72(?!\d)|american\s+vintage\s+['’‘]?\d\d['’]?(?![\ds])/i,
    ],
  },
  // Frozen boundary: "1176LN reissue line … Vintage Rev A Bluestripe should split later."
  'ua-1176ln': {
    line: '1176ln',
    otherMembers: [
      ...cues(
        'urei', 'urie', 'vintage', 'blue stripe', 'bluestripe',
        'blackface', 'silverface', 'black panel', 'silver panel',
        // Other Universal Audio products that carry an 1176 inside.
        '6176', '2-1176', 'channel strip',
      ),
      /(?<![\w-])rev\.?\s*[a-h](?![\w-])/i,
      yearCue(1967, 1989),
      // PAN-203 clone guard: "Warm Audio WA76 1176 …" is the WA76.
      ...WARM_AUDIO_COPY,
    ],
  },
  // Frozen boundary: "ORIGINAL (1978) only. MS-20 Mini, MS-20 Kit and MS-20 FS … MUST NOT land here."
  'korg-ms-20': {
    line: 'ms-20',
    otherMembers: [
      ...cues('mini', 'fs', 'ic', 'legacy', 'replica', 'arturia', 'klon', 'x-911'),
      /(?<![\w-])ms-?20\s+v(?![\w-])/i,
      // The original ran 1978–83; the Mini, Kit and FS are 2013 on.
      yearCue(1990, 2039),
    ],
    // `kit` and `controller` sit here, under the inclusion-marker rule, because
    // an original is sold "+ midi kit Kenton" and "with foot controller".
    accessories: [
      'kit', 'controller', 'knob', 'side panel', 'side panels', 'pedal',
      'mug', 'poster', 'book', 'license', 'download', 'software',
    ],
  },
  // Frozen boundary: "Excludes Custom Shop reissues." The Les Paul Custom is itself
  // built by Gibson Custom, so "Custom Shop" is not a cue here; its reissue,
  // limited and signature lines are.
  'gibson-les-paul-custom': {
    line: 'les-paul',
    otherMembers: [
      ...cues(
        'reissue', 'historic', 'vos', 'murphy lab', 'm2m', 'made to measure', 'made 2 measure',
        'aged', 'r0', 'r4', 'r7', 'r8', 'anniversary', '70th', 'limited edition', 'ltd',
        'collector', 'chambered', 'widow', 'axcess', 'dealer select', 'willcutt', 'yamano',
        'bebo', 'guitar of the week', 'mod shop', 'modified shop',
        'signature', 'ace frehley', 'randy rhoads', 'adam jones', 'justin hawkins', 'budokan',
        'zakk wylde', 'peter frampton', 'mick ronson',
        'artisan', 'classic', 'lite', 'ultima', 'sg',
      ),
      // The Gibson USA "Les Paul Custom 70s", not a 1970 original "Vintage 70s".
      /les\s+paul\s+custom\s+['’]?70['’]?s(?![\w-])/i,
      // A Custom Shop build named after a '54–'68 year is its reissue; an
      // original is just "1968 Gibson Les Paul Custom".
      /(?:custom\s+shop|gibson\s+custom)(?=.*(?<!\d)19(?:5[4-9]|6[0-8])(?!\d))|(?<!\d)19(?:5[4-9]|6[0-8])(?!\d)(?=.*custom\s+shop)/i,
    ],
    accessories: ['book'],
  },
  // Split by name like the Prophet-10 (PAN-221, owner decision 1 of 2026-10-02 on the clean rows):
  // `sequential-prophet-5` is the 2020 model, `sequential-circuits-prophet-5` the 1978–84 original,
  // `sequential-prophet-5-desktop` the 2021 module. A 2020 cue wins over a vintage one.
  'sequential-prophet-5': {
    line: 'prophet-5',
    otherMembers: [unlessAlso(PROPHET_5_VINTAGE, PROPHET_5_2020), ...SEQ_DESKTOP],
    accessories: SEQ_PARTS,
  },
  // Frozen boundary: "Excludes HD-28." (The tokenizer already refuses "HD-28".)
  // `reimagined` stays as the owner ratified it, although the 2017+ Standard Series D-28 is the
  // Reimagined model (owner decision pending; its CSP is the 1970–84 page, also the owner's).
  // PAN-204 adds the editions measured on D-28 titles (Billy Strings without "Signature", Rich
  // Robinson, Elvis, Lennon, Herringbone, Golden Era, Museum), the PAN-204 era policy and
  // MARTIN_NEVER. A human-approved match (`admin_decision`, e.g. the 1942 D-28) is not re-decided:
  // the PAN-204 re-match skips it.
  'martin-d-28': martin('d-28',
    ...cues(
      'custom shop', 'ctm', 'authentic', 'modern deluxe', 'satin', 'marquis',
      'street legend', 'streetlegend', 'reimagined', 'signature',
      'billy strings', 'rich robinson', 'elvis', 'lennon', 'herringbone', 'golden era', 'museum',
    )),

  // ── PAN-154 (2/2): option B, the base member of the `mustang-bass` family ──
  // Base: the 1966–81 US original. Like the Thinline, every original carries
  // its year, and a year alone is not enough ("Sunn Fender Mustang Bass 1980s").
  'fender-mustang-bass': {
    line: 'mustang-bass',
    requires: [yearCue(1966, 1981)],
    otherMembers: [
      // Not `player`: "1973 … Clean Amazing Player" is an original. The Player
      // series carries no 1966–81 year, so the requirement already refuses it.
      ...cues(
        'performer', 'vintera', 'american professional', 'jmj', 'offset', 'pj',
        'cij', 'mij', 'japan', 'mb98', 'mb-98', "mb'98", 'mb-sd', 'reissue', 'sunn',
        'pawn shop', 'hybrid',
      ),
      yearCue(1982, 2039),
    ],
    accessories: ['harness', 'wiring'],
  },

  // ── PAN-195: the Fender series models (owner decision 2026-09-30) ─────────
  // Where one model's name sits inside another's ("Player II Stratocaster" in
  // "Player II Stratocaster HSS"), the shorter one refuses the longer one's
  // extra word, and both join the family's line so the refusal picks the
  // longer model instead of deferring (step 5b). Measured on every held and
  // unmatched listing of the seven families.
  // `hh`: the Limited Edition AP II Stratocaster HH Mahogany, which has no row.
  'fender-american-professional-ii-stratocaster': member('stratocaster', ...cues('hss', 'hh', 'thinline')),
  'fender-american-professional-ii-stratocaster-hss': member('stratocaster'),
  'fender-american-professional-ii-stratocaster-thinline': member('stratocaster'),
  'fender-american-professional-classic-stratocaster': member('stratocaster', cue('hss')),
  'fender-american-professional-classic-stratocaster-hss': member('stratocaster'),
  'fender-american-performer-stratocaster': member('stratocaster', cue('hss')),
  'fender-american-performer-stratocaster-hss': member('stratocaster'),
  'fender-american-ultra-stratocaster': member('stratocaster', cue('hss')),
  'fender-american-ultra-stratocaster-hss': member('stratocaster'),
  'fender-american-ultra-ii-stratocaster': member('stratocaster', cue('hss')),
  'fender-american-ultra-ii-stratocaster-hss': member('stratocaster'),
  'fender-player-ii-stratocaster': member('stratocaster', cue('hss')),
  'fender-player-ii-stratocaster-hss': member('stratocaster'),
  'fender-player-ii-modified-stratocaster': member('stratocaster', cue('hss')),
  'fender-player-ii-modified-stratocaster-hss': member('stratocaster', cue('floyd')),
  'fender-player-ii-modified-stratocaster-hss-floyd-rose': member('stratocaster'),
  'fender-player-plus-stratocaster': member('stratocaster', cue('hss')),
  'fender-player-plus-stratocaster-hss': member('stratocaster'),
  'fender-standard-stratocaster': { line: 'stratocaster', ...STANDARD_2025, otherMembers: [...STANDARD_2025.otherMembers, cue('hss')] },
  'fender-standard-stratocaster-hss': { line: 'stratocaster', ...STANDARD_2025 },

  'fender-american-standard-telecaster': member('telecaster'),
  'fender-standard-telecaster': { line: 'telecaster', ...STANDARD_2025 },
  'fender-american-professional-ii-telecaster': member('telecaster', ...cues('deluxe', 'thinline')),
  'fender-american-professional-ii-telecaster-deluxe': member('telecaster'),
  'fender-american-professional-ii-telecaster-thinline': member('telecaster'),
  'fender-american-performer-telecaster': member('telecaster', cue('hum')),
  'fender-american-performer-telecaster-hum': member('telecaster'),
  'fender-player-ii-telecaster': member('telecaster', cue('hh')),
  'fender-player-ii-telecaster-hh': member('telecaster'),
  'fender-player-ii-modified-telecaster': member('telecaster', cue('sh')),
  'fender-player-ii-modified-telecaster-sh': member('telecaster'),
  'fender-vintera-ii-60s-telecaster': member('telecaster', cue('thinline')),
  'fender-vintera-ii-60s-telecaster-thinline': member('telecaster'),
  'fender-american-vintage-ii-1972-telecaster-thinline': member('telecaster'),
  'fender-american-vintage-ii-1977-telecaster-custom': member('telecaster'),

  'fender-american-professional-ii-jazz-bass': member('jazz-bass', FIVE_STRING, cue('fretless')),
  'fender-american-professional-ii-jazz-bass-v': member('jazz-bass'),
  'fender-american-professional-ii-jazz-bass-fretless': member('jazz-bass'),
  'fender-american-ultra-jazz-bass': member('jazz-bass', FIVE_STRING),
  'fender-american-ultra-jazz-bass-v': member('jazz-bass'),
  'fender-american-ultra-ii-jazz-bass': member('jazz-bass', FIVE_STRING),
  'fender-american-ultra-ii-jazz-bass-v': member('jazz-bass'),
  'fender-player-plus-jazz-bass': member('jazz-bass', FIVE_STRING),
  'fender-player-plus-jazz-bass-v': member('jazz-bass'),
  'fender-player-ii-modified-active-jazz-bass': member('jazz-bass', FIVE_STRING),
  'fender-player-ii-modified-active-jazz-bass-v': member('jazz-bass'),
  'fender-standard-jazz-bass': { line: 'jazz-bass', ...STANDARD_2025 },

  'fender-american-professional-ii-precision-bass': member('precision-bass', FIVE_STRING),
  'fender-american-professional-ii-precision-bass-v': member('precision-bass'),

  // `fender-mustang-bass` already refuses these series by name.
  'fender-vintera-ii-70s-competition-mustang-bass': member('mustang-bass'),
  'fender-american-performer-mustang-bass': member('mustang-bass'),
  'fender-american-professional-classic-mustang-bass': member('mustang-bass'),

  // ── PAN-198: the Gibson series models (manager decision 2026-09-30) ───────
  // The PAN-195 method: a base refuses the words of every longer member of
  // its family, and the whole family shares one line so the refusal picks the
  // longer member instead of deferring (step 5b). Series, Custom Shop reissue
  // year, signature and generation are models; year, finish, handedness,
  // pickups and aging are facets (option A). Every cue was read against the
  // forecast titles of 6,995 production listings.

  // Les Paul (line shared with the PAN-154 Studio, Special and Custom above).
  'gibson-les-paul-standard-50s': member('les-paul', ...cues('faded', 'double trouble', 'p-90', 'p90')),
  'gibson-les-paul-standard-50s-double-trouble': member('les-paul'),
  'gibson-les-paul-standard-50s-faded': member('les-paul'),
  'gibson-les-paul-standard-50s-p-90': member('les-paul'),
  'gibson-les-paul-standard-60s': member('les-paul', ...cues('faded', 'double trouble')),
  'gibson-les-paul-standard-60s-double-trouble': member('les-paul'),
  'gibson-les-paul-standard-60s-faded': member('les-paul'),
  'gibson-les-paul-studio-deluxe-ii': member('les-paul'),
  'gibson-les-paul-studio-double-trouble': member('les-paul'),
  'gibson-les-paul-studio-session': member('les-paul'),
  'gibson-les-paul-special-tribute': member('les-paul'),
  'gibson-les-paul-custom-70s': member('les-paul'),
  'gibson-custom-shop-1957-les-paul-custom-reissue': member('les-paul'),
  'gibson-custom-shop-1968-les-paul-custom-reissue': member('les-paul'),
  'gibson-custom-shop-1957-les-paul-special-single-cut-reissue': member('les-paul'),
  'gibson-custom-shop-1960-les-paul-special-double-cut-reissue': member('les-paul'),
  'gibson-custom-shop-les-paul-special-double-cut-figured': member('les-paul'),
  'gibson-les-paul-double-cut-special': {
    line: 'les-paul',
    otherMembers: [...GIBSON_CUSTOM, cue('figured')],
    // Measured: a Canadian case maker's cases (as on the Les Paul Special).
    accessories: ['canadian made', 'made in canada'],
  },
  // Base: the single-cut Junior. The Double Cut, the Junior Special, the
  // Tribute, the Custom Shop reissues and the Billie Joe Armstrong are models.
  'gibson-les-paul-junior': {
    line: 'les-paul',
    otherMembers: [
      ...cues(
        'double cut', 'double cutaway', 'doublecut', 'dc', 'billie joe', 'billy joe', 'armstrong',
        'special', 'tribute', 'anniversary',
      ),
      ...GIBSON_CUSTOM,
      SHORT_YEAR(5),
    ],
    accessories: ['gitarkoffert', 'koffert', 'book', 'canadian made', 'made in canada'],
  },
  'gibson-les-paul-junior-double-cut': member('les-paul'),
  'gibson-billie-joe-armstrong-les-paul-junior': member('les-paul'),
  'gibson-custom-shop-1957-les-paul-junior-reissue': member('les-paul'),
  'gibson-les-paul-classic': member(
    'les-paul',
    ...cues(
      'plus', 'custom', 'premium', 'antique', 'zebrawood', 'rock', 'tom morgan',
      'guitar of the week', 'limited edition',
    ),
  ),
  // Base: the 1969–84 Deluxe. The 2021 '70s Deluxe is sold as "Les Paul Deluxe 70s".
  'gibson-les-paul-deluxe': member(
    'les-paul',
    ...cues('pro', 'anniversary', 'studio', 'player plus', 'tribute'),
    ...GIBSON_CUSTOM,
    /['’]?70['’]?s\s+deluxe|deluxe\s+['’]?70['’]?s/i,
  ),
  'gibson-les-paul-70s-deluxe': member('les-paul'),
  'gibson-les-paul-modern': member('les-paul', ...cues('figured', 'lite', 'studio', 'supreme')),
  'gibson-les-paul-supreme': member('les-paul', cue('guitar of the week')),
  'gibson-les-paul-traditional': member('les-paul', ...cues('pro', 'plus'), ...GIBSON_CUSTOM),
  'gibson-les-paul-traditional-pro-ii': member('les-paul'),
  'gibson-les-paul-tribute': member(
    'les-paul',
    ...cues('hp', 'high performance', 'future', 'tribute to', 'dc', 'junior', 'special', 'studio'),
    DECADE_MODEL, DECADE_70S_80S, SHORT_YEAR(5),
  ),
  'gibson-les-paul-50s-tribute': member('les-paul', ...cues('hp', 'high performance')),
  'gibson-les-paul-52-tribute': member('les-paul'),
  'gibson-les-paul-60s-tribute': member('les-paul', ...cues('hp', 'high performance')),
  'gibson-les-paul-70s-tribute': member('les-paul'),
  'gibson-les-paul-future-tribute': member('les-paul'),
  // Base: the 1978–80 Firebrand "The Paul". The Paul II, The Paul Deluxe and
  // the SL/Lite are other models; tailpiece and switch listings name it in a
  // list of fitting models.
  'gibson-the-paul': {
    line: 'les-paul',
    otherMembers: [
      ...cues('ii', 'deluxe', 'firebrand', 'sl', 'lite', 'anniversary', 'custom shop'),
      /the\s+paul\s+2(?!\d)/i,
      // "1990s Trans Red" is The Paul II; the original ran 1978–80.
      yearCue(1981, 2039),
    ],
    accessories: ['tailpiece', 'studs', 'switch', 'switch tip', 'switch plate'],
  },
  'gibson-les-paul-the-paul-ii': member('les-paul'),
  'gibson-custom-shop-les-paul-r0': member('les-paul'),
  'gibson-custom-shop-les-paul-r4': member('les-paul'),
  'gibson-custom-shop-les-paul-r6': member('les-paul'),
  'gibson-custom-shop-les-paul-r7': member('les-paul'),
  'gibson-custom-shop-les-paul-r8': member('les-paul'),
  'gibson-custom-shop-les-paul-r9': member('les-paul'),
  'gibson-les-paul-paul-kossoff': member('les-paul'),
  'gibson-les-paul-paul-landers-signature': member('les-paul'),
  'gibson-slash-les-paul-standard': member('les-paul'),

  // SG. Base: the 2019– SG Standard (Modern collection); the '61 is its own model.
  'gibson-sg-standard': member(
    'sg',
    ...cues(
      'large guard', 'maestro', 'les paul sg', 'tribute', 'bass', 'derek trucks', 'jeff tweedy',
      'signature', 'faded', '24',
    ),
    ...GIBSON_CUSTOM,
    SHORT_YEAR(6),
  ),
  'gibson-sg-standard-large-guard-with-maestro-vibrola': member('sg'),
  'gibson-sg-standard-61': member(
    'sg',
    ...cues('faded', 'maestro', 'sideways', 'les paul sg'),
    ...GIBSON_CUSTOM,
  ),
  'gibson-sg-standard-61-faded': member('sg'),
  'gibson-sg-61-reissue': member('sg', ...cues('custom shop', 'historic', 'vos', 'murphy lab', 'les paul sg')),
  'gibson-custom-shop-1961-les-paul-sg-standard-reissue': member('sg'),
  'gibson-sg-special': {
    line: 'sg',
    otherMembers: [
      ...cues(
        'faded', 'tribute', 'anniversary', 'limited edition', 'lightning bar', 'iommi',
        'junior', 'supreme',
      ),
      ...GIBSON_CUSTOM,
      DECADE_70S_80S,
      SHORT_YEAR(6),
    ],
    accessories: ['pickguard'],
  },
  'gibson-sg-special-faded': member('sg'),
  'gibson-custom-shop-1963-sg-special-reissue': member('sg'),
  // Base: the 2024– SG Supreme. The 1999–2007 SG Supreme is an earlier generation.
  'gibson-sg-supreme': member(
    'sg',
    ...cues('guitar of the week', 'bass', 'p-90', 'p90', 'modern'),
    yearCue(1995, 2012),
  ),
  'gibson-sg-modern': {
    line: 'sg',
    otherMembers: cues('supreme', 'mod collection', 'outrun'),
    accessories: ['hardshell case'],
  },

  // ES. The ES-355 row stays `known` (its CSP is the Custom Shop '59 reissue).
  'gibson-es-335-dot': member('es'),
  'gibson-es-335-block': member('es', ...GIBSON_CUSTOM, SHORT_YEAR(6), DECADE_MODEL),
  'gibson-es-335-50s': member('es'),
  'gibson-es-335-60s-block': member('es'),
  'gibson-es-335-satin': member('es', cue('block')),
  'gibson-es-335-studio': member('es'),
  'gibson-custom-shop-1959-es-335-reissue': member('es'),
  'gibson-custom-shop-1961-es-335-reissue': member('es'),
  'gibson-custom-shop-1963-es-335-block-reissue': member('es'),
  'gibson-custom-shop-1964-es-335-reissue': member('es'),
  'gibson-es-330': {
    line: 'es',
    // A Kluson tuner is never the guitar; "1965+ Kluson" defeats the accessory
    // rule, whose "+" is an inclusion marker.
    otherMembers: [...GIBSON_CUSTOM, SHORT_YEAR(5), cue('kluson')],
    accessories: ['tuners', 'tuner', 'tailpiece', 'saitenhalter', 'guitar case'],
  },
  // Base: the 2020– ES-345; the vintage original is the same model (option A).
  'gibson-es-345': member('es', cue('marcus king'), ...GIBSON_CUSTOM, /(?<!\w)['’‘´]\d\d(?!\d)/),
  'gibson-marcus-king-es-345': member('es'),
  'gibson-es-346-paul-jackson-jr': member('es'),
  'gibson-gary-clark-jr-es-355': member('es'),
  'gibson-es-les-paul': {
    line: 'es',
    otherMembers: cues('custom', 'special', 'bass', 'lifeson', 'signature'),
    accessories: ['tuners', 'grover'],
  },

  // Explorer. Base: the 2019– Explorer and its originals; every series,
  // reissue and limited run below is another model.
  'gibson-explorer': member(
    'explorer',
    ...cues(
      'korina', 'pro', 'studio', 'xpl', 'government', 'gothic', 'robot', 'mirror', 'melody maker',
      'cmt', 'centennial', 'anniversary', 'guitar of the week', 'guitar of the month',
      'traditional', 'e2', 'ii', 'iii', 'b-2', 'tribute', 'hp', 'vampire', 'designer series',
      'modern', '83', 'double',
    ),
    ...GIBSON_CUSTOM,
    DECADE_70S_80S,
    /(?<![\w\d-])['’]?(?:58|76|90)(?![\w\d'’-])/i,
  ),
  'gibson-70s-explorer': member('explorer'),
  'gibson-80s-explorer': member('explorer'),
  'gibson-custom-shop-1958-korina-explorer-reissue': member('explorer'),
  'gibson-explorer-b-2': member('explorer'),
  'gibson-explorer-custom': member('explorer'),
  'gibson-explorer-e2': member('explorer'),
  'gibson-explorer-iii': member('explorer'),

  // Flying V. Base: the 2019– Flying V and its originals.
  'gibson-flying-v': {
    line: 'flying-v',
    otherMembers: [
      ...cues(
        'korina', 'exp', 'mustaine', 'v2', 'b-2', 'faded', 'government', 'hp', 'pro', 'melody maker',
        'cmt', 'the v', 'holy v', 'guitar of the month', 'anniversary', 'tribute', 'designer series',
        'heritage', 'signature', 'kirk hammett', 'schenker', 'limited', 'ltd', 'proprietary',
        'replica', 'prototype',
        // A Kluson/Tulip tuner lists the Flying V among the models it fits.
        // It cannot be an accessory: the "+" of "3+3" reads as an inclusion marker.
        'tuner',
      ),
      ...GIBSON_CUSTOM,
      DECADE_70S_80S,
      /(?<![\w\d-])['’]?(?:58|59|67|68|75|76|90)(?![\w\d'’-])/i,
      /flying\s+v\s+i(?![\w-])/i,
    ],
    accessories: ['harness', 'wiring harness', 'formkoffer'],
  },
  'gibson-70s-flying-v': member('flying-v'),
  'gibson-custom-shop-1958-korina-flying-v-reissue': member('flying-v'),
  'gibson-dave-mustaine-flying-v-exp': member('flying-v'),
  'gibson-flying-v-67': member('flying-v'),
  'gibson-flying-v-custom': member('flying-v'),
  'gibson-flying-v2': member('flying-v'),

  // Firebird. Base: the 2019– reverse Firebird (a Firebird V).
  'gibson-firebird': {
    line: 'firebird',
    otherMembers: [
      ...cues(
        'platypus', 'studio', 'vii', 'iii', 'zero', 'x', 'hp', 'tribute', 'non-reverse', 'nr',
        'celebrity', 'collectors choice', 'slash', 'johnny winter', 'anniversary',
        'guitar of the week', 'dealer select', 'aged', 'bass',
      ),
      ...GIBSON_CUSTOM,
      /firebird\s+i(?![\w-])/i,
      DECADE_70S_80S,
    ],
    accessories: ['harness', 'sticker', 'guitar case'],
  },
  'gibson-custom-shop-1963-firebird-v-reissue': member('firebird'),
  'gibson-firebird-platypus': member('firebird'),
  // A replacement pickguard "for 2004-2008 Gibson Firebird Studio". Not an
  // accessory: "3 Ply W/B/W Pickguard" puts the inclusion marker "w/" first.
  'gibson-firebird-studio': member('firebird', cue('pickguard')),
  'gibson-firebird-vii': member('firebird', ...GIBSON_CUSTOM),

  // Thunderbird. Base: the reverse Thunderbird IV. The 2021 Thunderbird Bass
  // ships with a non-reverse HEADSTOCK; the Non-Reverse Thunderbird is a body.
  'gibson-thunderbird': {
    line: 'thunderbird',
    otherMembers: [
      ...cues(
        'bicentennial', 'anniversary', 'gene simmons', 'g2', 'rex brown', 'studio', 'tribute',
        'tom peterson', 'orville', 'faded', 'ii',
      ),
      /non[-\s]?reverse(?!\s+headstock)/i,
    ],
    accessories: ['hardshell case', 'harness', 'sticker', 'pickguard'],
  },
  'gibson-non-reverse-thunderbird': member('thunderbird'),
  'gibson-thunderbird-bicentennial': member('thunderbird'),

  // Acoustics. J-45 and Hummingbird keep their PAN-154 lines.
  'gibson-50s-j-45-original': member('j-45'),
  'gibson-60s-j-45-original': member('j-45'),
  'gibson-custom-shop-1942-banner-j-45': member('j-45'),
  'gibson-custom-shop-1955-j-45-reissue': member('j-45'),
  'gibson-j-45-century-12-fret': member('j-45'),
  'gibson-j-45-special': member('j-45'),
  'gibson-j-45-standard-rosewood': member('j-45'),
  'gibson-j-45-studio-rosewood': member('j-45'),
  'gibson-j-45-studio-walnut': member('j-45'),
  'gibson-j-45-standard-12-string': member('j-45'),
  'gibson-margo-price-j-45': member('j-45'),
  'gibson-slash-j-45': member('j-45'),
  'gibson-custom-shop-1960-hummingbird': member('hummingbird'),
  'gibson-hummingbird-original': member('hummingbird'),
  'gibson-hummingbird-special': member('hummingbird'),
  'gibson-hummingbird-standard-rosewood': member('hummingbird'),
  'gibson-hummingbird-studio-ec': member('hummingbird'),
  'gibson-hummingbird-studio-rosewood': member('hummingbird'),
  // Base: the 2019– SJ-200 Original.
  'gibson-sj-200-original': member('sj-200', ...cues('special'), ...GIBSON_CUSTOM, DECADE_MODEL),
  'gibson-sj-200-standard': member('sj-200', ...cues('maple', 'rosewood'), ...GIBSON_CUSTOM),
  'gibson-sj-200-standard-rosewood': member('sj-200'),
  'gibson-sj-200-studio-rosewood': member('sj-200'),
  'gibson-sj-200-studio-walnut': member('sj-200'),
  'gibson-sj-200-60s-original': member('sj-200'),
  'gibson-sj-200-western-classic': member('sj-200'),
  'gibson-sj-200-orianthi-signature': member('sj-200'),
  'gibson-elvis-presley-sj-200': member('sj-200'),
  'gibson-custom-shop-1957-sj-200': member('sj-200'),
  'gibson-pre-war-sj-200': member('sj-200'),
  'gibson-j-185': member(
    'j-185',
    ...cues(
      'original', 'century', '12-fret', 'rosanne cash', 'elite', 'ec', 'modern classic',
      'centennial', 'anniversary', 'harley', 'red spruce', 'limited edition', '1952',
    ),
    ...GIBSON_CUSTOM,
  ),
  'gibson-custom-shop-1952-j-185': member('j-185'),
  'gibson-j-185-century-12-fret': member('j-185'),
  'gibson-j-185-original': member('j-185'),
  'gibson-rosanne-cash-j-185': member('j-185'),
  'gibson-lg-2': member(
    'lg-2',
    ...cues(
      'original', 'all mahogany', 'all-mahogany', 'mahogany', 'faded', 'banner', 'rateliff',
      'western', '3/4', 'american eagle',
    ),
    ...GIBSON_CUSTOM,
    DECADE_MODEL,
  ),
  'gibson-50s-lg-2-original': member('lg-2'),
  'gibson-lg-2-3-4': member('lg-2'),
  'gibson-lg-2-all-mahogany-faded': member('lg-2'),
  'gibson-lg-2-american-eagle': member('lg-2'),
  'gibson-j-35': member(
    'j-35',
    ...cues('1936', 'faded', 'banner', 'collector', 'saito'),
    ...GIBSON_CUSTOM,
    /(?<![\w'’])['’]?30['’]?s(?![\w-])/i,
  ),
  'gibson-custom-shop-1936-j-35': member('j-35'),
  'gibson-j-35-30s-faded': member('j-35'),
  'gibson-j-55': {
    line: 'j-55',
    otherMembers: [...cues('1939', 'centennial', 'faded'), ...GIBSON_CUSTOM],
    accessories: ['dealer sheet'],
  },
  'gibson-custom-shop-1939-j-55': member('j-55'),
  'gibson-advanced-jumbo': member(
    'advanced-jumbo',
    ...cues(
      '1936', 'adirondack', 'red spruce', 'pro', 'anniversary', 'limited edition', "luthier's choice",
      'birdseye', 'performer', "fuller's", 'maple',
    ),
    ...GIBSON_CUSTOM,
  ),
  'gibson-custom-shop-1936-advanced-jumbo': member('advanced-jumbo'),
  // Base: the 1968–88 Dove; the 2019– Dove Original is its own model.
  'gibson-dove': member(
    'dove',
    ...cues('elvis', 'in flight', 'artist'),
    ...GIBSON_CUSTOM,
    /dove\s+original|original\s+dove/i,
    yearCue(1989, 2039),
  ),
  'gibson-dove-original': member('dove', yearCue(1962, 2018)),
  // Base: the 2021– Generation Collection G-45; the 2019 G-45 Standard is not it.
  'gibson-g-45': member('g-45', ...cues('studio', 'standard'), ...GIBSON_CUSTOM),
  'gibson-g-45-studio': member('g-45'),
  'gibson-southern-jumbo-original': member('southern-jumbo', ...cues('dealer select', 'sinker', 'custom')),

  // ── PAN-230: legendary gear, step 5 ──────────────────────────────────────
  // The known legendary rows with live demand (3+ unmatched active titles naming them, measured
  // 2026-10-03), each in its own line; every cue below is one those titles carried.
  // The SM57 and SM7B: one mic; screens, clips and cables sold alone are not it.
  'shure-sm57': { line: 'sm57', otherMembers: [...PAIR_OR_LOT, ...cues('bundle', 'beta 57', 'beta 57a')], accessories: MIC_PARTS },
  'shure-sm7b': { line: 'sm7b', otherMembers: [...PAIR_OR_LOT, ...cues('bundle', 'headphones'), /(?<![\w-])sm7a?(?![\w-])/i], accessories: MIC_PARTS },
  // The 1992–2004 "Block Letter" 5150 head: never the 5150 II / III, the 6505 line or EVH's own, nor
  // the 2x12 combo or a cabinet; the retube kits and covers are not the amp.
  'peavey-5150': {
    line: '5150',
    otherMembers: cues('combo', '2x12', '212', '4x12', '412', 'cabinet', 'cab', 'slant', 'straight', 'ii', 'iii', '6505', '6534', 'evh', 'signature', 'stealth', 'lbx'),
    accessories: AMP_PARTS,
  },
  // The 1987–88 JCM 25/50 model 2555 head: never the 2015– 2555X reissue, the 2556/2558 combos, the
  // 2553/2554 and 2525 Mini, nor the 2551 cabinets or a stack built with them.
  'marshall-2555-silver-jubilee': {
    line: '2555',
    otherMembers: [
      ...cues('2555x', '2555x-u', 'reissue', 're-issue', '2556', '2558', '2553', '2554', '2525', '2525h', '2525c', '2536', '2551',
        'cabinet', 'cabinets', 'cab', 'stack', 'full stack', 'half stack', 'combo', '1x12', '2x12', '4x12', 'mini'),
      /(?<![\w-])2551\s?[ab]v?(?![\w-])/i,
      yearCue(2015, 2039),
    ],
    accessories: AMP_PARTS,
  },
  // The 2004– M117R reissue: a bare "M-117" / "M117" is the 1976 original, its own price.
  'mxr-m117r-flanger': { line: 'm117r', otherMembers: [/(?<![\w-])m[\s-]?117(?![\w-]|\s?r)/i], accessories: PEDAL_PARTS },
  // The C800G and the 1950s C-37A: one mic each; the tubes sold for them, clones and parts are not.
  'sony-c800g': {
    line: 'c800g',
    otherMembers: [...PAIR_OR_LOT, ...TUBE_LISTING, ...cues('clone', 'wa-8000', 'wa8000', 'sa-800g', 'ga-8000', 'akita')],
    accessories: MIC_PARTS,
  },
  'sony-c-37a': {
    line: 'c-37a',
    otherMembers: [...PAIR_OR_LOT, ...TUBE_LISTING, ...cues('c-37p', 'c37p', 'c-17', 'c-17b', 'c17', 'c17b')],
    accessories: MIC_PARTS,
  },
  // The 1961–66 6G15 Reverb Unit, a vintage identity: a year, "vintage" or a period finish is
  // required, and the '63 reissue (1990s–), a tank or transformer sold alone are not it.
  'fender-6g15-reverb-unit': {
    line: '6g15',
    otherMembers: [
      ...cues('reissue', 're-issue', "'63", '’63', 'pacific transformer', 'vibroverb', 'twin', 'deluxe reverb', 'stand alone', 'tank only'),
      ...TUBE_LISTING,
      yearCue(1990, 2039),
    ],
    accessories: ['transformer', 'transformers', 'tank', 'pan', 'footswitch', 'cover', 'knob', 'knobs', 'chassis', 'faceplate', 'logo', 'badge', 'handle', 'grille', 'grill', 'cabinet'],
    requires: [yearCue(1961, 1979), ...cues('vintage', 'brownface', 'blackface', 'blonde', 'brown', 'pre-cbs', 'pre cbs', 'tolex')],
  },
  // The ATR-102: never the ATR-100/104 or the MM series, a UAD plug-in or "parts"; the cards,
  // remote, heads and stand sold alone are not the machine.
  'ampex-atr-102': {
    line: 'atr-102',
    otherMembers: [...UAD_SOFTWARE, ...cues('atr-100', 'atr 100', 'atr100', 'atr-104', 'atr 104', 'atr104', 'mm1100', 'mm1200', 'mm-1100', 'mm-1200', 'parts', 'parts and accessories', 'stand only')],
    accessories: ['card', 'cards', 'remote', 'remote control', 'heads', 'head', 'extender', 'servo', 'feet', 'feets', 'sticker', 'scale', 'meter', 'board', 'kit', 'panel', 'control panel', 'padnet', 'cable', 'stand', 'cue amplifier'],
  },
  // The LA-3A (the Urei original and UA's reissue share the row): never a UAD plug-in, a pair or a bundle.
  'ua-la-3a': member('ua-la-3a', ...WARM_AUDIO_COPY, ...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('bundle', 'pedal')),

  // ── PAN-261: the amp section ─────────────────────────────────────────────
  // Measured on the 1,938 active titles that name one of the section's models (read-only snapshot
  // 2026-10-13). The Fender blackface rows are the vintage originals and their reissue rows are the
  // '65 Reissue, the '68 Custom and the Tone Master, each on its own Reverb page and price, so every
  // row of a line names what it is NOT and a reissue row requires its own cue (the Minimoog pattern).
  // The whole section shares the amp trade's extras: a Boss "legend" pedal named for the amp (40 of 75
  // Bassman titles), covers, recap and retube kits, capacitor sets, turret boards, headshells, speakers
  // and a flightcase sold alone.
  'fender-twin-reverb-vintage': fenderVintageAmp('twin-reverb', ...cues('twin reverb ii', 'ii', 'super twin', 'twin amp', 'twin-amp', 'the twin', 'evil twin', 'cyber twin', 'cyber-twin', 'pro tube')),
  'fender-65-twin-reverb-reissue': fenderReissueAmp('twin-reverb', [YY('65'), ...REISSUE], ...TONE_MASTER, ...CUSTOM_68, cue('ii'), cue('super twin')),
  'fender-tone-master-twin-reverb': fenderReissueAmp('twin-reverb', TONE_MASTER, cue('super')),
  'fender-deluxe-reverb-vintage': fenderVintageAmp('deluxe-reverb', ...cues('deluxe reverb ii', 'ii', 'super deluxe', 'hot rod deluxe', 'blues deluxe', 'deluxe 85', 'deluxe 90', 'deluxe 112', 'deluxe vm', 'tweed deluxe', '5e3')),
  'fender-65-deluxe-reverb-reissue': fenderReissueAmp('deluxe-reverb', [YY('65'), ...REISSUE], ...TONE_MASTER, ...CUSTOM_68, ...CUSTOM_64, cue('ii')),
  'fender-68-custom-deluxe-reverb': fenderReissueAmp('deluxe-reverb', CUSTOM_68, ...TONE_MASTER, YY('65'), ...CUSTOM_64, ...CUSTOM_68_NOT),
  'fender-tone-master-deluxe-reverb': fenderReissueAmp('deluxe-reverb', TONE_MASTER),
  'fender-princeton-reverb-vintage': fenderVintageAmp('princeton-reverb', ...cues('princeton reverb ii', 'ii', 'princeton chorus', 'princeton 65', 'princeton 112', 'princeton 650', 'princeton recording')),
  'fender-65-princeton-reverb-reissue': fenderReissueAmp('princeton-reverb', [YY('65'), ...REISSUE], ...TONE_MASTER, ...CUSTOM_68, ...CUSTOM_64, cue('ii')),
  'fender-tone-master-princeton-reverb': fenderReissueAmp('princeton-reverb', TONE_MASTER),
  'fender-super-reverb': fenderVintageAmp('super-reverb', ...cues('super six', 'super twin', 'super champ', 'super sonic', 'super-sonic', 'super 60', 'super 112', 'super 210', 'super amp', 'super bassman', 'without speakers')),
  'fender-vibrolux-reverb': fenderVintageAmp('vibrolux', ...cues('custom vibrolux', 'custom', 'vibrolux reverb-amp')),
  // PAN-261 round 2 (owner, 2026-10-14): the reissues with their own Reverb page and price that the rows above
  // refuse. The Tone Master Super Reverb (CSP 135523) and the '68 Custom Twin (1170), Princeton (1012) and
  // Vibrolux (3232) follow the reissue rule of their lines; the 1995–2008 Custom Vibrolux Reverb has no row and
  // satisfies no '68 cue, so it stays unmatched.
  'fender-tone-master-super-reverb': fenderReissueAmp('super-reverb', TONE_MASTER, cue('super six'), cue('super twin')),
  'fender-68-custom-twin-reverb': fenderReissueAmp('twin-reverb', CUSTOM_68, ...TONE_MASTER, YY('65'), cue('ii'), cue('super twin'), ...CUSTOM_68_NOT),
  'fender-68-custom-princeton-reverb': fenderReissueAmp('princeton-reverb', CUSTOM_68, ...TONE_MASTER, YY('65'), ...CUSTOM_64, cue('ii'), ...CUSTOM_68_NOT),
  'fender-68-custom-vibrolux-reverb': fenderReissueAmp('vibrolux', CUSTOM_68, ...TONE_MASTER, ...CUSTOM_68_NOT),
  'fender-pro-reverb': fenderVintageAmp('pro-reverb', ...cues('pro junior', 'vibro champ', 'vibro-champ', 'pro reverb-amp', 'custom')),
  // The tweed 5F6 / 5F6-A Bassman of 1957–60, the amp the owner's list means: a title must say so, and
  // the blackface and silverface heads, the '59 LTD reissue, the Tone Master and every numbered bass
  // Bassman (10, 100, 135, 500, 800 …) are other products. A two-digit "59" is the reissue: every amp title
  // that writes it is one ("Fender 59 Bassman LTD", "Bassman 59 4x10 1990", "FENDER BASSMAN 59 tweed").
  'fender-bassman': {
    line: 'bassman',
    requires: [...cues('tweed', '5f6', '5f6-a', '5f6a', 'narrow panel', 'narrowpanel', "50's", '50s'), yearCue(1952, 1960)],
    otherMembers: [...REISSUE, ...BASSMAN_OTHERS, YY('59'), ...cues('ltd', 'limited'), yearCue(1961, 2039)],
    accessories: AMP_ACCESSORIES,
  },
  // The '59 Bassman LTD (CSP 8162), Fender's 1990– reissue of the 5F6-A: a title must say so ("59", "LTD",
  // "reissue"); a 1961–89 year is another Bassman's, and a title that writes a 1950s year in full is the original's
  // (it satisfies no cue here and the tweed row takes it).
  'fender-59-bassman-ltd': {
    line: 'bassman',
    requires: [YY('59'), ...REISSUE, cue('ltd')],
    otherMembers: [...BASSMAN_OTHERS, yearCue(1961, 1989)],
    accessories: AMP_ACCESSORIES,
  },
  // The Blues Junior line: the 1995–2015 base model, the III (2010–18) and the IV (2018–) are three pages
  // and three prices; the LTD / Lacquered Tweed / NOS editions are the base model in another dress.
  // "mk3" / "mk 3" is how DBA sellers write the III ("Fender blues Jr. mk3", 2026-10-15; PAN-266): refused on the
  // other members, so it cannot land on the base model.
  'fender-blues-junior': { line: 'blues-junior', otherMembers: [...BLUES_JUNIOR_NOT, ...cues('iii', 'iv', 'mk iii', 'mkiii', 'mk 3', 'mk3', 'mk iv', 'mkiv', 'mk 4', 'mk4')], accessories: AMP_ACCESSORIES },
  'fender-blues-junior-iii': { line: 'blues-junior', requires: cues('iii', 'mk iii', 'mkiii'), otherMembers: [...BLUES_JUNIOR_NOT, ...cues('iv', 'mk iv', 'mkiv', 'mk 4', 'mk4')], accessories: AMP_ACCESSORIES },
  'fender-blues-junior-iv': { line: 'blues-junior', requires: cues('iv', 'mk iv', 'mkiv'), otherMembers: [...BLUES_JUNIOR_NOT, ...cues('iii', 'mk iii', 'mkiii', 'mk 3', 'mk3')], accessories: AMP_ACCESSORIES },
  // The 1955–60 narrow-panel tweed Deluxe (CSP 23302): never the Custom Shop '57 Custom Deluxe, a kit or a
  // boutique copy ("Amp-N Custom 5E3"), nor the Deluxe Reverb.
  'fender-5e3-tweed-deluxe': {
    line: 'tweed-deluxe',
    otherMembers: [
      ...REISSUE, ...BOSS_LEGEND, ...AMP_COPY, ...PAIR_OR_LOT, ...TUBE_LISTING,
      ...cues('custom shop', 'customshop', 'custom', 'handwired', 'hand-wired', 'hand wired', 'deluxe reverb', 'eric clapton', 'vibro champ', 'vibro-champ', 'champ', 'hot rod', 'blues deluxe', 'pro junior'),
      YY('57'), YY('53'), YY('55'), yearCue(1961, 2039),
    ],
    accessories: AMP_ACCESSORIES,
  },
  // The JMI-era and 1970s Top Boost AC30 (CSP 106533): a title must place it (Top Boost / TB, JMI, a 1958–89
  // year, "vintage"); the Korg-era C2 / CC / HW / VR / S1 lines, the 1992 "Vintage Edition", the AC15 / AC10
  // / AC4 and an Escort or WEM named for it are other products; vents, selectors, tubes and speakers are parts.
  'vox-ac30-vintage': {
    line: 'ac30',
    requires: [...cues('top boost', 'tb', 'tbx', 'jmi', 'vintage', 'treble', 'copper', 'copper top', 'ac30/6', 'ac-30/6', 'ac30-6', 'bulldog', 'bulldogs', 'silver bulldogs'), yearCue(1958, 1989), /(?<![\w-])['’]?[67]0['’]?s(?![\w-])/i],
    otherMembers: [
      ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY,
      ...cues('c2', 'c2x', 'cc1', 'cc2', 'cc', 'ch', 'hw', 'hw2', 'hwx', 'vr', 's1', 'c1', 'vtx', 'custom', 'reissue', 're-issue', 'vintage edition', 'amplug', 'escort', 'wem', 'dominator',
        'ac15', 'ac-15', 'ac10', 'ac-10', 'ac4', 'ac-4', 'ac50', 'ac-50', 'ac100', 'ac-100', 'mini', 'head', 'cabinet', 'cab', 'korg', 'pathfinder'),
      /(?<![\w-])ac-?30\s?(?:c|cc|ch|hw|vr|s|vt|tbx)\w*/i,
      yearCue(1990, 2039),
    ],
    accessories: AMP_ACCESSORIES,
  },
  // PAN-261 round 2: the Korg-era AC30 Custom lines the vintage row refuses, the most common Danish AC30 ad. The C2
  // (2010–) and the CC2 Custom Classic (2005–10) each require their own cue and refuse the other's; the X (Blue
  // Alnico) editions and the CC1 / heads are their own pages and are refused by both.
  'vox-ac30c2': {
    line: 'ac30',
    requires: [...cues('c2', 'ac30 custom'), AC30_C2],
    otherMembers: [...AC30_CUSTOM_OTHERS, ...cues('c2x', 'cc2', 'cc2x', 'custom classic'), AC30_C2X, AC30_CC2, AC30_CC2X, yearCue(1958, 2009)],
    accessories: AMP_ACCESSORIES,
  },
  'vox-ac30cc2': {
    line: 'ac30',
    requires: [...cues('cc2', 'custom classic'), AC30_CC2],
    otherMembers: [...AC30_CUSTOM_OTHERS, ...cues('cc2x', 'c2', 'c2x'), AC30_CC2X, AC30_C2, AC30_C2X, yearCue(1958, 2004)],
    accessories: AMP_ACCESSORIES,
  },
  // The 1965–81 JMP 1959 Super Lead (CSP 106245; "Plexi" is a curated alias): never the SLP / HW reissues, the
  // Randy Rhoads, the Studio Vintage SV20, the 50-watt 1987, a JCM / JTM, a 1960 cabinet or a stack, a kit or a
  // boutique copy, nor an overdrive pedal named for it.
  'marshall-super-lead-plexi': {
    line: 'plexi',
    otherMembers: [...PLEXI_OTHERS, ...PLEXI_HW, ...PLEXI_SLP, ...cues('reissue', 're-issue'), yearCue(1982, 2039)],
    accessories: AMP_ACCESSORIES,
  },
  // The two reissues of the 1959 (PAN-261 round 2): the 1959SLP (1993–, CSP 24221; the 35th Anniversary is its own
  // page) and the hand-wired 1959HW (2005–, CSP 6050). Each requires its own cue; a reissue title with a 1990-on year
  // is the SLP. A title that says only "plexi reissue" names neither row's model and stays unmatched.
  'marshall-1959slp': {
    line: 'plexi',
    requires: [...PLEXI_SLP, ...cues('reissue', 're-issue'), yearCue(1990, 2039)],
    otherMembers: [...PLEXI_OTHERS, ...PLEXI_HW, ...cues('anniversary', '35th'), yearCue(1965, 1981)],
    accessories: AMP_ACCESSORIES,
  },
  'marshall-1959hw': {
    line: 'plexi',
    requires: PLEXI_HW,
    otherMembers: [...PLEXI_OTHERS, ...PLEXI_SLP, cue('anniversary'), yearCue(1965, 1981)],
    accessories: AMP_ACCESSORIES,
  },
  // The JCM800 2203 (100 W, CSP 1541) and 2204 (50 W, CSP 23895), 1981–90: never each other, the 2203X / KK / ZW
  // / MS reissues, the Studio Classic SC20, the 4103 / 4104 combos or the 2205 / 2210 split-channel heads; a bare
  // "2203" with a 2000s year is the unlabelled reissue at the original's price and stays; a 1960 cabinet in the
  // title is a bundle after "+" or "with" and a part before it.
  'marshall-jcm800-2203': marshallJcm800('2203', '2204', '4104', '4010'),
  'marshall-jcm800-2204': marshallJcm800('2204', '2203', '4103'),
  // The Dual Rectifier head across its revisions (CSP 121251, the 1992–2000 Solo Head): never the Roadster, Road
  // King, Trem-o-Verb, Blue Angel, Maverick, Triple / Single / Mini / Rect-o-Verb, a combo or cabinet, a retube
  // kit, a Jack Rack or a standalone preamp built from it.
  'mesa-boogie-dual-rectifier': {
    line: 'rectifier',
    otherMembers: [
      ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY, ...UAD_SOFTWARE,
      ...cues('roadster', 'road king', 'roadking', 'triple', 'single', 'mini', 'rect-o-verb', 'rectoverb', 'recto-verb', 'trem-o-verb', 'tremoverb', 'trem o verb', 'blue angel', 'maverick', 'badlander',
        'solo 50', 'rectifier 50', 'combo', '1x12', '2x12', '4x12', 'cab', 'cabinet', 'rack', 'jack rack', 'preamp', 'pre amp', 'pre-amp', 'jessup', 'retube', 'tube set', 'anniversary', 'reborn', 'reissue'),
    ],
    accessories: AMP_ACCESSORIES,
  },
  // The 6505 head (CSP 8435), the 5150 renamed in 2004: never the 6505+ / II / MH / Mini / Piranha, the 5150
  // itself (its own row, same line), a cabinet, combo, module or preamp.
  'peavey-6505': {
    line: '5150',
    otherMembers: [...PEAVEY_6505_OTHERS, PEAVEY_6505_PLUS, ...cues('6505+', 'plus', 'ii')],
    accessories: AMP_ACCESSORIES,
  },
  // PAN-261 round 2: the 6505+ (CSP 1635; "6505 Plus", "6505 +") and the 6505 II (2022–, CSP 167518) are their own
  // pages. The 6505+ 112 combo and the 6505 II 4x12 cabinet are refused with the rest of the family.
  'peavey-6505-plus': {
    line: '5150',
    requires: [PEAVEY_6505_PLUS, ...cues('6505+', 'plus')],
    otherMembers: [...PEAVEY_6505_OTHERS, cue('ii')],
    accessories: AMP_ACCESSORIES,
  },
  'peavey-6505-ii': {
    line: '5150',
    requires: cues('ii', 'mk ii', 'mkii', '6505ii'),
    otherMembers: [...PEAVEY_6505_OTHERS, PEAVEY_6505_PLUS, ...cues('6505+', 'plus')],
    accessories: AMP_ACCESSORIES,
  },
  // The JC-120 combo (CSP 1674): never the JC-120H head, the JC-160 / 40 / 22 / 85 / 77 / 50 / 20, the 50th
  // Anniversary edition (its own page), a gig bag or slip cover.
  'roland-jc-120': {
    line: 'jc',
    otherMembers: [...PAIR_OR_LOT, ...AMP_COPY, ...cues('jc-120h', 'jc120h', 'jc-160', 'jc160', 'jc-40', 'jc-22', 'jc-85', 'jc-77', 'jc-50', 'jc-20', 'jc-01', 'jc-10', 'anniversary', '50th', 'studio slips', 'clamshell')],
    accessories: [...AMP_ACCESSORIES, ...JC_SPEAKER],
  },
  // The Hiwatt DR103 Custom 100 head (CSP 25625): never the DR504 / DR201, the Custom 50 / 20, an SE4123
  // cabinet, a Maxwatt, nor a Hi-Tone or Reeves built like it.
  'hiwatt-dr103': {
    line: 'dr103',
    otherMembers: [...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY, ...cues('dr504', 'dr-504', 'dr201', 'dr-201', 'custom 50', 'custom 20', 'se4123', 'se 4123', 'se-4123', 'cab', 'cabinet', '4x12', 'hi-tone', 'hitone', 'reeves', 'maxwatt', 'solid state', 'bulldog')],
    accessories: AMP_ACCESSORIES,
  },
  // The Soldano SLO-100 head (CSP 45958, the pre-2019 Soldano-built original): never the SLO-30, the SLO-100R
  // rack, the Custom Shop production since 2019 (its own page and half the price), a mini, a pedal or a plug-in.
  'soldano-slo-100': {
    line: 'slo',
    otherMembers: [...SLO_OTHERS, ...cues('custom shop', 'customshop'), yearCue(2019, 2039)],
    accessories: AMP_ACCESSORIES,
  },
  // PAN-261 round 2: the Custom Shop SLO-100 (CSP 166850), built since 2019 under Boutique Amps Distribution. Its
  // model name is the original's (the Minimoog pattern), so a title reaches both rows and the cue decides: "Custom
  // Shop" or a 2019-on year is this row, a 1987–2018 year the original's.
  'soldano-slo-100-custom-shop': {
    line: 'slo',
    requires: [...cues('custom shop', 'customshop'), yearCue(2019, 2039)],
    otherMembers: [...SLO_OTHERS, yearCue(1987, 2018)],
    accessories: AMP_ACCESSORIES,
  },
  // The 1969–85 tube SVT head (CSP 22627, the 1969–72 "Blue Line" page): never the SVT-CL / VR / AV, the II–8 and
  // Pro hybrids, the Micro / Mini, any SVT cabinet (810, 410, 210, 212, 115 …), a DI box or a stack.
  'ampeg-svt': {
    line: 'svt',
    otherMembers: [
      ...PAIR_OR_LOT, ...TUBE_LISTING, ...AMP_COPY,
      /(?<![\w-])svt[\s-]*(?:cl|vr|av|ii|iii|iv|vi|v|[2-8]|pro|classic|heritage|micro|mini|tube|di|\d{3,4}[a-z]*)(?![\w])/i,
      ...cues('classic', 'heritage', 'pro', 'micro', 'mini', 'cab', 'cabinet', 'cabs', 'speaker cabinet', '8x10', '4x10', '2x10', '1x15', '2x12', '810', '410', '210', '212', '115', '15e', 'hen', 'hlf', 'he', 'av', 'di box', 'tube di',
        'full stack', 'stack', 'b-15', 'b15', 'portaflex', 'v-4', 'v4', 'v-4b', 'rocket', 'reissue'),
    ],
    accessories: AMP_ACCESSORIES,
  },

  // ── PAN-230: legendary gear, step 5, tranche 2 ───────────────────────────
  // Manley's three legendary rows are the standard versions (CSPs 1856, 28955, 28964): the Mastering
  // Versions, the XXV / 30th anniversary editions and the Nu Mu are their own Reverb pages and prices.
  'manley-massive-passive': { line: 'massive-passive', otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('mastering', 'anniversary', 'xxv', 'bundle')], accessories: STUDIO_PARTS },
  'manley-variable-mu': { line: 'variable-mu', otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('mastering', 'anniversary', 'nu mu', 'numu', 'slam', 'bundle')], accessories: STUDIO_PARTS },
  // The standard ELOP (CSP 28964). The ELOP+ is a different product with its own Reverb page and price (its row
  // comes with the Manley pass); Langevin's ELOP and the CORE strip are not it either.
  'manley-elop': { line: 'elop', otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, /(?<![\w-])elop\s*(?:\+|plus(?![\w-]))/i, /(?<![\w-])core(?![a-z])/i, ...cues('langevin', 'bundle')], accessories: STUDIO_PARTS },
  // The 2007– API 550A (CSP 3855): never a 1970s original (Huntington / Melville, its own price), the Saul Walker
  // "Classic" and Anniversary editions, a 550B, a loaded rack, console or channel strip, a pair, or a power supply for it.
  'api-550a': {
    line: '550a',
    otherMembers: [
      ...UAD_SOFTWARE, ...PAIR_OR_LOT, yearCue(1968, 1999),
      ...cues('vintage', 'huntington', 'melville', 'saul walker', 'anniversary', 'classic', 'gold', '550a-1', '550b', '560', '5500', '550l', '512c',
        'radial cube', 'console', 'mixer', 'the box', '1608', '7600', 'tcs', 'tcs-ii', 'channel strip', 'input module', 'rack', 'lunchbox', 'loaded', 'bundle'),
    ],
    accessories: ['power supply', 'psu', 'knob', 'knobs', 'faceplate', 'op-amp', 'op-amps', 'opamp', 'opamps'],
  },
  // The 1970s "Metal Knob" 33609 (CSP 56137): never AMS Neve's 33609/J, /JD and /N, the later 33609 C, the console
  // 34628, a Siemens module sold "like" it, or a transformer out of one.
  'neve-33609': {
    line: '33609',
    otherMembers: [
      ...UAD_SOFTWARE, ...PAIR_OR_LOT, ...NEVE_CLONES,
      /(?<![\w-])33609\s?\/?\s?(?:j|jd|n|c)(?![\w-])/i,
      ...cues('ams', 'reissue', '34628', 'siemens', '601433', 'u73', 'u273', 'module', 'modules', 'dealer display', '1073', '1081', '1084'),
    ],
    accessories: NEVE_PARTS,
  },

  // ── PAN-249: the studio-gear pass (one Danish studio's 33 ads) ───────────
  // Measured on every active title naming the model (read-only, 2026-10-07; scripts/lib/pan249-studio.test.ts).
  // The 2004–2008 LA-610 (CSP 24819): never the MkII — 57 of the 58 live titles, its own Reverb page and price —
  // nor the Bill Putnam Jr. edition; a plug-in, a pair or a bundle is not the unit.
  'ua-la-610': member('ua-la-610', ...UAD_SOFTWARE, ...PAIR_OR_LOT, /(?<![\w-])mk\s?(?:ii|2)(?![\w-])/i, ...cues('mkii', 'mk2', 'putnam', 'signature', 'bundle')),
  // The ARP Solina String Ensemble (CSP 15989): the Behringer is another brand's product (the brand guard defers it);
  // the parts trade that outnumbers its units — caps, switches, knobs, keys, the transformer, manuals — is refused
  // unless an inclusion marker precedes it ("OG Volume Pedal Included" stays).
  'arp-solina-string-ensemble': {
    line: 'solina',
    otherMembers: [...PAIR_OR_LOT, ...cues('behringer', 'phone jack')],
    accessories: [
      'cap', 'caps', 'slidercap', 'slider cap', 'button caps', 'pushbutton cap', 'switch', 'powerswitch', 'power switch', 'knob', 'knobs',
      'key', 'keys', 'replacement keys', 'transformer', 'power transformer', 'manual', 'service manual', 'documentation',
    ],
  },
  // The ARP 2600 (1971–81) is never Korg's FS / M reissue, which has its own row and needs the cue (PAN-266), nor
  // Behringer's clone ("Behringer ARP 2600 Grey Meanie"), which names ARP the same way.
  'arp-2600': { line: 'arp-2600', otherMembers: [...KORG_ARP_2600, cue('behringer')] },
  'arp-korg-arp-2600': { line: 'arp-2600', otherMembers: [], requires: KORG_ARP_2600 },
  // The Clariphonic Dual-Channel (CSP 45994): the 500-series module and the MS version are other models with their own
  // pages; a UBK-branded unit is the original.
  'kush-clariphonic': member('kush-clariphonic', ...UAD_SOFTWARE, ...PAIR_OR_LOT, /(?<![\w-])500(?![\w-])/i, /(?<![\w-])ms(?![\w-])/i, ...cues('500 series', 'bundle')),
  // The Fairchild 670 (CSP 15156): never a Stam Audio / Stamchild or other clone, a unit sold "style" / "type" / "like",
  // a plug-in, a tube sold for it or a pair; the 660 is the mono unit, its own product.
  'fairchild-670': member('fairchild-670', ...UAD_SOFTWARE, ...PAIR_OR_LOT, ...TUBE_LISTING,
    ...cues('stam', 'stam audio', 'stamchild', 'sa-670', 'sa670', 'sa-660', 'undertone', 'analoguetube', 'heritage audio', 'herchild',
      'style', 'type', 'clone', 'copy', 'like', 'ala', 'inspired', 'kit', '660', 'bundle')),
  // The Lexicon 200 (CSP 14065), a bare-number model: never the MX200 / MPX 200 / PCM / LXP units or the 224 / 480L
  // that share the brand, nor a plug-in or a bundle. No live title names it today; the boundary guards the number.
  // PAN-290: a spaced "MX 200" or "MS 200" is not the number either, now that the MX200 is a row of its own, and the 200
  // joins the one `lexicon` line every PAN-290 Lexicon row is on (see `lexicon` above).
  'lexicon-200': member('lexicon', ...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('mx200', 'mx-200', 'mpx', 'mpx200', 'mpx-200', 'pcm', 'lxp', '224', '224x', '224xl', '480', '480l', 'bundle'), /(?<![\w-])m[sx][\s-]?200(?![\w-])/i),
  // The LA-610 MkII (2008–, CSP 1969) shares the classic's line, so the classic's MkII refusal separates them instead
  // of deferring a two-line tie (step 5b). Without a Mark II cue a title is the classic; a listing that bundles
  // headphones, monitors or cables (measured: Audio-Technica, KRK, Mackie, Mogami) is not the unit.
  'universal-audio-la-610-mkii': {
    line: 'ua-la-610',
    otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('putnam', 'signature', 'bundle', 'audio-technica', 'krk', 'mackie', 'mogami')],
    requires: MK_II,
  },
  // The dbx 160 family, one row per Reverb page (manager's call 2026-10-07): the 1970s VU unit (CSP 29953), the 160A
  // (2562), the 160X (55335) and the 160XT (51557). Each model number is its own token, so the rows already separate;
  // what none of them is: the UAD and Waves plug-ins named after the 160, a pair, or "2 dbx 160" (two units).
  'dbx-160': member('dbx-160', ...DBX_160_NOT_THE_UNIT),
  'dbx-160a': member('dbx-160', ...DBX_160_NOT_THE_UNIT),
  'dbx-160x': member('dbx-160', ...DBX_160_NOT_THE_UNIT),
  'dbx-160xt': member('dbx-160', ...DBX_160_NOT_THE_UNIT),

  // ── PAN-221: Sequential, three eras, one maker ───────────────────────────
  // The 2018– keyboards and their desktop / module versions are their own Reverb pages and prices,
  // so one line per model splits them on the form factor; the 1978–84 Prophet-5 is split from the
  // 2020 model as the Prophet-10 is (above); every vintage Sequential Circuits and Dave Smith
  // Instruments row refuses the parts trade that outnumbers its units. Measured on the 1,305
  // active titles naming the maker, 2026-10-04 (scripts/lib/pan221-sequential.test.ts).
  'sequential-prophet-5-desktop': { line: 'prophet-5', requires: SEQ_DESKTOP, otherMembers: [], accessories: SEQ_PARTS },
  'sequential-circuits-prophet-5': { line: 'prophet-5', requires: [PROPHET_5_VINTAGE], otherMembers: [PROPHET_5_2020], accessories: SEQ_PARTS },
  'sequential-prophet-6': { line: 'prophet-6', otherMembers: SEQ_DESKTOP, accessories: SEQ_PARTS },
  'sequential-prophet-6-desktop': { line: 'prophet-6', requires: SEQ_DESKTOP, otherMembers: [], accessories: SEQ_PARTS },
  'sequential-prophet-10-desktop': { line: 'prophet-10', requires: SEQ_DESKTOP, otherMembers: [], accessories: SEQ_PARTS },
  'sequential-ob-6': { line: 'ob-6', otherMembers: SEQ_DESKTOP, accessories: SEQ_PARTS },
  'sequential-ob-6-desktop': { line: 'ob-6', requires: SEQ_DESKTOP, otherMembers: [], accessories: SEQ_PARTS },
  'sequential-take-5': { line: 'take-5', otherMembers: SEQ_DESKTOP, accessories: SEQ_PARTS },
  'sequential-take-5-desktop': { line: 'take-5', requires: SEQ_DESKTOP, otherMembers: [], accessories: SEQ_PARTS },
  'sequential-trigon-6': { line: 'trigon-6', otherMembers: SEQ_DESKTOP, accessories: SEQ_PARTS },
  'sequential-trigon-6-desktop': { line: 'trigon-6', requires: SEQ_DESKTOP, otherMembers: [], accessories: SEQ_PARTS },
  'sequential-pro-3': { line: 'pro-3', otherMembers: cues('se', 'special edition'), accessories: SEQ_PARTS },
  'sequential-pro-3-se': { line: 'pro-3', requires: cues('se', 'special edition'), otherMembers: [], accessories: SEQ_PARTS },
  'sequential-prophet-rev2': { line: 'prophet-rev2', otherMembers: SEQ_DESKTOP, accessories: SEQ_PARTS },
  'sequential-prophet-x': { line: 'prophet-x', otherMembers: cues('xl'), accessories: SEQ_PARTS },
  'sequential-drumtraks': { line: 'drumtraks', otherMembers: [], accessories: SEQ_PARTS },
  'sequential-circuits-pro-one': { line: 'pro-one', otherMembers: cues('behringer', 'pro-2', 'pro 2', 'pro-3', 'pro 3'), accessories: SEQ_PARTS },
  'sequential-circuits-prophet-600': { line: 'prophet-600', otherMembers: [], accessories: SEQ_PARTS },
  'sequential-circuits-prophet-vs': { line: 'prophet-vs', otherMembers: cues('rack', 'rackmount'), accessories: SEQ_PARTS },
  'sequential-circuits-six-trak': { line: 'six-trak', otherMembers: [], accessories: SEQ_PARTS },
  'sequential-circuits-prophet-2000': { line: 'prophet-2000', otherMembers: cues('2002'), accessories: SEQ_PARTS },
  'sequential-circuits-prophet-t8': { line: 'prophet-t8', otherMembers: [], accessories: SEQ_PARTS },
  // Dave Smith Instruments: the Mopho is the yellow desktop box; the keyboard, the SE and the x4 are their own pages.
  'dave-smith-instruments-mopho': { line: 'mopho', otherMembers: cues('keyboard', 'x4', 'se', '32-key', '32 key', '42-key'), accessories: SEQ_PARTS },
  'dave-smith-instruments-mopho-x4': { line: 'mopho', requires: [cue('x4')], otherMembers: [], accessories: SEQ_PARTS },
  // The Evolver is the 2002 desktop; the Poly Evolver and the Mono Evolver are keyboards, the Poly Evolver Rack its own row.
  'dave-smith-instruments-evolver': { line: 'evolver', otherMembers: cues('poly', 'polyevolver', 'mono', 'mek', 'keyboard', 'rack'), accessories: SEQ_PARTS },
  'dave-smith-instruments-poly-evolver': { line: 'evolver', requires: cues('poly', 'polyevolver'), otherMembers: cues('rack'), accessories: SEQ_PARTS },
  'dave-smith-instruments-mono-evolver': { line: 'evolver', requires: cues('mono', 'mek'), otherMembers: [], accessories: SEQ_PARTS },
  'dave-smith-instruments-prophet-08': { line: 'prophet-08', otherMembers: SEQ_DESKTOP, accessories: SEQ_PARTS },
  'dave-smith-instruments-tempest': { line: 'tempest', otherMembers: [], accessories: SEQ_PARTS },
  'dave-smith-instruments-tetra': { line: 'tetra', otherMembers: [], accessories: SEQ_PARTS },
  'davesmithinstruments-pro2': { line: 'pro-2', otherMembers: [], accessories: SEQ_PARTS },
  // PAN-271: the trumpet rows. A Yamaha model number carries its own boundary ("YTR-2330" never reads as "YTR-2335",
  // and the finish suffix glues to the number, so "YTR-2330S" reaches the row only through its identifier); the row
  // is the model, not the finish (owner, 2026-10-03). A brandless or modelless "trompet" names no row at all.
  'yamaha-ytr-232': ytr(),
  'yamaha-ytr-1335': ytr(),
  'yamaha-ytr-2320': ytr(),
  'yamaha-ytr-2330': ytr(),
  'yamaha-ytr-2335': ytr(),
  'yamaha-ytr-4335gii': ytr(),
  'yamaha-ytr-8310z': ytr(),
  'yamaha-ytr-8335': ytr(),
  'yamaha-ytr-8345': ytr(),
  // The high-end rows (owner, 2026-10-20): the Xeno Artist Chicago and New York, the Xeno C and its Artist
  // siblings, the Custom LA, the lightweight 8340EM, the 850 Custom and the 6810 piccolo. "YTR-8335LA" never
  // reads as the 8335: the suffix glues to the number, and the LA row's own model name takes it.
  'yamaha-ytr-9335chs': ytr(),
  'yamaha-ytr-9335nys': ytr(),
  'yamaha-ytr-8445': ytr(),
  'yamaha-ytr-9445chs': ytr(),
  'yamaha-ytr-9445nys': ytr(),
  'yamaha-ytr-8335la': ytr(),
  'yamaha-ytr-8340em': ytr(),
  'yamaha-ytr-850': ytr(),
  'yamaha-ytr-6810': ytr(),
  'bach-stradivarius-37': stradivarius(),
  'bach-stradivarius-43': stradivarius(),
  'bach-stradivarius-72': stradivarius(),
  // ── PAN-280: boutique pedals (Strymon, EarthQuaker Devices, Hologram Electronics) ──
  // Strymon. The TimeLine never had a second version: a "TimeLine II" / "V2" title names a generation Klup holds no
  // row for and stays unmatched; a "Big Sky Mk1" is the original.
  'strymon-big-sky': pedal('bigsky', ...STRYMON_MX),
  'strymon-bigsky-mx': strymonMx('bigsky'),
  'strymon-timeline': pedal('timeline', ...STRYMON_MX, ...MK_II, ...cues('ii', 'v2')),
  'strymon-timeline-mx': strymonMx('timeline'),
  'strymon-nightsky': pedal('nightsky'),
  'strymon-volante': pedal('volante'),
  'strymon-iridium': pedal('iridium'),
  'strymon-mobius': pedal('mobius'),
  'strymon-el-capistan': pedal('el-capistan'),
  'strymon-flint': pedal('flint'),
  'strymon-deco': pedal('deco'),
  'strymon-dig': pedal('dig'),
  'strymon-bluesky': pedal('bluesky'),
  'strymon-lex': pedal('lex'),
  'strymon-ola': pedal('ola'),
  'strymon-brigadier': pedal('brigadier'),
  'strymon-orbit': pedal('orbit'),
  'strymon-riverside': pedal('riverside'),
  'strymon-sunset': pedal('sunset'),
  'strymon-compadre': pedal('compadre'),
  'strymon-cloudburst': pedal('cloudburst'),
  'strymon-zelzah': pedal('zelzah'),
  'strymon-ultraviolet': pedal('ultraviolet'),
  'strymon-ob-1': pedal('ob-1'),
  'strymon-fairfax': pedal('fairfax'),
  // EarthQuaker Devices. A V1 / V2 / V3 is the same row. The Hoof line: the Hoof refuses its Reaper and the Cloven
  // Hoof (no row), the Hoof Reaper requires "Reaper".
  'earthquaker-devices-plumes': pedal('plumes'),
  'earthquaker-devices-life-pedal': pedal('life-pedal'),
  'earthquaker-devices-avalanche-run': pedal('avalanche-run'),
  'earthquaker-devices-rainbow-machine': pedal('rainbow-machine'),
  'earthquaker-devices-afterneath': pedal('afterneath'),
  'earthquaker-devices-dispatch-master': pedal('dispatch-master'),
  'earthquaker-devices-hoof': pedal('hoof', ...cues('reaper', 'cloven')),
  'earthquaker-devices-hoof-reaper': { line: 'hoof', requires: cues('reaper'), otherMembers: PEDAL_NEVER, accessories: PEDAL_EXTRAS },
  'earthquaker-devices-hizumitas': pedal('hizumitas'),
  'earthquaker-devices-pyramids': pedal('pyramids'),
  'earthquaker-devices-westwood': pedal('westwood'),
  'earthquaker-devices-palisades': pedal('palisades'),
  'earthquaker-devices-ghost-echo': pedal('ghost-echo'),
  'earthquaker-devices-spatial-delivery': pedal('spatial-delivery'),
  'earthquaker-devices-bit-commander': pedal('bit-commander'),
  'earthquaker-devices-data-corrupter': pedal('data-corrupter'),
  'earthquaker-devices-sea-machine': pedal('sea-machine'),
  'earthquaker-devices-grand-orbiter': pedal('grand-orbiter'),
  'earthquaker-devices-arpanoid': pedal('arpanoid'),
  'earthquaker-devices-organizer': pedal('organizer'),
  'earthquaker-devices-special-cranker': pedal('special-cranker'),
  'earthquaker-devices-arrows': pedal('arrows'),
  'earthquaker-devices-astral-destiny': pedal('astral-destiny'),
  'earthquaker-devices-silos': pedal('silos'),
  'earthquaker-devices-aurelius': pedal('aurelius'),
  'earthquaker-devices-the-warden': pedal('warden'),
  'earthquaker-devices-zoar': pedal('zoar'),
  'earthquaker-devices-blumes': pedal('blumes'),
  'earthquaker-devices-park-fuzz': pedal('park-fuzz'),
  'earthquaker-devices-erupter': pedal('erupter'),
  'earthquaker-devices-acapulco-gold': pedal('acapulco-gold'),
  'earthquaker-devices-tone-job': pedal('tone-job'),
  'earthquaker-devices-hummingbird': pedal('hummingbird'),
  'earthquaker-devices-swiss-things': pedal('swiss-things'),
  'earthquaker-devices-talons': pedal('talons'),
  'earthquaker-devices-aqueduct': pedal('aqueduct'),
  'earthquaker-devices-bellows': pedal('bellows'),
  'earthquaker-devices-dirt-transmitter': pedal('dirt-transmitter'),
  'earthquaker-devices-the-depths': pedal('depths'),
  'earthquaker-devices-fuzz-master-general': pedal('fuzz-master-general'),
  'earthquaker-devices-levitation': pedal('levitation'),
  // Hologram Electronics.
  'hologram-electronics-microcosm': pedal('microcosm'),
  'hologram-electronics-chroma-console': pedal('chroma-console'),
  // ── PAN-282: Electro-Harmonix Memory Man ──
  // The four "Deluxe Memory Man" rows: each requires its own era and refuses the others'. The Reissue does not refuse
  // the vintage words — a 1997 big box is "vintage" to its seller — and the XO does not either: "XO" is explicit.
  'ehx-deluxe-memory-man-vintage': memoryMan(MM_VINTAGE, MM_REISSUE, MM_XO, MM_TAP_TEMPO, MM_TT_CODES, MM_NANO, MM_HAZARAI, MM_SMALL),
  'ehx-deluxe-memory-man-reissue': memoryMan(MM_REISSUE, MM_XO, MM_TAP_TEMPO, MM_TT_CODES, MM_NANO, MM_HAZARAI, MM_SMALL),
  'ehx-deluxe-memory-man-xo': memoryMan(MM_XO, MM_REISSUE, MM_TAP_TEMPO, MM_TT_CODES, MM_NANO, MM_HAZARAI, MM_SMALL),
  'ehx-deluxe-memory-man-tap-tempo': memoryMan(MM_TAP_TEMPO, MM_TT_CODES, MM_REISSUE, [cue('xo')], MM_NANO, MM_HAZARAI, MM_SMALL),
  // The 1100-TT and 550-TT are their own model names (and identifiers, for "… Tap Tempo Delay Pedal | 1100-TT");
  // each refuses the other's number.
  'ehx-deluxe-memory-man-1100-tt': memoryMan(undefined, [/(?<![\w-])550(?:[-\s]?tt)?(?![\w-])/i], MM_NANO, MM_HAZARAI, MM_SMALL),
  'ehx-deluxe-memory-man-550-tt': memoryMan(undefined, [/(?<![\w-])1100(?:[-\s]?tt)?(?![\w-])/i], MM_NANO, MM_HAZARAI, MM_SMALL),
  // The Nano (2021–) and the Stereo with Hazarai (2007–) carry their names; the identity file adds the spellings
  // "Nano Memory Man", "Nano Dlx Memory Man", "Memory Man Nano", "Hazarai" and "SMMH" as identifiers.
  'ehx-memory-man-nano': memoryMan(undefined, MM_TT_CODES, MM_HAZARAI, MM_SMALL),
  'ehx-memory-man-stereo-hazarai': memoryMan(undefined, MM_NANO, MM_SMALL),
  // The original non-deluxe Memory Man (EH 7500 / EH 1309 Solid State Echo of 1976–78, EH 7810 / EH 1338 with the
  // chorus switch of 1978–84): its model name is inside every other member's, so it refuses them all and, like the
  // vintage Deluxe, needs a vintage signal or Reverb's "Solid State Echo" / "Analog Delay Line".
  'ehx-memory-man': memoryMan(
    [...MM_VINTAGE, ...cues('solid state', 'analog delay line')],
    cues('deluxe', 'dlx'), MM_REISSUE, [cue('xo')], MM_TAP_TEMPO, MM_TT_CODES, MM_NANO, MM_HAZARAI, MM_SMALL,
  ),
  // Outside the line: the Memory Boy refuses its Deluxe, the Deluxe Memory Boy and the Memory Toy carry their names.
  'ehx-memory-boy': pedal('memory-boy', cue('deluxe')),
  'ehx-deluxe-memory-boy': pedal('memory-boy'),
  'ehx-memory-toy': pedal('memory-toy'),
  // ── PAN-286: Maestro vintage pedals ──
  // The Fuzz-Tone line, three rows (manager, 2026-10-21 — price decides identity): the 1962 FZ-1 ($1,150 on Reverb's
  // sold population, no Reverb page) is its own row whose model_name is its bare code, so "FZ-1A" is never a
  // candidate for it and it refuses every lettered sibling; the FZ-1A and FZ-1B ($400 / $354, the Memory Man faces'
  // closeness) are ONE row whose model_name is the line word and whose identifiers are the two codes — it requires
  // one of its letters, so the 1962 unit, the FZ-1S and the 2022 FZ-M stay out; the FZ-1S is its code or "Super Fuzz".
  'maestro-fuzz-tone-fz-1': maestro('fuzz-tone', undefined, FZ('a'), FZ('b'), FZ('s'), ...FZ_OTHERS),
  'maestro-fuzz-tone-fz-1a-fz-1b': maestro('fuzz-tone', [FZ('a'), FZ('b')], FZ('s'), ...FZ_OTHERS),
  // "Super Electric Suzztone - Maestro Fuzz-Tone FZ-1S Super-Fuzz" (three Reverb sold titles) is a copy that names
  // the original in full and never says so; its own name is the cue.
  'maestro-fuzz-tone-fz-1s': maestro('fuzz-tone', [FZ('s'), cue('super fuzz'), cue('super-fuzz'), cue('superfuzz')], FZ('a'), FZ('b'), ...FZ_OTHERS, cue('suzztone'), cue('super electric')),
  // The MFZ-1 (1976–79): its code, or "MFZ" alone ("Maestro MFZ Model 271A Fuzz"); a bare "Maestro Fuzz" names no row.
  'maestro-fuzz-mfz-1': maestro('mfz-1', [/(?<![\w-])mfz(?:[-\s]?1)?(?![a-z0-9])/i], cue('fuzztain'), cue('mfzt')),
  'maestro-fuzz-phazzer': maestro('fuzz-phazzer'),
  'maestro-bass-brassmaster': maestro('bass-brassmaster'),
  // The Phase Shifter PS-1 / PS-1A / PS-1B are ONE row (manager, 2026-10-21: $392 / $392 / $354 — price decides
  // identity): model_name is the line word, the lettered codes are identifiers (the bare "PS-1" is not — "Rega PS1
  // 350mA strømforsyning" is live on DBA and an identifier needs no brand word), and the row requires a PS-1 code in
  // any letter so that the MP-1, the Stage Phaser and a bare "Maestro Phaser" (DBA, 2026-10-21) stay out. The MP-1
  // (Moog, 1976–78) requires its code; the Stage Phaser (MSP, no Reverb page) is its word, and the MP-1 refuses it.
  'maestro-phase-shifter': maestro('phase-shifter', [PS('[ab]?')], cue('psfs')),
  'maestro-phaser-mp-1': maestro('mp-1', [/(?<![\w-])mp[-\s]?1(?![a-z0-9])/i], cue('stage'), cue('orbit'), cue('msp')),
  'maestro-stage-phaser': maestro('stage-phaser', undefined, cue('orbit')),
  'maestro-mini-phase-mps-2': maestro('mps-2', [/(?<![\w-])mps[-\s]?2(?![a-z0-9])/i, cue('mini phase'), cue('mini-phase'), cue('miniphase')]),
  // The RM-1 and its RM-1A / RM-1B revisions are one page; the MP-2 is the expression pedal sold for it.
  'maestro-ring-modulator-rm-1': maestro('rm-1', undefined, /(?<![\w-])mp[-\s]?2(?![a-z0-9])/i, cue('expression')),
  'maestro-filter-sample-hold-fsh-1': maestro('fsh-1'),
  'maestro-parametric-filter-mpf-1': maestro('mpf-1'),
  // The OB-1 and OB-2 Octave Box are one page and one price; the Boomerang BG-1 / BG-2 wah likewise.
  'maestro-octave-box': maestro('octave-box'),
  'maestro-boomerang-bg-2': maestro('boomerang'),
  'maestro-full-range-booster-frb-1': maestro('frb-1', [/(?<![\w-])frb[-\s]?1(?![a-z0-9])/i, cue('full range')], cue('titan')),
  // The Echoplex line (the EP-1, EP-3 and EP-4 rows exist since PAN-230): each requires its number and refuses the
  // others, so "Transitional … Maestro EP-2 / EP-3 Echoplex" names no row; Dunlop's EP103 / EP101 are their own brand
  // and the brand guard's, named here only so a title that quotes both sides stays out.
  'maestro-echoplex-ep-1': maestro('echoplex', [EP(1)], ...EP_OTHERS(1)),
  'maestro-echoplex-ep-2': maestro('echoplex', [EP(2)], ...EP_OTHERS(2)),
  'maestro-echoplex-ep-3': maestro('echoplex', [EP(3)], ...EP_OTHERS(3)),
  'maestro-echoplex-ep-4': maestro('echoplex', [EP(4)], ...EP_OTHERS(4)),
  // ── PAN-286: the Neo Instruments Ventilator family ──
  'neo-instruments-ventilator': neoVent(undefined, ...VENT_II, ...VENT_SMALL),
  'neo-instruments-ventilator-ii': neoVent(VENT_II, ...VENT_SMALL),
  'neo-instruments-mini-vent': neoVent(undefined, cue('micro'), cue('microvent'), cue('drive in')),
  'neo-instruments-micro-vent': neoVent(undefined, cue('mini'), cue('minivent'), cue('drive in')),
  // ── PAN-290: the Lexicon classics ──
  // The 224, 224X and 224XL are ONE row (price decides identity: $2,800 / $3,267 / $3,499 on Reverb's sold
  // population, 2026-10-21 — one chassis with another remote and firmware): model_name "224", the codes "224X" and
  // "224XL" its identifiers, so "Lexicon 224 XL" and "Lexicon 224X mit LARC" both name it.
  'lexicon-224': lexicon('224', undefined),
  // The 480L takes "Lexicon 480" as an identifier as well: DBA's "Lexicon 480 m. Larc, Classic Card" (31,000 kr).
  'lexicon-480l': lexicon('480l', undefined),
  'lexicon-960l': lexicon('960l', undefined),
  // The 300 (sellers also write "M300") and the 300L — the 300 with its LARC — price apart ($1,500 vs $2,490): the 300
  // refuses the L and any LARC ("Lexicon M300 LARC Remote"), the 300L is its own model name.
  'lexicon-300': lexicon('300', undefined, /(?<![\w-])(?:m[\s-]?)?300[\s-]?l(?![\w-])/i, cue('larc')),
  'lexicon-300l': lexicon('300', undefined),
  // The PCM line, one row per number. The PCM96 and the PCM96 Surround share the model name "PCM 96" and price apart
  // ($1,700 vs $2,250): the Surround requires its word, the stereo unit refuses it.
  'lexicon-pcm-41': lexicon('pcm', undefined, ...PCM_OTHERS(41)),
  'lexicon-pcm-42': lexicon('pcm', undefined, ...PCM_OTHERS(42)),
  'lexicon-pcm-60': lexicon('pcm', undefined, ...PCM_OTHERS(60)),
  'lexicon-pcm-70': lexicon('pcm', undefined, ...PCM_OTHERS(70)),
  'lexicon-pcm-80': lexicon('pcm', undefined, ...PCM_OTHERS(80)),
  'lexicon-pcm-81': lexicon('pcm', undefined, ...PCM_OTHERS(81)),
  'lexicon-pcm-90': lexicon('pcm', undefined, ...PCM_OTHERS(90)),
  'lexicon-pcm-91': lexicon('pcm', undefined, ...PCM_OTHERS(91)),
  'lexicon-pcm-92': lexicon('pcm', undefined, ...PCM_OTHERS(92)),
  'lexicon-pcm-96': lexicon('pcm', undefined, ...PCM_OTHERS(96), cue('surround')),
  'lexicon-pcm-96-surround': lexicon('pcm', [cue('surround')], ...PCM_OTHERS(96)),
  // The Prime Time line: the Model 93 and the Prime Time II (Model 95) share the model name "Prime Time" — the II
  // requires its numeral or its model number; the Super Prime Time (Model 97) is its own model name, and both others
  // refuse it.
  'lexicon-prime-time': lexicon('prime-time', undefined, PRIME_TIME_II, SUPER_PRIME_TIME),
  'lexicon-prime-time-ii': lexicon('prime-time', [PRIME_TIME_II], SUPER_PRIME_TIME, /(?<![\w-])model[\s-]?93(?![\w-])/i),
  'lexicon-super-prime-time': lexicon('prime-time', undefined, PRIME_TIME_II, /(?<![\w-])model[\s-]?93(?![\w-])/i),
  // The LXP line. The LXP-15 and the LXP-15 II share "LXP-15" and price apart ($149 vs $190): the II requires its mark.
  'lexicon-lxp-1': lexicon('lxp', undefined, LXP(5), LXP(15)),
  'lexicon-lxp-5': lexicon('lxp', undefined, LXP(1), LXP(15)),
  'lexicon-lxp-15': lexicon('lxp', undefined, LXP(1), LXP(5), LXP_15_II),
  'lexicon-lxp-15-ii': lexicon('lxp', [LXP_15_II], LXP(1), LXP(5)),
  // The MX line. The MX400 and the MX400XL (XLR I/O, 21 % over it — below the ~25 % a row of its own takes; manager,
  // 2026-10-21) are ONE row: its model name "MX400" reads a spaced "MX400 XL", its identifier the glued "MX400XL".
  'lexicon-mx200': lexicon('mx', undefined, MX(300), MX(400), MX_400XL),
  'lexicon-mx300': lexicon('mx', undefined, MX(200), MX(400), MX_400XL),
  'lexicon-mx400': lexicon('mx', undefined, MX(200), MX(300)),
  // ── PAN-290: the Korg SDD delay family ──
  'korg-sdd-1000': sdd('sdd', undefined, ...SDD_OTHERS(1000)),
  'korg-sdd-2000': sdd('sdd', undefined, ...SDD_OTHERS(2000)),
  // The 1982 rack takes a bare "SDD-3000"; the 2014 pedal requires its word or code ("SDD-3000-PDL" is also its
  // identifier, because the code form keeps "3000-pdl" whole) and refuses the rack's words and the 1980s.
  'korg-sdd-3000-rackmount': sdd('sdd', undefined, ...SDD_OTHERS(3000), ...SDD_PEDAL),
  'korg-sdd-3000-pedal': sdd('sdd', SDD_PEDAL, ...SDD_OTHERS(3000), ...cues('rack', 'rackmount', 'rack-mount', 'rack mount', 'rackeffekt', '1980s', '80s'), yearCue(1980, 1999)),
  // The DL8000R (1990s multi-tap rack delay): no Reverb page, created on its sold evidence; not an SDD.
  'korg-dl8000r': sdd('dl8000r', undefined),
  // ── PAN-291: Oto Machines ──
  'oto-machines-biscuit': oto('biscuit', 'biscuit'),
  'oto-machines-bim': oto('bim', 'bim'),
  'oto-machines-bam': oto('bam', 'bam'),
  'oto-machines-boum': oto('boum', 'boum'),
  'oto-machines-bebe-cherie': oto('bebe-cherie', 'b[eé]b[eé][-\\s]?ch[eé]rie'),
  // ── PAN-291: the Ensoniq samplers and outboard ──
  // The ASR line. The ASR-10 is one row for the keyboard and the rack ($1,100 / $1,300 on Reverb's sold population,
  // 2026-10-21: the closeness of the Memory Man faces); the ASR-X and the ASR-X Pro are two ($499 / $650).
  'ensoniq-asr-10': ensoniq('asr', 'asr[-\\s]?10(?:\\s?r)?', ASR_X, ASR_88),
  'ensoniq-asr-x': ensoniq('asr', 'asr[-\\s]?x', cue('pro'), cue('turbo'), ASR_10, ASR_88),
  'ensoniq-asr-x-pro': ensoniq('asr', 'asr[-\\s]?x[-\\s]?pro', ASR_10, ASR_88),
  // The EPS line: the classic EPS ($335) and the EPS-16 Plus keyboard ($595) and rack ($850) are three rows by price.
  'ensoniq-eps': ensoniq('eps', 'eps', EPS_16, EPS_M, ASR_10, ASR_X),
  'ensoniq-eps-16-plus': ensoniq('eps', EPS_16_PLUS, RACK, ASR_10, ASR_X),
  'ensoniq-eps-16-plus-rack': ensoniq('eps', EPS_16_PLUS_RACK, cue('keyboard'), ASR_10, ASR_X),
  // The Mirage: the DSK-8 and DSK-1 keyboards ($425 / $418) are the two rows production holds, the DSK-1 by its code; the
  // DMS-8 and DMS-1 racks ($600 / $525) are one row. A bare "Ensoniq Mirage" keyboard is the DSK-8 (manager, 2026-10-21:
  // the 1984 original, and the same price class as the DSK-1, which by price would merge into it once the owner moves its
  // three verdicts); the identity file's "Mirage" identifier reaches it, and the DSK-1, the racks and the rack word refuse.
  'ensoniq-mirage-dsk-8': ensoniq('mirage', '(?:mirage[-\\s]?)?dsk[-\\s]?8|mirage', DSK('1'), DMS, RACK),
  'ensoniq-mirage-dsk-1': ensoniq('mirage', 'dsk[-\\s]?1', DSK('8'), DMS, RACK),
  'ensoniq-mirage-dms-8': ensoniq('mirage', MIRAGE_RACK, DSK('[18]')),
  // The DP parallel effects processors: the DP/2 ($400), the DP/4 ($700) and the DP/4+ ($885); the DP/Pro sold once.
  'ensoniq-dp-2': ensoniq('dp', DP('2')),
  'ensoniq-dp-4': ensoniq('dp', DP('4'), DP_4_PLUS),
  'ensoniq-dp-4-plus': ensoniq('dp', `${DP('4')}\\s?(?:\\+|plus)`),
  // ── PAN-293: Eventide ──
  // The H9, two rows by price (Reverb's sold population, 2026-10-21): the Max, a bare "H9", the Gen 2 and the Dark
  // ($560 / $570) are one; the Core and the Standard ($320 / $355, sold with one and nine algorithms) the other. The
  // H90 ($725) is its own unit; an H90 title that names the H9 is the H90.
  'eventide-h9-max': eventide('h[\\s-]?9', [...EV_PEDALS.filter((k) => k !== 'h9'), 'h9core', 'h9standard']),
  'eventide-h9-core': eventide('h[\\s-]?9[\\s-]?(?:core|standard)', [...EV_PEDALS.filter((k) => k !== 'h9'), 'h9max']),
  'eventide-h90': eventide('h[\\s-]?90', [...EV_PEDALS.filter((k) => k !== 'h9' && k !== 'h90'), 'h9000']),
  // The Factor pedals and the Space: each refuses the H9s and the other pedals (a two-pedal title is a bundle); the Space
  // names its own algorithms ("Blackhole", "Shimmer"), so it does not refuse the Blackhole.
  'eventide-timefactor': evPedal('timefactor', 'time[\\s-]?factor'),
  'eventide-pitchfactor': evPedal('pitchfactor', 'pitch[\\s-]?factor'),
  'eventide-modfactor': evPedal('modfactor', 'mod[\\s-]?factor'),
  'eventide-space': evPedal('space', 'space', 'blackhole'),
  // The dot9 pedals, the Rose and the Knife Drop.
  'eventide-blackhole': evPedal('blackhole', 'black[\\s-]?hole'),
  'eventide-micropitch': evPedal('micropitch', 'micro[\\s-]?pitch'),
  'eventide-ultratap': evPedal('ultratap', 'ultra[\\s-]?tap'),
  'eventide-tricerachorus': evPedal('tricerachorus', 'tricera[\\s-]?chorus'),
  'eventide-riptide': evPedal('riptide', 'riptide'),
  'eventide-rose': evPedal('rose', 'rose'),
  'eventide-knife-drop': evPedal('knifedrop', 'knife[\\s-]?drop'),
  // The racks. The H3000 and H910 were supported before the ticket (PAN-230) and had no boundary.
  // The H3500 (1990s, $2,300 against the H3000's $2,000, +15 %) is the H3000's row, "H3500" its identifier.
  'eventide-h3000': evRack('h3000', 'h[\\s-]?3[05]00(?:se|sx|s|b|d)?', ['h3500']),
  'eventide-h910': evRack('h910', 'h[\\s-]?910'),
  'eventide-h949': evRack('h949', 'h[\\s-]?949', ['h910', 'h3000']),
  'eventide-dsp4000': evRack('dsp4000', 'dsp[\\s-]?4000(?:b\\+?)?', ['h3000']),
  'eventide-h8000': evRack('h8000', 'h[\\s-]?8000(?:fw|a|b)?'),
  'eventide-h7600': evRack('h7600', 'h[\\s-]?7600', ['h3000', 'h8000']),
  'eventide-eclipse': evRack('eclipse', 'eclipse'),
  'eventide-orville': evRack('orville', 'orville', ['dsp4000']),
  'eventide-h9000': evRack('h9000', 'h[\\s-]?9000r?'),
  'eventide-h969': evRack('h969', 'h[\\s-]?969', ['h949']),
  'eventide-sp2016': evRack('sp2016', 'sp[\\s-]?2016'),
  // The 1970s Omnipressor (the 2830, $2,550); the 2021 2830*Au 50th Anniversary reissue ($1,829, 12 sold) is no row.
  'eventide-omnipressor': evRack('omnipressor', 'omnipressor', [], /2830\s?\*?\s?au|50th|anniversary|reissue/i),
  // The PS-101 Instant Phaser (1971): no Reverb page, created on its sold evidence.
  'eventide-instant-phaser': evRack('instantphaser', 'instant[\\s-]?phaser|ps[\\s-]?101'),
  // ── PAN-293: FMR Audio ──
  'fmr-audio-rnc': fmr('rnc', 'rnc(?:[\\s-]?1773)?', /really\s+nice\s+comp/i),
  'fmr-audio-rnp': fmr('rnp', 'rnp(?:[\\s-]?8380)?', /really\s+nice\s+(?:mic\s+)?pre/i),
  'fmr-audio-rnla': fmr('rnla', 'rnla(?:[\\s-]?7239)?', /really\s+nice\s+level/i),
  // ── PAN-293: TC Electronic ──
  'tc-electronic-2290': tcRack('2290'),
  'tc-electronic-1210': tcRack('1210'),
  // ── PAN-293: Tube-Tech ── (the CL 1B and LCA 2B were supported before the ticket)
  'tube-tech-cl-1a': tubeTech('cl1a', 'cl1b'),
  'tube-tech-cl1b': tubeTech('cl1b'),
  // "CL 2A … Stereo CL 1B" and "CL2A Dual Channel version of CL1B" name the CL 1B as what the CL 2A doubles.
  'tube-tech-cl2a': tubeTech('cl2a', 'cl1b'),
  // A predecessor within 25 % on Reverb's sold population is its successor's row, the code an identifier: the LCA 2A
  // ($2,125 / $2,500), the PE 1B ($2,106 / $1,999) and the ME 1A ($1,900 / $2,000). The CL 1A sells apart in recent
  // years ($5,999 since 2022, 9 sold, against the CL 1B's $4,700) and keeps its own row.
  'tube-tech-lca-2b': tubeTech('lca2b', 'lca2a'),
  'tube-tech-pe-1c': tubeTech('pe1c', 'pe1b'),
  'tube-tech-me-1b': tubeTech('me1b', 'me1a'),
  'tube-tech-mp-1a': tubeTech('mp1a'),
  'tube-tech-mp-2a': tubeTech('mp2a'),
  'tube-tech-mec-1a': tubeTech('mec1a'),
  'tube-tech-smc-2b': tubeTech('smc2b'),
  'tube-tech-smc-2bm': tubeTech('smc2bm'),
  'tube-tech-hlt-2a': tubeTech('hlt2a'),
  'tube-tech-ssa-2a': tubeTech('ssa2a'),
  'tube-tech-eq-1a': tubeTech('eq1a'),
}

/**
 * Why `title` is not `slug` under its line boundary, or null when it may be.
 * Exported so the PAN-154 data script refuses exactly what the matcher refuses.
 */
/** Danish condition phrases ending in "stand" (PAN-261 review, 2026-10-14). */
const CONDITION_STAND = /\b(?:i|god|godt|fin|fint|pæn|pænt|flot|perfekt|nydelig|super|fejlfri|velholdt|top|ok|rigtig god|meget god)\s+stand\b/gi

/**
 * A row's boundary, read through `currentSlug`: the keys are the renamed slugs
 * (PAN-289), and production may still hold the old one until the rename SQL
 * runs — the nightly matcher reads the same rule for the row either way.
 */
function lineBoundaryOf(slug: string): LineBoundary | undefined {
  return LINE_BOUNDARIES[slug] ?? LINE_BOUNDARIES[currentSlug(slug)]
}

export function lineBoundaryRefusal(title: string, slug: string): string | null {
  const boundary = lineBoundaryOf(slug)
  if (!boundary) return null
  // What the title names comes first, so the reason says what the title IS
  // when it says anything; `no_member_cue` is left for titles that name nothing.
  for (const re of boundary.otherMembers) {
    const m = re.exec(title)
    if (m) return `other_member:${m[0].toLowerCase()}`
  }
  // A cue the row requires is its model's own word, never an inclusion marker (PAN-261): "Peavey 6505 plus Amp
  // Cover" and "6505+ 3-Button Footswitch" are a cover and a footswitch, not a head sold with one. The cue is
  // blanked (same length) before the marker search; "6505+ … W/ New Footswitch" keeps its real marker.
  const markerTitle = (boundary.requires ?? []).reduce(
    (t, re) => t.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), (m) => ' '.repeat(m.length)),
    title.toLowerCase(),
  )
  const markerAt = earliestInclusionMarker(markerTitle)
  const bundle = boundary.bundles?.some((re) => re.test(title)) ?? false
  // "i god stand" / "flot stand" is the condition, not a stand sold alone.
  const accessoryTitle = title.replace(CONDITION_STAND, (m) => ' '.repeat(m.length))
  for (const noun of bundle ? [] : boundary.accessories ?? []) {
    const m = (typeof noun === 'string' ? cue(noun) : noun).exec(accessoryTitle)
    if (m && !(markerAt !== -1 && markerAt < m.index)) return `accessory:${typeof noun === 'string' ? noun : m[0].toLowerCase()}`
  }
  if (boundary.requires && !boundary.requires.some((re) => re.test(title))) {
    return 'no_member_cue'
  }
  return null
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function resolveCanonical(canonical: string, products: Product[]): Product | undefined {
  const cSlug  = slugify(canonical)
  const cLower = canonical.toLowerCase()

  return (
    products.find(p => p.slug === cSlug) ??
    products.find(p => p.slug.startsWith(cSlug + '-')) ??
    products.find(p => p.slug.length >= 4 && cSlug.endsWith('-' + p.slug)) ??
    products.find(p => p.canonical_name.toLowerCase().startsWith(cLower))
  )
}

// ── Pagination helper (PostgREST caps at 1000 rows regardless of .limit()) ────

async function fetchAllRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: () => any,
  pageSize = 1000,
  label = 'table',
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (builder() as any).range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Fetch ${label} page ${offset}: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as T[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

// ── Pure decision core ────────────────────────────────────────────────────────

export interface MatchIndex {
  products:           Product[]
  idents:             Identifier[]
  synonyms:           Synonym[]
  canonicalToProduct: Map<string, Product>
  productById:        Map<string, Product>
  /** Distinct lowercased `kg_brand.name` values present in the catalogue. */
  catalogueBrands:    Set<string>
  /**
   * Normalised identifier term -> every product that term can plausibly
   * represent. Only terms with more than one such product are present.
   * See `buildSharedIdentifierIndex`.
   */
  sharedIdentifiers:  Map<string, Set<string>>
}

/**
 * Which identifier terms are NOT exclusive proof of one product.
 *
 * THE DEFECT THIS CLOSES: `kg_identifier` has no unique constraint on `value`
 * (verified against pg_constraint / pg_indexes — only a PK on id, an FK on
 * product_id, a CHECK on type and a NON-unique index on lower(value)), so the
 * same term may legitimately map to many products. In practice the table is
 * populated asymmetrically:
 *
 *   'Les Paul' -> Epiphone only     (Gibson instead owns the SKU 'PAUL')
 *   'ES-335'   -> Epiphone only     (Gibson instead owns the SKU '335')
 *   'SG', 'J-45' -> Gibson AND Epiphone
 *   'RE-201', 'SPS-1', 'Reference Cardioid/Gold', 'RB-338' -> collide with a
 *   duplicate row of the SAME product
 *
 * A score-95 identifier hit therefore conferred an unjustified brand
 * preference: a brandless "Les Paul Standard 2012" would resolve to *Epiphone*
 * purely because that is the row someone happened to attach the SKU to.
 *
 * THE RULE IS STRUCTURAL, NOT A STRING LIST. A term is shared when some OTHER
 * active product could answer to it — either because that product owns an
 * identifier with the same normalised value, or because the term matches that
 * product's `model_name` under EXACTLY the same `containsToken` semantics the
 * matcher uses on listing titles. Using the matcher's own predicate is what
 * makes the audit and the runtime agree: 'paul' is shared because it matches
 * Epiphone's model_name "Les Paul", while '335' is NOT shared because the
 * word-boundary rule refuses to fire inside "ES-335".
 *
 * Cost is one pass of (identifier terms x products) with pre-compiled
 * regexes — ~78 x 3,862 on the live catalogue.
 */
export function buildSharedIdentifierIndex(
  products: Product[],
  idents: Identifier[],
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>()
  for (const ident of idents) {
    const term = ident.value.trim().toLowerCase()
    if (!term) continue
    let set = owners.get(term)
    if (!set) { set = new Set<string>(); owners.set(term, set) }
    set.add(ident.product_id)
  }

  for (const [term, set] of Array.from(owners.entries())) {
    if (term.length < 3) continue // below the matcher's own token floor
    const re = tokenRegex(term)
    for (const product of products) {
      if (!product.model_name) continue
      if (set.has(product.id)) continue
      const model = product.model_name.trim().toLowerCase()
      if (re.test(model) || re.test(model.replace(/-/g, ' '))) set.add(product.id)
    }
  }

  const shared = new Map<string, Set<string>>()
  for (const [term, set] of Array.from(owners.entries())) {
    if (set.size > 1) shared.set(term, set)
  }
  return shared
}

/**
 * ACTIVE-ONLY ELIGIBILITY — the single enforcement point.
 *
 * THE DEFECT THIS CLOSES: `PRODUCT_SELECT` did not load `status` and no caller
 * filtered it, so the production index held 3,862 products including 293
 * `inactive` ones. Migration 053 retires duplicate losers by flipping `status`
 * only — it never touches `model_name` — so a retired duplicate stayed in
 * candidate generation with an identical `(brand, model_name)` and kept
 * producing `product_data_conflict`. 053 could not deliver its benefit.
 *
 * Filtering here rather than only in each caller's query is deliberate: the
 * index is the one thing every automatic caller must build, so a future caller
 * that forgets `.eq('status','active')` still cannot introduce an inactive
 * candidate. The database filter in `matchListings` is defence in depth.
 *
 * WHAT THIS DOES NOT DO: it never mutates or deletes an inactive product, its
 * identifiers, its synonyms or its historical `listing_product_match` rows.
 * 9 inactive products currently hold 237 historical matches; those remain
 * readable by product pages, `/intel` and the admin surfaces. An inactive
 * product simply cannot receive a NEW automatic match or create a candidate
 * conflict.
 */
export function buildMatchIndex(
  products: Product[],
  idents: Identifier[],
  synonyms: Synonym[],
  verifiedMusicBrands?: Iterable<string>,
): MatchIndex {
  /**
   * BRAND PROTECTION IS BROADER THAN CANDIDATE GENERATION.
   *
   * `catalogueBrands` drives collision detection and offered-brand elimination
   * — "this title says Tokai, so it is not a Gibson". That protection must
   * cover every verified music brand, INCLUDING brands with no supported
   * product, or narrowing the candidate set to the launch cohort would quietly
   * disable the guard for everything outside it.
   *
   * It is derived from IDENTITY (`status='active'`), never from SUPPORT, and
   * never from the raw input, so deprecated non-music brands — Apple, Samsung,
   * the furniture and cycling brands — cannot become brand evidence. Callers
   * that know the full verified brand list (`matchListings` does) pass it
   * explicitly; everyone else gets the identity-derived set.
   */
  const brandSource = products.filter((p) => p.status === MATCHABLE_STATUS)

  // Applied AFTER the brand source is captured, so that the shared-identifier
  // index and every downstream map derive only from eligible CANDIDATES.
  products = products.filter(isMatchableProduct)

  // Identifiers must be filtered too, not just products. The identifier tier
  // offers a candidate keyed on `ident.product_id` without consulting the
  // product map, so an identifier left pointing at an excluded product would
  // still produce a score-95 candidate — and every later guard treats an
  // unknown product as "no brand", i.e. permissively. Caught by the
  // "inactive product excluded even with a score-95 identifier" test.
  const eligibleIds = new Set(products.map((p) => p.id))
  idents = idents.filter((i) => eligibleIds.has(i.product_id))
  const canonicalToProduct = new Map<string, Product>()
  for (const syn of synonyms) {
    if (!syn.canonical_query) continue
    if (canonicalToProduct.has(syn.canonical_query)) continue
    const product = resolveCanonical(syn.canonical_query, products)
    if (product) canonicalToProduct.set(syn.canonical_query, product)
  }
  const productById = new Map<string, Product>()
  for (const p of products) productById.set(p.id, p)

  const catalogueBrands = new Set<string>()
  if (verifiedMusicBrands) {
    for (const b of Array.from(verifiedMusicBrands)) {
      const n = b?.trim().toLowerCase()
      if (n) catalogueBrands.add(n)
    }
  } else {
    for (const p of brandSource) if (p.brand_name) catalogueBrands.add(p.brand_name)
  }
  return {
    products, idents, synonyms, canonicalToProduct, productById, catalogueBrands,
    sharedIdentifiers: buildSharedIdentifierIndex(products, idents),
  }
}

/**
 * Evaluate one listing title. Pure — no I/O, no writes — so both the live
 * matcher and the read-only backlog report can share exactly one definition of
 * what a match is.
 *
 * The brand-compatibility guard is applied HERE, before a candidate can be
 * returned as `matched`, so no code path can produce a trusted collision.
 */
/** Highest score wins; ties broken by product_id so output never depends on input order. */
function strongest(candidates: MatchCandidate[]): MatchCandidate {
  return candidates.reduce((a, b) => {
    if (b.score !== a.score) return b.score > a.score ? b : a
    return b.product_id < a.product_id ? b : a
  })
}

/**
 * Evaluate one listing title. Pure — no I/O, no writes — so every caller
 * (scripts/match-listings.ts, app/api/cron/scrape/route.ts and the read-only
 * backlog report) shares exactly one definition of what a safe match is.
 *
 * DECISION PRECEDENCE (mutually exclusive, evaluated in this order):
 *   1. none                  — no candidate at all
 *   2. rejected              — hard licensed-subsidiary collision left nothing
 *   3. non_product_intent    — title offers a part/accessory, or is a wanted ad
 *                              (and, once the winner is known, "for <its model>" or its
 *                              model inside a list of models: step 5c)
 *   4. brand_mismatch        — catalogue-brand evidence eliminated everything
 *   5. product_data_conflict — tied candidates are duplicate KG rows
 *   6. shared_identifier_conflict — tie caused by a non-exclusive identifier
 *   7. ambiguous_tie         — top score shared, no evidence to separate
 *   8. low_confidence        — best below AUTO_CONFIDENCE_MIN without brand proof
 *   9. copy_or_reference    — another maker's product that merely references this one
 *  10. matched
 *
 * TIER PRECEDENCE IS BY SCORE, NOT BY SUPPRESSION. All three candidate tiers
 * contribute; a compatible higher-tier candidate still wins because 95 > 80 >
 * 70. A lower-tier candidate can only win when every higher-tier candidate was
 * eliminated as brand-incompatible — which is exactly the Gibson ES-335 case.
 *
 * ORDER INDEPENDENCE is a hard requirement: the input `products` array must
 * never be able to change the outcome. Candidates are deduplicated per
 * product, all tiers are collected (no early `break`), and every tie is either
 * broken by explicit evidence or fails closed.
 */
export function decideMatch(title: string, index: MatchIndex): MatchDecision {
  const norm = hyphenateMartinCodes(foldHyphens(title.toLowerCase().trim()))

  // Best candidate per product, so one product cannot appear twice and inflate
  // or mask a tie.
  const byProduct = new Map<string, MatchCandidate>()
  const offer = (c: MatchCandidate) => {
    const prev = byProduct.get(c.product_id)
    if (!prev) { byProduct.set(c.product_id, c); return }
    const [kept, dropped] = c.score > prev.score ? [c, prev] : [prev, c]
    // PAN-221: a curated alias on the same product must survive a higher-scoring
    // identifier, or the catalogue-brand elimination below cannot read it.
    const alias = dropped.explain.matched_alias
    byProduct.set(c.product_id, typeof alias === 'string' && kept.explain.matched_alias === undefined
      ? { ...kept, explain: { ...kept.explain, offered_alias: alias } }
      : kept)
  }

  // Products this title independently supports via their OWN model_name.
  // Computed first because the shared-identifier rule below needs it: a
  // sibling may only compete for a shared term if the title actually supports
  // that sibling on its own evidence.
  const modelSupported = new Set<string>()
  /** Products the title supports only in the code form (PAN-266), for the audit payload. */
  const codeFormOnly = new Set<string>()
  const normJunior = expandJunior(norm)
  const codeNorm = modelCodeForm(normJunior)
  for (const product of index.products) {
    if (!product.model_name) continue
    const mOrig = product.model_name.toLowerCase().trim()
    const mSpace = mOrig.replace(/-/g, ' ')
    if (
      (mOrig.length >= 3 && containsToken(norm, mOrig)) ||
      (mSpace !== mOrig && mSpace.length >= 3 && containsToken(norm, mSpace))
    ) { modelSupported.add(product.id); continue }
    // PAN-266: the title's "Jr." read as "Junior", the KG's own spelling kept.
    if (normJunior !== norm && mOrig.length >= 3 && (
      containsToken(normJunior, mOrig) || (mSpace !== mOrig && containsToken(normJunior, mSpace))
    )) { modelSupported.add(product.id); codeFormOnly.add(product.id); continue }
    // PAN-266: the same comparison with both spellings reduced to one code form, so a glued
    // "TR808", "Juno106" or "SP404 MKII" names its row as the KG's "TR-808", "Juno-106" and
    // "SP-404MKII" do. Only a model with a digit has a code form to compare: measured on the
    // 19,139 trusted production matches, reading word-only models in it changed 109 decisions.
    if (!/\d/.test(mOrig)) continue
    const mCode = modelCodeForm(mOrig)
    if (mCode.length >= 3 && containsToken(codeNorm, mCode)) {
      modelSupported.add(product.id)
      codeFormOnly.add(product.id)
    }
  }

  // Identifier match (SKU / MODEL) — score 95
  //
  // A SHARED term does not confer exclusivity. It emits a candidate for every
  // sibling the TITLE ITSELF also supports, all at the same score — scores are
  // never lowered and no product is ever chosen arbitrarily. The siblings tie,
  // and the existing machinery resolves the tie with explicit brand evidence
  // or fails closed.
  //
  // Siblings are intersected with `modelSupported` deliberately. The live KG
  // contains the SKU 'PAUL' on Gibson Les Paul; unfiltered, that one weak term
  // is shared with 17 products (Gibson Les Paul Custom, Gibson The Paul,
  // Gibson ES-346 Paul Jackson Jr., every Epiphone Les Paul variant...) and
  // would flood the top tier, deferring every genuine Les Paul listing. The
  // intersection keeps exactly the products the title genuinely names.
  const sharedTermsHit = new Set<string>()
  for (const ident of index.idents) {
    if (!containsToken(norm, ident.value)) continue
    const term = ident.value.trim().toLowerCase()
    const siblings = index.sharedIdentifiers.get(term)
    const explainBase = { matched_identifier: ident.value, type: ident.type }

    if (!siblings) {
      offer({ product_id: ident.product_id, method: ident.type as 'SKU' | 'MODEL', score: 95, explain: explainBase })
      continue
    }

    // Owner always competes; siblings only on their own title evidence.
    const eligible = Array.from(siblings).filter(
      (id) => id === ident.product_id || modelSupported.has(id),
    )
    if (eligible.length > 1) sharedTermsHit.add(term)

    for (const productId of eligible) {
      offer({
        product_id: productId,
        method:     ident.type as 'SKU' | 'MODEL',
        score:      95,
        explain: eligible.length > 1
          ? { ...explainBase, shared_identifier: true, shared_with: eligible.slice().sort() }
          : explainBase,
      })
    }
  }

  // Synonym match — score 80.
  //
  // NO TIER GATE. This used to run only when the identifier tier produced
  // nothing, which meant a higher-scoring but BRAND-INCOMPATIBLE candidate
  // could shadow the lower tiers entirely. Observed in production: the
  // `ES-335` identifier belongs only to *Epiphone* ES-335 (Gibson's is `335`),
  // so "Gibson ES-335 Dot Ebony" produced a single Epiphone candidate at 95,
  // which brand evidence then eliminated — and the compatible Gibson product,
  // reachable at the model tier, was never even considered. Eight legitimate
  // Gibson DBA listings were deferred that way.
  //
  // All tiers now contribute candidates; compatibility, tie resolution and the
  // confidence floor pick the winner afterwards. Tier precedence is preserved
  // by SCORE, not by suppression — see the ordering note below.
  for (const syn of index.synonyms) {
    if (!syn.canonical_query) continue
    if (!containsToken(norm, syn.alias)) continue
    const product = index.canonicalToProduct.get(syn.canonical_query)
    if (!product) continue
    offer({
      product_id: product.id,
      method:     'SYNONYM',
      score:      80,
      explain:    { matched_alias: syn.alias, canonical_query: syn.canonical_query },
    })
  }

  // Model name match — score 70, from the set computed above.
  // No early `break` and no tier gate — see the note above.
  for (const productId of Array.from(modelSupported)) {
    offer({
      product_id: productId,
      method:     'MODEL',
      score:      70,
      explain:    {
        matched_model_name: index.productById.get(productId)?.model_name ?? null,
        ...(codeFormOnly.has(productId) ? { code_form: true } : {}),
      },
    })
  }

  // Deterministic ordering (score desc, then product_id) so that not only the
  // verdict but every emitted candidate list is independent of input order.
  // Without this the audit payload still varied with product array order.
  const candidates = Array.from(byProduct.values()).sort((a, b) =>
    b.score !== a.score ? b.score - a.score : (a.product_id < b.product_id ? -1 : 1),
  )
  if (candidates.length === 0) return { kind: 'none' }

  // ── 2. Hard licensed-subsidiary collision ───────────────────────────────
  // Epiphone must never become Gibson; Squier must never become Fender. These
  // brands are matched as literal tokens, NOT via the catalogue: 'squier' is
  // not a kg_brand at all, so the catalogue-brand layer below cannot see it.
  const surviving: MatchCandidate[] = []
  /** Candidates a line boundary refused (PAN-154). Never a winner; see step 5b. */
  const lineRefused: MatchCandidate[] = []
  let hardCollision: { candidate: MatchCandidate; collision: BrandCollision } | null = null

  for (const candidate of candidates) {
    const product = index.productById.get(candidate.product_id)
    const collision = detectBrandCollision(norm, product?.brand_name ?? null)
    if (collision) {
      if (!hardCollision || candidate.score > hardCollision.candidate.score) {
        hardCollision = { candidate, collision }
      }
      continue
    }
    // A title that names another member of a line is not that line's product
    // at any tier (PAN-154). It stops being a candidate rather than being
    // deferred: "Minimoog Voyager XL" is not an undecided Minimoog. Checked
    // after the collision, so a licensed-subsidiary title keeps its auditable
    // rejection instead of vanishing.
    if (lineBoundaryRefusal(norm, product?.slug ?? '') !== null) {
      lineRefused.push(candidate)
      continue
    }
    surviving.push(candidate)
  }

  if (surviving.length === 0) {
    if (!hardCollision) return { kind: 'none' }
    return { kind: 'rejected', best: hardCollision.candidate, collision: hardCollision.collision }
  }

  // ── 3. Non-product intent ───────────────────────────────────────────────
  // A property of the LISTING, not of any candidate: the title offers a part
  // or accessory, or is a wanted ad. Checked after the hard-collision branch
  // so a licensed-subsidiary collision keeps its auditable is_valid=false row,
  // but before every candidate-selection rule — no amount of brand proof or
  // score should let a pickup set become the instrument.
  const intent = detectNonProductIntent(norm)
  if (intent) {
    return {
      kind: 'deferred',
      reason: 'non_product_intent',
      intent: intent.intent,
      candidates: surviving,
      detail: `${intent.intent} (token '${intent.token}')`,
    }
  }

  // ── 4. Symmetric catalogue-brand elimination ────────────────────────────
  // If the title names exactly ONE catalogue brand (after child-brand
  // precedence), any candidate belonging to a DIFFERENT explicit brand is
  // wrong regardless of score. This is what makes Gibson->Gibson and
  // Epiphone->Epiphone deterministic instead of order-dependent.
  //
  // A set of size != 1 is unusable evidence: zero means no brand was named,
  // more than one means the title names several unrelated brands ("Squier
  // Jazz Bass + Harley Benton amp"). Neither may be used to pick a winner.
  //
  // Several names of ONE maker ("Sequential Circuits", "Sequential") are one brand's worth
  // of evidence (PAN-221, SAME_MAKER): the first named stands for the maker.
  const detected = detectCatalogueBrands(norm, index.catalogueBrands)
  const makers = new Set(Array.from(detected).map(makerOf))
  const brandEvidence = makers.size === 1 ? Array.from(detected)[0] : null

  let admissible = surviving
  if (brandEvidence) {
    // Products with no brand recorded are not "a different explicit brand" and
    // are therefore not eliminated. Neither is a product offered by a curated
    // alias that itself names the title's brand: "Oberheim OB-6" is the
    // Sequential OB-6, a reissue, not an Oberheim (PAN-221, owner 2026-10-07).
    // The admission is audited as `alias_carries_brand`; the maker group is
    // untouched, so "Oberheim OB-X8" is still Oberheim's.
    admissible = surviving.flatMap((c) => {
      const b = index.productById.get(c.product_id)?.brand_name
      if (!b || sameMaker(b, brandEvidence)) return [c]
      const alias = c.explain.matched_alias ?? c.explain.offered_alias
      return typeof alias === 'string' && containsBrandToken(alias, brandEvidence)
        ? [{ ...c, explain: { ...c.explain, alias_carries_brand: brandEvidence } }]
        : []
    })
    if (admissible.length === 0) {
      return {
        kind: 'deferred',
        reason: 'brand_mismatch',
        candidates: surviving,
        detail: `title names catalogue brand '${brandEvidence}'; no candidate belongs to it`,
      }
    }
  }

  // ── 5. Ambiguity ────────────────────────────────────────────────────────
  const topScore = admissible.reduce((m, c) => (c.score > m ? c.score : m), -Infinity)
  const topTier  = admissible.filter((c) => c.score === topScore)

  if (topTier.length > 1) {
    // Duplicate KG rows: the tied products are the SAME (brand, model_name),
    // so no title could ever separate them. Reported distinctly from a genuine
    // ambiguity because the fix is a data repair, not better matching.
    //
    // A brand is REQUIRED to make this claim. Two brandless products sharing a
    // model name are merely indistinguishable, not provably duplicates, and
    // are reported as an ordinary ambiguous tie.
    const tiedProducts = topTier.map((c) => index.productById.get(c.product_id))
    const identities = new Set(tiedProducts.map((p) =>
      `${p?.brand_name ?? ''}|${(p?.model_name ?? '').trim().toLowerCase()}`,
    ))
    const allBranded = tiedProducts.every((p) => !!p?.brand_name)
    if (allBranded && identities.size === 1) {
      return {
        kind: 'deferred',
        reason: 'product_data_conflict',
        candidates: topTier,
        detail: `${topTier.length} duplicate kg_product rows share identity '${Array.from(identities)[0]}'`,
      }
    }

    // A tie produced by a shared identifier term is reported distinctly: the
    // cause is a KG identifier that several products can legitimately claim,
    // not an inherently ambiguous title. Its remedy is identifier curation.
    if (topTier.some((c) => (c.explain as { shared_identifier?: boolean }).shared_identifier)) {
      return {
        kind: 'deferred',
        reason: 'shared_identifier_conflict',
        candidates: topTier,
        detail: `${topTier.length} products claim shared identifier term(s) ` +
                `${Array.from(sharedTermsHit).sort().map(t => `'${t}'`).join(', ')} ` +
                `and no brand evidence separates them`,
      }
    }

    // Brand evidence is the only tie-break permitted. It has already been
    // applied above; if a tie survives it, there is genuinely nothing to
    // choose between the products and we must not guess.
    return {
      kind: 'deferred',
      reason: 'ambiguous_tie',
      candidates: topTier,
      detail: `${topTier.length} products tied at score ${topScore} with no brand evidence to separate them`,
    }
  }

  const best = strongest(topTier)

  // ── 5b. A refused member of a DIFFERENT line still names a product ───────
  // Refusal removes a candidate; it does not make a two-product title a
  // one-product title. "Sequential Circuits – Prophet 5, Prophet 10 – Fuse
  // Holder" names the vintage Prophet-10 (refused on the 2020 page) and the
  // Prophet-5; the tie that deferred it must stand. Within ONE line the
  // refusal is exactly the evidence that separates the members: "Minimoog
  // Model D Reissue" is the reissue because it is not the original.
  const lineOf = (id: string) => {
    const slug = index.productById.get(id)?.slug ?? id
    return lineBoundaryOf(slug)?.line ?? slug
  }
  const rival = lineRefused.find((c) => {
    if (c.score < best.score || lineOf(c.product_id) === lineOf(best.product_id)) return false
    const b = index.productById.get(c.product_id)?.brand_name
    if (brandEvidence && b && !sameMaker(b, brandEvidence)) return false
    // A refused member that is only REFERENCED is not a second product (PAN-266): "Warm Audio
    // WA73-EQ … Neve 1073-Style" names the 1073 as what the WA73 copies, and the Neve row's own
    // boundary refused it for that reason. Step 7a's reading, applied to the rival.
    const token = String(
      (c.explain as { matched_identifier?: string; matched_model_name?: string }).matched_identifier ??
      (c.explain as { matched_model_name?: string }).matched_model_name ?? '',
    ).toLowerCase()
    return !token || !(tokenFollowedByReference(norm, token) || tokenFollowedByReference(codeNorm, modelCodeForm(token)))
  })
  if (rival) {
    return {
      kind: 'deferred',
      reason: 'ambiguous_tie',
      candidates: [best, rival],
      detail: `the title also names ${index.productById.get(rival.product_id)?.slug ?? rival.product_id}, ` +
              `refused by its line boundary; a two-product title is not ${index.productById.get(best.product_id)?.slug ?? best.product_id}`,
    }
  }

  const evidenceToken = String(
    (best.explain as { matched_identifier?: string; matched_model_name?: string }).matched_identifier ??
    (best.explain as { matched_model_name?: string }).matched_model_name ?? '',
  )

  // ── 5c. The title offers something FOR the winner (PAN-193) ─────────────
  // "ORIGINAL Roland Key Spring (070-052) for Jupiter-4, System-100/700…"
  // names the Jupiter-4 only as what the spring fits. This is step 3's
  // non-product intent, but it depends on which model follows "for", so it can
  // only be read once the winner is known.
  const bestBrandName = index.productById.get(best.product_id)?.brand_name ?? null
  // PAN-266: a winner the code form found is read by the three guards below in the code form
  // too, or a glued "for Juno106" would pass what "for Juno-106" stops.
  const viaCode = best.explain.code_form === true
  const codeTok = modelCodeForm(evidenceToken)
  if (evidenceToken && (
    tokenIsObjectOfFor(norm, evidenceToken.toLowerCase(), bestBrandName) ||
    (viaCode && tokenIsObjectOfFor(codeNorm, codeTok, bestBrandName))
  )) {
    return {
      kind: 'deferred',
      reason: 'non_product_intent',
      intent: 'part_or_accessory',
      candidates: [best],
      detail: `part_or_accessory ('for ${evidenceToken}')`,
    }
  }
  // The same reading without the "for": "Prophet 5/10/T8 - panel switch",
  // "Juno-6/60/106 … Toggle Switch", "DS-1 RC-1 RC-3 TU-2" (PAN-196).
  if (evidenceToken && (tokenInModelList(norm, evidenceToken) || (viaCode && tokenInModelList(codeNorm, codeTok)))) {
    return {
      kind: 'deferred',
      reason: 'non_product_intent',
      intent: 'part_or_accessory',
      candidates: [best],
      detail: `part_or_accessory ('${evidenceToken}' in a list of models)`,
    }
  }

  // ── 6. Automatic-confidence floor ───────────────────────────────────────
  // Below the floor, the only evidence strong enough to make a candidate
  // uniquely safe is the product's OWN brand appearing verbatim in the title.
  if (best.score < AUTO_CONFIDENCE_MIN) {
    const ownBrand = index.productById.get(best.product_id)?.brand_name ?? null
    const brandProven = !!ownBrand && makerNamed(norm, ownBrand)
    if (!brandProven) {
      return {
        kind: 'deferred',
        reason: 'low_confidence',
        candidates: [best],
        detail: `score ${best.score} < ${AUTO_CONFIDENCE_MIN} and product brand ` +
                `${ownBrand ? `'${ownBrand}'` : '(none recorded)'} is not present in the title`,
      }
    }
  }

  // ── 7. Copy / reference guard ───────────────────────────────────────────
  // Measured on 19,902 live safe proposals across DBA, Kleinanzeigen and
  // Reverb: these two narrow rules remove ~110 (0.55%), essentially all of
  // them another maker's product that merely mentions this one. Broader
  // variants were rejected — "any reference word anywhere" destroyed 254
  // legitimate rows (Gibson Les Paul '52 Tribute, Epiphone SG Tribute,
  // Epiphone Inspired by Gibson J-45) and "two catalogue brands" destroyed 443
  // (Sequential Oberheim OB-X8, Warm Audio … Neve 1073-Style).

  // 7a. "<model> type/style/clone/kopi/Nachbau" — adjacency only.
  if (evidenceToken && (
    tokenFollowedByReference(norm, evidenceToken.toLowerCase()) ||
    (viaCode && tokenFollowedByReference(codeNorm, codeTok))
  )) {
    return {
      kind: 'deferred',
      reason: 'copy_or_reference',
      candidates: [best],
      detail: `'${evidenceToken}' is immediately qualified as a copy/reference`,
    }
  }

  // 7b. A different maker leads the title and this product's own brand only
  // appears deep inside it.
  const bestBrand = index.productById.get(best.product_id)?.brand_name ?? null
  if (bestBrand) {
    const offered = detectOfferedBrand(norm, index.catalogueBrands)
    // A product admitted by a brand-carrying alias (step 4) IS the offer: "Oberheim
    // OB-6" leads the title and names the Sequential row, it does not reference it.
    if (offered && !sameMaker(offered, bestBrand) && best.explain.alias_carries_brand !== offered) {
      const at = wordIndexOf(norm, bestBrand)
      if (at === null || at > OFFERED_BRAND_LEAD_WORDS) {
        return {
          kind: 'deferred',
          reason: 'copy_or_reference',
          candidates: [best],
          detail: `title is led by '${offered}'; '${bestBrand}' appears only at word ` +
                  `${at === null ? 'never' : at} — reads as a reference, not the offer`,
        }
      }
    }
  }

  return { kind: 'matched', best, admissible, brandEvidence }
}

/**
 * The ONLY `kg_product.status` value eligible for automatic matching.
 *
 * Exact-match, fail-closed: `null`, `''`, `'Active'`, `'archived'` or any
 * future value is INELIGIBLE until someone deliberately adds it here.
 * Production currently holds exactly two values — `active` (3,569) and
 * `inactive` (293), with no NULLs.
 */
export const MATCHABLE_STATUS = 'active'

/**
 * The ONLY `kg_product.support_state` value eligible for automatic matching.
 *
 * WHY THIS EXISTS SEPARATELY FROM `status`: the KG is the identity universe and
 * is expected to grow well beyond the launch catalogue. `status='active'` means
 * "verified music product"; it must NOT also mean "may receive automatic
 * matches", or every KG import would silently widen the matcher's target set.
 * Support is the product owner's frozen decision and is set explicitly.
 *
 * Fail-closed and exact-match, exactly like MATCHABLE_STATUS: `null`,
 * `'known'`, `'reserve'` and any future value are INELIGIBLE.
 */
export const MATCHABLE_SUPPORT_STATE = 'supported'

/**
 * A product may generate match candidates only when it is BOTH a verified,
 * non-deprecated identity AND in the supported launch cohort.
 *
 * Visibility (`browse_visibility`) and marketplace monitoring (`tier`) are
 * deliberately absent: a supported product can be matched while still private,
 * and matching never implies that any marketplace is being queried for it.
 *
 * A NAVIGATION FAMILY IS NEVER A MATCH TARGET (PAN-84). This is the half of the
 * guard that grows in silence: blocking only the product page still lets every
 * subsequent matcher run pile family-level listings onto the label, building a
 * price basis that spans a whole model range. `gibson-les-paul` had already
 * accumulated 673 verified matches at a 5.28x spread that way.
 *
 * `slug` is optional so existing callers that pass only the two axes still
 * type-check; the matcher itself passes a full `Product`, which always has one.
 */
export function isMatchableProduct(
  p: Pick<Product, 'status' | 'support_state'> & { slug?: string | null },
): boolean {
  if (isFamilyLabelSlug(p.slug)) return false
  return p.status === MATCHABLE_STATUS && p.support_state === MATCHABLE_SUPPORT_STATE
}

/**
 * Product select used by both the matcher and the read-only backlog report.
 * `status` is included so eligibility can be enforced in memory even when a
 * caller forgets the database-side filter.
 */
export const PRODUCT_SELECT =
  'id, slug, canonical_name, model_name, status, support_state, kg_brand(name)'

/**
 * Brands whose products are verified music identities. Used ONLY for offered-
 * brand collision protection, never for candidate generation, so it is loaded
 * independently of the supported cohort. `status='active'` is the identity
 * filter that keeps deprecated non-music brands out.
 */
export const BRAND_PROTECTION_SELECT = 'status, kg_brand(name)'

type RawProduct = Omit<Product, 'brand_name'> & {
  kg_brand: { name: string | null } | { name: string | null }[] | null
}

/** PostgREST returns an embedded to-one relation as an object or a 1-element array. */
export function normalizeProductRow(row: RawProduct): Product {
  const brand = Array.isArray(row.kg_brand) ? row.kg_brand[0] : row.kg_brand
  return {
    id:             row.id,
    slug:           row.slug,
    canonical_name: row.canonical_name,
    model_name:     row.model_name,
    brand_name:     brand?.name ? brand.name.trim().toLowerCase() : null,
    // Deliberately NOT defaulted. A row that arrives without `status` is
    // ineligible, which is the fail-closed direction.
    status:         (row as { status?: string | null }).status ?? null,
    // Same rule for support: a row loaded without `support_state` — an old
    // caller, or a query written before migration 056 — is NOT a match target.
    support_state:  (row as { support_state?: string | null }).support_state ?? null,
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * The index `matchListings` decides with, loaded read-only. Exported so a
 * dry run (scripts/pan193-jupiter-rematch.ts) counts exactly what the writer
 * would write.
 */
export async function loadMatchIndex(supabase: SupabaseClient): Promise<MatchIndex> {
  const [rawProducts, brandRows, idents, synonyms] = await Promise.all([
    // Database-side eligibility filter. Defence in depth only — buildMatchIndex
    // enforces the same rules in memory, so correctness does not depend on
    // these lines being present.
    fetchAllRows<RawProduct>(
      () => supabase.from('kg_product').select(PRODUCT_SELECT)
              .eq('status', MATCHABLE_STATUS).eq('support_state', MATCHABLE_SUPPORT_STATE),
      1000, 'kg_product',
    ),
    // Brand protection, loaded SEPARATELY and deliberately WITHOUT the support
    // filter: a Tokai listing must be recognised as a Tokai even though no
    // Tokai product is supported. `status='active'` keeps Apple and the other
    // deprecated non-music brands out.
    fetchAllRows<RawProduct>(
      () => supabase.from('kg_product').select(BRAND_PROTECTION_SELECT).eq('status', MATCHABLE_STATUS),
      1000, 'kg_product_brands',
    ),
    fetchAllRows<Identifier>(
      () => supabase.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']),
      1000, 'kg_identifier',
    ),
    fetchAllRows<Synonym>(
      () => supabase.from('synonym').select('alias, canonical_query').eq('match_type', 'alias'),
      1000, 'synonym',
    ),
  ])

  const products = rawProducts.map(normalizeProductRow)
  const verifiedMusicBrands = new Set<string>()
  for (const row of brandRows) {
    const b = normalizeProductRow(row).brand_name
    if (b) verifiedMusicBrands.add(b)
  }
  return buildMatchIndex(products, idents, synonyms, verifiedMusicBrands)
}

export async function matchListings(
  supabase: SupabaseClient,
  listingIds: string[],
): Promise<{ matched: number; rejected: number; deferred: number; total: number }> {
  if (listingIds.length === 0) return { matched: 0, rejected: 0, deferred: 0, total: 0 }

  const [index, listingsResult] = await Promise.all([
    loadMatchIndex(supabase),
    supabase.from('listings').select('id, title').in('id', listingIds).not('title', 'is', null),
  ])

  const { data: listingsData, error: lErr } = listingsResult
  if (lErr) throw new Error(`Fetch listings: ${lErr.message}`)

  // Callers are responsible for passing only unmatched IDs
  const listings = ((listingsData as Listing[]) ?? [])

  if (listings.length === 0) return { matched: 0, rejected: 0, deferred: 0, total: 0 }

  const matchRows: Array<{
    listing_id:      string
    product_id:      string
    method:          string
    score:           number
    explain:         Record<string, unknown>
    is_valid?:       boolean
    rejected_reason?: string
  }> = []

  let matchedCount  = 0
  let rejectedCount = 0
  let deferredCount = 0

  for (const listing of listings) {
    const decision = decideMatch(listing.title, index)
    if (decision.kind === 'none') continue

    // Deferred: NOT safe to automate. Deliberately writes NO ROW.
    //
    // A row with is_valid=NULL is SHOWN by /api/product/[slug] and /intel from
    // the moment it is written — it cannot reach a median since PAN-93, but it
    // is still an undecidable listing presented under a product, which is the
    // failure this gate exists to prevent. And
    // is_valid=false would permanently bury a listing that is merely
    // undecidable rather than wrong. Writing nothing leaves the listing in the
    // unmatched backlog, where a later run with a cleaner KG — or a human in
    // /admin/product/[slug] — can still resolve it.
    if (decision.kind === 'deferred') {
      deferredCount += 1
      continue
    }

    if (decision.kind === 'matched') {
      // is_valid is deliberately left unset (NULL = unreviewed), preserving the
      // existing contract with the AI validation pass and the admin queue.
      matchedCount += 1
      matchRows.push({
        listing_id: listing.id,
        product_id: decision.best.product_id,
        method:     decision.best.method,
        score:      decision.best.score,
        explain:    decision.best.explain,
      })
      continue
    }

    // Brand collision. Persisted as an explicit rejection rather than dropped:
    //   - is_valid=false keeps it off the wall too, not just out of the price
    //     evidence: display filters `is_valid IS NOT FALSE` and every price
    //     statistic filters `isPriceEvidence` (PAN-93);
    //   - it records WHY, so the decision is auditable;
    //   - it makes the run idempotent — the listing is not re-evaluated
    //     against the same colliding product on every subsequent run.
    // `method` and `score` retain the signal that WOULD have matched, so the
    // strength of the suppressed match stays visible in the audit trail.
    rejectedCount += 1
    matchRows.push({
      listing_id:      listing.id,
      product_id:      decision.best.product_id,
      method:          decision.best.method,
      score:           decision.best.score,
      explain:         { ...decision.best.explain, brand_collision: decision.collision },
      is_valid:        false,
      rejected_reason: brandCollisionReason(decision.collision),
    })
  }

  const BATCH = 100
  for (let i = 0; i < matchRows.length; i += BATCH) {
    const { error } = await supabase
      .from('listing_product_match')
      .upsert(matchRows.slice(i, i + BATCH), { onConflict: 'listing_id,product_id', ignoreDuplicates: true })
    if (error) throw new Error(`Upsert listing_product_match batch ${i}: ${error.message}`)
  }

  // `matched` counts trusted matches only. Rejections and deferrals are
  // reported separately so no caller's success metric can be inflated by rows
  // that were suppressed or by listings that were never decided.
  return {
    matched:  matchedCount,
    rejected: rejectedCount,
    deferred: deferredCount,
    total:    listings.length,
  }
}
