/**
 * scripts/verify-csp-progress.ts
 *
 * Read-only checks after migrations 030–033 + enrich-from-reverb-csp run.
 * - kg_product.reverb_csp_id coverage
 * - kg_category.reverb_uuid coverage
 * - reverb_price_history mapping state + sample queries
 *
 * Run: npx tsx scripts/verify-csp-progress.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

for (const p of [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]) {
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function main() {
  // 1. kg_product.reverb_csp_id coverage
  const { count: kpTotal } = await supabase
    .from('kg_product').select('*', { count: 'exact', head: true })
  const { count: kpCsp } = await supabase
    .from('kg_product').select('*', { count: 'exact', head: true })
    .not('reverb_csp_id', 'is', null)
  const { count: kpAttrCsp } = await supabase
    .from('kg_product').select('*', { count: 'exact', head: true })
    .not('attributes->reverb_csp', 'is', null)

  console.log('── kg_product ──')
  console.log(`  total                              ${kpTotal}`)
  console.log(`  with reverb_csp_id (typed)         ${kpCsp}     ← migration 032 result`)
  console.log(`  with attributes.reverb_csp (jsonb) ${kpAttrCsp}     ← enrich script result (incl. 'none')`)
  console.log()

  // 2. kg_category.reverb_uuid coverage
  const { count: kcTotal } = await supabase
    .from('kg_category').select('*', { count: 'exact', head: true })
  const { count: kcUuid } = await supabase
    .from('kg_category').select('*', { count: 'exact', head: true })
    .not('reverb_uuid', 'is', null)

  console.log('── kg_category ──')
  console.log(`  total                              ${kcTotal}`)
  console.log(`  with reverb_uuid                   ${kcUuid}     ← backfill-category-uuids result`)
  console.log()

  // 3. reverb_price_history state
  const { count: rphTotal } = await supabase
    .from('reverb_price_history').select('*', { count: 'exact', head: true })
  const { count: rphMapped } = await supabase
    .from('reverb_price_history').select('*', { count: 'exact', head: true })
    .not('kg_product_id', 'is', null)

  console.log('── reverb_price_history ──')
  console.log(`  total                              ${rphTotal}`)
  console.log(`  with kg_product_id (post-031)      ${rphMapped}     ← what migration 034 will increase`)
  console.log()

  // 4. Sample distinct queries from reverb_price_history
  const { data: rows } = await supabase
    .from('reverb_price_history')
    .select('query')
    .limit(2000)
  const tally = new Map<string, number>()
  for (const r of rows ?? []) {
    if (!r.query) continue
    tally.set(r.query, (tally.get(r.query) ?? 0) + 1)
  }
  const distinct = [...tally.entries()].sort((a, b) => b[1] - a[1])

  console.log(`── reverb_price_history.query distribution (sample of 2000 rows) ──`)
  console.log(`  distinct queries                   ${distinct.length}`)
  console.log(`  top 20:`)
  for (const [q, n] of distinct.slice(0, 20)) {
    console.log(`    ${String(n).padStart(4)} × "${q}"`)
  }
  console.log()

  // 5. Preview of normalize-based 034 join
  // Pull all kg_product canonical_names, normalize, build map, count matches.
  const allProducts: Array<{ id: string; canonical_name: string }> = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('kg_product')
      .select('id, canonical_name')
      .not('canonical_name', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    allProducts.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const productByNormName = new Map<string, string[]>()
  for (const p of allProducts) {
    const k = norm(p.canonical_name)
    if (!k) continue
    if (!productByNormName.has(k)) productByNormName.set(k, [])
    productByNormName.get(k)!.push(p.id)
  }

  let wouldMap = 0
  let wouldMapAmbiguous = 0
  let wouldFail = 0
  for (const [q, n] of distinct) {
    const ids = productByNormName.get(norm(q))
    if (!ids)            wouldFail += n
    else if (ids.length === 1) wouldMap += n
    else                 wouldMapAmbiguous += n
  }

  console.log('── 034 dry-run (normalized-name join, sample only) ──')
  console.log(`  would map (single kg_product)      ${wouldMap}     rows in sample`)
  console.log(`  would skip (ambiguous, ≥2 matches) ${wouldMapAmbiguous}     rows in sample`)
  console.log(`  would skip (no match)              ${wouldFail}     rows in sample`)
}

main().catch(err => { console.error(err); process.exit(1) })
