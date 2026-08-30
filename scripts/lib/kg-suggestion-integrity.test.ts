/**
 * Knowledge-graph suggestion integrity.
 *
 * Three separate defects, kept separate here because fixing one leaves the
 * others live. Every count below was measured against production with SELECT
 * only on 2026-08-30.
 *
 *   1. PUNCTUATION NORMALISATION
 *      `expand-knowledge-graph.ts` compared brands with
 *      `title.toLowerCase().includes(brand.name.toLowerCase())`. Stored
 *      `Electro Harmonix` therefore never matched written `Electro-Harmonix`.
 *      463 of the 530 Reverb listings that name the manufacturer use the
 *      hyphen — 87% were unmatchable.
 *
 *   2. ACTIVE-MUSIC-BRAND ELIGIBILITY
 *      Having failed, the loop fell through to the next brand in a
 *      longest-name-first list and hit `Canyon`, a road-bicycle manufacturer
 *      from a retired vertical: 145 of the 160 Reverb titles containing
 *      "Canyon" also contain "Electro". 43 brands across four retired
 *      verticals were eligible candidates and own 498 pending suggestions
 *      between them — Canyon 66, Apple 84, Sony 46, Dell 45, Canon 44.
 *
 *   3. FAIL-CLOSED MERGE SEQUENCING
 *      `/api/admin/suggestions/[id]` updated `listing_product_match` filtered
 *      on `match_reason`, a column that does not exist. The result was never
 *      destructured, so the error was discarded and the route went on to mark
 *      the suggestion approved and answer "Merget" — every merge was a silent
 *      no-op on the listing side.
 *
 * Historical remediation of the 498 existing rows is deliberately NOT tested
 * here: this branch changes behaviour going forward and touches no legacy row.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ACTIVE_BRAND_DOMAIN,
  brandTokens,
  isActiveMusicBrand,
  matchBrandInTitle,
  normalizeBrandKey,
  sameBrandName,
  selectActiveMusicBrands,
  stripBrandSpan,
  tokenizeWithOffsets,
  type BrandRow,
} from '../../frontend/lib/kg/brand-identity'

const ROOT = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

/**
 * Assertions about CODE run against comment-stripped source: the route's
 * comments quote the removed `match_reason` statement verbatim, so matching
 * raw source would let an explanation satisfy a test about behaviour.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SUGGESTION_ROUTE = stripComments(
  read('frontend', 'app', 'api', 'admin', 'suggestions', '[id]', 'route.ts'),
)
const BULK_MERGE = stripComments(
  read('frontend', 'app', 'api', 'admin', 'suggestions', 'bulk', 'merge', 'route.ts'),
)
const BULK_APPROVE = stripComments(
  read('frontend', 'app', 'api', 'admin', 'suggestions', 'bulk', 'approve', 'route.ts'),
)
const EXPAND_SCRIPT = stripComments(read('scripts', 'expand-knowledge-graph.ts'))

/* ── Real brand rows, copied from production kg_brand ─────────────────────── */

const MUSIC_CATEGORY = 'ea2a98e8-8fac-44ac-bdff-cf29fa0df665' // domain 'music'
const CYCLING_CATEGORY = 'ef761361-77a1-4f2f-82aa-9a875ce28344' // domain 'other'
const TECH_CATEGORY = '798f5b0b-4e4e-4586-982b-7e71289614aa' // domain 'other'

const DOMAINS = new Map<string, string>([
  [MUSIC_CATEGORY, 'music'],
  [CYCLING_CATEGORY, 'other'],
  [TECH_CATEGORY, 'other'],
])

const EHX: BrandRow = {
  id: 'd84f9a3e-48bd-406d-aeba-0552612a965c',
  name: 'Electro Harmonix',
  category_id: MUSIC_CATEGORY,
}
const CANYON: BrandRow = {
  id: '2b1ab7f5-0fee-4678-bc39-fb4053f7b932',
  name: 'Canyon',
  category_id: CYCLING_CATEGORY,
}
const APPLE: BrandRow = {
  id: '8236224c-2e91-4fb2-abfe-f95c73cf8049',
  name: 'Apple',
  category_id: TECH_CATEGORY,
}
const ROLAND: BrandRow = { id: 'b-roland', name: 'Roland', category_id: MUSIC_CATEGORY }
const BOSS: BrandRow = { id: 'b-boss', name: 'Boss', category_id: MUSIC_CATEGORY }
const SEQUENTIAL: BrandRow = { id: 'b-seq', name: 'Sequential', category_id: MUSIC_CATEGORY }
const SEQUENTIAL_CIRCUITS: BrandRow = {
  id: 'b-seqc', name: 'Sequential Circuits', category_id: MUSIC_CATEGORY,
}
const API: BrandRow = { id: 'b-api', name: 'API', category_id: MUSIC_CATEGORY }
const EMU: BrandRow = { id: 'b-emu', name: 'E-mu', category_id: MUSIC_CATEGORY }
const MEINL: BrandRow = { id: 'b-meinl', name: 'Meinl', category_id: MUSIC_CATEGORY }

