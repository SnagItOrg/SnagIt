/**
 * scripts/lib/brand-net-resolution.ts — PAN-151.
 *
 * Classifies one listing caught by a dba.dk BRAND query into exactly one of:
 *
 *   kg_product   names a KG product by an identity-forming token (PAN-52 D6)
 *   candidate    names a model of this brand that the KG does not hold
 *   family_only  names a model line (`Juno`, `Cube`, `Stratocaster`) and no
 *                terminal model
 *   brand_only   is this brand, and names nothing more
 *   noise        another brand, a sub-brand, a part/accessory, a wanted ad, or
 *                no evidence of the brand in the title at all
 *
 * THIS IS NOT A SECOND RESOLVER. KG resolution is `decideMatch()` from
 * frontend/lib/matching/match-listings.ts, unchanged, over an index built by
 * `buildMatchIndex()` exactly as scripts/report-match-backlog.ts builds its
 * whole-catalogue index: every product forced to `supported`, so the question
 * asked is IDENTITY ("does the KG hold this?"), never SUPPORT ("may it receive a
 * match?"). The active-only and family-label exclusions inside
 * `buildMatchIndex` still apply. Brand collisions, sub-brands and part/wanted
 * intent are the matcher's own guards (`brand-guard.ts`, `listing-intent.ts`).
 *
 * What this module ADDS, because the matcher has no concept of it:
 *
 *   1. MODEL LINES (PAN-52 D6, §4.4). A bare line token is not a terminal
 *      identity. Lines are derived from the KG, never from a supplied list and
 *      never from `families.ts` (whose aliases are navigation-only and must not
 *      reach resolution): a word is a line of brand B when it appears in the
 *      clean model names of B alongside at least two DIFFERENT further
 *      identities — `Juno` (-60, -106, -D, -G, …), `Cube` (Street, Lite, …),
 *      `Jaguar` (Kurt Cobain, Johnny Marr) — and is not merely a series word
 *      that always qualifies a line written after it (`American`, `Standard`,
 *      `Ultra`, round 2). A KG row whose whole model name IS a line
 *      (`fender-jaguar` = "Jaguar", `moog-minimoog` = "Minimoog") is withheld
 *      from the identity index, so a bare line can never resolve to it — the
 *      PAN-125 `juno`/`cube` collision, structurally.
 *
 *   2. MODEL DESIGNATORS. `TD-11`, `JV1080`, `G-1000`, `Cube 30X`. The code
 *      pattern runs on the raw title BEFORE any stop-word logic, so a stop word
 *      can never eat the letter half of a code (the PAN-125 `G-1000` bug).
 *      A model the KG holds under another spelling (`JV1080` for `JV-1080`,
 *      `Twin Reverb` for "Twin Reverb (vintage)", or a row whose `model_name`
 *      is NULL) is `kg_product` with `via: 'spelling'` — it is not a candidate,
 *      because the KG has it — and is reported separately, since the live
 *      matcher would miss it.
 *
 *   3. SERIES NAMES (round 2). D6 makes a series, a sub-brand and a signature
 *      artist identity-forming, so a line written with one is a named model,
 *      not family-only. Round 1 read only an unbroken run of words in front of
 *      the line and misread three shapes the hand audit found: the series after
 *      the line ("Stratocaster American Pro II", "Jazz Bass Vintera II 60s"),
 *      the series around a generic word ("American Vintage II", "Classic Series
 *      '50s", "Custom Shop 1959 Stratocaster" — `Custom Shop` is the matcher's
 *      own IDENTITY_PHRASES), and the artist ("Stratocaster Eric Clapton
 *      signature"). The same reading guards a KG match: "Pawn Shop Mustang
 *      Bass" names more than the KG row "Mustang Bass", so it is a candidate.
 *      Facets never join a name: finish, origin, condition, a bare year.
 * Only the title is evidence. The dba search page's JSON-LD `description` was
 * a verbatim copy of the title on every item measured (1,614 of 1,614), so it
 * is accepted and used only when it actually differs.
 */

import {
  buildMatchIndex,
  decideMatch,
  IDENTITY_PHRASES,
  MATCHABLE_STATUS,
  MATCHABLE_SUPPORT_STATE,
  type MatchIndex,
  type Product,
} from '../../frontend/lib/matching/match-listings'
import {
  containsBrandToken,
  detectBrandCollision,
  detectOfferedBrand,
  wordIndexOf,
  OFFERED_BRAND_LEAD_WORDS,
  tokenFollowedByReference,
} from '../../frontend/lib/matching/brand-guard'
import { detectNonProductIntent, earliestInclusionMarker } from '../../frontend/lib/matching/listing-intent'

export type BrandNetResolution =
  | { kind: 'kg_product'; productIds: string[]; via: 'matcher' | 'spelling'; ambiguous: boolean; detail: string }
  | { kind: 'candidate'; model: string; detail: string }
  | { kind: 'family_only'; line: string; detail: string }
  | { kind: 'brand_only'; detail: string }
  | { kind: 'noise'; reason: NoiseReason; detail: string }

export type NoiseReason =
  | 'other_brand'         // another maker, a sub-brand (Squier), or a reference
  | 'part_or_accessory'   // the matcher's own intent guard, or an accessory head noun
  | 'wanted_or_non_sale'
  | 'unbranded'           // the title never names this brand

export interface BrandNetContext {
  index: MatchIndex
  /** Per brand (lowercase): its model lines. */
  lines: Map<string, Set<string>>
  /** Per brand: the lines the KG writes with a model number after them. */
  numberedLines: Map<string, Set<string>>
  /** Per brand: normalised code or name -> the KG product ids spelled that way. */
  spellings: Map<string, Map<string, string[]>>
  /** Per brand: words that carry the brand inside them (`minimoog`). */
  brandWords: Map<string, Set<string>>
  /** Per brand: words the KG writes in front of a line — series names. */
  series: Map<string, Set<string>>
}

/**
 * Words that are never a model line and never part of a series name: generic
 * instrument nouns, finishes, conditions and trade words, in the three
 * languages the titles use. Whole words only, and never applied to the letter
 * half of a designator — see note 2 in the header.
 */
