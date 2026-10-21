/**
 * scripts/lib/catalogue-audit.test.ts
 *
 * PAN-284: the nightly catalogue audit. Each check finds the lapse it is named for on a production
 * row and stays silent on a clean one; an allow-listed exception is counted, not reported; the diff
 * reports a finding the night it appears and the night it is gone; a trend is reported every night
 * and never diffed.
 *
 * Fixtures are production rows as the audit read them on 2026-10-21 (the first run): boss-bd-2
 * without an image, roland-tr-909 with a Pexels hero, ssl-2 whose model_name starts with its brand,
 * warm-audio-warm-audio-wa-1b, gibson-es-330 without a subcategory, the two Neumann U 47 fet rows
 * (both with a line boundary), "Guitar Combos", the neumann-u87-condenser family whose label is its
 * child's name, altec-436 with no active listing.
 *
 * Run: npx tsx --test scripts/lib/catalogue-audit.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CHECKS, diffRuns, formatReport, runAudit, toState,
  type AuditMatch, type AuditProduct, type AuditSnapshot, type Check,
} from './catalogue-audit'
import { LINE_BOUNDARIES } from '../../frontend/lib/matching/match-listings'

const STORAGE = 'https://lmogfnyfpaqaxtrrcupw.supabase.co/storage/v1/object/public/product-images/products'

/** A clean canonical row; every lapse below overrides one field of it. */
function product(over: Partial<AuditProduct> & { slug: string }): AuditProduct {
  return {
    id: `id-${over.slug}`, canonical_name: over.slug, model_name: null,
    brand_id: 'brand-roland', brand_slug: 'roland', brand_name: 'Roland',
    status: 'active', support_state: 'supported', browse_visibility: 'public',
    browse_domain: 'music', taxonomy_state: 'classified',
    root_category_slug: 'keyboards-and-synths', subcategory_slug: 'keyboards-and-synths/analog-synths',
    hero_image_url: null, image_url: `${STORAGE}/${over.slug}.webp`, active_listing_count: 12,
    ...over,
  }
}

const snapshot = (over: Partial<AuditSnapshot>): AuditSnapshot => ({ products: [], categories: [], matches: [], ...over })

const findings = (snap: AuditSnapshot, id: string) => {
  const result = runAudit(snap).checks.find((c) => c.id === id)
  assert.ok(result, `check ${id} is registered`)
  return result
}
const keys = (snap: AuditSnapshot, id: string) => findings(snap, id).findings.map((f) => f.key)

/* ── The registry ──────────────────────────────────────────────────────── */

test('every check has a unique snake_case id, a title, a severity and a decided allow-list', () => {
  const ids = CHECKS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  for (const c of CHECKS) {
    assert.match(c.id, /^[a-z][a-z0-9_]+$/, c.id)
    assert.ok(c.title.length > 10, `${c.id} has a title`)
    assert.ok(['error', 'warn', 'info', 'trend'].includes(c.severity), `${c.id} severity`)
    for (const a of c.allow) assert.match(a.by, /^(PAN-\d+|same word in Danish)$/, `${c.id} allow ${a.key} names its decision`)
  }
  // The ticket's seed checks, by name.
  for (const id of [
    'model_name_starts_with_brand', 'supported_blocked_from_public', 'slug_repeats_brand', 'public_without_image',
    'shared_model_name_without_boundary', 'public_without_listings', 'family_label_equals_child_name',
    'family_without_canonical_child', 'category_name_da_is_english', 'matched_listing_brand_mismatch',
    'public_without_dk_listing_by_root',
  ]) assert.ok(ids.includes(id), `seed check ${id}`)
})

test('runAudit refuses a duplicate id, and sorts findings by key', () => {
  const twice: Check[] = [CHECKS[0], CHECKS[0]]
  assert.throws(() => runAudit(snapshot({}), twice), /duplicate check id/)
  const snap = snapshot({ products: [
    product({ slug: 'b-no-image', image_url: null }), product({ slug: 'a-no-image', image_url: null }),
  ] })
  assert.deepEqual(keys(snap, 'public_without_image'), ['a-no-image', 'b-no-image'])
})