/** The pool as the fixed script builds it: eligible brands only. */
const ELIGIBLE = selectActiveMusicBrands(
  [EHX, CANYON, APPLE, ROLAND, BOSS, SEQUENTIAL, SEQUENTIAL_CIRCUITS, API, EMU, MEINL],
  DOMAINS,
)

/* ═══ 1. Punctuation normalisation ═══════════════════════════════════════════ */

test('1. normalisation: the pinned Electro-Harmonix spellings are one identity', () => {
  const stored = normalizeBrandKey('Electro Harmonix')
  assert.equal(stored, 'electro harmonix')
  for (const written of [
    'Electro-Harmonix',      // U+002D hyphen-minus — 463 Reverb listings
    'Electro–Harmonix', // en dash
    'Electro—Harmonix', // em dash
    'Electro‐Harmonix', // Unicode hyphen
    'ELECTRO HARMONIX',
    'electro  harmonix',
  ]) {
    assert.equal(normalizeBrandKey(written), stored, written)
    assert.ok(sameBrandName(written, 'Electro Harmonix'), written)
  }
})

test('1. normalisation: the raw substring test that shipped would have failed', () => {
  // The exact expression the script used, kept as the regression witness.
  const title = 'Electro-Harmonix Big Muff Pi'
  assert.equal(title.toLowerCase().includes('electro harmonix'), false)
  assert.equal(matchBrandInTitle(title, ELIGIBLE)?.brand.id, EHX.id)
})

test('1. normalisation: apostrophe variants fold together', () => {
  assert.equal(normalizeBrandKey("D'Angelico"), normalizeBrandKey('D’Angelico'))
  assert.equal(normalizeBrandKey("D'Angelico"), normalizeBrandKey('D Angelico'))
})

test('1. normalisation: diacritics fold, Danish letters survive intact', () => {
  assert.equal(normalizeBrandKey('Böhm'), 'bohm')
  assert.equal(normalizeBrandKey('BÖHM'), 'bohm')
  // ø/æ/å have no combining decomposition; folding must not delete them.
  assert.equal(normalizeBrandKey('Carl Hansen Søn'), 'carl hansen søn')
})

test('1. normalisation: display names are never rewritten', () => {
  const match = matchBrandInTitle('Electro-Harmonix Big Muff Pi', ELIGIBLE)
  assert.equal(match?.brand.name, 'Electro Harmonix') // the stored spelling
})

test('1. normalisation: the model hint is cut from the original title by offset', () => {
  const title = 'Electro-Harmonix Canyon Delay & Looper'
  const match = matchBrandInTitle(title, ELIGIBLE)
  assert.ok(match)
  // Cut by offset, not by a regex over the stored name — which would not have
  // matched the hyphenated spelling at all and would have left it in the model.
  assert.equal(stripBrandSpan(title, match), 'Canyon Delay & Looper')
})

test('1. normalisation: is exact, never fuzzy', () => {
  // A near-miss is a non-match. Edit distance is what produced Canyon.
  assert.equal(matchBrandInTitle('Rolnad Juno-106', ELIGIBLE), null)
  assert.equal(matchBrandInTitle('Electro Harmonics Big Muff', ELIGIBLE), null)
  // Hyphen inside a stored brand name normalises the same way.
  assert.equal(matchBrandInTitle('E-MU Emulator II', ELIGIBLE)?.brand.id, EMU.id)
  assert.equal(matchBrandInTitle('E mu Emulator II', ELIGIBLE)?.brand.id, EMU.id)
})

test('1. normalisation: EHX is NOT an alias — no curated alias supports it', () => {
  // Measured: zero rows in `synonym` whose alias contains "ehx", against 110
  // Reverb titles that use the abbreviation. Inventing the expansion here would
  // be fuzzy matching by another name; it stays unclassified until a curated
  // alias exists.
  assert.equal(matchBrandInTitle('EHX Big Muff Pi Fuzz', ELIGIBLE), null)
})

