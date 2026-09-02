/**
 * Stage 3 WP-1 — eligibility spine.
 *
 * Covers the acceptance contract in
 * docs/stage-3-v1-decision-and-build-plan.md §16.2 (lib/catalogue.ts,
 * lib/families.ts) plus the i18n parity requirement from WP-1's acceptance
 * test 7.
 *
 * These run under the existing root harness (`tsx --test`). lib/catalogue.ts is
 * deliberately import-free so it can be exercised here with no Next.js,
 * Supabase or DOM dependency — the predicate that decides what the public can
 * read should not require a browser to test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CANONICAL_DOMAIN,
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CANONICAL_VISIBILITY,
  isAdminOnly,
  isCanonical,
  loadCanonicalSlugs,
  loadSupportedSlugs,
  resolveSlugRole,
  type CatalogueStateRow,
  effectiveExposure,
  type ExposureState,
} from '../../frontend/lib/catalogue'

import {
  NAVIGATION_FAMILIES,
  allFamilyChildSlugs,
  getFamily,
  isFamilySlug,
} from '../../frontend/lib/families'

import { translations } from '../../frontend/lib/i18n'

const CANONICAL_ROW: CatalogueStateRow = {
  status: CANONICAL_STATUS,
  support_state: CANONICAL_SUPPORT,
  browse_visibility: CANONICAL_VISIBILITY,
  browse_domain: CANONICAL_DOMAIN,
}

/* ------------------------------------------------------------------ *
 * §3.1 — the four axes, each independently decisive
 * ------------------------------------------------------------------ */

test('canonical: the reference row passes', () => {
  assert.equal(isCanonical(CANONICAL_ROW), true)
})

test('canonical: each axis alone is decisive', () => {
  assert.equal(isCanonical({ ...CANONICAL_ROW, status: 'inactive' }), false)
  assert.equal(isCanonical({ ...CANONICAL_ROW, support_state: 'known' }), false)
  assert.equal(isCanonical({ ...CANONICAL_ROW, support_state: 'reserve' }), false)
  assert.equal(isCanonical({ ...CANONICAL_ROW, browse_visibility: 'qa_only' }), false)
  assert.equal(isCanonical({ ...CANONICAL_ROW, browse_visibility: 'hidden' }), false)
  assert.equal(isCanonical({ ...CANONICAL_ROW, browse_domain: 'danish-modern' }), false)
})

test('canonical: an inactive row is refused even when supported and public', () => {
  // The four axes are independent (CLAUDE.md §2). Never infer one from another.
  assert.equal(
    isCanonical({
      status: 'inactive',
      support_state: 'supported',
      browse_visibility: 'public',
      browse_domain: 'music',
    }),
    false,
  )
})

test('canonical: fail-closed on a missing or unreadable axis', () => {
  assert.equal(isCanonical(null), false)
  assert.equal(isCanonical(undefined), false)
  assert.equal(isCanonical({}), false)
  for (const axis of ['status', 'support_state', 'browse_visibility', 'browse_domain'] as const) {
    const row = { ...CANONICAL_ROW }
    delete row[axis]
    assert.equal(isCanonical(row), false, `missing ${axis} must not be eligible`)
    assert.equal(isCanonical({ ...CANONICAL_ROW, [axis]: null }), false)
  }
})

test('canonical: the public-but-unsupported cohort is refused', () => {
  // gibson-les-paul, arp-2600, strymon-timeline and the other 11: active and
  // public, but support_state='known', so the matcher can never update them.
  assert.equal(
    isCanonical({
      status: 'active',
      support_state: 'known',
      browse_visibility: 'public',
      browse_domain: 'music',
    }),
    false,
  )
})

/* ------------------------------------------------------------------ *
 * Admin-only preview
 * ------------------------------------------------------------------ */

test('admin-only: supported + qa_only, and nothing else', () => {
  const qaRow = { ...CANONICAL_ROW, browse_visibility: 'qa_only' }
  assert.equal(isAdminOnly(qaRow), true)
  assert.equal(isAdminOnly(CANONICAL_ROW), false)
  assert.equal(isAdminOnly({ ...qaRow, support_state: 'known' }), false)
  assert.equal(isAdminOnly({ ...qaRow, status: 'inactive' }), false)
  assert.equal(isAdminOnly({ ...qaRow, browse_domain: 'tech' }), false)
  assert.equal(isAdminOnly(null), false)
})

test('role: qa_only renders for an admin and 404s for everyone else', () => {
  const qaRow = { ...CANONICAL_ROW, browse_visibility: 'qa_only' }
  assert.equal(
    resolveSlugRole({ row: qaRow, isFamilySlug: false, isAdmin: true }),
    'admin_only',
  )
  assert.equal(
    resolveSlugRole({ row: qaRow, isFamilySlug: false, isAdmin: false }),
    'not_found',
  )
})