const GENERIC_WORDS = new Set([
  // instrument / gear nouns
  'synth', 'synthesizer', 'synthesiser', 'synthsizer', 'keyboard', 'piano', 'digitalpiano', 'klaver',
  'guitar', 'guitarer', 'elguitar', 'el-guitar', 'western', 'ukulele', 'banjo', 'bass', 'bas', 'basguitar',
  'amp', 'amplifier', 'forstærker', 'basforstærker', 'midi', 'corporation',
  'guitarforstærker', 'combo', 'head', 'cabinet', 'kabinet', 'module', 'modul', 'drum', 'drums',
  'trommesæt', 'machine', 'pedal', 'effect', 'effekt', 'analog', 'analogue', 'digital', 'polyphonic',
  'paraphonic', 'monophonic', 'semi', 'modular', 'desktop', 'rack', 'voice', 'key', 'keys', 'watt',
  // finishes, condition, trade
  'black', 'white', 'red', 'blue', 'sort', 'hvid', 'rød', 'blå', 'sunburst', 'natural', 'vintage',
  'reissue', 'custom', 'limited', 'edition', 'series', 'model', 'special', 'new', 'used',
  'mint', 'brand', 'present', 'pre', 'owned', 'stock', 'hand', '2nd', 'the', 'and', 'with', 'for', 'of',
  'music', 'ny', 'nyt', 'brugt', 'flot', 'fin', 'pæn', 'sælges', 'stand', 'med', 'og', 'til', 'inkl',
  'incl', 'elektrisk', 'elektronisk', 'akustisk', 'original', 'org', 'orig', 'lh', 'left', 'lefthand',
  'venstrehånds', 'relic', 'fra', 'af', 'en', 'et', 'str', 'strenget', 'artist', 'cbs', 'elbas', 'el', 'top', 'rør', 'rørforstærker',
  'elektriske', 'trommer', 'elklaver', 'langhalset', 'fodpedal', 'sustainpedal', 'fretless', 'båndløs',
  'sampler', 'expression',
  // origin — a facet under D6, never identity
  'mexico', 'mex', 'mim', 'mij', 'japan', 'usa', 'us', 'made', 'in',
  // a signature marker points at an artist name; it is never the name itself
  'signature', 'signatur', 'sig', 'sign',
])

/**
 * Generic words that can sit INSIDE a series name, between two words that
 * name it: `American Vintage II`, `Classic Series '50s`, `Aerodyne Special`,
 * `Custom Shop 1959`. Anywhere else they are generic like the rest. Finishes,
 * origins and conditions never bridge: they are facets under D6.
 */
const BRIDGE_WORDS = new Set(['vintage', 'series', 'special', 'custom', 'reissue', 'limited', 'edition', 'the', 'and', 'of'])

/** Words that end a series name, read either way from its line: across them is another item. */
const RIGHT_STOP_WORDS = new Set(['med', 'm', 'inkl', 'incl', 'with', 'w', 'og', 'and', 'til', 'for'])

const SIGNATURE_MARKERS = new Set(['signature', 'signatur', 'sig', 'sign'])

/** Sub-brand and series phrases the live matcher already treats as identity (PAN-153). */
const PHRASES = IDENTITY_PHRASES.map((p) => p.split(' '))

const isYear = (w: string) => /^(19|20)\d\d$/.test(w)
/** A decade, a two-digit era or an anniversary: `60s`, `'57` (the apostrophe is gone by now), `75th`. */
const isEra = (w: string) => /^\d\d(s|th)?$/.test(w)
const isGeneration = (w: string) => /^(ii|iii|iv|mk(ii|iii|iv|\d))$/.test(w)

/**
 * Letter halves that are generations or counters, not model codes: `mk2`,
 * `v2`, `nr5`. Units (`kg`, `mm`) are not here: a unit follows its number, so
 * a unit-shaped PREFIX is a code (`Roland MM-4`).
 */
const NON_MODEL_PREFIXES = new Set(['mk', 'mkii', 'mkiii', 'v', 'x', 'w', 'nr', 'no', 'str', 'stk', 'op'])

