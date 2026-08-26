/**
 * scripts/build-product-lifecycle-artefacts.ts
 *
 * Derives the three product-data artefacts from the accepted evidence files.
 * READ-ONLY with respect to production: it opens no database connection and
 * makes no network call. Everything is computed from checked-in CSVs.
 *
 *   data/klup-product-candidate-registry.csv   every candidate, with provenance
 *   data/klup-launch-cohort-frozen.csv         the frozen 48, versioned
 *   data/klup-frozen-cohort-asset-inventory.csv  page/article/image readiness
 *
 * The registry and cohort are DERIVED, never hand-maintained: re-running this
 * command after an evidence change produces a reviewable diff instead of a
 * silent divergence.
 *
 *   npx tsx scripts/build-product-lifecycle-artefacts.ts            # write
 *   npx tsx scripts/build-product-lifecycle-artefacts.ts --validate # verify only
 *
 * `--validate` exits non-zero if the artefacts do not reproduce exactly, if any
 * source row is unaccounted for, or if any invariant is broken.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const ROOT = path.resolve(__dirname, '..')
const VALIDATE = process.argv.includes('--validate')

const SRC_336 = 'data/klup-clean-product-candidates.csv'
const SRC_182 = 'data/klup-music-vertical-candidate-additions.csv'
const SRC_REC = 'docs/klup-launch-catalogue-candidates.csv'
const SRC_MAN = 'docs/klup-music-vertical-kg-manifest.csv'
const OUT_REG = 'data/klup-product-candidate-registry.csv'
const OUT_COH = 'data/klup-launch-cohort-frozen.csv'
const OUT_AST = 'data/klup-frozen-cohort-asset-inventory.csv'

// ── tiny CSV/TSV reader & writer (no dependency; the repo has none for CSV) ──
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}
function readCsv(rel: string, delim = ','): Array<Record<string, string>> {
  const rows = parseDelimited(fs.readFileSync(path.join(ROOT, rel), 'utf8'), delim)
  const head = rows[0]
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}
function q(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function toCsv(header: string[], rows: Array<Record<string, unknown>>): string {
  return header.join(',') + '\n' + rows.map(r => header.map(h => q(r[h])).join(',')).join('\n') + '\n'
}
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// ── load evidence ───────────────────────────────────────────────────────────
const raw336 = fs.readFileSync(path.join(ROOT, SRC_336), 'utf8')
const src336 = parseDelimited(raw336, '\t').slice(1)          // Brand \t Product
const src182 = readCsv(SRC_182)
const rec    = readCsv(SRC_REC)
const man    = readCsv(SRC_MAN)

const errors: string[] = []
const fail = (m: string) => errors.push(m)

// ── 1. candidate registry ───────────────────────────────────────────────────
// One row per candidate from EVERY source, with provenance preserved. A
// consolidated variant keeps all of its source-family references.
const REG_HEADER = [
  'candidate_id', 'source_origin', 'source_row_label', 'brand', 'family_or_model',
  'hierarchy_role', 'reconciliation_state', 'kg_mapping', 'canonical_product_id', 'slug',
  'final_decision', 'score', 'confidence', 'lifecycle_proposal', 'decision_reason',
]
const registry: Array<Record<string, unknown>> = []
let seq = 0
const nextId = (p: string) => `${p}-${String(++seq).padStart(4, '0')}`

/** Support/visibility/monitoring proposal implied by a decision. Never applied here. */
function lifecycle(decision: string, role: string): string {
  if (role === 'navigation_family') return 'navigation_only:no_kg_product_row'
  if (role === 'discovery_only')    return 'registry_only:not_a_match_target'
  switch (decision) {
    case 'core':                return 'support=supported;visibility=private;monitoring=unchanged'
    case 'reserve':             return 'support=reserve;visibility=private;monitoring=none'
    case 'incumbent_removed':   return 'support=reserve;visibility=private;monitoring=none'
    case 'no_kg_product':       return 'registry_only:no_kg_row'
    case 'superseded_by_variant': return 'registry_only:superseded'
    default:                    return 'support=known;visibility=private;monitoring=none'
  }
}

