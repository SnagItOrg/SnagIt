/**
 * Stage 3 WP-2 — navigation families, non-canonical isolation, operator copy.
 *
 * Covers the acceptance contract in
 * docs/stage-3-v1-decision-and-build-plan.md, WP-2 §21 tests 1-7 and §4.2.
 *
 * DETERMINISTIC BY CONSTRUCTION. Every assertion reads either the reviewed
 * config in frontend/lib/families.ts, a fixture row, or a file on disk. None
 * touches the network or the database: a test that needed production to pass
 * could not tell a broken contract from an unreachable database, which is the
 * distinction WP-1's failure model exists to preserve.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  CANONICAL_DOMAIN,
  CANONICAL_STATUS,
  CANONICAL_SUPPORT,
  CANONICAL_VISIBILITY,
  isCanonical,
  type CatalogueStateRow,
} from '../../frontend/lib/catalogue'

import {
  FAMILY_MIN_CANONICAL_CHILDREN,
  NAVIGATION_FAMILIES,
  allFamilyChildSlugs,
  buildFamilyView,
  familyForChild,
  familyRedirectTarget,
  getFamily,
  isFamilySlug,
  type FamilyChildRow,
  type FamilyListingRow,
} from '../../frontend/lib/families'

import { ROUTE_ACCESS, requiresAuth } from '../../frontend/lib/route-access'

const FRONTEND = join(__dirname, '..', '..', 'frontend')

/** The six V1 families, from build plan §4.2. */
const GUITAR_FAMILIES = [
  'gibson-les-paul',
  'fender-stratocaster',
  'fender-telecaster',
  'gibson-es-335',
  'fender-jazz-bass',
  'fender-precision-bass',
]

/** The six, plus `rhodes` (PAN-85) — the first family with canonical children. */
const EXPECTED_FAMILIES = [...GUITAR_FAMILIES, 'rhodes']

/**
 * Production state of every configured child, SELECT-verified 2026-08-28:
 * all ten are active + supported + qa_only + music. Encoded as a fixture, not
 * queried, so the test is deterministic — the live equivalent is the §16.4
 * data-truth gate.
 */
const QA_ONLY_CHILD: Omit<CatalogueStateRow, 'browse_visibility'> = {
  status: CANONICAL_STATUS,
  support_state: CANONICAL_SUPPORT,
  browse_domain: CANONICAL_DOMAIN,
}

function qaOnlyRow(slug: string): FamilyChildRow {
  return { slug, canonical_name: slug, ...QA_ONLY_CHILD, browse_visibility: 'qa_only' }
}

function canonicalRow(slug: string, name = slug): FamilyChildRow {
  return { slug, canonical_name: name, ...QA_ONLY_CHILD, browse_visibility: CANONICAL_VISIBILITY }
}

function readRepoFile(relative: string): string {
  return readFileSync(join(FRONTEND, relative), 'utf8')
}

/* ------------------------------------------------------------------ *
 * 1. The six families, and only the six
 * ------------------------------------------------------------------ */

test('families: exactly the six V1 families are configured', () => {
  assert.deepEqual(
    NAVIGATION_FAMILIES.map((f) => f.slug).sort(),
    [...EXPECTED_FAMILIES].sort(),
  )
})

test('families: children match the reviewed §6.3 map', () => {
  const expected: Record<string, string[]> = {
    'gibson-les-paul': [
      'gibson-les-paul-custom',
      'gibson-les-paul-standard-50s',
      'gibson-les-paul-standard-60s',
      'gibson-les-paul-studio',
      'gibson-les-paul-special',
    ],
    'fender-telecaster': [
      'fender-telecaster-thinline',
      'fender-telecaster-custom',
      'fender-american-vintage-52-telecaster',
    ],
    'fender-stratocaster': ['fender-american-professional-ii-stratocaster'],
    'gibson-es-335': ['gibson-es-335-dot'],
    'fender-jazz-bass': [],
    'fender-precision-bass': [],
    // PAN-85. Not from §6.3: these four were SELECT-verified active+supported+
    // public+music on 2026-09-20, which is what makes them renderable at all.
    rhodes: [
      'rhodes-mark-i-stage-73',
      'rhodes-mark-i-suitcase-73',
      'rhodes-mark-ii-stage-73',
      'rhodes-mark-i-stage-88',
    ],
  }
  for (const family of NAVIGATION_FAMILIES) {
    assert.deepEqual([...family.children].sort(), [...expected[family.slug]].sort(), family.slug)
  }
})

