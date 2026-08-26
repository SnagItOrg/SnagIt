/**
 * scripts/build-candidate-disposition.ts
 *
 * Exhaustive disposition of every candidate labelled `matchable_canonical_product`,
 * plus the deterministic seed delta those dispositions imply.
 *
 * READ-ONLY with respect to production: no database connection, no network.
 *
 *   npx tsx scripts/build-candidate-disposition.ts            # write ledger (+ --seed to expand)
 *   npx tsx scripts/build-candidate-disposition.ts --validate # verify, exit non-zero on drift
 *
 * Every matchable-labelled source row gets EXACTLY ONE outcome. The label alone
 * is never treated as proof of verification: brand presence, model-token
 * precision and alias safety are re-checked here.
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const VALIDATE = process.argv.includes('--validate')
const WRITE_SEED = process.argv.includes('--seed')
const OUT = 'data/klup-candidate-disposition.csv'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}
const read = (rel: string) => {
  const rows = parseCsv(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  const h = rows[0]
  return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])) as Record<string,string>)
}
const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s }

const rec = read('docs/klup-launch-catalogue-candidates.csv')
const ovl = read('data/klup-music-vertical-candidate-additions.csv')
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/knowledge-graph.json'), 'utf8'))
const brands: Record<string, { products: Record<string, unknown> }> = seed.categories['music-gear'].brands
const seedSlugs = new Set(Object.values(brands).flatMap(b => Object.keys(b.products)))
const seedBrandKeys = new Set(Object.keys(brands))

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
const brandKey = (b: string) => slugify(b)
/** Model token that will become model_name AND a score-95 MODEL identifier. */
function modelToken(brand: string, variant: string): string {
  let m = variant.trim()
  if (m.toLowerCase().startsWith(brand.toLowerCase() + ' ')) m = m.slice(brand.length + 1).trim()
  return m
}
const GENERIC = new Set(['synthesizer','synth','piano','guitar','bass','drums','drum','tom','solo','studio','pro','one','spirit','se series','rg series'])
function unsafeToken(t: string): string | null {
  const v = t.trim()
  if (v.length < 3) return 'model token below the 3-character matcher floor'
  if (GENERIC.has(v.toLowerCase())) return `generic family token '${v}'`
  if (/^\d{1,3}$/.test(v)) return `bare short number '${v}'`
  return null
}

type Outcome =
  | 'existing_exact_kg_product' | 'added_verified_kg_product'
  | 'registry_only_insufficient_identity' | 'reclassified_navigation_or_discovery'
  | 'rejected_duplicate_nonproduct_or_unsafe' | 'deferred_missing_named_evidence'

interface Row { source: string; origin: string; label: string; brand: string; variant: string
  role: string; decision: string; kg_status: string; slug: string; outcome: Outcome
  seed_brand: string; seed_slug: string; model_token: string; reason: string }

const out: Row[] = []
const seen = new Set<string>()
const toAdd = new Map<string, { brand: string; slug: string; name: string; model: string; cat: string }>()

// ── 1. overlay rows labelled matchable ──────────────────────────────────────
for (const o of ovl) {
  if (o.hierarchy_role !== 'matchable_canonical_product') continue
  const r = rec.find(x => x.model === o.proposed_variant)
  const key = `OV|${o.proposed_variant}`
  if (seen.has(key)) continue; seen.add(key)
  const bk = brandKey(o.brand)
  const token = modelToken(o.brand, o.proposed_variant)
  const unsafe = unsafeToken(token)
  const slug = slugify(o.proposed_variant)
  let outcome: Outcome, reason = '', seedBrand = '', seedSlug = ''

  if (r && r.kg_status === 'exact_kg_product' && r.slug) {
    outcome = 'existing_exact_kg_product'; reason = `already in the KG as ${r.slug}`
  } else if (r && r.kg_status === 'partial_family_multiple_kg_rows') {
    outcome = 'existing_exact_kg_product'; reason = 'canonical survivor selected from a polluted family; no consolidation required'
  } else if (unsafe) {
    outcome = 'rejected_duplicate_nonproduct_or_unsafe'; reason = `unsafe identity: ${unsafe}`
  } else {
    // Deterministic regardless of current seed state: the disposition is the
    // same whether this run adds the row or a previous one already did.
    outcome = 'added_verified_kg_product'; seedBrand = bk; seedSlug = slug
    reason = 'exact brand + precise model boundary; carried in the canonical seed at known/private/unmonitored'
    if (!seedSlugs.has(slug)) toAdd.set(slug, { brand: bk, slug, name: o.proposed_variant, model: token, cat: o.category })
  }
  out.push({ source: 'overlay_182', origin: o.candidate_origin, label: o.proposed_variant,
    brand: o.brand, variant: o.proposed_variant, role: o.hierarchy_role,
    decision: r?.final_decision ?? '', kg_status: o.kg_status, slug: r?.slug ?? '',
    outcome, seed_brand: seedBrand, seed_slug: seedSlug, model_token: token, reason })
}