test('role: admin status never widens what is canonical', () => {
  const unsupported = { ...CANONICAL_ROW, support_state: 'known' }
  assert.equal(
    resolveSlugRole({ row: unsupported, isFamilySlug: false, isAdmin: true }),
    'not_found',
  )
})

test('role: a non-music row is never reachable, admin or not', () => {
  // /product/macbook-pro-m3-max and the Wegner chair.
  const nonMusic = {
    status: 'active',
    support_state: 'known',
    browse_visibility: 'public',
    browse_domain: 'tech',
  }
  assert.equal(resolveSlugRole({ row: nonMusic, isFamilySlug: false, isAdmin: false }), 'not_found')
  assert.equal(resolveSlugRole({ row: nonMusic, isFamilySlug: false, isAdmin: true }), 'not_found')
})

test('role: the family check runs FIRST', () => {
  // The six family labels are public-but-unsupported rows. If eligibility were
  // evaluated first they would 404 instead of redirecting to /family/<slug>.
  const familyRow = { ...CANONICAL_ROW, support_state: 'known' }
  assert.equal(
    resolveSlugRole({ row: familyRow, isFamilySlug: true, isAdmin: false }),
    'family',
  )
  assert.equal(
    resolveSlugRole({ row: null, isFamilySlug: true, isAdmin: false }),
    'family',
  )
})

test('role: an unknown slug is not_found', () => {
  assert.equal(resolveSlugRole({ row: null, isFamilySlug: false, isAdmin: false }), 'not_found')
})

/* ------------------------------------------------------------------ *
 * Slug-set loaders
 * ------------------------------------------------------------------ */

const SAMPLE_ROWS = [
  { slug: 'roland-juno-106', status: 'active', support_state: 'supported', browse_visibility: 'public' },
  { slug: 'gibson-j-45', status: 'active', support_state: 'supported', browse_visibility: 'qa_only' },
  { slug: 'gibson-les-paul', status: 'active', support_state: 'known', browse_visibility: 'public' },
  { slug: 'macbook-pro-m3-max', status: 'inactive', support_state: 'known', browse_visibility: 'hidden' },
]

test('loadSupportedSlugs: active + supported, regardless of visibility', async () => {
  const slugs = await loadSupportedSlugs(async () => ({ data: SAMPLE_ROWS, error: null }))
  assert.deepEqual([...slugs].sort(), ['gibson-j-45', 'roland-juno-106'])
})

test('loadCanonicalSlugs: active + supported + public', async () => {
  const slugs = await loadCanonicalSlugs(async () => ({ data: SAMPLE_ROWS, error: null }))
  assert.deepEqual([...slugs], ['roland-juno-106'])
})

test('loaders re-validate rows, so a forgotten filter cannot widen the set', async () => {
  // Simulates a caller that dropped the .eq('support_state', ...) filter.
  const slugs = await loadCanonicalSlugs(async () => ({
    data: [
      { slug: 'arp-2600', status: 'active', support_state: 'known', browse_visibility: 'public' },
      { slug: 'roland-tr-808', status: 'active', support_state: 'supported', browse_visibility: 'public' },
    ],
    error: null,
  }))
  assert.deepEqual([...slugs], ['roland-tr-808'])
})

test('loaders reject malformed rows rather than coercing them', async () => {
  const slugs = await loadCanonicalSlugs(async () => ({
    data: [
      null,
      'roland-juno-106',
      { status: 'active', support_state: 'supported', browse_visibility: 'public' }, // no slug
      { slug: '', status: 'active', support_state: 'supported', browse_visibility: 'public' },
      { slug: 'ok', status: 'active', support_state: 'supported', browse_visibility: 'public' },
    ],
    error: null,
  }))
  assert.deepEqual([...slugs], ['ok'])
})

test('loaders throw on a query error instead of returning a permissive set', async () => {
  await assert.rejects(
    () => loadCanonicalSlugs(async () => ({ data: null, error: { message: 'boom' } })),
    /Catalogue eligibility could not be established/,
  )
})

test('loaders throw on a non-array payload', async () => {
  // A malformed payload is unavailability, not an empty catalogue.
  await assert.rejects(
    () => loadCanonicalSlugs(async () => ({ data: { unexpected: true }, error: null })),
    /Catalogue eligibility could not be established/,
  )
})

test('loaders do NOT cache — every call re-reads eligibility', async () => {
  // Review finding H1. A 60-second memo meant a depublish kept being
  // advertised for up to a minute after the operator withdrew it. Eligibility
  // is a correctness boundary, not a hot path.
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return { data: SAMPLE_ROWS, error: null }
  }
  await loadCanonicalSlugs(fetcher)
  await loadCanonicalSlugs(fetcher)
  await loadCanonicalSlugs(fetcher)
  assert.equal(calls, 3, 'each call must re-query')
})