test('families: no family slug is a canonical product, and no child is a family', () => {
  const children = allFamilyChildSlugs()
  for (const family of NAVIGATION_FAMILIES) {
    // A family that were also its own child would make /family/<slug> link to
    // /product/<slug>, which 308s straight back here.
    assert.equal(children.has(family.slug), false, `${family.slug} is both family and child`)
    assert.equal(family.children.includes(family.slug), false)
  }
})

test('families: aliases never carry a bare model number or a sub-brand (§4.3)', () => {
  for (const family of NAVIGATION_FAMILIES) {
    for (const alias of family.aliases) {
      assert.equal(/^\d+$/.test(alias.trim()), false, `bare numeric alias "${alias}"`)
      assert.equal(/squier|epiphone/i.test(alias), false, `sub-brand alias "${alias}"`)
      assert.equal(alias, alias.toLowerCase(), `alias must be normalised: "${alias}"`)
    }
  }
})

/* ------------------------------------------------------------------ *
 * 2. The six redirects (acceptance test 1)
 * ------------------------------------------------------------------ */

test('redirects: each of the six legacy /product URLs maps to its family route', () => {
  for (const slug of EXPECTED_FAMILIES) {
    assert.equal(familyRedirectTarget(`/product/${slug}`), `/family/${slug}`)
  }
  // Exactly six of them are LEGACY — a former priced /product page whose
  // authority the 308 transfers. `rhodes` (PAN-85) has no legacy URL and never
  // had a kg_product row, so /product/rhodes was a 404 before this change and
  // is a 308 after it. That falls out of deriving the map from the family list
  // rather than restating it, and it is the desired behaviour: a family slug
  // must never resolve as a product, at any gate.
  assert.equal(GUITAR_FAMILIES.length, 6)
  assert.equal(EXPECTED_FAMILIES.length, 7)
})

test('redirects: nothing else is redirected', () => {
  for (const path of [
    '/product/roland-juno-106',          // canonical product — must render
    '/product/gibson-les-paul-custom',   // a family CHILD is not a family
    '/product/arp-2600',                 // public but unsupported — 404, not a redirect
    '/product/',                         // no slug
    '/product/gibson-les-paul/extra',    // deeper path
    '/family/gibson-les-paul',           // the target itself, never a source
    '/browse',
    '/',
  ]) {
    assert.equal(familyRedirectTarget(path), null, path)
  }
})

test('redirects: middleware issues 308 and derives the map from lib/families', () => {
  const middleware = readRepoFile('middleware.ts')
  assert.match(middleware, /familyRedirectTarget/)
  assert.match(middleware, /NextResponse\.redirect\(new URL\(familyTarget, request\.url\), 308\)/)
  // A second literal list is how a redirect map and its routes drift apart.
  for (const slug of EXPECTED_FAMILIES) {
    assert.equal(middleware.includes(slug), false, `middleware must not restate "${slug}"`)
  }
})

/* ------------------------------------------------------------------ *
 * 3. Canonical-child filtering (the binding rule of §4.2)
 * ------------------------------------------------------------------ */

test('children: a qa_only child is rendered NOWHERE — not even as a name', () => {
  const family = getFamily('gibson-les-paul')!
  const view = buildFamilyView(family, family.children.map(qaOnlyRow))
  assert.deepEqual(view.children, [])
  assert.equal(view.published, false)
})

test('children: every non-canonical axis is independently disqualifying', () => {
  const family = getFamily('gibson-es-335')!
  const slug = family.children[0]
  for (const broken of [
    { ...canonicalRow(slug), status: 'inactive' },
    { ...canonicalRow(slug), support_state: 'known' },
    { ...canonicalRow(slug), support_state: 'reserve' },
    { ...canonicalRow(slug), browse_visibility: 'qa_only' },
    { ...canonicalRow(slug), browse_visibility: 'hidden' },
    { ...canonicalRow(slug), browse_domain: 'danish-modern' },
    { ...canonicalRow(slug), support_state: null },   // fail-closed on a partial row
    { ...canonicalRow(slug), browse_domain: null },
  ]) {
    assert.deepEqual(buildFamilyView(family, [broken as FamilyChildRow]).children, [])
  }
})

test('children: a missing row is not canonical, and extra rows cannot smuggle a child in', () => {
  const family = getFamily('fender-stratocaster')!
  assert.deepEqual(buildFamilyView(family, []).children, [])
  // A canonical row for a slug that is NOT a configured child must be ignored.
  const view = buildFamilyView(family, [canonicalRow('roland-juno-106', 'Roland Juno-106')])
  assert.deepEqual(view.children, [])
})