/* ── Images ────────────────────────────────────────────────────────────── */

test('public_without_image: boss-bd-2 (no column set) is an error; a qa_only row without an image is not public and is silent', () => {
  const snap = snapshot({ products: [
    product({ slug: 'boss-bd-2', brand_slug: 'boss', brand_name: 'Boss', image_url: null, root_category_slug: 'effects-and-pedals' }),
    product({ slug: 'ehx-memory-boy', browse_visibility: 'qa_only', image_url: null }),
    product({ slug: 'roland-juno-106' }),
    // A blank string is not an image (resolveProductImage).
    product({ slug: 'blank-image', image_url: '   ' }),
  ] })
  assert.deepEqual(keys(snap, 'public_without_image'), ['blank-image', 'boss-bd-2'])
  assert.equal(findings(snap, 'public_without_image').severity, 'error')
})

test('public_image_off_storage: the TR-909 Pexels hero is a warning; a curated hero in Storage wins over an external ingested one', () => {
  const snap = snapshot({ products: [
    product({ slug: 'roland-tr-909', hero_image_url: 'https://images.pexels.com/photos/1/x.jpeg', image_url: `${STORAGE}/roland-tr-909.webp` }),
    product({ slug: 'gibson-hummingbird', hero_image_url: `${STORAGE}/gibson-hummingbird.webp`, image_url: 'https://images.unsplash.com/photo-1' }),
    product({ slug: 'roland-juno-106' }),
  ] })
  const r = findings(snap, 'public_image_off_storage')
  assert.deepEqual(r.findings, [{ key: 'roland-tr-909', detail: 'images.pexels.com' }])
})

/* ── Names and slugs ───────────────────────────────────────────────────── */

test('model_name_starts_with_brand: "SSL 2" under SSL and "ARP 2600" under Arp, case-insensitively; "Juno-106" under Roland is clean', () => {
  const snap = snapshot({ products: [
    product({ slug: 'ssl-2', brand_slug: 'ssl', brand_name: 'SSL', model_name: 'SSL 2' }),
    product({ slug: 'arp-2600', brand_slug: 'arp', brand_name: 'Arp', model_name: 'ARP 2600' }),
    product({ slug: 'roland-juno-106', model_name: 'Juno-106' }),
    // "Rolandia" is not "Roland " — a brand that is a prefix of a word does not count.
    product({ slug: 'roland-rolandia', model_name: 'Rolandia X' }),
    product({ slug: 'no-model', model_name: null }),
  ] })
  assert.deepEqual(keys(snap, 'model_name_starts_with_brand'), ['arp-2600', 'ssl-2'])
})

test('slug_repeats_brand: warm-audio-warm-audio-wa-1b and a "--" slug; arp-korg-arp-2600 does not repeat its brand at the start', () => {
  const snap = snapshot({ products: [
    product({ slug: 'warm-audio-warm-audio-wa-1b', brand_slug: 'warm-audio', brand_name: 'Warm Audio' }),
    product({ slug: 'roland--505' }),
    product({ slug: 'arp-korg-arp-2600', brand_slug: 'arp', brand_name: 'Arp' }),
    product({ slug: 'roland-juno-106' }),
  ] })
  assert.deepEqual(keys(snap, 'slug_repeats_brand'), ['roland--505', 'warm-audio-warm-audio-wa-1b'])
})

/* ── Publication ───────────────────────────────────────────────────────── */