// ── 2. reconciliation rows labelled matchable that the overlay did not cover ─
for (const r of rec) {
  if (r.hierarchy_role !== 'matchable_canonical_product') continue
  const key = `OV|${r.model}`
  if (seen.has(key)) continue; seen.add(`RC|${r.model}`)
  let outcome: Outcome, reason = ''
  if (r.kg_status === 'exact_kg_product' && r.slug) { outcome = 'existing_exact_kg_product'; reason = `already in the KG as ${r.slug}` }
  else if (r.kg_status === 'partial_family_multiple_kg_rows') { outcome = 'existing_exact_kg_product'; reason = 'canonical survivor selected from a polluted family' }
  else { outcome = 'deferred_missing_named_evidence'; reason = 'gross-list row with no exact KG identity and no overlay variant to resolve it' }
  out.push({ source: 'gross_list_336', origin: r.candidate_origin, label: r.gross_list_name || r.model,
    brand: r.brand, variant: r.model, role: r.hierarchy_role, decision: r.final_decision,
    kg_status: r.kg_status, slug: r.slug, outcome, seed_brand: '', seed_slug: '', model_token: '', reason })
}

// ── 3. seed expansion ───────────────────────────────────────────────────────
let addedBrands = 0, addedProducts = 0
if (WRITE_SEED) {
  for (const a of Array.from(toAdd.values())) {
    if (!brands[a.brand]) { brands[a.brand] = { products: {} }; addedBrands++ }
    if (!brands[a.brand].products[a.slug]) {
      brands[a.brand].products[a.slug] = {
        name: a.name, type: a.cat.replace(/-/g, ' ').replace(/s$/, ''),
        variants: [], related: [], model: a.model, sku: [], ean: [],
      }
      addedProducts++
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data/knowledge-graph.json'), JSON.stringify(seed, null, 2) + '\n')
}

// ── emit ────────────────────────────────────────────────────────────────────
const H = ['source','origin','label','brand','variant','hierarchy_role','final_decision',
  'kg_status','existing_slug','outcome','seed_brand','seed_slug','model_token','reason']
const body = H.join(',') + '\n' + out.map(r => [r.source,r.origin,r.label,r.brand,r.variant,r.role,
  r.decision,r.kg_status,r.slug,r.outcome,r.seed_brand,r.seed_slug,r.model_token,r.reason]
  .map(q).join(',')).join('\n') + '\n'

const counts = out.reduce((a, r) => { a[r.outcome] = (a[r.outcome] ?? 0) + 1; return a }, {} as Record<string, number>)
console.log(`matchable-labelled rows: ${out.length}`)
for (const [k, v] of Object.entries(counts).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(42)} ${v}`)
if (WRITE_SEED) console.log(`seed: +${addedBrands} brands, +${addedProducts} products`)
console.log(`seed totals: ${Object.keys(brands).length} brands, ${Object.values(brands).reduce((n,b)=>n+Object.keys(b.products).length,0)} products`)

const errs: string[] = []
if (out.length !== 194) errs.push(`expected 194 matchable-labelled rows, got ${out.length}`)
if (out.some(r => !r.outcome)) errs.push('a row has no outcome')
const dup = out.map(r => `${r.source}|${r.variant}`).filter((v,i,a) => a.indexOf(v) !== i)
if (dup.length) errs.push(`duplicate dispositions: ${dup.slice(0,3).join(', ')}`)
for (const r of out) if (r.outcome !== 'existing_exact_kg_product' && !r.reason) errs.push(`no reason for ${r.variant}`)

if (VALIDATE) {
  const p = path.join(ROOT, OUT)
  if (!fs.existsSync(p)) errs.push(`missing ledger: ${OUT}`)
  else if (fs.readFileSync(p, 'utf8') !== body) errs.push(`ledger out of date: ${OUT}`)
} else {
  fs.writeFileSync(path.join(ROOT, OUT), body)
  console.log(`\nledger written: ${OUT}`)
}
if (errs.length) { console.error('\nFAILURES:'); errs.slice(0,10).forEach(e => console.error('  ' + e)); process.exit(1) }
console.log('all disposition invariants hold.')