test('children: canonical children render in reviewed order with their display name', () => {
  const family = getFamily('gibson-les-paul')!
  const rows = [
    qaOnlyRow('gibson-les-paul-custom'),
    canonicalRow('gibson-les-paul-studio', 'Gibson Les Paul Studio'),
    canonicalRow('gibson-les-paul-special', 'Gibson Les Paul Special'),
  ]
  const view = buildFamilyView(family, rows)
  assert.deepEqual(view.children, [
    { slug: 'gibson-les-paul-studio', label: 'Gibson Les Paul Studio' },
    { slug: 'gibson-les-paul-special', label: 'Gibson Les Paul Special' },
  ])
})

/**
 * PAN-94 SPLIT THIS ASSERTION IN TWO, because the product owner split the rule
 * in two: a family MAY aggregate its children's listings and NEVER their
 * prices. What used to be one forbidden-word list over one shape is now:
 *
 *   the CONFIG   — still holds no price, no listing and no count. `families.ts`
 *                  is reviewed navigation data and gained nothing;
 *   the VIEW     — may name listings, and may not name price evidence;
 *   a LISTING    — an exact key set, the way `RenderableChild` has one.
 *
 * `count` stays forbidden on the view deliberately. The displayed number is
 * `listings.length`; a stored count is a number that can disagree with the rows
 * beneath it, which is the defect the ticket was opened on.
 */
test('children: the config can hold no price, listing or count, at any depth', () => {
  const forbidden = /price|band|listing|count|median|aggregate/i
  for (const family of NAVIGATION_FAMILIES) {
    for (const key of Object.keys(family)) assert.equal(forbidden.test(key), false, key)
  }
  for (const child of buildFamilyView(
    getFamily('gibson-es-335')!,
    [canonicalRow('gibson-es-335-dot')],
  ).children) {
    assert.deepEqual(Object.keys(child).sort(), ['label', 'slug'])
  }
})

test('view: names listings, and can name no price evidence and no stored count', () => {
  const priceShaped = /price|band|median|verdict|aggregate|count/i
  const view = buildFamilyView(getFamily('gibson-les-paul')!, [])

  // An exact key set, not a spot check: a fifth key is how price evidence would
  // arrive, and it now has to be written into this list to ship.
  assert.deepEqual(Object.keys(view).sort(), ['children', 'family', 'listings', 'published'])
  for (const key of Object.keys(view)) {
    if (key === 'listings') continue
    assert.equal(priceShaped.test(key), false, key)
  }
  // The count is derived from the rows themselves and exists nowhere else.
  assert.deepEqual(view.listings, [])
  assert.equal(view.listings.length, 0)
})

/* ------------------------------------------------------------------ *
 * 4. Empty-family behaviour and the indexability transition
 * ------------------------------------------------------------------ */

test('empty: the six guitar families are empty when every child is qa_only', () => {
  // A PREDICATE TEST, NOT A SNAPSHOT OF PRODUCTION — renamed by PAN-94, which
  // re-measured and found the old claim false. Four of the six guitar families
  // now have `public` children (SELECT, 2026-09-20), so the assertion below is
  // that a family whose children are ALL qa_only renders none of them, which is
  // true whatever the catalogue does next. `rhodes` is excluded because the
  // next test covers the canonical case.
  for (const slug of GUITAR_FAMILIES) {
    const family = getFamily(slug)!
    const view = buildFamilyView(family, family.children.map(qaOnlyRow))
    assert.deepEqual(view.children, [], family.slug)
    assert.equal(view.published, false, family.slug)
  }
})

test('rhodes: the first family that renders — four canonical children, no price', () => {
  const family = getFamily('rhodes')!
  const view = buildFamilyView(family, family.children.map((s) => canonicalRow(s, s.toUpperCase())))

  // All four render, in the reviewed order, and the family is published.
  assert.deepEqual(
    view.children.map((c) => c.slug),
    [
      'rhodes-mark-i-stage-73',
      'rhodes-mark-i-suitcase-73',
      'rhodes-mark-ii-stage-73',
      'rhodes-mark-i-stage-88',
    ],
  )
  assert.equal(view.published, true)

  // A rendered child carries a slug and a label and NOTHING else — no price,
  // no median, no count. This is the assertion PAN-85 exists to protect.
  for (const child of view.children) assert.deepEqual(Object.keys(child).sort(), ['label', 'slug'])

  // A non-canonical child is omitted entirely, never greyed and never named.
  const partial = buildFamilyView(family, [
    canonicalRow('rhodes-mark-i-stage-73', 'Rhodes Mark I Stage 73'),
    qaOnlyRow('rhodes-mark-i-suitcase-73'),
  ])
  assert.deepEqual(partial.children, [
    { slug: 'rhodes-mark-i-stage-73', label: 'Rhodes Mark I Stage 73' },
  ])
})