// 1a. the immutable 336
seq = 0
for (const [brand, product] of src336) {
  const hits = rec.filter(r => (r.gross_list_name || '').split('; ').includes(`${brand.trim()} ${product.trim()}`))
  if (hits.length === 0) {
    registry.push({
      candidate_id: nextId('GL'), source_origin: 'gross_list_336',
      source_row_label: `${brand.trim()}\t${product.trim()}`, brand: brand.trim(),
      family_or_model: product.trim(), hierarchy_role: '', reconciliation_state: 'unreconciled',
      kg_mapping: '', canonical_product_id: '', slug: '', final_decision: '', score: '',
      confidence: '', lifecycle_proposal: 'registry_only:unreconciled',
      decision_reason: 'Gross-list row with no reconciliation record.',
    })
    fail(`336 row not reconciled: ${brand} ${product}`)
    continue
  }
  for (const h of hits) {
    registry.push({
      candidate_id: nextId('GL'), source_origin: 'gross_list_336',
      source_row_label: `${brand.trim()}\t${product.trim()}`, brand: brand.trim(),
      family_or_model: h.model || product.trim(), hierarchy_role: h.hierarchy_role || '',
      reconciliation_state: h.gross_list_status || '', kg_mapping: h.kg_status || '',
      canonical_product_id: h.canonical_product_id || '', slug: h.slug || '',
      final_decision: h.final_decision || '', score: h.score || '', confidence: h.confidence || '',
      lifecycle_proposal: lifecycle(h.final_decision, h.hierarchy_role),
      decision_reason: h.decision_change_reason || h.main_reason || '',
    })
  }
}
// 1b. the 182 overlay
seq = 0
for (const o of src182) {
  const h = rec.find(r => r.model === o.proposed_variant)
  if (!h) fail(`overlay row missing from reconciliation: ${o.proposed_variant}`)
  registry.push({
    candidate_id: nextId('OV'), source_origin: o.candidate_origin,
    source_row_label: o.proposed_variant, brand: o.brand,
    family_or_model: o.family ? `${o.family} / ${o.proposed_variant}` : o.proposed_variant,
    hierarchy_role: o.hierarchy_role, reconciliation_state: 'overlay_addition',
    kg_mapping: o.kg_status, canonical_product_id: h?.canonical_product_id || '', slug: h?.slug || '',
    final_decision: h?.final_decision || '', score: o.score || '', confidence: o.confidence || '',
    lifecycle_proposal: lifecycle(h?.final_decision || '', o.hierarchy_role),
    decision_reason: o.boundary_note || '',
  })
}
// 1c. reconciled rows that came from neither source file (Prompt 03 reconstructions)
seq = 0
for (const r of rec) {
  if (r.gross_list_name) continue
  if (src182.some(o => o.proposed_variant === r.model)) continue
  registry.push({
    candidate_id: nextId('RC'), source_origin: 'prompt03_reconstruction',
    source_row_label: r.model || r.slug, brand: r.brand, family_or_model: r.model,
    hierarchy_role: r.hierarchy_role || '', reconciliation_state: r.gross_list_status || '',
    kg_mapping: r.kg_status || '', canonical_product_id: r.canonical_product_id || '',
    slug: r.slug || '', final_decision: r.final_decision, score: r.score, confidence: r.confidence,
    lifecycle_proposal: lifecycle(r.final_decision, r.hierarchy_role),
    decision_reason: r.decision_change_reason || r.main_reason || '',
  })
}

// ── 2. frozen launch cohort ─────────────────────────────────────────────────
const COH_HEADER = [
  'rank', 'canonical_product_id', 'slug', 'canonical_title', 'brand', 'category',
  'parent_navigation_family', 'match_page_boundary', 'kg_prerequisite',
  'support_state_target', 'visibility_target', 'monitoring_target', 'candidate_origin',
]
const core = rec.filter(r => r.final_decision === 'core')
  .sort((a, b) => Number(a.rank) - Number(b.rank))
const cohort = core.map(r => ({
  rank: r.rank, canonical_product_id: r.canonical_product_id, slug: r.slug,
  canonical_title: r.model, brand: r.brand, category: r.family,
  parent_navigation_family: (src182.find(o => o.proposed_variant === r.model)?.family) || '',
  match_page_boundary: r.variant_decision,
  kg_prerequisite: r.kg_status === 'exact_kg_product' ? ''
    : r.kg_status === 'partial_family_multiple_kg_rows'
      ? 'consolidate_multiple_kg_rows_then_select_survivor'
      : 'create_kg_product_before_support',
  support_state_target: 'supported',
  // Deliberately NOT public: freezing support must never publish a page.
  visibility_target: 'private',
  // Deliberately unchanged: freezing support must never widen scraper queries.
  monitoring_target: 'unchanged',
  candidate_origin: r.candidate_origin,
}))