/* ═══ 2. Active-music-brand eligibility ══════════════════════════════════════ */

test('2. eligibility: Canyon cannot receive music suggestions', () => {
  assert.equal(isActiveMusicBrand(CANYON, DOMAINS), false)
  assert.ok(!ELIGIBLE.some((b) => b.id === CANYON.id))
})

test('2. eligibility: Canyon cannot claim an Electro-Harmonix title', () => {
  // The exact production case: 128 Reverb listings name both, and the bicycle
  // brand took 66 pending suggestions from them.
  const title = 'Electro-Harmonix Canyon Delay & Looper Pedal'
  const match = matchBrandInTitle(title, ELIGIBLE)
  assert.equal(match?.brand.id, EHX.id)
  assert.notEqual(match?.brand.id, CANYON.id)
})

test('2. eligibility: Canyon is excluded even when it IS the leading token', () => {
  // Eligibility is not a tie-break, it is a filter. A genuine bicycle title
  // must produce no suggestion at all rather than the best available brand.
  assert.equal(matchBrandInTitle('Canyon Ultimate CF SLX Road Bike', ELIGIBLE), null)
})

test('2. eligibility: other verified legacy verticals are excluded too', () => {
  // Provenance, not spelling: each of these sits under a kg_category whose
  // domain is not 'music'.
  for (const brand of [CANYON, APPLE]) {
    assert.equal(isActiveMusicBrand(brand, DOMAINS), false, brand.name)
  }
  assert.equal(matchBrandInTitle('Apple Mac Pro 5.1 Tower', ELIGIBLE), null)
})

test('2. eligibility: a valid music brand with few or no products stays eligible', () => {
  // 15 of the 43 legacy brands own no products at all, so emptiness cannot be
  // the signal — the guard must never exclude a real music brand for being new.
  const newcomer: BrandRow = { id: 'b-new', name: 'Bastl Instruments', category_id: MUSIC_CATEGORY }
  assert.equal(isActiveMusicBrand(newcomer, DOMAINS), true)
  assert.equal(
    matchBrandInTitle('Bastl Instruments Kastle V1.5', [...ELIGIBLE, newcomer])?.brand.id,
    'b-new',
  )
})

test('2. eligibility: fails closed on an unreadable support axis', () => {
  assert.equal(isActiveMusicBrand({ id: 'x', name: 'X', category_id: null }, DOMAINS), false)
  assert.equal(
    isActiveMusicBrand({ id: 'x', name: 'X', category_id: 'not-in-map' }, DOMAINS),
    false,
  )
  assert.deepEqual(selectActiveMusicBrands([EHX, CANYON], new Map()), [])
  assert.equal(ACTIVE_BRAND_DOMAIN, 'music')
})

test('2. eligibility: the script reads stored provenance, not a brand-name list', () => {
  // Assert the WIRING, not the import: naming the helper in an import list is
  // not the same as filtering the pool with it.
  assert.ok(EXPAND_SCRIPT.includes(
    'const eligibleBrands = selectActiveMusicBrands(brandList, domainByCategoryId)',
  ))
  // The matcher must be handed the filtered pool, never the raw one.
  assert.ok(EXPAND_SCRIPT.includes('matchBrandInTitle(trimmed, eligibleBrands)'))
  assert.ok(!/matchBrandInTitle\([^)]*brandList/.test(EXPAND_SCRIPT))
  // And the domain map must come from the category table, not be assumed.
  assert.ok(EXPAND_SCRIPT.includes("'kg_category'"))
  assert.ok(EXPAND_SCRIPT.includes('domainByCategoryId.size === 0'))
  // No hardcoded Canyon exclusion anywhere in the runtime path.
  assert.ok(!/canyon/i.test(EXPAND_SCRIPT))
  assert.ok(!/canyon/i.test(stripComments(read('frontend', 'lib', 'kg', 'brand-identity.ts'))))
})

test('2. eligibility: a failed match is unclassified, never a fall-through', () => {
  assert.equal(matchBrandInTitle('Some Unknown Maker Widget 9000', ELIGIBLE), null)
  // The script drops it; it does not reach for the next-best brand.
  assert.ok(EXPAND_SCRIPT.includes('if (!match) { unclassified++; continue }'))
  assert.ok(!EXPAND_SCRIPT.includes('includes(brand.name.toLowerCase())'))
})

/* ═══ 2b. Token-boundary matching ════════════════════════════════════════════ */