test('supported_blocked_from_public: gibson-es-330 (qa_only, no subcategory) is refused by publicationRefusal; a classified qa row is not', () => {
  const snap = snapshot({ products: [
    product({ slug: 'gibson-es-330', brand_slug: 'gibson', brand_name: 'Gibson', browse_visibility: 'qa_only',
      browse_domain: null, taxonomy_state: 'missing_subcategory', root_category_slug: null, subcategory_slug: null }),
    product({ slug: 'ehx-memory-boy', browse_visibility: 'qa_only' }),
    product({ slug: 'roland-juno-106' }),
  ] })
  const r = findings(snap, 'supported_blocked_from_public')
  assert.deepEqual(r.findings, [{ key: 'gibson-es-330', detail: 'taxonomy_required_for_public (qa_only, taxonomy missing_subcategory)' }])
})

/* ── Shared model names ────────────────────────────────────────────────── */

test('shared_model_name_without_boundary: the two U 47 fet rows both carry a boundary and are silent; a pair without one is reported; Memory Man and Model D are allowed by ticket', () => {
  assert.ok('neumann-u47-fet' in LINE_BOUNDARIES && 'neumann-neumann-u47-fet-collectors-edition' in LINE_BOUNDARIES)
  assert.ok(!('acme-x' in LINE_BOUNDARIES) && !('acme-x-deluxe' in LINE_BOUNDARIES))
  const snap = snapshot({ products: [
    product({ slug: 'neumann-u47-fet', brand_slug: 'neumann', brand_name: 'Neumann', model_name: 'U 47 fet' }),
    product({ slug: 'neumann-neumann-u47-fet-collectors-edition', brand_slug: 'neumann', brand_name: 'Neumann', model_name: 'U 47 fet' }),
    product({ slug: 'acme-x', brand_id: 'b-acme', brand_slug: 'acme', brand_name: 'Acme', model_name: 'X' }),
    product({ slug: 'acme-x-deluxe', brand_id: 'b-acme', brand_slug: 'acme', brand_name: 'Acme', model_name: 'x' }),
    // The same model name under another brand is another group.
    product({ slug: 'other-x', brand_id: 'b-other', brand_slug: 'other', brand_name: 'Other', model_name: 'X' }),
  ] })
  const r = findings(snap, 'shared_model_name_without_boundary')
  assert.deepEqual(r.findings, [{ key: 'acme:x', detail: '2 rows, no line boundary on acme-x, acme-x-deluxe' }])
  const check = CHECKS.find((c) => c.id === 'shared_model_name_without_boundary')!
  assert.deepEqual(check.allow.map((a) => `${a.key}=${a.by}`), ['electro-harmonix:deluxe memory man=PAN-282', 'moog:model d=PAN-199'])
})

/* ── Categories ────────────────────────────────────────────────────────── */

test('category_name_da_is_english: "Guitar Combos" with public products is reported; "Reverb" is a loanword and allowed; an empty category and a translated one are silent', () => {
  const snap = snapshot({
    products: [
      product({ slug: 'fender-deluxe-reverb', root_category_slug: 'amps', subcategory_slug: 'amps/guitar-combos' }),
      product({ slug: 'strymon-big-sky', root_category_slug: 'effects-and-pedals', subcategory_slug: 'effects-and-pedals/reverb' }),
      // Not public, so its category holds nothing a visitor sees.
      product({ slug: 'hidden-cover', browse_visibility: 'hidden', subcategory_slug: 'accessories/amp-covers' }),
    ],
    categories: [
      { slug: 'amps/guitar-combos', name_da: 'Guitar Combos', name_en: 'Guitar Combos', domain: 'music' },
      { slug: 'effects-and-pedals/reverb', name_da: 'Reverb', name_en: 'Reverb', domain: 'music' },
      { slug: 'accessories/amp-covers', name_da: 'Amp Covers', name_en: 'Amp Covers', domain: 'music' },
      { slug: 'amps', name_da: 'Forstærkere', name_en: 'Amps', domain: 'music' },
    ],
  })
  const r = findings(snap, 'category_name_da_is_english')
  assert.deepEqual(r.findings, [{ key: 'amps/guitar-combos', detail: '"Guitar Combos", 1 public product' }])
  assert.deepEqual(r.allowed, [{ key: 'effects-and-pedals/reverb', detail: '"Reverb", 1 public product', by: 'same word in Danish' }])
})

