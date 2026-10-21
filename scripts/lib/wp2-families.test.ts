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
import { FAMILY_CARD_MIN_CHILDREN } from '../../frontend/lib/family-cards'
import { cardVerdictsByProduct, type MatchWithListing } from '../../frontend/lib/listing-verdicts'
import { MIN_BAND_N } from '../../frontend/lib/price-populations'

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

/** The two Boss lines (PAN-141). Navigation-only, like `rhodes`. */
const BOSS_FAMILIES = ['boss-ce-chorus', 'boss-dm-delay', 'boss-ds-distortion']

/** PAN-159 Tier 1. The last two are guarded line-label rows; the rest have no row. */
const PAN159_FAMILIES = [
  'roland-juno',
  'roland-jupiter',
  'sequential-prophet',
  'roland-space-echo',
  'arp-2600-semi-modular',
  'fender-jazzmaster',
  'fender-jaguar',
]

/** PAN-198. A guarded line-label row, like `fender-jazzmaster`. */
const PAN198_FAMILIES = ['gibson-sg']

/** PAN-199. The `rhodes` case: no row. */
const PAN199_FAMILIES = ['moogerfooger']

/** PAN-230. The `rhodes` case: no row. Not `neumann-u87`, which is the vintage U 87's own priced page. */
const PAN230_FAMILIES = ['neumann-u87-condenser', 'universal-audio-1176']

/** PAN-261. The `rhodes` case: no row. Not `fender-blues-junior`, which is the original's own priced page. */
const PAN261_FAMILIES = ['fender-blues-junior-amp']

/** PAN-271. The `rhodes` case: no row. The three bells are the priced pages. */
const PAN271_FAMILIES = ['bach-stradivarius']

/** PAN-282. The `rhodes` case: no row. Not `ehx-memory-man`, which is the original non-deluxe's own priced page. */
const PAN282_FAMILIES = ['memory-man']

/** PAN-286. The `rhodes` case, three times: no row. The lettered / numbered rows are the priced pages. */
const PAN286_FAMILIES = ['fuzz-tone', 'echoplex', 'ventilator']

/** PAN-291. The `rhodes` case, four times: no row. The ASR, EPS, Mirage and DP rows are the priced pages. */
const PAN291_FAMILIES = ['ensoniq-asr-sampler', 'ensoniq-eps-sampler', 'ensoniq-mirage-sampler', 'ensoniq-dp-effects']

/** The six, plus `rhodes` (PAN-85) — the first family with canonical children — the Boss lines and `minimoog` (PAN-154). */
/** PAN-284 (owner, 2026-10-21). The `rhodes` case, all 27: eleven Roland lines, thirteen guitar models, three synths. */
const PAN284_FAMILIES = [
  'roland-tr', 'roland-sh', 'roland-jx', 'roland-cr', 'roland-mc', 'roland-jv', 'roland-xp', 'roland-jd', 'roland-fantom',
  'roland-sp-404-sampler', 'roland-jazz-chorus',
  'gibson-j-45-dreadnought', 'gibson-j-185-jumbo', 'gibson-j-35-acoustic', 'gibson-sj-200-jumbo', 'gibson-l-00-parlor',
  'gibson-lg-2-parlor', 'gibson-g-45-dreadnought', 'martin-d-18-dreadnought', 'martin-d-28-dreadnought',
  'martin-om-28-auditorium', 'guild-d-55-dreadnought', 'heritage-h-535-semi-hollow', 'soldano-slo-100-amp',
  'sequential-ob-6-synth', 'sequential-trigon-6-synth', 'oberheim-ob-x-synth',
]