test('2b. boundary: a short brand never matches inside a longer word', () => {
  // `API` inside "capital", "Boss" inside "Bossa".
  assert.equal(matchBrandInTitle('Capital Audio Preamp', ELIGIBLE), null)
  assert.equal(matchBrandInTitle('Bossa Nova Songbook', ELIGIBLE), null)
  // …but still matches as a whole token.
  assert.equal(matchBrandInTitle('API 512c Preamp', ELIGIBLE)?.brand.id, API.id)
  assert.equal(matchBrandInTitle('Boss DS-1 Distortion', ELIGIBLE)?.brand.id, BOSS.id)
})

test('2b. boundary: a manufacturer inside product prose is not the primary brand', () => {
  // Meinl "Byzance Big Apple Ride" cymbals gave the tech brand 84 suggestions.
  const title = 'Meinl 20" Byzance Jazz Big Apple Ride Cymbal'
  const match = matchBrandInTitle(title, ELIGIBLE)
  assert.equal(match?.brand.id, MEINL.id)
  // And a clone title names the maker first, not the cloned product's maker.
  assert.equal(
    matchBrandInTitle('Boss DS-1 / Roland reissue', ELIGIBLE)?.brand.id,
    BOSS.id,
  )
})

test('2b. boundary: the longest valid brand wins at the same position', () => {
  const pool = [SEQUENTIAL, SEQUENTIAL_CIRCUITS]
  assert.equal(
    matchBrandInTitle('Sequential Circuits Prophet-5 Rev 2', pool)?.brand.id,
    SEQUENTIAL_CIRCUITS.id,
  )
  assert.equal(
    matchBrandInTitle('Sequential Prophet-6 Desktop', pool)?.brand.id,
    SEQUENTIAL.id,
  )
})

test('2b. boundary: the result does not depend on brand-row order', () => {
  const title = 'Electro-Harmonix Canyon Delay'
  const forward = matchBrandInTitle(title, [EHX, ROLAND, MEINL])
  const reverse = matchBrandInTitle(title, [MEINL, ROLAND, EHX])
  assert.equal(forward?.brand.id, reverse?.brand.id)
})

test('2b. boundary: tokenizer offsets address the original string', () => {
  const title = 'Electro-Harmonix Big Muff'
  const tokens = tokenizeWithOffsets(title)
  assert.deepEqual(tokens.map((t) => t.folded), ['electro', 'harmonix', 'big', 'muff'])
  assert.equal(title.slice(tokens[0].start, tokens[1].end), 'Electro-Harmonix')
  assert.deepEqual(brandTokens('Electro-Harmonix'), ['electro', 'harmonix'])
  assert.deepEqual(brandTokens('   '), [])
  assert.equal(matchBrandInTitle('', ELIGIBLE), null)
})

/* ═══ 3. Fail-closed merge sequencing ════════════════════════════════════════ */

test('3. merge: the non-existent match_reason column is gone from every route', () => {
  for (const [name, code] of [
    ['[id]', SUGGESTION_ROUTE], ['bulk/merge', BULK_MERGE], ['bulk/approve', BULK_APPROVE],
  ] as const) {
    assert.ok(!code.includes('match_reason'), name)
  }
})

test('3. merge: listing_product_match is not written by the suggestion routes', () => {
  // `listing_product_match` has no suggestion key, so no row can be identified
  // as belonging to one. Nothing here may write it.
  for (const [name, code] of [
    ['[id]', SUGGESTION_ROUTE], ['bulk/merge', BULK_MERGE], ['bulk/approve', BULK_APPROVE],
  ] as const) {
    assert.ok(!code.includes('listing_product_match'), name)
  }
})