/* ── Families ──────────────────────────────────────────────────────────── */

test('family_label_equals_child_name: neumann-u87-condenser renders a child named exactly "Neumann U 87"; a label that is only a prefix is clean', () => {
  const snap = snapshot({ products: [
    product({ slug: 'neumann-u87', canonical_name: 'Neumann U 87', brand_slug: 'neumann', brand_name: 'Neumann', root_category_slug: 'pro-audio' }),
    product({ slug: 'neumann-u87-ai', canonical_name: 'Neumann U 87 Ai', brand_slug: 'neumann', brand_name: 'Neumann', root_category_slug: 'pro-audio' }),
    product({ slug: 'roland-juno-106', canonical_name: 'Roland Juno-106' }),
  ] })
  const r = findings(snap, 'family_label_equals_child_name')
  assert.deepEqual(r.findings, [{ key: 'neumann-u87-condenser', detail: 'label "Neumann U 87" is also the name of neumann-u87' }])
  // The same child, not canonical: a family renders nothing for it, so there is nothing to collide with.
  const qa = snapshot({ products: [product({ slug: 'neumann-u87', canonical_name: 'Neumann U 87', browse_visibility: 'qa_only' })] })
  assert.deepEqual(keys(qa, 'family_label_equals_child_name'), [])
})

test('family_without_canonical_child: a family whose children are all qa_only is listed with its configured count; one canonical child is enough', () => {
  const none = snapshot({ products: [product({ slug: 'ehx-memory-man', browse_visibility: 'qa_only' })] })
  const r = findings(none, 'family_without_canonical_child')
  assert.ok(r.findings.some((f) => f.key === 'memory-man' && f.detail === '9 children configured, none canonical'))
  const one = snapshot({ products: [product({ slug: 'ehx-memory-man', canonical_name: 'Electro-Harmonix Memory Man' })] })
  assert.ok(!keys(one, 'family_without_canonical_child').includes('memory-man'))
})

/* ── Matches ───────────────────────────────────────────────────────────── */

test('matched_listing_brand_mismatch: an active match whose listing brand differs is an error; same brand, no brand, or a non-matchable product is silent', () => {
  const match = (listing_id: string, product_id: string, listing_brand_id: string | null, country = 'DK'): AuditMatch =>
    ({ listing_id, product_id, listing_brand_id, listing_country: country })
  const snap = snapshot({
    products: [
      product({ slug: 'roland-juno-106' }),
      product({ slug: 'korg-ms-20', brand_id: 'brand-korg', brand_slug: 'korg', brand_name: 'Korg' }),
      // Known, not supported: the matcher refuses it, so the audit does not read its old rows.
      product({ slug: 'old-known', support_state: 'known', browse_visibility: 'qa_only' }),
    ],
    matches: [
      match('l1', 'id-roland-juno-106', 'brand-korg'),
      match('l2', 'id-roland-juno-106', 'brand-roland'),
      match('l3', 'id-roland-juno-106', null),
      match('l4', 'id-old-known', 'brand-korg'),
      match('l5', 'id-korg-ms-20', 'brand-roland'),
    ],
  })
  assert.deepEqual(findings(snap, 'matched_listing_brand_mismatch').findings, [
    { key: 'korg-ms-20:l5', detail: 'listing brand brand-roland ≠ product brand korg' },
    { key: 'roland-juno-106:l1', detail: 'listing brand brand-korg ≠ product brand roland' },
  ])
})

/* ── Listings ──────────────────────────────────────────────────────────── */