const EXPECTED_FAMILIES = [...GUITAR_FAMILIES, 'rhodes', ...BOSS_FAMILIES, 'minimoog', 'mustang-short-scale-bass', ...PAN159_FAMILIES, ...PAN198_FAMILIES, ...PAN199_FAMILIES, ...PAN230_FAMILIES, ...PAN261_FAMILIES, ...PAN271_FAMILIES, ...PAN282_FAMILIES, ...PAN284_FAMILIES, ...PAN286_FAMILIES, ...PAN291_FAMILIES]

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
      // PAN-198: the Gibson series models.
      'gibson-les-paul-standard-50s-p-90',
      'gibson-les-paul-standard-50s-faded',
      'gibson-les-paul-standard-50s-double-trouble',
      'gibson-les-paul-standard-60s-faded',
      'gibson-les-paul-standard-60s-double-trouble',
      'gibson-les-paul-studio-session',
      'gibson-les-paul-studio-deluxe-ii',
      'gibson-les-paul-studio-double-trouble',
      'gibson-les-paul-special-tribute',
      'gibson-les-paul-double-cut-special',
      'gibson-les-paul-junior',
      'gibson-les-paul-junior-double-cut',
      'gibson-billie-joe-armstrong-les-paul-junior',
      'gibson-les-paul-custom-70s',
      'gibson-les-paul-classic',
      'gibson-les-paul-deluxe',
      'gibson-les-paul-70s-deluxe',
      'gibson-les-paul-modern',
      'gibson-les-paul-supreme',
      'gibson-les-paul-traditional',
      'gibson-les-paul-traditional-pro-ii',
      'gibson-les-paul-tribute',
      'gibson-les-paul-50s-tribute',
      'gibson-les-paul-52-tribute',
      'gibson-les-paul-60s-tribute',
      'gibson-les-paul-70s-tribute',
      'gibson-les-paul-future-tribute',
      'gibson-the-paul',
      'gibson-les-paul-the-paul-ii',
      'gibson-slash-les-paul-standard',
      'gibson-les-paul-paul-kossoff',
      'gibson-les-paul-paul-landers-signature',
      'gibson-custom-shop-les-paul-r0',
      'gibson-custom-shop-les-paul-r4',
      'gibson-custom-shop-les-paul-r6',
      'gibson-custom-shop-les-paul-r7',
      'gibson-custom-shop-les-paul-r8',
      'gibson-custom-shop-les-paul-r9',
      'gibson-custom-shop-1957-les-paul-custom-reissue',
      'gibson-custom-shop-1968-les-paul-custom-reissue',
      'gibson-custom-shop-1957-les-paul-junior-reissue',
      'gibson-custom-shop-1957-les-paul-special-single-cut-reissue',
      'gibson-custom-shop-1960-les-paul-special-double-cut-reissue',
      'gibson-custom-shop-les-paul-special-double-cut-figured',
    ],
    'fender-telecaster': [
      'fender-telecaster-thinline',
      'fender-telecaster-custom',
      'fender-american-vintage-52-telecaster',
      // PAN-159 Tier 0. Both supported + public, SELECT-verified 2026-09-28.
      'fender-american-standard-telecaster',
      'fender-american-ultra-ii-telecaster',
      // PAN-195: the Fender series models.
      'fender-player-ii-telecaster',
      'fender-player-ii-telecaster-hh',
      'fender-player-ii-modified-telecaster',
      'fender-player-ii-modified-telecaster-sh',
      'fender-player-plus-telecaster',
      'fender-player-plus-nashville-telecaster',
      'fender-vintera-ii-60s-telecaster',
      'fender-vintera-ii-60s-telecaster-thinline',
      'fender-vintera-ii-70s-telecaster-deluxe',
      'fender-vintera-ii-road-worn-60s-telecaster',
      'fender-vintera-iii-late-50s-telecaster',
      'fender-vintera-iii-mid-60s-telecaster',
      'fender-american-performer-telecaster',
      'fender-american-performer-telecaster-hum',
      'fender-american-professional-ii-telecaster',
      'fender-american-professional-ii-telecaster-deluxe',
      'fender-american-professional-ii-telecaster-thinline',
      'fender-american-professional-classic-telecaster',
      'fender-american-professional-classic-hotshot-telecaster',
      'fender-american-vintage-ii-1951-telecaster',
      'fender-american-vintage-ii-1963-telecaster',
      'fender-american-vintage-ii-1972-telecaster-thinline',
      'fender-american-vintage-ii-1975-telecaster-deluxe',
      'fender-american-vintage-ii-1977-telecaster-custom',
      'fender-american-ultra-telecaster',
      'fender-standard-telecaster',
    ],
    'fender-stratocaster': [
      'fender-american-professional-ii-stratocaster',
      // PAN-195: the Fender series models.
      'fender-player-ii-stratocaster',
      'fender-player-ii-stratocaster-hss',
      'fender-player-ii-modified-stratocaster',
      'fender-player-ii-modified-stratocaster-hss',
      'fender-player-ii-modified-stratocaster-hss-floyd-rose',
      'fender-player-plus-stratocaster',
      'fender-player-plus-stratocaster-hss',
      'fender-vintera-ii-50s-stratocaster',
      'fender-vintera-ii-60s-stratocaster',
      'fender-vintera-ii-70s-stratocaster',
      'fender-vintera-ii-road-worn-60s-stratocaster',
      'fender-vintera-iii-early-60s-stratocaster',
      'fender-vintera-iii-late-60s-stratocaster',
      'fender-vintera-iii-late-50s-stratocaster',
      'fender-american-performer-stratocaster',
      'fender-american-performer-stratocaster-hss',
      'fender-american-performer-timber-stratocaster',
      'fender-american-professional-ii-stratocaster-hss',
      'fender-american-professional-ii-stratocaster-thinline',
      'fender-american-professional-classic-stratocaster',
      'fender-american-professional-classic-stratocaster-hss',
      'fender-american-vintage-ii-1954-stratocaster',
      'fender-american-vintage-ii-1957-stratocaster',
      'fender-american-vintage-ii-1961-stratocaster',
      'fender-american-vintage-ii-1965-stratocaster',
      'fender-american-vintage-ii-1973-stratocaster',
      'fender-american-ultra-stratocaster',
      'fender-american-ultra-stratocaster-hss',
      'fender-american-ultra-ii-stratocaster',
      'fender-american-ultra-ii-stratocaster-hss',
      'fender-standard-stratocaster',
      'fender-standard-stratocaster-hss',
    ],
    'gibson-es-335': [
      'gibson-es-335-dot',
      // PAN-198: the Gibson series models.
      'gibson-es-335-block',
      'gibson-es-335-50s',
      'gibson-es-335-60s-block',
      'gibson-es-335-satin',
      'gibson-es-335-studio',
      'gibson-custom-shop-1959-es-335-reissue',
      'gibson-custom-shop-1961-es-335-reissue',
      'gibson-custom-shop-1963-es-335-block-reissue',
      'gibson-custom-shop-1964-es-335-reissue',
    ],
    // PAN-154: the only clean rows the KG holds, all `known` today.
    'fender-jazz-bass': [
      'fender-american-standard-jazz-bass',
      // PAN-195: the Fender series models.
      'fender-player-ii-jazz-bass',
      'fender-player-ii-modified-active-jazz-bass',
      'fender-player-ii-modified-active-jazz-bass-v',
      'fender-player-plus-jazz-bass',
      'fender-player-plus-jazz-bass-v',
      'fender-vintera-ii-60s-jazz-bass',
      'fender-vintera-iii-early-60s-jazz-bass',
      'fender-vintera-iii-early-70s-jazz-bass',
      'fender-american-performer-jazz-bass',
      'fender-american-professional-ii-jazz-bass',
      'fender-american-professional-ii-jazz-bass-v',
      'fender-american-professional-ii-jazz-bass-fretless',
      'fender-american-professional-classic-jazz-bass',
      'fender-american-vintage-ii-1966-jazz-bass',
      'fender-american-ultra-jazz-bass',
      'fender-american-ultra-jazz-bass-v',
      'fender-american-ultra-ii-jazz-bass',
      'fender-american-ultra-ii-jazz-bass-v',
      'fender-standard-jazz-bass',
    ],
    'fender-precision-bass': [
      'fender-american-standard-precision-bass',
      'fender-precision-bass-57-reissue',
      // PAN-195: the Fender series models.
      'fender-player-ii-precision-bass',
      'fender-player-ii-modified-active-precision-bass',
      'fender-player-plus-precision-bass',
      'fender-vintera-ii-50s-precision-bass',
      'fender-vintera-ii-60s-precision-bass',
      'fender-vintera-iii-late-60s-precision-bass',
      'fender-american-performer-precision-bass',
      'fender-american-professional-ii-precision-bass',
      'fender-american-professional-ii-precision-bass-v',
      'fender-american-professional-classic-precision-bass',
      'fender-american-vintage-ii-1954-precision-bass',
      'fender-american-vintage-ii-1960-precision-bass',
      'fender-american-ultra-precision-bass',
      'fender-american-ultra-ii-precision-bass',
      'fender-mexican-standard-precision-bass',
    ],
    // PAN-85. Not from §6.3: these four were SELECT-verified active+supported+
    // public+music on 2026-09-20, which is what makes them renderable at all.
    rhodes: [
      'rhodes-mark-i-stage-73',
      'rhodes-mark-i-suitcase-73',
      'rhodes-mark-ii-stage-73',
      'rhodes-mark-i-stage-88',
    ],
    // PAN-141. SELECT-verified active+supported+public+music on 2026-09-24.
    // The listing-title duplicates `boss-boss-boss-ce-3-…-1987` and
    // `boss-boss-ceb-3-bass-chorus` are never members.
    'boss-ce-chorus': ['boss-ce-1', 'boss-ce-2', 'boss-ce-2w', 'boss-ce-3', 'boss-ce-5'],
    'boss-dm-delay': ['boss-dm-2', 'boss-dm-2w'],
    // PAN-284. SELECT-verified active+supported+public+music on 2026-10-21.
    'boss-ds-distortion': ['boss-ds-1', 'boss-ds-1x', 'boss-ds-2'],
    // PAN-284. Supported rows of each line at any visibility, SELECT-verified
    // 2026-10-21. Not members: roland-sh-01-gaia (owner), the SH-201 / SH-32,
    // the SP-808, the two gibson-gibson-… slugs, gibson-j-55, the L-4C / L-7C
    // archtops, gibson-g-200-ec, martin-d-42-modern-deluxe, heritage-h-150.
    'roland-tr': [
      'roland-tr-606', 'roland-tr-626', 'roland-tr-707', 'roland-tr-727', 'roland-tr-808', 'roland-tr-909',
      'roland-tr-06', 'roland-tr-08', 'roland-tr-09', 'roland-tr-8s',
    ],
    'roland-sh': [
      'roland-sh-1000', 'roland-sh-2000', 'roland-sh-3a', 'roland-sh-5', 'roland-sh-7', 'roland-sh-1', 'roland-sh-09',
      'roland-sh-2', 'roland-sh-101', 'roland-sh-01a',
    ],
    'roland-jx': ['roland-jx-3p', 'roland-jx-8p', 'roland-jx-10', 'roland-jx-1', 'roland-jx-305', 'roland-jx-03', 'roland-jx-08'],
    'roland-cr': ['roland-cr-68', 'roland-cr-78', 'roland-cr-8000'],
    'roland-mc': ['roland-mc-202', 'roland-mc-303', 'roland-mc-307', 'roland-mc-505', 'roland-mc-09', 'roland-mc-808', 'roland-mc-909'],
    'roland-jv': ['roland-jv-30', 'roland-jv-880', 'roland-jv-90', 'roland-jv-1000', 'roland-jv-1010', 'roland-jv-1080', 'roland-jv-2080'],
    'roland-xp': ['roland-xp-10', 'roland-xp-30', 'roland-xp-50', 'roland-xp-60', 'roland-xp-80'],
    'roland-jd': ['roland-jd-800', 'roland-jd-990', 'roland-jd-xa', 'roland-jd-08'],
    'roland-fantom': ['roland-fantom-s', 'roland-fantom-x6', 'roland-fantom-x8', 'roland-fantom-xa'],
    'roland-sp-404-sampler': ['roland-sp-404', 'roland-sp-404sx', 'roland-sp-404a', 'roland-sp-404-mkii'],
    'roland-jazz-chorus': ['roland-jc-120', 'roland-jc-120h', 'roland-jc-85', 'roland-jc-22'],
    'gibson-j-45-dreadnought': [
      'gibson-j-45', 'gibson-j-45-special', 'gibson-j-45-standard-rosewood', 'gibson-j-45-studio-rosewood',
      'gibson-j-45-studio-walnut', 'gibson-j-45-century-12-fret', 'gibson-j-45-standard-12-string',
    ],
    'gibson-j-185-jumbo': ['gibson-j-185', 'gibson-j-185-original', 'gibson-j-185-century-12-fret'],
    'gibson-j-35-acoustic': ['gibson-j-35', 'gibson-j-35-30s-faded'],
    'gibson-sj-200-jumbo': [
      'gibson-sj-200-standard', 'gibson-sj-200-standard-rosewood', 'gibson-sj-200-original', 'gibson-sj-200-60s-original',
      'gibson-sj-200-studio-rosewood', 'gibson-sj-200-studio-walnut', 'gibson-sj-200-western-classic',
      'gibson-sj-200-orianthi-signature',
    ],
    'gibson-l-00-parlor': ['gibson-l-00-standard', 'gibson-l-00-century-12-fret', 'gibson-l-00-original'],
    'gibson-lg-2-parlor': ['gibson-lg-2', 'gibson-lg-2-3-4', 'gibson-lg-2-all-mahogany-faded', 'gibson-lg-2-american-eagle'],
    'gibson-g-45-dreadnought': ['gibson-g-45', 'gibson-g-45-studio'],
    'martin-d-18-dreadnought': ['martin-d-18', 'martin-d-18-satin', 'martin-d-18-authentic-1937', 'martin-d-18-molly-tuttle'],
    'martin-d-28-dreadnought': ['martin-d-28', 'martin-d-28-satin', 'martin-d-28-modern-deluxe', 'martin-d-28-authentic-1937', 'martin-d-28-billy-strings'],
    'martin-om-28-auditorium': ['martin-om-28', 'martin-om-28-modern-deluxe'],
    'guild-d-55-dreadnought': ['guild-d-55', 'guild-d-55e'],
    'heritage-h-535-semi-hollow': ['heritage-h-535', 'heritage-h-535-artisan-aged', 'heritage-custom-shop-core-h-535'],
    'soldano-slo-100-amp': ['soldano-slo-100', 'soldano-slo-100-custom-shop'],
    'sequential-ob-6-synth': ['sequential-ob-6', 'sequential-ob-6-desktop'],
    'sequential-trigon-6-synth': ['sequential-trigon-6', 'sequential-trigon-6-desktop'],
    'oberheim-ob-x-synth': ['oberheim-ob-x', 'oberheim-ob-xa'],
    // PAN-154. The existing clean rows, SELECT-verified active on 2026-09-26;
    // only `moog-minimoog` is canonical today. The duplicates
    // `moog-minimoog-model-d` and `moog-minimoog-model-d-reissue` are never
    // members.
    minimoog: [
      'moog-minimoog',
      'moog-model-d',
      'moog-minimoog-model-d-geddy-lee',
      'moog-minimoog-voyager',
      'moog-minimoog-voyager-xl',
      'moog-minimoog-voyager-rme',
      // PAN-199: the 2022– re-run and the Voyager Old School.
      'moog-minimoog-model-d-2022',
      'moog-minimoog-voyager-old-school',
    ],
    // PAN-154 (2/2). The base member is the only clean Mustang row.
    'mustang-short-scale-bass': [
      'fender-mustang-bass',
      // PAN-195: the Fender series models.
      'fender-vintera-ii-70s-competition-mustang-bass',
      'fender-american-performer-mustang-bass',
      'fender-american-professional-classic-mustang-bass',
    ],
    // PAN-159 Tier 1. Existing clean rows, SELECT-verified active 2026-09-28.
    // Duplicates (`roland-juno-ds61`, `roland-jp-4/6/8`), clones and sub-brand
    // rows are never members.
    'roland-juno': [
      'roland-juno-6',
      'roland-juno-60',
      'roland-juno-106',
      // PAN-200: the Juno-106S, the Boutique JU-06/JU-06A, the Juno-X and the JUNO-D6/D7/D8.
      'roland-juno-106s',
      'roland-alpha-juno-1',
      'roland-alpha-juno-2',
      'roland-juno-d',
      'roland-juno-g',
      'roland-juno-stage',
      'roland-juno-di',
      'roland-juno-ds-61',
      'roland-ju-06',
      'roland-ju-06a',
      'roland-juno-x',
      'roland-juno-d6',
      'roland-juno-d7',
      'roland-juno-d8',
    ],
    'roland-jupiter': [
      'roland-jupiter-4',
      'roland-jupiter-8',
      'roland-jupiter-6',
      'roland-jupiter-80',
      // PAN-200: the Jupiter-50 and the Boutique JP-08.
      'roland-jupiter-50',
      'roland-jp-08',
      'roland-jupiter-xm',
    ],
    'sequential-prophet': [
      'sequential-circuits-prophet-5',
      'sequential-circuits-prophet-10',
      'sequential-circuits-prophet-600',
      'sequential-circuits-prophet-t8',
      'sequential-circuits-prophet-vs',
      'dave-smith-instruments-prophet-08',
      'sequential-prophet-6',
      'sequential-prophet-rev2',
      'sequential-prophet-5',
      'sequential-prophet-10',
      // PAN-221: the desktop modules and the Prophet X.
      'sequential-prophet-5-desktop',
      'sequential-prophet-6-desktop',
      'sequential-prophet-10-desktop',
      'sequential-prophet-x',
    ],
    // PAN-200: the RE-301, RE-150 and SRE-555.
    'roland-space-echo': ['roland-re-201', 'roland-re-301', 'roland-re-150', 'roland-re-501', 'roland-sre-555'],
    'arp-2600-semi-modular': ['arp-2600', 'arp-korg-arp-2600'],
    'fender-jazzmaster': [
      'fender-jim-root-jazzmaster',
      'fender-jim-root-v4-jazzmaster',
      'fender-troy-van-leeuwen-jazzmaster',
      'fender-american-vintage-ii-jazzmaster',
      // PAN-195: the Fender series models.
      'fender-player-ii-jazzmaster',
      'fender-vintera-ii-50s-jazzmaster',
      'fender-vintera-iii-mid-60s-jazzmaster',
      'fender-american-performer-jazzmaster',
      'fender-american-professional-ii-jazzmaster',
      'fender-american-professional-classic-jazzmaster',
      'fender-american-ultra-jazzmaster',
    ],
    'fender-jaguar': [
      'fender-johnny-marr-jaguar',
      'fender-kurt-cobain-jaguar',
      // PAN-195: the Fender series models.
      'fender-player-ii-jaguar',
      'fender-vintera-ii-70s-jaguar',
      'fender-vintera-iii-mid-60s-jaguar',
      'fender-american-professional-classic-jaguar',
    ],
    'gibson-sg': [
      'gibson-sg-standard',
      'gibson-sg-standard-61',
      'gibson-sg-standard-61-faded',
      'gibson-sg-standard-large-guard-with-maestro-vibrola',
      'gibson-sg-61-reissue',
      'gibson-custom-shop-1961-les-paul-sg-standard-reissue',
      'gibson-sg-special',
      'gibson-sg-special-faded',
      'gibson-custom-shop-1963-sg-special-reissue',
      'gibson-sg-supreme',
      'gibson-sg-modern',
    ],
    // PAN-199. Every Moogerfooger row with a verified Reverb CSP.
    moogerfooger: [
      'moog-mf-101-lowpass-filter',
      'moog-mf-102',
      'moog-mf-103',
      'moog-mf-104',
      'moog-mf-104m',
      'moog-mf-104z',
      'moog-mf-105',
      'moog-mf-105m-midi-murf',
      'moog-cp-251',
    ],
    // PAN-230. The vintage U 87 and the U 87 Ai: two priced models, one navigation concept.
    'neumann-u87-condenser': ['neumann-u87', 'neumann-u87ai'],
    // PAN-230 (2026-10-04). The vintage Urei 1176LN and the UA reissue: two priced models, one navigation concept.
    'universal-audio-1176': ['ua-1176ln', 'universal-audio-urei-1176ln'],
    // PAN-261 (2026-10-14). The Blues Junior, III and IV: three priced models, one navigation concept.
    'fender-blues-junior-amp': ['fender-blues-junior', 'fender-blues-junior-iii', 'fender-blues-junior-iv'],
    // PAN-271 (2026-10-19). The 37, 43 and 72 bells: three priced models, one navigation concept.
    'bach-stradivarius': ['bach-stradivarius-37', 'bach-stradivarius-43', 'bach-stradivarius-72'],
    // PAN-282 (2026-10-21). Nine priced models, one navigation concept; the Memory Boy and Toy are outside it.
    'memory-man': [
      'ehx-deluxe-memory-man-vintage', 'ehx-memory-man', 'ehx-deluxe-memory-man-reissue', 'ehx-deluxe-memory-man-tap-tempo',
      'ehx-memory-man-stereo-hazarai', 'ehx-deluxe-memory-man-xo', 'ehx-deluxe-memory-man-1100-tt', 'ehx-deluxe-memory-man-550-tt',
      'ehx-memory-man-nano',
    ],
    // PAN-286 (2026-10-21). Three lines whose word sellers write; the lettered / numbered rows are the priced pages.
    'fuzz-tone': ['maestro-fuzz-tone-fz-1', 'maestro-fuzz-tone-fz-1a-fz-1b', 'maestro-fuzz-tone-fz-1s'],
    'echoplex': ['maestro-echoplex-ep-1', 'maestro-echoplex-ep-2', 'maestro-echoplex-ep-3', 'maestro-echoplex-ep-4'],
    'ventilator': ['neo-instruments-ventilator', 'neo-instruments-ventilator-ii', 'neo-instruments-mini-vent', 'neo-instruments-micro-vent'],
    // PAN-291 (2026-10-21). Four Ensoniq lines whose word sellers write; the coded rows are the priced pages.
    'ensoniq-asr-sampler': ['ensoniq-asr-10', 'ensoniq-asr-x', 'ensoniq-asr-x-pro'],
    'ensoniq-eps-sampler': ['ensoniq-eps', 'ensoniq-eps-16-plus', 'ensoniq-eps-16-plus-rack'],
    'ensoniq-mirage-sampler': ['ensoniq-mirage-dsk-8', 'ensoniq-mirage-dsk-1', 'ensoniq-mirage-dms-8'],
    'ensoniq-dp-effects': ['ensoniq-dp-4', 'ensoniq-dp-4-plus', 'ensoniq-dp-2'],
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
  // The Boss lines (PAN-141), `minimoog` and `mustang-short-scale-bass`
  // (PAN-154) are the same case as `rhodes`. So are five of PAN-159's seven;
  // `fender-jazzmaster` and `fender-jaguar` are rows, but `known` + `qa_only`,
  // so their /product URLs 404ed before and 308 now: no priced page moves.
  assert.equal(GUITAR_FAMILIES.length, 6)
  // `gibson-sg` (PAN-198) is the Jazzmaster case: a `known` + `qa_only` row.
  // `moogerfooger` (PAN-199), `neumann-u87-condenser` and `universal-audio-1176`
  // (PAN-230), `fender-blues-junior-amp` (PAN-261), `bach-stradivarius` (PAN-271), `memory-man` (PAN-282) and
  // `fuzz-tone` / `echoplex` / `ventilator` (PAN-286) are the `rhodes` case: no row. So are `boss-ds-distortion`
  // and the 27 prefix families (PAN-284), and the four Ensoniq lines (PAN-291).
  assert.equal(EXPECTED_FAMILIES.length, 60)
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
  // No asking price, band, median or sold population may cross the family
  // boundary inside a listing. Widening this shape is the way the rule is
  // lost, so the shape is pinned exactly and every key must also be checked
  // for MEANING: this assertion used to be a count ("five keys and no
  // sixth"), and a count cannot tell a price from a photo.
  //
  // `imageUrl` is the sixth key. It carries the seller's photo, which is
  // provenance in the same class as `source` — it states no price, implies no
  // band and settles no verdict, and /product/[slug] and /search already
  // publish it for these same rows. The two assertions below are what the
  // count was standing in for, now stated directly.
  //
  // `verdict` is the seventh (PAN-272, owner decision 2026-10-19): the word
  // the listing's OWN CHILD's page would show for it, or null. It is checked
  // for meaning below the key scan — a word, a basis label key and a small
  // sample count, never a number a price could hide in — and the PAN-272 test
  // further down pins that it is never built from two children's rows.
  const priceShaped = /price|band|median|aggregate|count|currency|msrp/i
  for (const listing of view.listings) {
    assert.deepEqual(
      Object.keys(listing).sort(),
      ['childLabel', 'childSlug', 'id', 'imageUrl', 'source', 'title', 'verdict'],
    )
    for (const key of Object.keys(listing)) {
      assert.equal(priceShaped.test(key), false, key)
    }
    // No verdicts were passed in, so none is attached.
    assert.equal(listing.verdict, null)
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

/**
 * PAN-272 (owner decision 2026-10-19). A family page's card may say "under /
 * typisk / over" — measured against the band of the CHILD the listing is
 * attributed to, the way that child's product page measures it. The family
 * itself still has no band. Pinned four ways on one fixture:
 *
 *   1. the verdict is a word plus how to qualify it, and nothing numeric a
 *      price could travel in;
 *   2. two children's prices never meet: a child with too few rows yields
 *      null even when the other child's rows would make a band for it;
 *   3. a listing matched to two children takes the verdict of the child it is
 *      SHOWN under (first in reviewed order), never the other's;
 *   4. a truncated read builds no band, so every card is unbadged rather
 *      than badged from a fragment.
 */
test('PAN-272: a listing’s verdict is its own child’s, and no family band exists', () => {
  const family = getFamily('rhodes')!
  const [first, second] = family.children
  const rows: FamilyChildRow[] = [
    { ...canonicalRow(first, 'Rhodes Mark I Stage 73'), id: 'id-1' },
    { ...canonicalRow(second, 'Rhodes Mark I Suitcase 73'), id: 'id-2' },
  ]
  const dk = (id: string, price: number, extra: Partial<MatchWithListing['listings'] & object> = {}) => ({
    id, title: `Rhodes ${id}`, url: `https://dba.dk/${id}`, source: 'dba.dk', country: 'DK',
    price, price_dkk: price, is_active: true, scraped_at: '2026-10-19T00:00:00Z', ...extra,
  })
  // The first child: eight reviewed Danish prices, 10,000–10,700 — a band.
  const evidence = Array.from({ length: MIN_BAND_N }, (_, i) => ({
    product_id: 'id-1', is_valid: true, listings: dk(`E${i}`, 10000 + i * 100),
  }))
  const matches = [
    ...evidence,
    // Unreviewed rows on the first child's wall: badged (PAN-268 A), not counted.
    { product_id: 'id-1', is_valid: null, listings: dk('L-under', 8000) },
    { product_id: 'id-1', is_valid: null, listings: dk('L-typical', 10300) },
    { product_id: 'id-1', is_valid: null, listings: dk('L-over', 20000) },
    // The second child: two reviewed rows, no band of its own.
    { product_id: 'id-2', is_valid: true, listings: dk('S1', 10100) },
    { product_id: 'id-2', is_valid: true, listings: dk('S2', 10200) },
    { product_id: 'id-2', is_valid: null, listings: dk('L-second', 8000) },
    // One listing matched to BOTH children.
    { product_id: 'id-1', is_valid: null, listings: dk('L-both', 8000) },
    { product_id: 'id-2', is_valid: null, listings: dk('L-both', 8000) },
    // A rejection: never on the wall, never judged.
    { product_id: 'id-1', is_valid: false, listings: dk('L-rejected', 8000) },
  ]

  const verdicts = cardVerdictsByProduct(matches)
  const firstChild = verdicts.get('id-1')!
  assert.equal(firstChild.get('L-under')?.verdict, 'under')
  assert.equal(firstChild.get('L-typical')?.verdict, 'typical')
  assert.equal(firstChild.get('L-over')?.verdict, 'over')
  assert.equal(firstChild.has('L-rejected'), false)
  // (1) A word, how to qualify it, and nothing else.
  for (const v of firstChild.values()) {
    assert.deepEqual(Object.keys(v).sort(), ['basisLabelKey', 'fewN', 'verdict'])
    assert.ok(['under', 'typical', 'over'].includes(v.verdict))
    assert.equal(v.fewN, null, 'eight observations is a band, not a small sample')
  }
  // (2) Never pooled. Ten Danish prices sit across the two children; the
  // second has two, so its listing gets no verdict — a family band would have
  // called 8,000 "under".
  assert.equal(verdicts.get('id-2')!.has('L-second'), false)
  assert.equal(verdicts.get('id-2')!.has('L-both'), false)

  // (3) Through buildFamilyView the shared listing is attributed to the first
  // child and judged by it; the second child's listing carries null.
  const listingRows: FamilyListingRow[] = matches
    .filter((m) => m.is_valid !== false)
    .map((m) => ({ product_id: m.product_id, is_valid: m.is_valid, listings: { id: m.listings.id, title: m.listings.title, source: 'dba.dk', is_active: true } }))
  const view = buildFamilyView(family, rows, listingRows, verdicts)
  const byId = new Map(view.listings.map((l) => [l.id, l]))
  assert.equal(byId.get('L-both')!.childSlug, first)
  // The basis key names the listing's OWN market (the badge's tooltip); only a
  // borrowed Reverb basis is spelled out on the badge (PAN-268 C).
  assert.deepEqual(byId.get('L-both')!.verdict, { verdict: 'under', basisLabelKey: 'verdictBasisDk', fewN: null })
  assert.deepEqual(byId.get('L-under')!.verdict, { verdict: 'under', basisLabelKey: 'verdictBasisDk', fewN: null })
  assert.equal(byId.get('L-second')!.childSlug, second)
  assert.equal(byId.get('L-second')!.verdict, null)
  // The evidence rows are listings too, and are judged like any other.
  assert.equal(byId.get('E0')!.verdict?.verdict, 'under')
  // The reverse attribution never happens: a listing shown under the second
  // child is not judged by the first child's band.
  const reversed = buildFamilyView({ ...family, children: [second, first] }, rows, listingRows, verdicts)
  const both = reversed.listings.find((l) => l.id === 'L-both')!
  assert.equal(both.childSlug, second)
  assert.equal(both.verdict, null)

  // (4) An incomplete read builds nothing.
  const truncated = cardVerdictsByProduct(matches, { incomplete: true })
  assert.equal(truncated.get('id-1')!.size, 0)
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
  // PAN-154 gave the two bass families, this test's former examples, their
  // first members. The property is about an empty family, so it is held here.
  const family = { ...getFamily('fender-jazz-bass')!, children: [] }
  assert.equal(buildFamilyView(family, [canonicalRow('anything')]).published, false)
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

  // It reads exactly four tables: two for eligibility, one for the listings,
  // and (PAN-130) the browse root that names the category crumb.
  const tables = [...page.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]).sort()
  assert.deepEqual(tables, ['browse_product_projection', 'kg_category', 'kg_product', 'listing_product_match'])

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

  /**
   * PAN-192 (owner decision 2026-09-30) admits the SECOND linker, deliberately:
   * the browse grids and home shelves now show a family card in place of its
   * models. It is gated the same way the breadcrumb is — never on a family, only
   * on the rows a public grid already renders — and the gate is pinned below:
   * a card exists only where `collapseFamilies` found two members of one family
   * in that set, and every member of a public set is canonical, so the family
   * it links to has at least two canonical children and is published.
   */
  const FAMILY_CARD_LINKER = join('components', 'FamilyCard.tsx')

  /**
   * PAN-288 admits the THIRD: /sitemap.xml lists a family only when
   * `buildFamilyView` over the canonical rows says `published` — the one
   * threshold `noindex` turns on (see "indexability" above). Pinned below.
   */
  const SITEMAP_LINKER = join('app', 'sitemap.ts')

  for (const file of [...walk(join(FRONTEND, 'app')), ...walk(join(FRONTEND, 'components'))]) {
    if (file.includes(join('app', '(shell)', 'family'))) continue          // the route itself
    const rel = file.replace(FRONTEND, 'frontend')
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('/family/')) continue
      const isRedirect = /permanentRedirect\(|NextResponse\.redirect\(|familyRedirectTarget/.test(line)
      const isComment = /^\s*(\*|\/\/)/.test(line)
      // PAN-192: SideNav READS `/family/` to mark Katalog as the section. A
      // path test is not a link, so it cannot list anything.
      const isPathTest = /\bpathname\.startsWith\('\/family\/'\)/.test(line)
      if (isPathTest) continue
      if (isRedirect) redirectors.push(rel)
      else if (
        !isComment &&
        !file.endsWith(GATED_LINKER) &&
        !file.endsWith(FAMILY_CARD_LINKER) &&
        !file.endsWith(SITEMAP_LINKER)
      ) {
        linkers.push(`${rel}: ${line.trim()}`)
      }
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
  // PAN-288's linker, pinned: the sitemap's family entries are filtered on the
  // view's own `published`, never on a count of their own.
  assert.match(
    readRepoFile('app/sitemap.ts'),
    /\.filter\(\(family\) => buildFamilyView\(family, rows\)\.published\)/,
    'the sitemap must list a family only when buildFamilyView publishes it',
  )
  // PAN-192's linker, pinned: a card needs more members than a family needs
  // canonical children to publish, and it is mounted only from the collapse,
  // on the surfaces whose rows are the public catalogue (PAN-289 added the
  // brand page, which serves the same browse rows).
  assert.equal(FAMILY_CARD_MIN_CHILDREN >= Math.max(2, FAMILY_MIN_CANONICAL_CHILDREN), true)
  const mounts = [...walk(join(FRONTEND, 'app')), ...walk(join(FRONTEND, 'components'))]
    .filter((file) => readFileSync(file, 'utf8').includes('<FamilyCard'))
    .map((file) => file.replace(FRONTEND, 'frontend'))
    .sort()
  assert.deepEqual(mounts, [
    'frontend/app/(shell)/brand/[brand]/page.tsx',
    'frontend/app/(shell)/browse/[root]/page.tsx',
    'frontend/components/DiscoverShelves.tsx',
  ])
  for (const mount of mounts) {
    assert.match(
      readFileSync(join(FRONTEND, '..', mount), 'utf8'),
      /collapseFamilies\(/,
      `${mount} must build family cards with collapseFamilies, never by hand`,
    )
  }

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

  // A PRODUCT WITH NO FAMILY. `roland-tr-808` is canonical and belongs to no
  // family, and this is the case the product page must handle by rendering
  // nothing — not an empty breadcrumb and not a heading with no links.
  // (`roland-juno-106` stood here until PAN-159 made it a `roland-juno` member,
  // and `roland-tr-808` until PAN-284 made it a `roland-tr` member.)
  assert.equal(familyForChild('korg-ms-20'), null)
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

test('navigation: the family route links only to /browse, its browse root and canonical children', () => {
  // PAN-272: the listing row is `FamilyListingCard`, so its link is read there.
  const page = readRepoFile('app/(shell)/family/[slug]/page.tsx') + readRepoFile('components/FamilyListingCard.tsx')
  const hrefs = [...page.matchAll(/href=(?:\{`|["'])([^"'`]+)/g)].map((m) => m[1])
  assert.equal(hrefs.length > 0, true, 'expected at least one link')
  for (const href of hrefs) {
    const ok =
      href === '/browse' ||
      // PAN-130. The family's own browse root, resolved from `categoryRoot`.
      href === '/browse/${category.slug}' ||
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

test('PAN-130: a family crumbs its own categoryRoot; a product never takes its category through its family', () => {
  // PAN-52 §6 grants `categoryRoot` exactly one job — placing the FAMILY under
  // a browse root — so the family page is where it is read.
  const family = readRepoFile('app/(shell)/family/[slug]/page.tsx')
  assert.match(family, /loadCategoryCrumb\(family\.categoryRoot\)/)

  // The other half of §6: no product surface reaches a category via the family.
  const product = readRepoFile('app/(shell)/product/[slug]/page.tsx')
  const productApi = readRepoFile('app/api/product/[slug]/route.ts')
  assert.equal(product.includes('categoryRoot'), false, 'product page must not read family.categoryRoot')
  assert.equal(productApi.includes('categoryRoot'), false, 'product API must not read family.categoryRoot')

  // Both trails keep exactly one current crumb: `BreadcrumbItem` without
  // `href` is the one that carries aria-current="page".
  for (const [name, source] of [['family', family], ['product', product]] as const) {
    const items = [...source.matchAll(/<BreadcrumbItem(\s[^>]*)?>/g)]
    const current = items.filter((m) => !/\bhref=/.test(m[1] ?? ''))
    assert.equal(current.length, 1, `${name} breadcrumb must have exactly one current crumb`)
  }
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

test('vercel.json: the crons block survives and only the approved region was added', () => {
  // WP-2 makes NO change to this file. Removing the crons block would be a
  // deployment-affecting edit, and Stage 3 makes none; adding a comment to a
  // Vercel config is also a change to a deployment input, which is why the
  // warning WP-2 briefly carried here was withdrawn in cross-package review.
  // The cron's disabled state lives at Vercel project level, not in the repo.
  // PAN-167 (owner-approved) pins functions to dub1, next to Supabase eu-west-1.
  const parsed = JSON.parse(readRepoFile('vercel.json')) as Record<string, unknown>
  assert.deepEqual(Object.keys(parsed), ['regions', 'crons'], 'no other property may be added to vercel.json')
  assert.deepEqual(parsed.regions, ['dub1'])
  assert.equal(Array.isArray(parsed.crons), true, 'the crons block must NOT be removed')
  assert.equal((parsed.crons as unknown[]).length, 1)
  assert.deepEqual((parsed.crons as Array<Record<string, unknown>>)[0], {
    path: '/api/cron/scrape',
    schedule: '*/10 * * * *',
  })
})