/**
 * PAN-94's one aggregation test.
 *
 * THE FIXTURE IS THE MEASUREMENT. Production, `rhodes`, 2026-09-20 (SELECT):
 * `browse_product_projection.active_listing_count` sums to 40 across the four
 * children; the four product pages render 39, because one match on
 * `rhodes-mark-i-stage-73` is `is_valid = false`; and the family holds 37
 * DISTINCT listings, because two listings are matched to two children each.
 * Three numbers for one question, and the page must publish the third.
 *
 * The shape below reproduces that in miniature — four children, a rejected
 * match, a delisted listing, a shared listing and a listing owned by a child
 * the view refused — so the rule is checked without the database, which is what
 * lets this file stay deterministic.
 */
test('listings: a family aggregates its children’s listings, de-duplicated and priceless', () => {
  const family = getFamily('rhodes')!
  const [first, second, third, fourth] = family.children

  const rows: FamilyChildRow[] = [
    { ...canonicalRow(first, 'Rhodes Mark I Stage 73'), id: 'id-1' },
    { ...canonicalRow(second, 'Rhodes Mark I Suitcase 73'), id: 'id-2' },
    { ...canonicalRow(third, 'Rhodes Mark II Stage 73'), id: 'id-3' },
    // Admitted as a child, but nothing is matched to it: a model with no
    // listings is still a model, and still renders as a link.
    { ...canonicalRow(fourth, 'Rhodes Mark I Stage 88'), id: 'id-4' },
  ]

  const listingRows: FamilyListingRow[] = [
    { product_id: 'id-1', is_valid: null, listings: { id: 'L1', title: 'Rhodes stagepiano', source: 'dba', is_active: true } },
    // An automatic match that an operator or the AI pass adjudicated WRONG. The
    // projection counts it; no page renders it; neither does this.
    { product_id: 'id-1', is_valid: false, listings: { id: 'L2', title: 'Rhodes pedal', source: 'dba', is_active: true } },
    // Delisted. Present in the match table, absent from the market.
    { product_id: 'id-2', is_valid: true, listings: { id: 'L3', title: 'Solgt Rhodes', source: 'dba', is_active: false } },
    // The one fixture row with a photo, so the thumbnail path is exercised and
    // not merely typed. The rest have none, which is the common case.
    { product_id: 'id-2', is_valid: true, listings: { id: 'L4', title: 'Suitcase 73', source: 'reverb', image_url: 'https://rvb-img.reverb.com/x.jpg', is_active: true } },
    // THE SAME LISTING, MATCHED TO TWO CHILDREN. It is one thing on the market
    // and must be counted once, under the FIRST child in reviewed order.
    { product_id: 'id-3', is_valid: null, listings: { id: 'L5', title: 'Rhodes 73', source: 'dba', is_active: true } },
    { product_id: 'id-1', is_valid: null, listings: { id: 'L5', title: 'Rhodes 73', source: 'dba', is_active: true } },
    // Matched to a product that is not a child of this family at all.
    { product_id: 'id-stranger', is_valid: null, listings: { id: 'L6', title: 'Wurlitzer 200A', source: 'dba', is_active: true } },
  ]

  const view = buildFamilyView(family, rows, listingRows)

  assert.equal(view.children.length, 4)
  // Reviewed child order first, then title, then id — so the order is a
  // property of the reviewed config and not of what the database returned.
  // Within the first child, "Rhodes 73" sorts before "Rhodes stagepiano".
  assert.deepEqual(view.listings.map((l) => l.id), ['L5', 'L1', 'L4'])
  // THE COUNT AND THE CONTENT ARE ONE ARRAY. This is the whole bug: there is no
  // second number to compare, only a length.
  assert.equal(view.listings.length, 3)

  // Every listing names the child it belongs to, and that child is one the view
  // actually rendered — so the link can never resolve to a 404.
  const rendered = new Set(view.children.map((c) => c.slug))
  for (const listing of view.listings) {
    assert.equal(rendered.has(listing.childSlug), true, listing.childSlug)
  }
  assert.equal(view.listings.find((l) => l.id === 'L5')!.childSlug, first)
  assert.equal(view.listings.find((l) => l.id === 'L4')!.childLabel, 'Rhodes Mark I Suitcase 73')
  // A photo survives the attribution; a row without one gets null rather than
  // an empty string, so the route never has to decide what counts as an image.
  assert.equal(view.listings.find((l) => l.id === 'L4')!.imageUrl, 'https://rvb-img.reverb.com/x.jpg')
  assert.equal(view.listings.find((l) => l.id === 'L1')!.imageUrl, null)

  // PRICE ISOLATION, STRUCTURALLY — the PAN-56 assertion, extended to listings.
  // No asking price, band, median, verdict or sold population may cross the
  // family boundary inside a listing. Widening this shape is the way the rule
  // is lost, so the shape is pinned exactly and every key must also be
  // checked for MEANING: this assertion used to be a count ("five keys and no
  // sixth"), and a count cannot tell a price from a photo.
  //
  // `imageUrl` is the sixth key. It carries the seller's photo, which is
  // provenance in the same class as `source` — it states no price, implies no
  // band and settles no verdict, and /product/[slug] and /search already
  // publish it for these same rows. The two assertions below are what the
  // count was standing in for, now stated directly.
  const priceShaped = /price|band|median|verdict|aggregate|count|currency|msrp/i
  for (const listing of view.listings) {
    assert.deepEqual(
      Object.keys(listing).sort(),
      ['childLabel', 'childSlug', 'id', 'imageUrl', 'source', 'title'],
    )
    for (const key of Object.keys(listing)) {
      assert.equal(priceShaped.test(key), false, key)
    }
    // Not price-shaped, and still forbidden: an off-site link is how a
    // navigation row would become an exit to an unverdicted marketplace price.
    assert.equal(Object.prototype.hasOwnProperty.call(listing, 'url'), false)
    // The photo is a photo — a string or null, never a number a price could be
    // hiding in.
    assert.equal(listing.imageUrl === null || typeof listing.imageUrl === 'string', true)
  }

  // A family with no canonical child aggregates nothing, whatever is matched to
  // the label row itself. `fender-jazz-bass` is that case in production: the
  // `kg_product` row carries 268 active matches (SELECT, 2026-09-20) and none of
  // them is a child's, so the family correctly holds zero.
  const jazzBass = getFamily('fender-jazz-bass')!
  const empty = buildFamilyView(jazzBass, [], listingRows)
  assert.deepEqual(empty.children, [])
  assert.deepEqual(empty.listings, [])
})

