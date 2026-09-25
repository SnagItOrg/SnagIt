/**
 * The supported cohort as `productEntity()` reads it — a TEST SNAPSHOT.
 *
 * PAN-147. The search suites used to read their product list out of the
 * committed `frontend/data/klup-search-index.json`. That file is gone: the
 * resolver reads the live supported set instead. They now build their index
 * from these rows, through the same `productEntity()` and `buildSearchIndex()`
 * the resolve route uses, so they exercise the real derivation of labels and
 * alias keys rather than a copy of its output.
 *
 * Captured read-only on 2026-09-25 (SELECT on `kg_product`, active +
 * supported, all music): 88 rows, whose entities equal the index PAN-143
 * regenerated. Only the columns `productEntity()` reads are kept.
 *
 * A SNAPSHOT, NOT A MIRROR. It does not have to follow production, any more
 * than `PUBLIC_COHORT` in wp4-search.test.ts does. Production is the business
 * of the credentialled live test in that suite. Change a row here only when a
 * test needs a different catalogue.
 */

import {
  buildSearchIndex,
  productEntity,
  type SearchIndex,
  type SearchProductRow,
} from '../../../frontend/lib/search-index'
import type { NavigationFamily } from '../../../frontend/lib/families'

export const SUPPORTED_PRODUCT_ROWS: readonly SearchProductRow[] = [
  { slug: 'ampex-atr-700', canonical_name: 'Ampex ATR-700', model_name: 'ATR-700', era: null, year_released: null, kg_brand: { name: 'Ampex' } },
  { slug: 'arp-2600', canonical_name: 'ARP 2600', model_name: 'ARP 2600', era: '1971-1980', year_released: null, kg_brand: { name: 'Arp' } },
  { slug: 'arp-korg-arp-2600', canonical_name: 'Korg ARP 2600', model_name: null, era: null, year_released: null, kg_brand: { name: 'Arp' } },
  { slug: 'boss-ab-2', canonical_name: 'Boss AB-2', model_name: 'AB-2', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-aw-3', canonical_name: 'Boss AW-3', model_name: 'AW-3', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-bd-2', canonical_name: 'Boss BD-2', model_name: 'BD-2', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-bf-1', canonical_name: 'Boss BF-1', model_name: 'BF-1', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ce-1', canonical_name: 'Boss CE-1', model_name: 'CE-1', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ce-2', canonical_name: 'Boss CE-2', model_name: 'CE-2', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ce-2w', canonical_name: 'Boss CE-2W', model_name: 'CE-2W', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ce-3', canonical_name: 'Boss CE-3', model_name: 'CE-3', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ce-5', canonical_name: 'Boss CE-5', model_name: 'CE-5', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ceb-3', canonical_name: 'Boss CEB-3', model_name: 'CEB-3', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-cs-3', canonical_name: 'Boss CS-3', model_name: 'CS-3', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-dm-2', canonical_name: 'Boss DM-2', model_name: 'DM-2', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-dm-2w', canonical_name: 'Boss DM-2W', model_name: 'DM-2W', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-dr-110-dr-rhythm', canonical_name: 'BOSS DR-110 Dr. Rhythm', model_name: null, era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-dr-202-dr-groove', canonical_name: 'BOSS DR-202 Dr. Groove', model_name: null, era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-dr-220-dr-rhythm', canonical_name: 'BOSS DR-220 Dr. Rhythm', model_name: null, era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-dr-55-dr-rhythm', canonical_name: 'BOSS DR-55 Dr. Rhythm', model_name: null, era: '1980', year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ds-1', canonical_name: 'Boss DS-1', model_name: 'DS-1', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ds-1x', canonical_name: 'Boss DS-1X', model_name: 'DS-1X', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-ds-2', canonical_name: 'Boss DS-2', model_name: 'DS-2', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-eq-200', canonical_name: 'Boss EQ-200', model_name: 'EQ-200', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'boss-es-5', canonical_name: 'Boss ES-5', model_name: 'ES-5', era: null, year_released: null, kg_brand: { name: 'Boss' } },
  { slug: 'emu-sp-1200', canonical_name: 'E-mu SP-1200', model_name: 'SP-1200', era: '1987', year_released: null, kg_brand: { name: 'E Mu' } },
  { slug: 'fender-american-professional-ii-stratocaster', canonical_name: 'Fender American Professional II Stratocaster', model_name: 'American Professional II Stratocaster', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-american-standard-telecaster', canonical_name: 'Fender American Standard Telecaster', model_name: 'American Standard Telecaster', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-american-ultra-ii-telecaster', canonical_name: 'Fender American Ultra II Telecaster', model_name: 'American Ultra II Telecaster', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-american-vintage-52-telecaster', canonical_name: 'Fender American Vintage \'52 Telecaster', model_name: 'American Vintage \'52 Telecaster', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-jim-root-jazzmaster', canonical_name: 'Fender Jim Root Jazzmaster', model_name: 'Jim Root Jazzmaster', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-mustang-bass', canonical_name: 'Fender Mustang Bass', model_name: 'Mustang Bass', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-telecaster-custom', canonical_name: 'Fender Telecaster Custom', model_name: 'Telecaster Custom', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'fender-telecaster-thinline', canonical_name: 'Fender Telecaster Thinline', model_name: 'Telecaster Thinline', era: null, year_released: null, kg_brand: { name: 'Fender' } },
  { slug: 'gibson-es-335-dot', canonical_name: 'Gibson ES-335 Dot', model_name: 'ES-335 Dot', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-hummingbird', canonical_name: 'Gibson Hummingbird', model_name: 'Hummingbird', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-j-45', canonical_name: 'Gibson J-45', model_name: 'J-45', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-les-paul-custom', canonical_name: 'Gibson Les Paul Custom', model_name: 'Les Paul Custom', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-les-paul-special', canonical_name: 'Gibson Les Paul Special', model_name: 'Les Paul Special', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-les-paul-standard-50s', canonical_name: 'Gibson Les Paul Standard \'50s', model_name: 'Les Paul Standard \'50s', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-les-paul-standard-60s', canonical_name: 'Gibson Les Paul Standard \'60s', model_name: 'Les Paul Standard \'60s', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-les-paul-studio', canonical_name: 'Gibson Les Paul Studio', model_name: 'Les Paul Studio', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-sg-standard-large-guard-with-maestro-vibrola', canonical_name: 'Gibson SG Standard "Large Guard" with Maestro Vibrola', model_name: 'SG Standard "Large Guard" with Maestro Vibrola', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'gibson-sj-200-original', canonical_name: 'Gibson SJ-200 Original', model_name: 'SJ-200 Original', era: null, year_released: null, kg_brand: { name: 'Gibson' } },
  { slug: 'korg-mono-poly', canonical_name: 'Korg MONO/POLY', model_name: 'MONO/POLY', era: null, year_released: null, kg_brand: { name: 'Korg' } },
  { slug: 'korg-ms-20', canonical_name: 'Korg MS-20', model_name: 'MS-20', era: null, year_released: null, kg_brand: { name: 'Korg' } },
  { slug: 'korg-polysix', canonical_name: 'Korg PolySix', model_name: 'PolySix', era: null, year_released: null, kg_brand: { name: 'Korg' } },
  { slug: 'linn-electronics-linndrum', canonical_name: 'Linn Electronics LinnDrum', model_name: 'LinnDrum', era: null, year_released: null, kg_brand: { name: 'Linn Electronics' } },
  { slug: 'manley-ref-c', canonical_name: 'Manley Reference Cardioid', model_name: 'Reference Cardioid', era: '1990s-', year_released: null, kg_brand: { name: 'Manley' } },
  { slug: 'manley-reference-gold', canonical_name: 'Manley Reference Gold', model_name: 'Reference Gold', era: null, year_released: null, kg_brand: { name: 'Manley' } },
  { slug: 'manley-voxbox', canonical_name: 'Manley VOXBOX', model_name: 'VOXBOX', era: '1990s-', year_released: null, kg_brand: { name: 'Manley' } },
  { slug: 'martin-d-28', canonical_name: 'Martin D-28', model_name: 'D-28', era: null, year_released: null, kg_brand: { name: 'Martin' } },
  { slug: 'moog-minimoog', canonical_name: 'Moog Minimoog', model_name: 'Minimoog', era: '1972-1981', year_released: null, kg_brand: { name: 'Moog' } },
  { slug: 'moog-model-d', canonical_name: 'Moog Model D', model_name: 'Model D', era: null, year_released: null, kg_brand: { name: 'Moog' } },
  { slug: 'moog-source', canonical_name: 'Moog Source', model_name: 'Source', era: null, year_released: null, kg_brand: { name: 'Moog' } },
  { slug: 'neumann-u87ai', canonical_name: 'Neumann U 87 Ai', model_name: 'U 87 Ai', era: '1967-', year_released: null, kg_brand: { name: 'Neumann' } },
  { slug: 'neve-portico-ii-master-buss-processor', canonical_name: 'Neve Portico II Master Buss Processor', model_name: 'Portico II Master Buss Processor', era: null, year_released: null, kg_brand: { name: 'Neve' } },
  { slug: 'oberheim-ob-x', canonical_name: 'Oberheim OB-X', model_name: 'OB-X', era: null, year_released: null, kg_brand: { name: 'Oberheim' } },
  { slug: 'oberheim-ob-xa', canonical_name: 'Oberheim OB-Xa', model_name: 'OB-Xa', era: null, year_released: null, kg_brand: { name: 'Oberheim' } },
  { slug: 'rhodes-mark-i-stage-73', canonical_name: 'Rhodes Mark I Stage 73', model_name: 'Mark I Stage 73', era: null, year_released: 1970, kg_brand: { name: 'Rhodes' } },
  { slug: 'rhodes-mark-i-stage-88', canonical_name: 'Rhodes Mark I Stage 88', model_name: 'Mark I Stage 88', era: null, year_released: 1970, kg_brand: { name: 'Rhodes' } },
  { slug: 'rhodes-mark-i-suitcase-73', canonical_name: 'Rhodes Mark I Suitcase 73', model_name: 'Mark I Suitcase 73', era: null, year_released: 1970, kg_brand: { name: 'Rhodes' } },
  { slug: 'rhodes-mark-ii-stage-73', canonical_name: 'Rhodes Mark II Stage 73', model_name: 'Mark II Stage 73', era: null, year_released: 1980, kg_brand: { name: 'Rhodes' } },
  { slug: 'roland-alpha-juno-1', canonical_name: 'Roland Alpha Juno-1', model_name: null, era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-alpha-juno-2', canonical_name: 'Roland Alpha Juno 2', model_name: 'Alpha Juno 2', era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-cr-68', canonical_name: 'Roland CR-68', model_name: null, era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-cr-78', canonical_name: 'Roland CR-78', model_name: null, era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-cr-8000', canonical_name: 'Roland CR-8000', model_name: null, era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-juno-106', canonical_name: 'Roland Juno-106', model_name: 'Juno-106', era: '1984-1985', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-juno-6', canonical_name: 'Roland Juno-6', model_name: 'Juno-6', era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-juno-60', canonical_name: 'Roland Juno-60', model_name: 'Juno-60', era: '1982-1984', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-jupiter-4', canonical_name: 'Roland Jupiter-4', model_name: 'Jupiter-4', era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-jupiter-8', canonical_name: 'Roland Jupiter-8', model_name: 'Jupiter-8', era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-re-201', canonical_name: 'Roland RE-201 (Space Echo)', model_name: 'RE-201', era: '1974-1980s', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-re-501', canonical_name: 'Roland RE-501 (Chorus Echo)', model_name: 'RE-501', era: '1970s-1980s', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-sh-101', canonical_name: 'Roland SH-101', model_name: 'SH-101', era: '1982-1986', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-system-100', canonical_name: 'Roland System 100', model_name: 'System 100', era: null, year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-tr-606', canonical_name: 'Roland TR-606', model_name: 'TR-606', era: '1981-1984', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-tr-707', canonical_name: 'Roland TR-707', model_name: 'TR-707', era: '1984-1986', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-tr-808', canonical_name: 'Roland TR-808 (Rhythm Composer)', model_name: 'TR-808', era: '1981-1984', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'roland-tr-909', canonical_name: 'Roland TR-909', model_name: 'TR-909', era: '1983-1984', year_released: null, kg_brand: { name: 'Roland' } },
  { slug: 'sequential-prophet-10', canonical_name: 'Sequential Prophet-10', model_name: 'Prophet-10', era: null, year_released: null, kg_brand: { name: 'Sequential' } },
  { slug: 'sequential-prophet-5', canonical_name: 'Sequential Prophet-5', model_name: 'Prophet-5', era: '1978-1984', year_released: null, kg_brand: { name: 'Sequential' } },
  { slug: 'tube-tech-cl1b', canonical_name: 'Tube-Tech CL 1B', model_name: 'CL 1B', era: '1990s-', year_released: null, kg_brand: { name: 'Tube-Tech' } },
  { slug: 'tube-tech-lca-2b', canonical_name: 'Tube-Tech LCA 2B', model_name: 'LCA 2B', era: null, year_released: null, kg_brand: { name: 'Tube-Tech' } },
  { slug: 'ua-1176ln', canonical_name: 'Universal Audio 1176LN', model_name: '1176LN', era: '1960s-', year_released: null, kg_brand: { name: 'Universal Audio' } },
  { slug: 'wurlitzer-200a', canonical_name: 'Wurlitzer 200A', model_name: '200A', era: null, year_released: 1972, kg_brand: { name: 'Wurlitzer' } },
  { slug: 'yamaha-dx7', canonical_name: 'Yamaha DX7', model_name: 'DX7', era: '1983', year_released: null, kg_brand: { name: 'Yamaha' } },
]

/** The index the resolver sees when the supported set is exactly these rows. */
export function fixtureSearchIndex(families: readonly NavigationFamily[]): SearchIndex {
  return buildSearchIndex(SUPPORTED_PRODUCT_ROWS.map(productEntity), families)
}