/** Apostrophes are dropped first, so `'50's` is `50s` and `’57` is `57`, never a stray `s`. */
const words = (s: string) => s.toLowerCase().replace(/['’‘´`]/g, '').split(/[^a-z0-9æøåäöüé]+/).filter(Boolean)
const normCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Human form of a designator: `td17` -> `td-17`, `juno 60` -> `juno-60`, `sr-jv80-02` kept. */
function displayCode(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, '-')
  return s.includes('-') ? s : s.replace(/^([a-z]+)(\d)/, '$1-$2')
}

/**
 * Model designators in a text, in order of appearance.
 *
 * Joined form — one token that starts with a letter and contains a digit:
 * `td-11`, `jv1080`, `g-1000`, `sr-jv80-02`, `cube-30x`. Spaced form — a word
 * followed by a number — only when the word is a NUMBERED line of this brand,
 * i.e. one the KG itself writes with a number (`juno 60`, `cube 30x`; never
 * `telecaster 63`, where the number is a year), or when a word that is no
 * line at all sits immediately after the brand (`roland mc 303`, `fender
 * bassman 100`). Anywhere else "fra 1997" or "str 44" would become a model.
 * Decades and ordinals (`60s`, `40th`) and wattages (`30w`) are never model
 * numbers; a four-digit year is refused after a word and accepted after a
 * two-letter code prefix (`sh 2000`). A code WRITTEN as one — two or three
 * capitals, then a plain number that is not a year or a decade (`RS 505`,
 * `HP 1000`, `BA 330`) — is a designator wherever it stands; lower case
 * (`str 44`, `kr 500`) and a roman numeral (`Champion II 50`) never are.
 */
function extractDesignators(text: string, brand: string, lines: Set<string>, numberedLines: Set<string>): string[] {
  const raw = text.split(/[\s,;:()[\]|/!?"'’.]+/).filter(Boolean)
  const tokens = raw.map((t) => t.toLowerCase())
  const found: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/^-+|-+$/g, '')
    const joined = /^([a-z][a-z-]{0,9}?)-?(\d[a-z0-9-]*)$/.exec(t)
    if (joined && /\d/.test(t)) {
      const prefix = joined[1].replace(/-$/, '')
      if (NON_MODEL_PREFIXES.has(prefix)) continue
      // A bare single letter + single digit ("a4") is too weak on its own.
      if (prefix.length === 1 && !t.includes('-') && joined[2].length < 2) continue
      // A generation written after the code is part of it: "SP404 MKII" is
      // the MKII, never the plain SP-404.
      if (/^mk-?(ii|iii|iv|\d)$/.test(tokens[i + 1] ?? '')) found.push(`${displayCode(t)}-${tokens[++i].replace('-', '')}`)
      else found.push(displayCode(t))
      continue
    }
    const next = tokens[i + 1]
    if (!/^[a-z]{1,12}$/.test(t) || !next || !/^\d{1,4}[a-z]{0,3}$/.test(next)) continue
    const afterBrand = i > 0 && tokens[i - 1] === brand
    const writtenAsCode = /^[A-Z]{2,3}$/.test(raw[i]) && !/^[ivx]+$/.test(t) && /^\d{2,4}$/.test(next) &&
      !/^(19|20)\d\d$/.test(next) && !(next.length === 2 && tokens[i + 2] === 's')
    if (!numberedLines.has(t) && !writtenAsCode && (!afterBrand || lines.has(t))) continue
    if (NON_MODEL_PREFIXES.has(t) || GENERIC_WORDS.has(t)) continue
    if (/^(19|20)\d\d$/.test(next) && t.length > 2) continue // "fra 1988"; `sh 2000` survives
    if (/^\d+(w|s|st|nd|rd|th)$/.test(next)) continue
    found.push(displayCode(`${t} ${next}`))
    i++
  }
  return found
}

/** A model name clean enough to teach us structure: not a listing title. */
function isCleanModelName(name: string): boolean {
  return name.length <= 40 && words(name).length <= 5
}

function brandOf(p: Product): string | null {
  return p.brand_name?.trim().toLowerCase() || null
}

export function buildBrandNetContext(
  products: Product[],
  idents: Array<{ product_id: string; type: string; value: string }>,
  synonyms: Array<{ alias: string; canonical_query: string | null }>,
): BrandNetContext {
  const active = products.filter((p) => p.status === MATCHABLE_STATUS)

  // ── model lines ────────────────────────────────────────────────────────
  // word -> the distinct further identities it appears with, per brand.
  const remainders = new Map<string, Map<string, Set<string>>>()
  const brandWords = new Map<string, Set<string>>()
  const cleanNames = new Map<string, string[][]>()
  for (const p of active) {
    const brand = brandOf(p)
    if (!brand || !p.model_name || !isCleanModelName(p.model_name)) continue
    const ws = words(p.model_name)
    if (!cleanNames.has(brand)) cleanNames.set(brand, [])
    cleanNames.get(brand)!.push(ws)
    for (const w of ws) {
      if (w !== brand && w.includes(brand)) {
        if (!brandWords.has(brand)) brandWords.set(brand, new Set())
        brandWords.get(brand)!.add(w)
      }
      if (w.length < 3 || /\d/.test(w) || GENERIC_WORDS.has(w)) continue
      const rest = ws.filter((x) => x !== w && !GENERIC_WORDS.has(x)).join(' ')
      if (!remainders.has(brand)) remainders.set(brand, new Map())
      const byWord = remainders.get(brand)!
      if (!byWord.has(w)) byWord.set(w, new Set())
      byWord.get(w)!.add(rest)
    }
  }
  const lines = new Map<string, Set<string>>()
  remainders.forEach((byWord, brand) => {
    const set = new Set<string>()
    byWord.forEach((rests, w) => {
      const identities = Array.from(rests).filter(Boolean)
      if (identities.length >= 2) set.add(w)
    })
    // A SERIES word recurs too — `American` (Professional II, Ultra, Vintage
    // II …) — but it always qualifies a line written after it: no KG name
    // ends its run of line words with it. `Cube` ("Cube Lite"), `Minimoog`
    // ("Minimoog Model D") and `Deluxe` ("Telecaster Deluxe") each end one.
    const qualifiesOnly = (w: string) => (cleanNames.get(brand) ?? [])
      .filter((ws) => ws.includes(w))
      .every((ws) => ws.slice(ws.indexOf(w) + 1).some((x) => x !== w && set.has(x)))
    lines.set(brand, new Set(Array.from(set).filter((w) => !qualifiesOnly(w))))
  })

  // ── series words ───────────────────────────────────────────────────────
  // Every naming word the KG writes in front of the brand's last line, in
  // any active row — listing-title rows included, since they spell out real
  // series ("Vintera II '60s Jazz Bass", "Player Plus Jazz Bass"). Only these
  // are read as a series when a title puts them AFTER its line ("Stratocaster
  // Player II"); in front of a line, naming order already says so.
  const series = new Map<string, Set<string>>()
  for (const p of active) {
    const brand = brandOf(p)
    const brandLines = brand ? lines.get(brand) : undefined
    if (!brand || !brandLines || !p.model_name) continue
    const ws = words(p.model_name)
    const at = ws.map((w) => brandLines.has(w)).lastIndexOf(true)
    for (const w of ws.slice(0, Math.max(at, 0))) {
      if (w.length < 2 || /\d/.test(w) || GENERIC_WORDS.has(w) || w === brand) continue
      if (!series.has(brand)) series.set(brand, new Set())
      series.get(brand)!.add(w)
    }
  }

  // A row whose whole model name is one line ("Jaguar", "Minimoog") names a
  // family, not a terminal. Withheld from the identity index so no bare line
  // can resolve to it; its identifiers go with it inside buildMatchIndex.
  // The raw words, NOT generic-filtered: "Telecaster Custom" is a supported
  // terminal and must stay, even though `custom` alone identifies nothing.
  const isLineLabel = (p: Product) => {
    const brand = brandOf(p)
    if (!brand || !p.model_name) return false
    const ws = words(p.model_name)
    return ws.length === 1 && !!lines.get(brand)?.has(ws[0])
  }

  // The same rule for the two curated tiers: an alias or identifier that is a
  // bare line word ("juno", "Jaguar") would let the line resolve at score 80
  // or 95 to whichever product it happens to point at.
  const allLines = new Set<string>()
  lines.forEach((set) => set.forEach((l) => allLines.add(l)))
  const isBareLine = (s: string) => allLines.has(s.trim().toLowerCase())

  // IDENTITY, not support — the scripts/report-match-backlog.ts precedent.
  const identityProducts = active
    .filter((p) => !isLineLabel(p))
    .map((p) => ({ ...p, support_state: MATCHABLE_SUPPORT_STATE }))
  const index = buildMatchIndex(
    identityProducts,
    idents.filter((i) => !isBareLine(i.value)),
    synonyms.filter((s) => !isBareLine(s.alias)),
  )

  // A NUMBERED line is one the KG writes with a number after it: `Juno-60`,
  // `Cube-40GX`, `System 700`. `Telecaster` never is, so in "Telecaster 63"
  // the number is a year, not a model.
  const numberedLines = new Map<string, Set<string>>()
  for (const p of active) {
    const brand = brandOf(p)
    const brandLines = brand ? lines.get(brand) : undefined
    if (!brand || !brandLines || !p.model_name) continue
    const ws = p.model_name.toLowerCase().split(/[\s-]+/)
    ws.forEach((w, i) => {
      if (brandLines.has(w) && /^\d/.test(ws[i + 1] ?? '')) {
        if (!numberedLines.has(brand)) numberedLines.set(brand, new Set())
        numberedLines.get(brand)!.add(w)
      }
    })
  }

  // ── every spelling the KG holds, per brand: its designator codes, and its
  //    names with punctuation and parentheticals dropped ("Twin Reverb
  //    (vintage)" -> "twinreverb"; a NULL model_name falls back to the
  //    canonical name without the brand) ──────────────────────────────────
  const spellings = new Map<string, Map<string, string[]>>()
  for (const p of index.products) {
    const brand = brandOf(p)
    if (!brand) continue
    if (!spellings.has(brand)) spellings.set(brand, new Map())
    const bySpelling = spellings.get(brand)!
    const names = [p.model_name, p.canonical_name.replace(new RegExp(`^${brand}\\s+`, 'i'), '')]
      .filter((s): s is string => !!s)
    const keys = new Set<string>()
    for (const s of names) {
      keys.add(normCode(s.replace(/\([^)]*\)/g, '')))
      // "'65 Twin Reverb Reissue" is what a seller writes as "'65 Twin Reverb".
      keys.add(normCode(s.replace(/\([^)]*\)/g, '').replace(/\s+reissue\s*$/i, '')))
      for (const d of extractDesignators(s, brand, lines.get(brand) ?? new Set(), numberedLines.get(brand) ?? new Set())) {
        keys.add(normCode(d))
      }
    }
    keys.forEach((k) => { if (k) bySpelling.set(k, [...(bySpelling.get(k) ?? []), p.id]) })
  }

  return { index, lines, numberedLines, spellings, brandWords, series }
}