test('public_without_listings: altec-436 at 0 is info; a qa_only row at 0 and a public row at 1 are silent; a missing projection count is read as 0', () => {
  const snap = snapshot({ products: [
    product({ slug: 'altec-436', brand_slug: 'altec', brand_name: 'Altec', root_category_slug: 'pro-audio', active_listing_count: 0 }),
    product({ slug: 'ehx-memory-boy', browse_visibility: 'qa_only', active_listing_count: 0 }),
    product({ slug: 'roland-juno-106', active_listing_count: 1 }),
    product({ slug: 'no-projection', active_listing_count: null }),
  ] })
  assert.deepEqual(findings(snap, 'public_without_listings').findings, [
    { key: 'altec-436', detail: 'pro-audio' }, { key: 'no-projection', detail: 'keyboards-and-synths' },
  ])
})

test('public_without_dk_listing_by_root: one line per root, largest first; a DK match on any listing counts, a rejected or inactive one was never read', () => {
  const snap = snapshot({
    products: [
      product({ slug: 'a', root_category_slug: 'amps' }),
      product({ slug: 'b', root_category_slug: 'amps' }),
      product({ slug: 'c', root_category_slug: 'amps' }),
      product({ slug: 'd', root_category_slug: 'pro-audio' }),
      product({ slug: 'qa', root_category_slug: 'pro-audio', browse_visibility: 'qa_only' }),
    ],
    matches: [
      { listing_id: 'l1', product_id: 'id-a', listing_brand_id: null, listing_country: 'DK' },
      { listing_id: 'l2', product_id: 'id-b', listing_brand_id: null, listing_country: null },
      { listing_id: 'l3', product_id: 'id-qa', listing_brand_id: null, listing_country: 'DK' },
    ],
  })
  const r = findings(snap, 'public_without_dk_listing_by_root')
  assert.equal(r.severity, 'trend')
  assert.deepEqual(r.findings, [
    { key: 'amps', detail: '2/3 public products with no Danish listing (67 %)' },
    { key: 'pro-audio', detail: '1/1 public products with no Danish listing (100 %)' },
  ])
})

/* ── State, diff and report ────────────────────────────────────────────── */

/** A two-row night leaves every family without a canonical child; that check is tested above and is left out here. */
const NIGHT_CHECKS = CHECKS.filter((c) => c.id !== 'family_without_canonical_child')

const night1 = snapshot({ products: [
  product({ slug: 'boss-bd-2', image_url: null, root_category_slug: 'effects-and-pedals' }),
  product({ slug: 'altec-436', root_category_slug: 'pro-audio', active_listing_count: 0 }),
] })
const night2 = snapshot({ products: [
  product({ slug: 'boss-bd-2', root_category_slug: 'effects-and-pedals' }), // image uploaded
  product({ slug: 'altec-436', root_category_slug: 'amps', active_listing_count: 0 }), // detail moved
  product({ slug: 'ssl-2', brand_slug: 'ssl', brand_name: 'SSL', model_name: 'SSL 2' }), // new
] })

test('the state file holds the diffable findings by check and key, and never a trend', () => {
  const state = toState(runAudit(night1, NIGHT_CHECKS, new Date('2026-10-21T04:00:00Z')))
  assert.equal(state.ran_at, '2026-10-21T04:00:00.000Z')
  assert.deepEqual(state.findings.public_without_image, { 'boss-bd-2': 'no hero_image_url and no image_url' })
  assert.deepEqual(state.findings.public_without_listings, { 'altec-436': 'pro-audio' })
  assert.equal('public_without_dk_listing_by_root' in state.findings, false)
  assert.equal(Object.keys(state.findings).length, NIGHT_CHECKS.filter((c) => c.severity !== 'trend').length)
})