test('supported and canonical resolve independently from the same rows', async () => {
  const supported = await loadSupportedSlugs(async () => ({ data: SAMPLE_ROWS, error: null }))
  const canonical = await loadCanonicalSlugs(async () => ({ data: SAMPLE_ROWS, error: null }))
  assert.equal(supported.size, 2)
  assert.equal(canonical.size, 1)
})

/* ------------------------------------------------------------------ *
 * lib/families.ts — the shape WP-1 owns; the entries are WP-2's
 * ------------------------------------------------------------------ */

test('families: the shape is intact and every entry is well formed', () => {
  // SUPERSEDED BY WP-2, bounded edit to this block only.
  //
  // This test previously asserted `NAVIGATION_FAMILIES.length === 0`, pinning
  // the R1-to-R3 intermediate state in which the six legacy /product URLs 404
  // because their family routes do not exist yet. That state ended when WP-2
  // landed app/family/[slug] and filled the config, so the assertion was
  // pinning a fact with an expiry date rather than an invariant.
  //
  // Nothing is weakened: the shape checks below are unchanged, the three
  // structural invariants in the tests that follow are unchanged, and WP-2
  // re-asserts all of them more strongly in scripts/lib/wp2-families.test.ts
  // (exact membership, redirect map, child filtering, indexability).
  for (const family of NAVIGATION_FAMILIES) {
    assert.equal(typeof family.slug, 'string')
    assert.equal(typeof family.label, 'string')
    assert.equal(typeof family.brand, 'string')
    assert.equal(typeof family.categoryRoot, 'string')
    assert.equal(Array.isArray(family.children), true)
    assert.equal(Array.isArray(family.aliases), true)
    assert.equal(isFamilySlug(family.slug), true)
    assert.equal(getFamily(family.slug)?.slug, family.slug)
  }

  // A slug that is not configured is not a family, whatever the config holds.
  assert.equal(isFamilySlug('roland-juno-106'), false)
  assert.equal(getFamily('roland-juno-106'), null)

  const children = allFamilyChildSlugs()
  assert.equal(children.size, NAVIGATION_FAMILIES.flatMap((f) => f.children).length)
})

test('families: no slug may be both a family and a family child', () => {
  // Holds vacuously at zero entries, and becomes a real guard the moment WP-2
  // adds the six. A family that is also a child would make /family/<slug>
  // reachable from itself.
  const children = allFamilyChildSlugs()
  for (const family of NAVIGATION_FAMILIES) {
    assert.equal(children.has(family.slug), false, `${family.slug} is both a family and a child`)
  }
})