// ── reading a series name around a line ─────────────────────────────────────

interface SeriesReader {
  brand: string
  brandWords: Set<string>
  /** The line a title word names, or null. */
  lineOf: (w: string) => string | null
  /** The KG series word a title word is or abbreviates, or null. */
  seriesWord: (w: string) => string | null
}

/** `w` itself when the set holds it, or the one member it abbreviates (`strat`, `pro`). */
function uniqueExpansion(w: string, set: Set<string>): string | null {
  if (set.has(w)) return w
  if (w.length < 3 || GENERIC_WORDS.has(w)) return null
  const full = Array.from(set).filter((x) => x.startsWith(w))
  return full.length === 1 ? full[0] : null
}

/** An identity phrase (`custom shop`) whose last word is ws[i]; the fused `customshop` counts. */
function phraseEndingAt(ws: string[], i: number): { words: string[]; span: number } | null {
  for (const p of PHRASES) {
    if (ws[i] === p.join('')) return { words: p, span: 1 }
    const start = i - p.length + 1
    if (start >= 0 && p.every((w, k) => ws[start + k] === w)) return { words: p, span: p.length }
  }
  return null
}

/** An identity phrase whose first word is ws[i]. */
function phraseStartingAt(ws: string[], i: number): { words: string[]; span: number } | null {
  for (const p of PHRASES) {
    if (ws[i] === p.join('')) return { words: p, span: 1 }
    if (p.every((w, k) => ws[i + k] === w)) return { words: p, span: p.length }
  }
  return null
}

/**
 * The series name written IN FRONT OF ws[at], read leftwards to the brand.
 * Naming order makes any plain word there part of the name — another line
 * too (`American Deluxe Stratocaster`). A finish, origin
 * or condition word is skipped and never becomes part of it; a bridge word,
 * year or era (`Vintage`, `1959`, `'60s`) is kept only when enclosed by the
 * name (`American Vintage II`, `Custom Shop 1959 Stratocaster`), and a
 * leading era is kept with the name it prefixes (`'65 Twin Reverb`). A bare
 * year alone is a facet (D6), so "1977 Fender Stratocaster" reads nothing.
 */
function seriesBefore(ws: string[], at: number, r: SeriesReader): string[] {
  const anchor = r.lineOf(ws[at])
  const name: string[] = []
  let pending: string[] = []
  let edge = at // the leftmost word read so far
  for (let i = at - 1; i >= 0; i--) {
    const w = ws[i]
    if (w === r.brand || (r.brandWords.has(w) && !r.lineOf(w)) || RIGHT_STOP_WORDS.has(w)) break
    // Another line is part of the name only when it touches it (`American
    // Deluxe Stratocaster`); further off, or the same line again, it is
    // another item.
    if (r.lineOf(w) && (i !== edge - 1 || r.lineOf(w) === anchor)) break
    const phrase = phraseEndingAt(ws, i)
    if (phrase) {
      name.unshift(...phrase.words, ...pending)
      pending = []
      i -= phrase.span - 1
      edge = i
      continue
    }
    if (BRIDGE_WORDS.has(w) || isYear(w) || isEra(w)) { pending.unshift(w); continue }
    if (GENERIC_WORDS.has(w)) continue
    if (!/^[a-zæøåäöüé]+$/.test(w)) break
    name.unshift(w, ...pending)
    pending = []
    edge = i
  }
  if (name.length > 0 && pending.length > 0 && pending.every(isEra)) name.unshift(...pending)
  return name
}