test('rhodes: the family slug is a navigation label, never a product (PAN-84)', () => {
  // There is no `rhodes` kg_product row and there must never be one. If one is
  // created anyway, every gate that could price it refuses it.
  assert.equal(isFamilySlug('rhodes'), true)
  assert.equal(
    isCanonical({
      slug: 'rhodes',
      status: CANONICAL_STATUS,
      support_state: CANONICAL_SUPPORT,
      browse_domain: CANONICAL_DOMAIN,
      browse_visibility: CANONICAL_VISIBILITY,
    }),
    false,
    'a rhodes row that passed all four axes would still be refused',
  )
  // The children themselves are of course still canonical.
  assert.equal(
    isCanonical({
      slug: 'rhodes-mark-i-stage-73',
      status: CANONICAL_STATUS,
      support_state: CANONICAL_SUPPORT,
      browse_domain: CANONICAL_DOMAIN,
      browse_visibility: CANONICAL_VISIBILITY,
    }),
    true,
  )
})

test('indexability: publishing ONE child flips the family, with no code change', () => {
  const family = getFamily('fender-telecaster')!
  const before = buildFamilyView(family, family.children.map(qaOnlyRow))
  assert.equal(before.published, false)
  assert.equal(before.children.length, 0)

  // Exactly one row changes: browse_visibility qa_only -> public.
  const after = buildFamilyView(family, [
    canonicalRow('fender-telecaster-thinline', 'Fender Telecaster Thinline'),
    qaOnlyRow('fender-telecaster-custom'),
    qaOnlyRow('fender-american-vintage-52-telecaster'),
  ])
  assert.equal(after.published, true)
  assert.deepEqual(after.children, [
    { slug: 'fender-telecaster-thinline', label: 'Fender Telecaster Thinline' },
  ])
})

test('indexability: one threshold drives index, sitemap, nav and search together', () => {
  assert.equal(FAMILY_MIN_CANONICAL_CHILDREN, 1)
  const page = readRepoFile('app/(shell)/family/[slug]/page.tsx')
  // robots.index is the view's own `published`, never a second rule.
  assert.match(page, /robots:\s*\{\s*index:\s*view\.published,\s*follow:\s*true\s*\}/)
})

test('empty: a family with no configured children can never become published', () => {
  for (const slug of ['fender-jazz-bass', 'fender-precision-bass']) {
    const family = getFamily(slug)!
    assert.equal(family.children.length, 0)
    assert.equal(buildFamilyView(family, [canonicalRow('anything')]).published, false)
  }
})

