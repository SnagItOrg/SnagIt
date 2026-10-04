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
  detectCatalogueBrands,
  detectOfferedBrand,
  tokenFollowedByReference,
  tokenIsObjectOfFor,
  tokenInModelList,
  wordIndexOf,
  OFFERED_BRAND_LEAD_WORDS,
  containsBrandToken,
  type BrandCollision,
} from './brand-guard'
import { detectNonProductIntent, earliestInclusionMarker, type NonProductIntent } from './listing-intent'
// The family-label rule is owned by lib/catalogue.ts — the same module that
// owns the canonical predicate — so both gates refuse the same six slugs for
// the same reason instead of holding two opinions (PAN-84).
import { isFamilyLabelSlug } from '../catalogue'

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

/** A whole word or phrase, on the same boundary rule as `tokenRegex`. */
function cue(phrase: string): RegExp {
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
  accessories?: readonly string[]
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
const ROLAND_PARTS: readonly string[] = [
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

/** A Martin member of `line` (PAN-204): refuses `otherMembers`, the vintage years and MARTIN_NEVER. */
const martin = (line: string, ...otherMembers: RegExp[]): LineBoundary => ({
  line, otherMembers: [...otherMembers, ...MARTIN_VINTAGE, ...MARTIN_NEVER], accessories: MARTIN_PARTS,
})

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
  'moog-moog-subsequent-37': moog('subsequent-37', cue('cv')),
  // PAN-199. The Sirin is "the Analog Messenger of Joy": that title is not the 2024 Messenger.
  'moog-moog-messenger': moog('messenger', cue('sirin'), cue('messenger of joy')),
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
  'roland-jc-120h': roland('roland-jc-120h'),
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
  'roland-SP-404': roland('sp-404', /(?<![\w-])sp[-\s]?404[-\s]?(?:sx|a|mk\s?(?:ii|2|Ⅱ))(?![\w-])/i, ...MK_II),
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
  'neumann-neumann-u47-fet-collectors-edition': { ...neumannSingle('u47'), requires: [COLLECTOR] },
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
  'warm-audio-warm-audio-wa273-eq': warmAudio('wa73'),
  // The single-channel WA76; the WA76-D2 / -A2 are two channels (no target row).
  'warm-audio-wa76': warmAudioSingle('wa76', ...WA76_STEREO),
  'warm-audio-warm-audio-wa-mpx': warmAudioSingle('wa-mpx', ...WA_2MPX),
  'warm-audio-wa-2mpx': warmAudio('wa-mpx'),
  'warm-audio-wa-84': warmAudioSingle('wa-84', ...WA84_PAIR),
  'warm-audio-wa2a': warmAudioSingle('wa-2a'),
  'warm-audio-wa-19': warmAudioSingle('wa-19'),
  'warm-audio-wa-67': warmAudioSingle('wa-67'),
  'warm-audio-wa-251': warmAudioSingle('wa-251'),
  'warm-audio-wa-cx24': warmAudioSingle('wa-cx24'),
  'warm-audio-warm-audio-wa-cx12': warmAudioSingle('wa-cx12'),
  'warm-audio-warm-audio-wa-8000': warmAudioSingle('wa-8000'),
  'warm-audio-warm-audio-wa-44': warmAudioSingle('wa-44'),
  'warm-audio-warm-audio-wa-1b': warmAudioSingle('wa-1b'),
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
  'tube-tech-cl1b': member('tube-tech-cl1b', ...WARM_AUDIO_COPY),

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
  'sequential-prophet-10': {
    line: 'prophet-10',
    otherMembers: [unlessAlso(PROPHET_10_VINTAGE, PROPHET_10_2020)],
  },
  'sequential-circuits-prophet-10': {
    line: 'prophet-10',
    requires: [PROPHET_10_VINTAGE],
    otherMembers: [PROPHET_10_2020],
    accessories: ['rom', 'ics', 'upgrade'],
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
  // Form factor only; the vintage/Rev4 split is unresolved (frozen boundary).
  'sequential-prophet-5': {
    line: 'prophet-5',
    otherMembers: cues('module', 'desktop'),
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
  'gibson-gibson-j-45-standard-12-string': member('j-45'),
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

  // ── PAN-230: legendary gear, step 5, tranche 2 ───────────────────────────
  // Manley's three legendary rows are the standard versions (CSPs 1856, 28955, 5318): the Mastering
  // Versions, the XXV / 30th anniversary editions and the Nu Mu are their own Reverb pages and prices.
  'manley-massive-passive': { line: 'massive-passive', otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('mastering', 'anniversary', 'xxv', 'bundle')], accessories: STUDIO_PARTS },
  'manley-variable-mu': { line: 'variable-mu', otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, ...cues('mastering', 'anniversary', 'nu mu', 'numu', 'slam', 'bundle')], accessories: STUDIO_PARTS },
  // The ELOP and its "+" revision share the row (Reverb's page is the ELOP+); Langevin's ELOP and the CORE strip do not.
  'manley-elop': { line: 'elop', otherMembers: [...UAD_SOFTWARE, ...PAIR_OR_LOT, /(?<![\w-])core(?![a-z])/i, ...cues('langevin', 'bundle')], accessories: STUDIO_PARTS },
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
}

/**
 * Why `title` is not `slug` under its line boundary, or null when it may be.
 * Exported so the PAN-154 data script refuses exactly what the matcher refuses.
 */
export function lineBoundaryRefusal(title: string, slug: string): string | null {
  const boundary = LINE_BOUNDARIES[slug]
  if (!boundary) return null
  // What the title names comes first, so the reason says what the title IS
  // when it says anything; `no_member_cue` is left for titles that name nothing.
  for (const re of boundary.otherMembers) {
    const m = re.exec(title)
    if (m) return `other_member:${m[0].toLowerCase()}`
  }
  const markerAt = earliestInclusionMarker(title.toLowerCase())
  const bundle = boundary.bundles?.some((re) => re.test(title)) ?? false
  for (const noun of bundle ? [] : boundary.accessories ?? []) {
    const m = cue(noun).exec(title)
    if (m && !(markerAt !== -1 && markerAt < m.index)) return `accessory:${noun}`
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
  const norm = title.toLowerCase().trim()

  // Best candidate per product, so one product cannot appear twice and inflate
  // or mask a tie.
  const byProduct = new Map<string, MatchCandidate>()
  const offer = (c: MatchCandidate) => {
    const prev = byProduct.get(c.product_id)
    if (!prev || c.score > prev.score) byProduct.set(c.product_id, c)
  }

  // Products this title independently supports via their OWN model_name.
  // Computed first because the shared-identifier rule below needs it: a
  // sibling may only compete for a shared term if the title actually supports
  // that sibling on its own evidence.
  const modelSupported = new Set<string>()
  for (const product of index.products) {
    if (!product.model_name) continue
    const mOrig = product.model_name.toLowerCase().trim()
    const mSpace = mOrig.replace(/-/g, ' ')
    if (
      (mOrig.length >= 3 && containsToken(norm, mOrig)) ||
      (mSpace !== mOrig && mSpace.length >= 3 && containsToken(norm, mSpace))
    ) modelSupported.add(product.id)
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
      explain:    { matched_model_name: index.productById.get(productId)?.model_name ?? null },
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
  const detected = detectCatalogueBrands(norm, index.catalogueBrands)
  const brandEvidence = detected.size === 1 ? Array.from(detected)[0] : null

  let admissible = surviving
  if (brandEvidence) {
    // Products with no brand recorded are not "a different explicit brand" and
    // are therefore not eliminated.
    admissible = surviving.filter((c) => {
      const b = index.productById.get(c.product_id)?.brand_name
      return !b || b === brandEvidence
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
    return LINE_BOUNDARIES[slug]?.line ?? slug
  }
  const rival = lineRefused.find((c) => {
    if (c.score < best.score || lineOf(c.product_id) === lineOf(best.product_id)) return false
    const b = index.productById.get(c.product_id)?.brand_name
    return !brandEvidence || !b || b === brandEvidence
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
  if (evidenceToken && tokenIsObjectOfFor(norm, evidenceToken.toLowerCase(), bestBrandName)) {
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
  if (evidenceToken && tokenInModelList(norm, evidenceToken)) {
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
    const brandProven = !!ownBrand && containsBrandToken(norm, ownBrand)
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
  if (evidenceToken && tokenFollowedByReference(norm, evidenceToken.toLowerCase())) {
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
    if (offered && offered !== bestBrand) {
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