test('the first run reports everything as new; the next run reports only what appeared, changed or went away', () => {
  const run1 = runAudit(night1, NIGHT_CHECKS, new Date('2026-10-21T04:00:00Z'))
  const first = diffRuns(null, run1)
  assert.equal(first.previous_ran_at, null)
  assert.deepEqual(first.added.map((e) => `${e.id}:${e.key}`), ['public_without_image:boss-bd-2', 'public_without_listings:altec-436'])
  assert.deepEqual(first.fixed, [])

  const run2 = runAudit(night2, NIGHT_CHECKS, new Date('2026-10-22T04:00:00Z'))
  const second = diffRuns(toState(run1), run2)
  assert.equal(second.previous_ran_at, '2026-10-21T04:00:00.000Z')
  assert.deepEqual(second.added.map((e) => `${e.id}:${e.key}`), ['model_name_starts_with_brand:ssl-2'])
  assert.deepEqual(second.changed.map((e) => `${e.id}:${e.key}:${e.was}->${e.detail}`), ['public_without_listings:altec-436:pro-audio->amps'])
  assert.deepEqual(second.fixed.map((e) => `${e.id}:${e.key}`), ['public_without_image:boss-bd-2'])

  // A third identical night is silent.
  const run3 = runAudit(night2, NIGHT_CHECKS, new Date('2026-10-23T04:00:00Z'))
  const third = diffRuns(toState(run2), run3)
  assert.deepEqual([third.added, third.changed, third.fixed], [[], [], []])
})

test('the report leads with the headline, then NEW, CHANGED and FIXED in that order, errors first; a quiet night says OK', () => {
  const run1 = runAudit(night1, NIGHT_CHECKS, new Date('2026-10-21T04:00:00Z'))
  const run2 = runAudit(night2, NIGHT_CHECKS, new Date('2026-10-22T04:00:00Z'))
  const report = formatReport(run2, diffRuns(toState(run1), run2))
  const lines = report.split('\n')
  assert.equal(lines[0], '[catalogue-audit] 1 new, 1 changed, 1 fixed — 2 open findings, since 2026-10-21 04:00 UTC')
  const at = (s: string) => lines.findIndex((l) => l === s)
  assert.ok(at('NEW') > 0 && at('CHANGED') > at('NEW') && at('FIXED') > at('CHANGED') && at('UNCHANGED') > at('FIXED') && at('TREND') > at('UNCHANGED'))
  assert.ok(lines.includes('  warn  model_name_starts_with_brand  ssl-2 — "SSL 2" under brand "SSL"'))
  assert.ok(lines.includes('  info  public_without_listings  altec-436 — amps (was: pro-audio)'))
  assert.ok(lines.includes('  error public_without_image  boss-bd-2 — no hero_image_url and no image_url'))

  const run3 = runAudit(night2, NIGHT_CHECKS, new Date('2026-10-23T04:00:00Z'))
  const quiet = formatReport(run3, diffRuns(toState(run2), run3))
  assert.equal(quiet.split('\n')[0], '[catalogue-audit] OK — 2 open findings, since 2026-10-22 04:00 UTC')
  assert.equal(quiet.includes('NEW'), false)

  // Errors sort before warnings inside NEW whatever order the checks ran in.
  const both = runAudit(snapshot({ products: [
    product({ slug: 'ssl-2', brand_slug: 'ssl', brand_name: 'SSL', model_name: 'SSL 2' }),
    product({ slug: 'boss-bd-2', image_url: null }),
  ] }), NIGHT_CHECKS)
  const fresh = formatReport(both, diffRuns(null, both)).split('\n')
  assert.ok(fresh.findIndex((l) => l.includes('error public_without_image')) < fresh.findIndex((l) => l.includes('warn  model_name_starts_with_brand')))
})

/* ── The script itself ─────────────────────────────────────────────────── */

test('scripts/catalogue-audit.ts only SELECTs, reads the four tables, and mails nothing without --email', () => {
  const src = readFileSync(join(__dirname, '..', 'catalogue-audit.ts'), 'utf8')
  for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
    assert.equal(src.includes(write), false, `the audit must not perform ${write}`)
  }
  const tables = [...src.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(tables)].sort(), ['browse_product_projection', 'kg_category', 'kg_product', 'listing_product_match'])
  assert.match(src, /const EMAIL = flag\('email'\)/)
  assert.match(src, /if \(EMAIL && /, 'mail is sent only behind the flag')
})