// ── 3. asset inventory (structure only; live values are filled by a SELECT-only
//      probe, so this artefact records the SHAPE and the known repository facts) ─
const AST_HEADER = [
  'slug', 'canonical_title', 'kg_prerequisite', 'page_route', 'visibility_now',
  'tier_now', 'article_state', 'image_state', 'notes',
]
const assets = core.map(r => ({
  slug: r.slug, canonical_title: r.model,
  kg_prerequisite: r.kg_status === 'exact_kg_product' ? '' : r.kg_status,
  page_route: r.slug ? `/product/${r.slug}` : '',
  visibility_now: r.current_status.includes('/') ? r.current_status.split('/')[1] : '',
  tier_now: r.current_status.includes('/') ? r.current_status.split('/')[0] : '',
  article_state: '', image_state: '',
  notes: r.slug ? '' : 'No KG row yet — no page, article or image can exist.',
}))

// ── emit / validate ─────────────────────────────────────────────────────────
const outputs: Array<[string, string]> = [
  [OUT_REG, toCsv(REG_HEADER, registry)],
  [OUT_COH, toCsv(COH_HEADER, cohort)],
  [OUT_AST, toCsv(AST_HEADER, assets)],
]

// invariants
if (cohort.length < 30 || cohort.length > 50) fail(`cohort must be 30-50, got ${cohort.length}`)
if (new Set(cohort.map(c => c.canonical_title)).size !== cohort.length) fail('cohort titles not unique')
for (const c of core) {
  if (c.hierarchy_role === 'navigation_family' || c.hierarchy_role === 'discovery_only')
    fail(`core row has non-matchable role: ${c.model}`)
}
if (new Set(registry.map(r => r.candidate_id)).size !== registry.length) fail('candidate_id not unique')
const cov336 = new Set(registry.filter(r => r.source_origin === 'gross_list_336').map(r => r.source_row_label))
if (cov336.size !== src336.length) fail(`336 coverage: ${cov336.size} of ${src336.length}`)
const cov182 = new Set(registry.filter(r => String(r.source_origin).includes('addition') || String(r.source_origin).includes('challenger')).map(r => r.source_row_label))
if (cov182.size !== src182.length) fail(`182 coverage: ${cov182.size} of ${src182.length}`)

const hash336 = sha256(raw336)
console.log(`immutable 336 source sha256 = ${hash336}`)
console.log(`registry rows        ${registry.length}`)
console.log(`  gross_list_336     ${registry.filter(r => r.source_origin === 'gross_list_336').length} (covering ${cov336.size}/${src336.length} source rows)`)
console.log(`  overlay            ${registry.filter(r => String(r.source_origin).includes('addition') || String(r.source_origin).includes('challenger')).length} (covering ${cov182.size}/${src182.length})`)
console.log(`  prompt03 recon     ${registry.filter(r => r.source_origin === 'prompt03_reconstruction').length}`)
console.log(`frozen cohort        ${cohort.length}`)
console.log(`  needing KG work    ${cohort.filter(c => c.kg_prerequisite).length}`)
console.log(`asset inventory rows ${assets.length}`)
console.log(`manifest rows        ${man.length}`)

if (VALIDATE) {
  for (const [rel, body] of outputs) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { fail(`missing artefact: ${rel}`); continue }
    if (fs.readFileSync(p, 'utf8') !== body) fail(`artefact out of date (re-run without --validate): ${rel}`)
  }
} else {
  for (const [rel, body] of outputs) fs.writeFileSync(path.join(ROOT, rel), body)
  console.log('\nartefacts written.')
}

if (errors.length) {
  console.error('\nVALIDATION FAILURES:')
  for (const e of errors.slice(0, 20)) console.error('  ' + e)
  console.error(`  (${errors.length} total)`)
  process.exit(1)
}
console.log('\nall invariants hold.')