/**
 * The series name written AFTER ws[at] ("Stratocaster American Pro II", "Jazz
 * Bass Vintera II 60s"). Word order no longer says "this is a name" here, so
 * only an identity phrase or a word the KG itself writes in front of a line
 * counts; a generation or era counts once the name has begun. It stops at the
 * brand, another line, a year, or a word that starts another item (`med`,
 * `og`).
 */
function seriesAfter(ws: string[], at: number, r: SeriesReader): string[] {
  const anchor = r.lineOf(ws[at]) ?? r.lineOf(ws[at - 1] ?? '') // "Jazz Bass": read after `bass`
  const name: string[] = []
  let pending: string[] = []
  for (let i = at + 1; i < ws.length; i++) {
    const w = ws[i]
    const series = r.seriesWord(w)
    if (anchor && r.lineOf(w) === anchor) break
    if (!series && (w === r.brand || r.brandWords.has(w) || r.lineOf(w))) break
    if (RIGHT_STOP_WORDS.has(w)) break
    const phrase = phraseStartingAt(ws, i)
    if (phrase) {
      name.push(...pending, ...phrase.words)
      pending = []
      i += phrase.span - 1
      continue
    }
    if (series || (name.length > 0 && (isGeneration(w) || isEra(w)))) {
      name.push(...pending, w)
      pending = []
      continue
    }
    // A bridge word only bridges inside a name: before one it is a
    // description ("Precision Bass Vintage American 60s"), and so is what
    // follows a year ("Precision Bass 1968 … American Vintage 60s").
    if (BRIDGE_WORDS.has(w)) { if (name.length === 0) break; pending.push(w); continue }
    if (isYear(w)) break
    if (isEra(w)) { pending.push(w); continue } // kept only if a name follows: "60th Anniversary"
    if (GENERIC_WORDS.has(w)) continue
    break
  }
  return name
}

/**
 * The artist a signature marker points at: up to two plain words right
 * before it ("Eric Clapton signature"), else right after it ("signatur Bonnie
 * Raitt"). A signature artist is identity-forming under D6.
 */
function signatureArtist(ws: string[], r: SeriesReader): string[] {
  const at = ws.findIndex((w) => SIGNATURE_MARKERS.has(w))
  if (at === -1) return []
  const isName = (w: string | undefined) => !!w && /^[a-zæøåäöüé]+$/.test(w) && !GENERIC_WORDS.has(w) &&
    w !== r.brand && !r.brandWords.has(w) && !r.lineOf(w)
  const before: string[] = []
  for (let i = at - 1; before.length < 2 && isName(ws[i]); i--) before.unshift(ws[i])
  if (before.length > 0) return before
  const after: string[] = []
  for (let i = at + 1; after.length < 2 && isName(ws[i]); i++) after.push(ws[i])
  return after
}

/**
 * Evaluation order is fixed, and each step only runs when every earlier one
 * declined — so the five kinds are mutually exclusive by construction:
 *
 *   1. sub-brand collision (Squier on a Fender net)            -> noise
 *   2. part / accessory / wanted: the matcher's intent guard,
 *      then the Danish accessory evidence below                -> noise
 *   3. decideMatch over the identity index                     -> kg_product | noise
 *      … unless the title names a longer identity than the
 *      matched model NAME (a series or artist in front of it)  -> candidate
 *   4. the brand is absent from the title, or only referenced  -> noise
 *   5. a designator                                            -> kg_product | candidate
 *   6. a model line, with a series or signature artist         -> kg_product | candidate
 *      a model line on its own                                 -> family_only
 *      a signature artist and no line                          -> candidate
 *   7. a capitalised name right after the brand                -> candidate
 *      any other name right after the brand, or right before
 *      it when the brand ends the title                        -> candidate
 *   8. otherwise                                               -> brand_only
 */