/* ------------------------------------------------------------------ *
 * 5. The route renders no price, no feed, no count, no CTA
 * ------------------------------------------------------------------ */

test('route: the family page imports and computes nothing price-shaped', () => {
  const page = readRepoFile('app/(shell)/family/[slug]/page.tsx')
  for (const forbidden of [
    'price-band',
    // PAN-94 REMOVED `listing_product_match` FROM THIS LIST AND KEPT
    // `active_listing_count`, which is the whole distinction the ticket draws.
    // The match table is where the family's listings legitimately come from.
    // The projection COLUMN is a second, pre-aggregated answer to the same
    // question — it counts rows adjudicated `is_valid = false` that no page
    // renders, and summing it across children double-counts a listing matched
    // to two of them. Reading it here is how the count and the content would
    // disagree again.
    'active_listing_count',
    'priceRange',
    'PriceHistory',
    'watchlist',
    'Watchlist',
  ]) {
    assert.equal(page.includes(forbidden), false, `family route must not reference ${forbidden}`)
  }

  // It reads exactly three tables: two for eligibility, one for the listings.
  const tables = [...page.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]).sort()
  assert.deepEqual(tables, ['browse_product_projection', 'kg_product', 'listing_product_match'])

  // AND NO SELECT ON THIS ROUTE MAY NAME A PRICE COLUMN. Asserted over the
  // select literals rather than over the prose, so the file may still explain
  // in words why it holds no price while being unable to read one.
  const selects = [...page.matchAll(/\.select\('([^']*)'\)/g)].map((m) => m[1])
  assert.equal(selects.length > 0, true, 'expected at least one select')
  for (const select of selects) {
    for (const column of ['price', 'price_dkk', 'currency', 'msrp']) {
      assert.equal(
        new RegExp(`\\b${column}\\b`).test(select),
        false,
        `family route select must not read ${column}: ${select}`,
      )
    }
  }
})