test('3. merge: no unanchored ilike filter drives an update', () => {
  for (const [name, code] of [
    ['[id]', SUGGESTION_ROUTE], ['bulk/merge', BULK_MERGE], ['bulk/approve', BULK_APPROVE],
  ] as const) {
    assert.ok(!code.includes('.ilike('), name)
    assert.ok(!/%\$\{/.test(code), name)
  }
})

test('3. merge: writes are constrained by real identities', () => {
  // The alias upsert names the target product's primary key and lands on the
  // unique index (alias, product_id); the suggestion update is keyed by id.
  assert.ok(SUGGESTION_ROUTE.includes("onConflict: 'alias,product_id'"))
  assert.ok(SUGGESTION_ROUTE.includes("product_id: merge_product_id"))
  assert.ok(SUGGESTION_ROUTE.includes(".eq('id', params.id)"))
  assert.ok(BULK_MERGE.includes("product_id: kg_product_id"))
  assert.ok(BULK_MERGE.includes(".in('id', suggestion_ids)"))
})

test('3. merge: every Supabase result in the merge path is checked', () => {
  const merge = SUGGESTION_ROUTE.slice(SUGGESTION_ROUTE.indexOf("action === 'merge'"))
  // No bare `await admin` — every call is destructured so its error is visible.
  assert.ok(!/\n\s+await admin\b/.test(merge), 'a Supabase call in merge is unchecked')
  for (const guard of ['targetErr', 'synonymErr', 'updateErr']) {
    assert.ok(merge.includes(guard), guard)
  }
})

test('3. merge: no route in the family contains an unchecked Supabase call', () => {
  for (const [name, code] of [
    ['[id]', SUGGESTION_ROUTE], ['bulk/merge', BULK_MERGE], ['bulk/approve', BULK_APPROVE],
    ['bulk/reject', stripComments(
      read('frontend', 'app', 'api', 'admin', 'suggestions', 'bulk', 'reject', 'route.ts'),
    )],
  ] as const) {
    assert.ok(!/\n\s+await admin\b/.test(code), `${name} has an unchecked Supabase call`)
  }
})

test('3. merge: a failed alias write performs no subsequent step', () => {
  const merge = SUGGESTION_ROUTE.slice(SUGGESTION_ROUTE.indexOf("action === 'merge'"))
  const aliasGuard = merge.indexOf('if (synonymErr)')
  const approve = merge.indexOf("status: 'approved'")
  assert.ok(aliasGuard > -1 && approve > -1)
  assert.ok(aliasGuard < approve, 'the suggestion is marked approved before the alias is verified')
  // Same ordering in the bulk path.
  assert.ok(BULK_MERGE.indexOf('if (synonymErr)') < BULK_MERGE.indexOf("status: 'approved'"))
})

test('3. merge: success is never reported after a failed step', () => {
  const merge = SUGGESTION_ROUTE.slice(SUGGESTION_ROUTE.indexOf("action === 'merge'"))
  const firstOk = merge.indexOf('ok: true')
  for (const guard of ['targetErr', 'synonymErr', 'updateErr']) {
    assert.ok(merge.indexOf(guard) < firstOk, `${guard} is checked after success is returned`)
  }
  // And the response does not claim listing work it did not do.
  assert.ok(merge.includes('relinked_listings: 0'))
})

test('3. merge: admin authorization precedes parsing and client construction', () => {
  for (const [name, code] of [
    ['[id]', SUGGESTION_ROUTE], ['bulk/merge', BULK_MERGE], ['bulk/approve', BULK_APPROVE],
  ] as const) {
    const handler = code.slice(code.indexOf('export async function'))
    const auth = handler.indexOf('verifyAdmin()')
    const parse = handler.indexOf('req.json()')
    const client = handler.indexOf('getSupabaseAdmin()')
    assert.ok(auth > -1 && parse > -1 && client > -1, name)
    assert.ok(auth < parse, `${name}: body parsed before authorization`)
    assert.ok(auth < client, `${name}: service-role client built before authorization`)
  }
})

test('3. merge: the admin check itself fails closed on a read error', () => {
  for (const [name, code] of [
    ['[id]', SUGGESTION_ROUTE], ['bulk/merge', BULK_MERGE], ['bulk/approve', BULK_APPROVE],
  ] as const) {
    assert.ok(code.includes('if (error || !prefs?.is_admin) return { ok: false }'), name)
  }
})

test('3. merge: the slug availability probe fails closed', () => {
  // A discarded probe error read as "slug is free" and pushed the failure down
  // into the unique index, reporting 500 where 409 was meant.
  assert.ok(SUGGESTION_ROUTE.includes('existingErr'))
  assert.ok(BULK_APPROVE.includes('existingErr'))
})

/* ═══ Historical data is untouched by this branch ════════════════════════════ */

test('remediation: this branch mutates no existing suggestion or brand row', () => {
  const code = EXPAND_SCRIPT
  // The script still only upserts suggestions; it deletes and rejects nothing.
  assert.ok(!/\.delete\(/.test(code))
  assert.ok(!code.includes("status: 'rejected'"))
  assert.ok(!code.includes("from('kg_brand')\n      .update"))
  assert.ok(code.includes("from('kg_product_suggestions')"))
})