test('families: slugs and children are unique across the whole config', () => {
  const slugs = NAVIGATION_FAMILIES.map((f) => f.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  const allChildren = NAVIGATION_FAMILIES.flatMap((f) => f.children)
  assert.equal(new Set(allChildren).size, allChildren.length)
})

test('families: the config carries no price, listing or count field', () => {
  // Structural, not a flag: a family cannot aggregate what it cannot hold.
  const forbidden = ['price', 'band', 'listing', 'listings', 'count', 'median', 'from']
  for (const family of NAVIGATION_FAMILIES) {
    for (const key of Object.keys(family)) {
      assert.equal(
        forbidden.includes(key.toLowerCase()),
        false,
        `family config must not carry "${key}"`,
      )
    }
  }
})

/* ------------------------------------------------------------------ *
 * i18n — WP-1 owns the file and lands the whole V1 key set
 * ------------------------------------------------------------------ */

test('i18n: da and en carry exactly the same keys', () => {
  const da = Object.keys(translations.da).sort()
  const en = Object.keys(translations.en).sort()
  assert.deepEqual(da, en)
})

test('i18n: no pre-pivot multi-vertical or single-source copy remains', () => {
  const banned = [
    'iphone', 'sofa', 'cykel', 'bike',
    'dba.dk',
    'søg efter alt', 'search for anything',
    '{platforms}',
    'dansk design', 'danish design', 'fotografi', 'photography', 'cycling',
  ]
  for (const locale of ['da', 'en'] as const) {
    const blob = JSON.stringify(translations[locale]).toLowerCase()
    for (const term of banned) {
      assert.equal(blob.includes(term), false, `${locale} still contains "${term}"`)
    }
  }
})

test('i18n: the V1 key set every later package consumes is present in both locales', () => {
  // WP-2/3/4/5 are read-only consumers of this file (build plan §24 rule 1),
  // so a missing key here becomes a merge conflict later. Assert the contract.
  const required = [
    // WP-1
    'notFoundHeading', 'notFoundBody', 'notFoundCta',
    'errorHeading', 'errorBody', 'errorRetry', 'qaBannerPrivate',
    'scopeLine', 'coverageLine', 'marketplaceList', 'weDoNotSell',
    // WP-2
    'familyWhyNotOnePrice', 'familyNoPublicChildren',
    'familyNoSupportedChildren', 'familyBackToCatalogue',
    // WP-3
    'priceBandMedian', 'priceBandRange', 'priceBandBasis', 'priceBandSources',
    'priceBandAsOf', 'priceBandTooFew', 'priceBandTooWide',
    'verdictUnder', 'verdictTypical', 'verdictOver',
    'soldOnReverb', 'soldOnAuctionet', 'thomannNewPrice', 'opensAt', 'approxDkk',
    'noListingsHeading', 'noListingsBody', 'lastSeenForSale',
    'followedSince', 'sourcesChecked', 'howToReadPrices',
    'shelfFollowedNow', 'shelfNewListings', 'browseFirstRunStrip', 'dismiss',
    // WP-4
    'searchNotFollowedHeading', 'searchNotFollowedBody', 'searchAmbiguousHeading',
    'searchNearestHeading', 'demandCta', 'demandThanks',
    // WP-5
    'consentHeading', 'consentBody', 'consentAccept', 'consentReject',
    'consentWithdraw', 'consentGrantLater',
    'consentStatusGranted', 'consentStatusRejected',
    'privacyTitle', 'privacyProcessorsHeading', 'privacyPurposeHeading',
    'privacyDataHeading', 'privacyRetentionHeading', 'privacyRightsHeading',
    'privacyContactHeading', 'privacyNoRawSearch',
  ]
  for (const locale of ['da', 'en'] as const) {
    for (const key of required) {
      assert.ok(
        key in translations[locale],
        `translations.${locale} is missing "${key}"`,
      )
    }
  }
})

test('i18n: category names are music-only', () => {
  for (const locale of ['da', 'en'] as const) {
    assert.deepEqual(Object.keys(translations[locale].categoryNames), ['music-gear'])
  }
})


/**
 * The effective exposure state, parameterised.
 *
 * /admin/products badged `browse_visibility` alone and called `public`
 * "Public". Measured 2026-09-02: 35 rows are active+public, 14 pass
 * `isCanonical`, and the browse projection calls 30 `is_public` — 20 of which
 * are not supported and have no product page. The badge has to name the gate
 * that is actually missing, and precedence decides WHICH gate that is.
 */
test('exposure: each axis combination reports the one gate that is missing', () => {
  const music = { browse_domain: 'music' as const }
  const cases: ReadonlyArray<[string, Parameters<typeof effectiveExposure>[0], ExposureState]> = [
    ['everything passes',
      { ...music, status: 'active', support_state: 'supported', browse_visibility: 'public', taxonomy_state: 'classified' },
      'live_in_browse'],
    ['classified missing -> page still renders, browse does not list it',
      { ...music, status: 'active', support_state: 'supported', browse_visibility: 'public', taxonomy_state: 'missing_subcategory' },
      'page_only'],
    ['root mapping missing is equally not classified',
      { ...music, status: 'active', support_state: 'supported', browse_visibility: 'public', taxonomy_state: 'missing_root_mapping' },
      'page_only'],
    ['public but not supported — the 20-row production case',
      { ...music, status: 'active', support_state: 'known', browse_visibility: 'public', taxonomy_state: 'classified' },
      'unsupported'],
    ['reserve is not supported either',
      { ...music, status: 'active', support_state: 'reserve', browse_visibility: 'public', taxonomy_state: 'classified' },
      'unsupported'],
    ['a non-music identity has no page, whatever visibility says',
      { browse_domain: 'design', status: 'active', support_state: 'supported', browse_visibility: 'public', taxonomy_state: 'classified' },
      'unsupported'],
    ['withheld on purpose',
      { ...music, status: 'active', support_state: 'supported', browse_visibility: 'qa_only', taxonomy_state: 'classified' },
      'hidden'],
    ['hidden is withheld too',
      { ...music, status: 'active', support_state: 'supported', browse_visibility: 'hidden', taxonomy_state: 'classified' },
      'hidden'],
    ['an inactive identity outranks every other complaint',
      { ...music, status: 'inactive', support_state: 'known', browse_visibility: 'qa_only', taxonomy_state: null },
      'inactive'],
    ['fail closed on an unreadable row', null, 'inactive'],
    ['fail closed on an empty row', {}, 'inactive'],
  ]
  for (const [name, row, expected] of cases) {
    assert.equal(effectiveExposure(row), expected, name)
  }

  // `public` alone is never a positive verdict.
  assert.notEqual(
    effectiveExposure({ browse_domain: 'music', status: 'active', support_state: 'known', browse_visibility: 'public', taxonomy_state: 'classified' }),
    'live_in_browse',
  )
})