test('route: the demand control is present on the empty state only', () => {
  const page = readRepoFile('app/(shell)/family/[slug]/page.tsx')
  assert.match(page, /data-demand-control="family"/)
  assert.match(page, /t\.demandCta/)
  assert.match(page, /children\.length === 0 && \(/)
  // No analytics emission in WP-2: the analytics module is WP-5's and the
  // consent boundary deploys first. Assert the absence of an IMPORT and of a
  // call, not of the word — the file explains in prose why it emits nothing.
  assert.equal(/^import .*analytics/m.test(page), false, 'family route must not import analytics')
  assert.equal(/\btrack\(/.test(page), false, 'family route must not emit events')
  assert.equal(/posthog\.|usePostHog/i.test(page), false)
})

test('route: unknown family slugs 404 rather than rendering an empty family', () => {
  assert.equal(getFamily('gibson-flying-v'), null)
  assert.equal(isFamilySlug('gibson-flying-v'), false)
  const page = readRepoFile('app/(shell)/family/[slug]/page.tsx')
  assert.match(page, /if \(!view\) notFound\(\)/)
  // A slug that is not a family is also not redirected INTO the family route.
  assert.equal(familyRedirectTarget('/product/gibson-flying-v'), null)
})

/* ------------------------------------------------------------------ *
 * 6. Navigation exclusion, and no public surface links to a 404
 * ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|json)$/.test(entry)) out.push(full)
  }
  return out
}

test('navigation: an empty family is reachable ONLY by the legacy 308s (§4.2 rule 1)', () => {
  // The permitted inbound paths are the six legacy /product URLs and a direct
  // URL. Anything that LINKS to /family — a card, a shelf, a nav item, a
  // sitemap entry — would list a route that is noindex and has nothing to show.
  const linkers: string[] = []
  const redirectors: string[] = []

  /**
   * PAN-56 admits exactly ONE linking surface, and it is not an exception to
   * the rule above — it is an instance of it.
   *
   * The product page's family breadcrumb renders only when `familyContext` is
   * non-null, and /api/product/[slug] emits that field only when the
   * FamilyView it built is `published`, i.e. has at least one canonical child.
   * An EMPTY family therefore remains unreachable by any link, which is the
   * property this test actually defends. PAN-52 D10(a) ratified the family as
   * a route that publishes at its first canonical child, and PAN-85 made
   * `rhodes` the first family to clear that bar.
   *
   * The gate is ASSERTED below rather than trusted, so deleting it fails this
   * test instead of silently turning the breadcrumb into an unconditional link.
   */
  const GATED_LINKER = join('app', '(shell)', 'product', '[slug]', 'page.tsx')

  for (const file of [...walk(join(FRONTEND, 'app')), ...walk(join(FRONTEND, 'components'))]) {
    if (file.includes(join('app', '(shell)', 'family'))) continue          // the route itself
    const rel = file.replace(FRONTEND, 'frontend')
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('/family/')) continue
      const isRedirect = /permanentRedirect\(|NextResponse\.redirect\(|familyRedirectTarget/.test(line)
      const isComment = /^\s*(\*|\/\/)/.test(line)
      if (isRedirect) redirectors.push(rel)
      else if (!isComment && !file.endsWith(GATED_LINKER)) linkers.push(`${rel}: ${line.trim()}`)
    }
  }

  assert.deepEqual(
    linkers,
    [],
    'an empty family must be absent from homepage, browse, navigation, sitemap and search',
  )

  // The one admitted linker, pinned on both sides of the seam.
  const productPage = readRepoFile('app/(shell)/product/[slug]/page.tsx')
  assert.match(
    productPage,
    /\{familyContext && \(/,
    'the family breadcrumb must be gated on familyContext, never rendered unconditionally',
  )
  const productApi = readRepoFile('app/api/product/[slug]/route.ts')
  assert.match(
    productApi,
    /familyView\.published/,
    'familyContext must be emitted only for a published family, so an empty one is never linked',
  )
  // And the redirect sources are exactly the legacy product surfaces.
  assert.deepEqual(
    [...new Set(redirectors)].sort(),
    [
      // Sorted, and PAN-131 reordered them: the gate moved into the `(shell)`
      // route group, and `(` sorts before `a`.
      'frontend/app/(shell)/product/[slug]/layout.tsx',
      'frontend/app/api/product/[slug]/route.ts',
    ],
  )
})

/**
 * PAN-56's one permitted hierarchy test (its test budget, and PAN-52 §13).
 *
 * It covers the single new primitive — the reverse lookup — and the two
 * properties the product page depends on: a product outside every family
 * resolves to nothing at all, and a sibling can carry no price evidence.
 */
test('hierarchy: familyForChild resolves a product to its family, and nothing else', () => {
  // Round-trip: every declared child resolves back to the family that declares
  // it. Built from NAVIGATION_FAMILIES rather than a second literal list, so
  // adding a family cannot leave this assertion describing the old set.
  for (const family of NAVIGATION_FAMILIES) {
    for (const child of family.children) {
      assert.equal(
        familyForChild(child)?.slug,
        family.slug,
        `${child} must resolve to ${family.slug}`,
      )
    }
  }

  // A PRODUCT WITH NO FAMILY. `roland-juno-106` is canonical and belongs to no
  // family, and this is the case the product page must handle by rendering
  // nothing — not an empty breadcrumb and not a heading with no links.
  assert.equal(familyForChild('roland-juno-106'), null)
  assert.equal(familyForChild('does-not-exist'), null)

  // A FAMILY SLUG IS NOT ITS OWN CHILD. `rhodes` names a family, so asking for
  // its family must not answer itself and create a cycle in the breadcrumb.
  assert.equal(familyForChild('rhodes'), null)

  // PRICE ISOLATION, STRUCTURALLY. What the product page receives as a sibling
  // is a RenderableChild, and it has exactly two keys — so no median, band,
  // sold population, verdict or listing count can travel from a sibling into
  // this product's evidence. Widening this shape is the way that rule is lost.
  const rhodes = getFamily('rhodes')!
  const rows: FamilyChildRow[] = rhodes.children.map((slug) => ({
    slug,
    canonical_name: slug.toUpperCase(),
    status: CANONICAL_STATUS,
    support_state: CANONICAL_SUPPORT,
    browse_visibility: CANONICAL_VISIBILITY,
    browse_domain: CANONICAL_DOMAIN,
  }))
  const view = buildFamilyView(rhodes, rows)
  assert.equal(view.published, true)
  for (const child of view.children) {
    assert.deepEqual(Object.keys(child).sort(), ['label', 'slug'])
  }

  // And the page excludes the product being viewed from its own sibling list.
  const viewing = rhodes.children[0]
  const siblings = view.children.filter((c) => c.slug !== viewing)
  assert.equal(siblings.length, view.children.length - 1)
  assert.equal(siblings.some((s) => s.slug === viewing), false)
})

test('navigation: the family route links only to /browse and to canonical children', () => {
  const page = readRepoFile('app/(shell)/family/[slug]/page.tsx')
  const hrefs = [...page.matchAll(/href=(?:\{`|["'])([^"'`]+)/g)].map((m) => m[1])
  assert.equal(hrefs.length > 0, true, 'expected at least one link')
  for (const href of hrefs) {
    const ok =
      href === '/browse' ||
      href === '/product/${child.slug}' ||
      // PAN-94. An aggregated listing links to the MODEL it is matched to, never
      // to the marketplace it came from. A family page that linked off-site
      // would send the visitor to a price with no verdict attached, which is
      // the opposite of what a family exists to say.
      href === '/product/${listing.childSlug}'
    assert.equal(ok, true, `unexpected outbound href on a family page: ${href}`)
  }
  // Every /product/ link is built from a RenderableChild — directly, or through
  // a listing whose `childSlug` is one — and a RenderableChild by construction
  // passed isCanonical(), so no rendered link can resolve to a 404.
  assert.match(page, /href=\{`\/product\/\$\{child\.slug\}`\}/)
  assert.match(page, /href=\{`\/product\/\$\{listing\.childSlug\}`\}/)
})

test('route-access: /family/[slug] is classified, reachable and no longer planned', () => {
  const rule = ROUTE_ACCESS.find((r) => r.route === '/family/[slug]')
  assert.ok(rule, '/family/[slug] must have a classification')
  assert.equal(rule!.access, 'public_page_data_gated')
  assert.equal(rule!.planned, undefined, 'the route now exists on disk')
  assert.equal(requiresAuth('/family/gibson-les-paul'), false)
})

/* ------------------------------------------------------------------ *
 * 7. Operator copy (acceptance tests 6 and 7)
 * ------------------------------------------------------------------ */

test('operator copy: the promotion API no longer claims tier drives monitoring', () => {
  const route = readRepoFile('app/api/admin/products/[id]/route.ts')
  for (const stale of [
    'implicit selector',
    'implicit scraper selector',
    'implicit query selector',
    'MONITORING EXPANDS',
    'MONITORING SHRINKS',
    'MONITORING_SELECTOR_TIERS',
    'SOURCES_SELECTING_ON_TIER',
  ]) {
    assert.equal(route.includes(stale), false, `stale monitoring copy: "${stale}"`)
  }
  assert.match(route, /MONITORING UNCHANGED: tier is not a scraper selector/)
  assert.match(route, /data\/klup-source-monitoring\.json/)
})

test('operator copy: the write path itself is untouched', () => {
  const route = readRepoFile('app/api/admin/products/[id]/route.ts')
  // Axis mapping, validation, intent requirement, dryRun and manifest keys are
  // WP-2-forbidden. Assert each is still exactly as WP-1 left it.
  assert.match(route, /tier:\s+'monitoring',/)
  assert.match(route, /const mustDeclare: Axis\[\] = \['visibility', 'monitoring', 'taxonomy', 'retail'\]/)
  assert.match(route, /const dryRun = req\.nextUrl\.searchParams\.get\('dryRun'\) === '1'/)
  assert.match(route, /error: 'undeclared_axis'/)
  assert.match(route, /error: 'inactive_product_cannot_be_supported'/)
  for (const key of ['axes_touched', 'axis_semantics', 'unchanged_axes', 'monitoring_boundary']) {
    assert.match(route, new RegExp(`${key}:`), key)
  }
})

test('operator copy: the admin UI declares an axis the API still requires', () => {
  const page = readRepoFile('app/admin/products/page.tsx')
  // Sending ['metadata'] would be rejected as undeclared_axis while FIELD_AXIS
  // maps tier -> 'monitoring', and that mapping is WP-2-forbidden. The token
  // stays; the operator-visible copy is corrected instead.
  assert.match(page, /intent: \['monitoring'\]/)
  assert.match(page, /ændrer ikke overvågning/)
  assert.match(page, /NOT change marketplace monitoring/)
})

test('vercel.json: untouched — the crons block survives and nothing was added', () => {
  // WP-2 makes NO change to this file. Removing the crons block would be a
  // deployment-affecting edit, and Stage 3 makes none; adding a comment to a
  // Vercel config is also a change to a deployment input, which is why the
  // warning WP-2 briefly carried here was withdrawn in cross-package review.
  // The cron's disabled state lives at Vercel project level, not in the repo.
  const parsed = JSON.parse(readRepoFile('vercel.json')) as Record<string, unknown>
  assert.deepEqual(Object.keys(parsed), ['crons'], 'no property may be added to vercel.json')
  assert.equal(Array.isArray(parsed.crons), true, 'the crons block must NOT be removed')
  assert.equal((parsed.crons as unknown[]).length, 1)
  assert.deepEqual((parsed.crons as Array<Record<string, unknown>>)[0], {
    path: '/api/cron/scrape',
    schedule: '*/10 * * * *',
  })
})