export function resolveBrandNetListing(
  listing: { title: string; description?: string | null },
  netBrand: string,
  ctx: BrandNetContext,
): BrandNetResolution {
  const brand = netBrand.trim().toLowerCase()
  const title = listing.title.toLowerCase().trim()
  // The description is used only when it says something the title does not.
  const extra = listing.description && listing.description.toLowerCase().trim() !== title
    ? listing.description.toLowerCase() : ''
  const lines = ctx.lines.get(brand) ?? new Set<string>()

  // 1. Epiphone is not a Gibson and Squier is not a Fender, whatever else the
  //    title says.
  const collision = detectBrandCollision(title, brand)
  if (collision) {
    return { kind: 'noise', reason: 'other_brand', detail: `sub-brand '${collision.detectedBrand}'` }
  }

  // 2. The matcher's own part/accessory and wanted-ad guard, applied to every
  //    listing rather than only to ones that produced a candidate.
  const intent = detectNonProductIntent(title)
  if (intent) {
    return { kind: 'noise', reason: intent.intent, detail: `intent token '${intent.token}'` }
  }
  const danish = danishAccessory(title, brand)
  if (danish) {
    return { kind: 'noise', reason: 'part_or_accessory', detail: danish }
  }

  // Steps 3 and 5–7 each name a model. A model the KG holds under another
  // spelling ("JV1080" for JV-1080, "Sirin" for a row whose model_name is
  // NULL) is the KG's, not a candidate — and the live matcher would miss it, so
  // it is reported apart as `via: 'spelling'`.
  const spellings = ctx.spellings.get(brand) ?? new Map<string, string[]>()
  const seriesWords = ctx.series.get(brand) ?? new Set<string>()
  const held = (model: string) => spellings.get(normCode(model.replace(/\([^)]*\)/g, '')))
  // `American Pro II Stratocaster` is held as "American Professional II
  // Stratocaster". The abbreviation is expanded for the lookup only: "Pro
  // Reverb" is a model of its own, so an unheld name keeps its own words.
  const expanded = (model: string) =>
    model.split(' ').map((w) => uniqueExpansion(w, seriesWords) ?? w).join(' ')
  const named = (model: string, how: string): BrandNetResolution => {
    const ids = held(model) ?? held(expanded(model))
    return ids
      ? { kind: 'kg_product', productIds: ids.slice().sort(), via: 'spelling', ambiguous: ids.length > 1,
          detail: `${how} '${model}' held by the KG under another spelling` }
      : { kind: 'candidate', model, detail: `${how} '${model}'` }
  }
  const brandWords = ctx.brandWords.get(brand) ?? new Set<string>()
  const reader: SeriesReader = {
    brand, brandWords,
    // `strat`, `tele`: an abbreviation of exactly one line.
    lineOf: (w) => uniqueExpansion(w, lines),
    // `pro`: an abbreviation of exactly one series word.
    seriesWord: (w) => uniqueExpansion(w, seriesWords),
  }
  const ws = words(title)
  const artist = signatureArtist(ws, reader)

  // A matched model NAME (no code) that the title writes with more identity in
  // front of it — a series (`Pawn Shop Mustang Bass`, `American Professional
  // II Telecaster Deluxe`) or a signature artist — names a longer identity
  // than the KG row (D6). A code (`JX-8P`) identifies on its own: the words in
  // front of it are nicknames ("Space Echo RE-201").
  const longerIdentity = (id: string): BrandNetResolution | null => {
    const p = ctx.index.productById.get(id)
    if (!p?.model_name || /\d/.test(p.model_name)) return null
    const mws = words(p.model_name)
    const at = ws.findIndex((_, i) => mws.every((m, k) => ws[i + k] === m))
    if (at === -1) return null
    const more = [...artist.filter((a) => !mws.includes(a)), ...seriesBefore(ws, at, reader)]
    return more.length > 0 ? named([...more, ...mws].join(' '), 'series + KG model') : null
  }

  // 3. The KG, via the live matcher's decision core. A listing the matcher
  //    resolves to ANOTHER brand's product is still a KG listing — just not
  //    one of this brand's, so this net counts it as noise.
  const decision = decideMatch(title, ctx.index)
  const otherBrand = (ids: string[]) => ids
    .map((id) => ctx.index.productById.get(id)?.brand_name ?? null)
    .find((b) => b !== null && b !== brand) ?? null
  if (decision.kind === 'matched' && otherBrand([decision.best.product_id])) {
    return { kind: 'noise', reason: 'other_brand', detail: `KG product of '${otherBrand([decision.best.product_id])}'` }
  }
  if (decision.kind === 'matched') {
    return longerIdentity(decision.best.product_id) ?? {
      kind: 'kg_product', productIds: [decision.best.product_id], via: 'matcher', ambiguous: false,
      detail: `${decision.best.method} ${decision.best.score}`,
    }
  }
  if (decision.kind === 'rejected') {
    return { kind: 'noise', reason: 'other_brand', detail: `brand collision '${decision.collision.detectedBrand}'` }
  }
  if (decision.kind === 'deferred') {
    switch (decision.reason) {
      case 'product_data_conflict':
      case 'ambiguous_tie':
      case 'shared_identifier_conflict': {
        // The listing came back for a query on this brand, so among tied
        // candidates this brand's own are preferred. That is the ONLY use of
        // the net's brand as evidence, and it never beats a named brand: the
        // title "Jupiter-6 synthesizer" ties Roland Jupiter-6 with a KG row
        // named just "Synthesizer".
        const all = decision.candidates.map((c) => c.product_id)
        const own = all.filter((id) => ctx.index.productById.get(id)?.brand_name === brand)
        const ids = own.length > 0 ? own : all
        const other = otherBrand(ids)
        if (other) return { kind: 'noise', reason: 'other_brand', detail: `KG product of '${other}'` }
        // The title names something the KG holds; which ROW is a KG data
        // question, not a resolution one.
        return {
          kind: 'kg_product', productIds: ids.slice().sort(),
          via: 'matcher', ambiguous: ids.length > 1, detail: decision.reason,
        }
      }
      case 'brand_mismatch':
        // The title names a catalogue brand and no candidate belongs to it.
        // When that brand is THIS one, the KG simply holds no such model of
        // ours (the only candidates were e.g. a row named "Synthesizer") —
        // which is exactly what steps 4–8 go on to classify.
        if (containsBrandToken(title, brand)) break
        return { kind: 'noise', reason: 'other_brand', detail: decision.reason }
      case 'copy_or_reference':
        return { kind: 'noise', reason: 'other_brand', detail: decision.reason }
      case 'non_product_intent': // unreachable: step 2 already ran the same guard
      case 'low_confidence':
        break
    }
  }

  // 4. Everything below names THIS brand's models, so the title must name the
  //    brand — and as the offer, not as a reference deep in someone else's ad.
  const haystack = extra ? `${title} ${extra}` : title
  const brandPresent =
    containsBrandToken(haystack, brand) || words(haystack).some((w) => brandWords.has(w))
  const offered = detectOfferedBrand(title, Array.from(ctx.index.catalogueBrands).concat(brand))
  if (!brandPresent) {
    return offered
      ? { kind: 'noise', reason: 'other_brand', detail: `offers '${offered}', never names '${brand}'` }
      : { kind: 'noise', reason: 'unbranded', detail: `title never names '${brand}'` }
  }
  if (offered && offered !== brand && !brandWords.has(offered)) {
    const at = wordIndexOf(title, brand)
    if (at === null || at > OFFERED_BRAND_LEAD_WORDS) {
      return { kind: 'noise', reason: 'other_brand', detail: `led by '${offered}'; '${brand}' only at word ${at}` }
    }
  }

  // 5. A model designator.
  const designators = extractDesignators(listing.title, brand, lines, ctx.numberedLines.get(brand) ?? new Set())
  const heldDesignator = designators.find((d) => held(d))
  if (heldDesignator) return named(heldDesignator, 'designator')
  if (designators.length > 0) return named(designators[0], 'designator')

  // 6. A model line. The identity words written with it — a series
  //    (`American Professional II Telecaster`, `Stratocaster Player II`,
  //    `Custom Shop 1959 Stratocaster`) or a signature artist — make a named
  //    model, which D6 makes identity-forming; a line alone is family-only.
  //    Where a title names a line twice, the richer reading wins.
  let best: { written: string; line: string; series: string[] } | null = null
  for (let i = 0; i < ws.length; i++) {
    const line = reader.lineOf(ws[i])
    if (!line) continue
    // "Jazz Bass", "Precision Bass": the KG writes the line with its noun.
    const withBass = ws[i + 1] === 'bass'
    // Read after the line only when nothing names it in front: what follows a
    // named model ("… II Telecaster 75th Anniversary") describes that model.
    const before = seriesBefore(ws, i, reader)
    const series = before.length > 0 ? before : seriesAfter(ws, withBass ? i + 1 : i, reader)
    // A Custom Shop model with no other series name is its year ("Custom
    // Shop Stratocaster 63"): D6's year that the series name contains. Any
    // other year after a line is when it was built.
    const next = ws[withBass ? i + 2 : i + 1] ?? ''
    if (series.join(' ') === 'custom shop' && (isYear(next) || /^\d\ds?$/.test(next)) && !series.includes(next)) {
      series.push(next)
    }
    if (!best || series.length > best.series.length) {
      best = { written: ws[i], line: withBass ? `${line} bass` : line, series }
    }
  }
  if (best) {
    const { written, line, series } = best
    // "JUNO-Gi", "Juno-X": a short code hyphenated onto the line is the model,
    // and so is one written after a line the KG numbers ("Roland Cube xl").
    const sep = ctx.numberedLines.get(brand)?.has(line) ? '[-\\s]' : '-'
    const coded = new RegExp(`(?<![\\w-])${written}${sep}([a-z0-9]{1,3})(?![\\w-])`).exec(title)
    if (coded && !GENERIC_WORDS.has(coded[1]) && series.length === 0) return named(`${line}-${coded[1]}`, 'line + code')
    // "Fender Jazz Style", "Strat type": a reference, the matcher's own rule.
    if (tokenFollowedByReference(title, written)) {
      return { kind: 'noise', reason: 'other_brand', detail: `'${written}' is qualified as a copy/reference` }
    }
    const name = [...artist.filter((a) => !series.includes(a)), ...series]
    if (name.length > 0) return named([...name, line].join(' '), 'series + line')
    return { kind: 'family_only', line, detail: `bare line '${line}'` }
  }
  if (artist.length > 0) return named(`${artist.join(' ')} signature`, 'signature artist')

  // 7. A capitalised name right after the brand: `Fender Blues Junior III`,
  //    `Fender Super Champ X2`, `Roland Studio Capture`. Many Fender models
  //    carry no code and are not in the KG, so without this they would all
  //    read as brand-only.
  const capitalised = capitalisedNameAfterBrand(listing.title, brand)
  if (capitalised) return named(capitalised, 'capitalised name after brand')
  const beside = nameBesideBrand(listing.title, brand, ctx.index.catalogueBrands)
  if (beside) return named(beside, 'name beside brand')

  return { kind: 'brand_only', detail: `names '${brand}' and no model` }
}

/**
 * Up to three capitalised tokens that directly follow the brand, separated
 * from it and from each other by whitespace only, none of them generic.
 * Returns null for a title written mostly in capitals, where capitalisation
 * carries no signal ("FLOT ROLAND E-28 KEYBOARD").
 */
function capitalisedNameAfterBrand(original: string, brand: string): string | null {
  const letters = original.replace(/[^A-Za-zÆØÅæøå]/g, '')
  const upper = original.replace(/[^A-ZÆØÅ]/g, '')
  if (letters.length === 0 || upper.length / letters.length > 0.6) return null
  const tokens = original.split(/\s+/)
  const isBrand = (t: string | undefined) => t?.toLowerCase().replace(/[^a-z]/g, '') === brand
  let at = tokens.findIndex(isBrand)
  while (at !== -1 && isBrand(tokens[at + 1])) at++ // "Fender Fender Mustang"
  if (at === -1 || /[,.;:–-]$/.test(tokens[at])) return null
  const name: string[] = []
  // A leading era or article belongs to the name it heads: "Fender '59
  // Bassman LTD", "Fender The Pelt".
  let from = at + 1
  const lead = tokens[from]?.replace(/['’]/g, '')
  if (lead && (/^\d\ds?$/.test(lead) || lead === 'The') && /^[A-ZÆØÅ]/.test(tokens[from + 1] ?? '')) {
    name.push(lead.toLowerCase())
    from++
  }
  for (const raw of tokens.slice(from, from + 3)) {
    const t = raw.replace(/[,.;!?)]+$/, '')
    const lower = t.toLowerCase()
    if (!/^[A-ZÆØÅ][\wæøåÆØÅ:'-]*$/.test(t) || GENERIC_WORDS.has(lower)) break
    name.push(lower)
    if (t !== raw) break // trailing punctuation ends the name
  }
  if (name.length === 1 && from > at + 1) return null // the era or article alone
  const joined = name.join(' ')
  return joined.replace(/[^a-z]/g, '').length >= 3 ? joined : null
}

/**
 * The name a title writes beside the brand when capitalisation says nothing:
 * lower case ("Fender pro Junior IV", "Fender super sonic 22", "Fender
 * greta"), all capitals ("FENDER CLASSIC FUZZ WAH"), or the brand written
 * last ("Stratacoustic Fender"). Up to three plain words, ending at the first
 * generic word, another brand, or a model number (which it keeps). Round 2:
 * these were the largest class left in brand-only.
 */
function nameBesideBrand(original: string, brand: string, brands: Set<string>): string | null {
  const tokens = original.split(/[\s/]+/).filter(Boolean)
  const bare = (t: string | undefined) => (t ?? '').toLowerCase().replace(/[^a-z0-9æøåäöüé:]/g, '')
  const isBrand = (t: string | undefined) => bare(t) === brand
  const isWord = (w: string) => /^[a-zæøåäöüé][a-zæøåäöüé:]*$/.test(w) && !GENERIC_WORDS.has(w) && !brands.has(w)
  const read = (from: number, step: 1 | -1): string[] => {
    const name: string[] = []
    for (let i = from; i >= 0 && i < tokens.length && name.length < 3; i += step) {
      const raw = tokens[i]
      if (/^[-–]$/.test(raw)) break
      const pieces = raw.toLowerCase().replace(/[,.;!?()]+/g, ' ').trim().split(/[\s-]+/).filter(Boolean)
      if (pieces.length === 0) break
      if (!pieces.every(isWord)) {
        // a model number or roman numeral ends the name it follows
        if (step === 1 && name.length > 0 && pieces.length === 1 && /^(\d{1,4}[a-z]?|ii|iii|iv)$/.test(pieces[0])) name.push(pieces[0])
        break
      }
      if (step === 1) name.push(...pieces)
      else name.unshift(...pieces)
      if (/[,.;!?)]$/.test(raw) && step === 1) break // punctuation ends it
    }
    return name
  }
  let at = tokens.findIndex(isBrand)
  if (at === -1) return null
  while (isBrand(tokens[at + 1])) at++
  let name: string[] = []
  if (!/[,.;:–-]$/.test(tokens[at])) name = read(at + 1, 1)
  if (name.length === 0 && at === tokens.length - 1) name = read(at - 1, -1)
  const joined = name.join(' ')
  return joined.replace(/[^a-z]/g, '').length >= 3 && name[0].length >= 3 ? joined : null
}

/**
 * Danish accessory evidence the matcher's intent guard has no vocabulary for.
 * Derived from this net's own titles (PAN-151, 1,614 listings), not supplied:
 *
 *   "<thing> til <Brand …>"  — `til` is Danish "for". When the brand first
 *     appears only AFTER it, the listing is the thing, not the brand's
 *     product: "Transporttaske til Roland FR1X", "Keytar grib til Roland
 *     Sh-101", "Slagplade til Fender Stratocaster", "Udgangs transformator …
 *     til FENDER TWIN REVERB". No listing in the sweep named the brand after
 *     `til` and was the instrument itself.
 *   an accessory head noun — `…plade` (slagplade = pickguard, print/control
 *     plade), `…taske`, `…kasse`, `…kabel`, `…stativ`, `…dele` (reservedele =
 *     spare parts), case/bag forms and expansion boards — suppressed, exactly
 *     as `listing-intent.ts` does, by an
 *     inclusion marker that PRECEDES it ("Roland Juno-106 med flightcase",
 *     "Fender … m. orig. case", "Roland CY-15R m/stativ").
 *   round 2, from the same titles: the part and accessory nouns that round 1
 *     let through as brand-only, candidate or even KG product — speakers
 *     (`guitarhøjttaler`, `højttalerenheder`), screws and hinges
 *     (`stemmeskruer`, `hængsler`, "Rhodes tine screw"), picks (`plektre`),
 *     plates and panels ("back plate", "front panel"), a keytar `switch`, a
 *     keyboard's text `skinne` (rail) and `tangenter` (keys: "SH 1000 / 2000
 *     synthesizer tangenter"), a reverb `tank`, a tremolo `arm`, style
 *     `card`s, a `chassis`, cables, a `PU` (pickup) set, catalogues, sheet
 *     music, a bar stool and LPs.
 *     `tangenter` after a number is a key count ("61 tangenter"), not keys.
 *     `udskiftet` ("replaced") marks a part fitted to the instrument on sale,
 *     like an inclusion marker: "Fender Blues Junior, udskiftet højtaler".
 */
const ACCESSORY_SUFFIXES = ['plade', 'taske', 'kasse', 'kabel', 'stativ', 'dele']
const ACCESSORY_WORDS = new Set([
  'case', 'hardcase', 'flightcase', 'softcase', 'bag', 'gigbag',
  'højttaler', 'højtaler', 'højttalere', 'højtalere', 'guitarhøjttaler', 'guitarhøjttalere',
  'guitarhøjtaler', 'guitarhøjtalere', 'højttalerenhed', 'højttalerenheder', 'højtalerenhed',
  'højtalerenheder', 'højtalerstof', 'speaker', 'speakers', 'loudspeaker',
  'skrue', 'skruer', 'stemmeskruer', 'screw', 'screws', 'hængsel', 'hængsler', 'tine', 'tines', 'comb',
  'plektre', 'plektrum', 'plectrum', 'plectrums', 'plate', 'panel', 'switch', 'skinne', 'tangenter',
  'tank', 'arm', 'card', 'chassis', 'transformator', 'transformer', 'håndtag', 'sadler',
  'katalog', 'catalog', 'catalogue', 'noder', 'nodesamling', 'barstol', 'lps', 'cable', 'cables', 'pu',
])
const ACCESSORY_PREFIXES = ['expansion', 'ekspansion']
const DANISH_INCLUSION = /(?:^|[\s,(])(?:m\/|(?:m\.|m|inklusive|på|udskiftet)(?=\s|$))/

function danishAccessory(title: string, brand: string): string | null {
  const brandAt = new RegExp(`(?<![\\w-])${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(title)?.index ?? -1
  const tilAt = /(?<![\wæøå-])til(?![\wæøå-])/.exec(title)?.index ?? -1
  if (tilAt !== -1 && brandAt > tilAt) return `names '${brand}' only after 'til' (for)`

  let accessoryAt = -1
  let noun = ''
  for (const m of Array.from(title.matchAll(/[a-zæøå-]+/g))) {
    const w = m[0]
    if (w === 'tangenter' && /\d\s*$/.test(title.slice(0, m.index))) continue
    if (ACCESSORY_WORDS.has(w) || ACCESSORY_SUFFIXES.some((s) => w.endsWith(s)) ||
        ACCESSORY_PREFIXES.some((p) => w.startsWith(p))) {
      accessoryAt = m.index ?? -1
      noun = w
      break
    }
  }
  if (accessoryAt === -1) return null
  const markers = [earliestInclusionMarker(title), DANISH_INCLUSION.exec(title)?.index ?? -1].filter((i) => i !== -1)
  if (markers.length > 0 && Math.min(...markers) < accessoryAt) return null
  return `accessory head noun '${noun}'`
}
