/**
 * scripts/report-match-backlog.ts
 *
 * READ-ONLY impact report for the matcher data-integrity gate.
 *
 * Answers, without writing anything: if the corrected source allowlist and the
 * brand-compatibility guard were applied to the DBA and Kleinanzeigen backlog,
 * what WOULD happen? Those two sources were never auto-matched — the matcher
 * filtered on the literal 'dba' while rows are stored as 'dba.dk', and
 * 'kleinanzeigen' was absent from the list entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS SCRIPT HAS NO APPLY MODE, BY CONSTRUCTION.
 *
 * It issues SELECT queries only. It never calls insert/update/upsert/delete or
 * a write RPC, and it never touches `listing_product_match`. Everything it
 * prints is a PROPOSAL computed in memory — never a production match. Adding a
 * write path here is a separate, separately-reviewed change.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   npm run report-match-backlog
 *   npx tsx scripts/report-match-backlog.ts --source=dba.dk
 *   npx tsx scripts/report-match-backlog.ts --samples=20
 */

import * as path from 'path'
import * as fs from 'fs'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import {
  buildMatchIndex,
  decideMatch,
  normalizeProductRow,
  PRODUCT_SELECT,
  MATCHABLE_SUPPORT_STATE,
  type Product,
} from '../frontend/lib/matching/match-listings'
import { brandCollisionReason } from '../frontend/lib/matching/brand-guard'
import { isMatcherSource } from '../frontend/lib/matching/sources'
import { hasPlausibleListingPrice } from '../frontend/lib/listing-price-integrity'

const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')

const envPaths = [
  path.resolve(__dirname, '../frontend/.env.local'),
  path.resolve(__dirname, '../.env.local'),
]
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
    break
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const args = process.argv.slice(2)
const sourceArg = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? null
const samplesArg = args.find(a => a.startsWith('--samples='))?.split('=')[1]
const MAX_SAMPLES = Math.min(samplesArg ? parseInt(samplesArg, 10) : 20, 20)

/** Sources this report covers — the two that were never auto-matched. */
const TARGET_SOURCES = ['dba.dk', 'kleinanzeigen'] as const

/**
 * Reverses the product array on a second pass and asserts the aggregate
 * decision counts are identical. Order dependence was the defect that made a
 * real Gibson listing resolvable to Epiphone.
 */
const CHECK_ORDER_INDEPENDENCE = !process.argv.includes('--no-order-check')

type ListingRow = {
  id: string
  title: string | null
  source: string
  price: number | string | null
  is_active: boolean | null
}

async function fetchAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: () => any, label: string, pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    // PostgREST caps every request at 1000 rows; .range() with a stable
    // .order() in the builder is the only safe way to page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (builder() as any).range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Fetch ${label} @${offset}: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as T[]))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n)
}

async function main() {
  const targets = (sourceArg ? [sourceArg] : [...TARGET_SOURCES]).filter((s) => {
    if (isMatcherSource(s)) return true
    console.error(`⚠️  '${s}' is not a supported matcher source — skipping.`)
    return false
  })
  if (targets.length === 0) { console.error('No valid sources requested.'); process.exit(1) }

  console.log('══════════════════════════════════════════════════════════════')
  console.log('  MATCH BACKLOG IMPACT REPORT — READ-ONLY, NO WRITES')
  console.log('  All figures below are PROPOSALS computed in memory.')
  console.log('  Nothing here exists in listing_product_match.')
  console.log('══════════════════════════════════════════════════════════════\n')

  // ── knowledge graph (SELECT) ────────────────────────────────────────────
  const rawProducts = await fetchAll<Parameters<typeof normalizeProductRow>[0]>(
    () => supabase.from('kg_product').select(PRODUCT_SELECT).order('id'),
    'kg_product',
  )
  const products: Product[] = rawProducts.map(normalizeProductRow)
  const idents = await fetchAll<{ product_id: string; type: string; value: string }>(
    () => supabase.from('kg_identifier').select('product_id, type, value').in('type', ['SKU', 'MODEL']).order('product_id'),
    'kg_identifier',
  )
  const synonyms = await fetchAll<{ alias: string; canonical_query: string | null }>(
    () => supabase.from('synonym').select('alias, canonical_query').eq('match_type', 'alias').order('alias'),
    'synonym',
  )
  // The report deliberately loads ALL products, including inactive ones, and
  // lets buildMatchIndex apply active-only eligibility. That both exercises the
  // in-memory guard and lets this report quantify exactly what the guard costs.
  //
  // SUPPORT AXIS (migration 056): this is a BACKLOG report, not the runtime
  // matcher. Its job is to measure what the decision core would do across the
  // whole verified catalogue, so support is forced to 'supported' here and the
  // support delta is reported separately below. The live matcher applies the
  // real support filter; nothing here writes a row.
  const asSupported = (p: Product) => ({ ...p, support_state: MATCHABLE_SUPPORT_STATE })
  const index = buildMatchIndex(products.map(asSupported), idents, synonyms)
  const nameById = new Map(products.map(p => [p.id, p.canonical_name]))

  // "Legacy" index = the pre-fix behaviour, reproduced by forcing every product
  // eligible. Used ONLY to measure the delta; never used for reported outcomes.
  const legacyIndex = buildMatchIndex(
    products.map(p => ({ ...p, status: 'active', support_state: MATCHABLE_SUPPORT_STATE })),
    idents, synonyms)

  const activeCount   = products.filter(p => p.status === 'active').length
  const inactiveCount = products.length - activeCount
  const inactiveWithModel = products.filter(
    p => p.status !== 'active' && !!p.model_name).length
  console.log(`Knowledge graph: ${products.length} products loaded, ${idents.length} identifiers, ${synonyms.length} aliases`)
  const supportedCount = products.filter(p => p.support_state === MATCHABLE_SUPPORT_STATE).length
  console.log(`  ELIGIBILITY: ${activeCount} active indexed · ${inactiveCount} inactive EXCLUDED ` +
              `(${inactiveWithModel} of them carry a model_name and could otherwise create candidates)`)
  console.log(`  SUPPORT:     ${supportedCount} product(s) carry support_state='${MATCHABLE_SUPPORT_STATE}' and would be ` +
              `LIVE matcher targets; this report deliberately measures all ${activeCount} active products instead\n`)

  for (const source of targets) {
    // ── listings for this source (SELECT) ─────────────────────────────────
    const listings = await fetchAll<ListingRow>(
      () => supabase.from('listings')
        .select('id, title, source, price, is_active')
        .eq('source', source)
        .eq('is_active', true)
        .not('title', 'is', null)
        .order('id'),
      `listings:${source}`,
    )

    // Already-matched ids (SELECT), chunked — a large .in() list blows the
    // PostgREST URL length limit.
    const matchedIds = new Set<string>()
    const ids = listings.map(l => l.id)
    for (let i = 0; i < ids.length; i += 50) {
      const { data, error } = await supabase
        .from('listing_product_match')
        .select('listing_id')
        .in('listing_id', ids.slice(i, i + 50))
      if (error) throw new Error(`Fetch listing_product_match: ${error.message}`)
      for (const r of (data ?? []) as { listing_id: string }[]) matchedIds.add(r.listing_id)
    }

    const unmatched = listings.filter(l => !matchedIds.has(l.id))

    // ── classify (pure, in memory) ────────────────────────────────────────
    //
    // CATEGORIES ARE DISJOINT. Every unmatched listing falls into exactly one
    // bucket, assigned by the decision core's own precedence:
    //   none < rejected < brand_mismatch < ambiguous_tie < low_confidence < matched
    // A listing that is both ambiguous and low-confidence is counted ONCE, as
    // ambiguous, because ambiguity is resolved first. `implausible_price` is
    // reported SEPARATELY and deliberately overlaps: it is a price-integrity
    // property, not a matching outcome, so it is excluded from the disjoint
    // total and labelled as such.
    const byProduct = new Map<string, number>()
    const rejections: Array<{ title: string; reason: string; product: string }> = []
    const brandMismatch: Array<{ title: string; detail: string }> = []
    const ambiguous: Array<{ title: string; products: string[] }> = []
    const lowConfidence: Array<{ title: string; product: string; detail: string }> = []
    const nonProduct: Array<{ title: string; detail: string; candidate: string }> = []
    const dataConflict: Array<{ title: string; detail: string; products: string[] }> = []
    const sharedIdent: Array<{ title: string; detail: string; products: string[] }> = []
    const copyRef: Array<{ title: string; detail: string; product: string }> = []
    const implausiblePrice: Array<{ title: string; price: string }> = []
    let safeMatches = 0
    let noCandidate = 0

    const classify = (idx: typeof index) => {
      const counts = {
        matched: 0, rejected: 0, none: 0,
        brand_mismatch: 0, ambiguous_tie: 0, low_confidence: 0,
        non_product_intent: 0, product_data_conflict: 0, shared_identifier_conflict: 0,
        copy_or_reference: 0,
      }
      for (const l of unmatched) {
        const d = decideMatch(l.title ?? '', idx)
        if (d.kind === 'deferred') counts[d.reason] += 1
        else counts[d.kind] += 1
      }
      return counts
    }

    for (const l of unmatched) {
      // Reported separately — overlaps the buckets below by design.
      if (!hasPlausibleListingPrice(l)) {
        implausiblePrice.push({ title: l.title ?? '', price: String(l.price) })
      }

      const decision = decideMatch(l.title ?? '', index)

      if (decision.kind === 'none') { noCandidate += 1; continue }

      if (decision.kind === 'rejected') {
        rejections.push({
          title: l.title ?? '',
          reason: brandCollisionReason(decision.collision),
          product: nameById.get(decision.best.product_id) ?? decision.best.product_id,
        })
        continue
      }

      if (decision.kind === 'deferred') {
        const title = l.title ?? ''
        if (decision.reason === 'non_product_intent') {
          const c = decision.candidates[0]
          nonProduct.push({
            title,
            detail: decision.detail,
            candidate: c ? (nameById.get(c.product_id) ?? c.product_id) + ` [${c.method}/${c.score}]` : '—',
          })
        } else if (decision.reason === 'product_data_conflict') {
          dataConflict.push({
            title,
            detail: decision.detail,
            products: decision.candidates.map(c => nameById.get(c.product_id) ?? c.product_id).sort(),
          })
        } else if (decision.reason === 'copy_or_reference') {
          const c = decision.candidates[0]
          copyRef.push({ title, detail: decision.detail,
            product: c ? (nameById.get(c.product_id) ?? c.product_id) : '—' })
        } else if (decision.reason === 'shared_identifier_conflict') {
          sharedIdent.push({
            title,
            detail: decision.detail,
            products: decision.candidates.map(c => nameById.get(c.product_id) ?? c.product_id).sort(),
          })
        } else if (decision.reason === 'brand_mismatch') {
          brandMismatch.push({ title, detail: decision.detail })
        } else if (decision.reason === 'ambiguous_tie') {
          ambiguous.push({
            title,
            products: decision.candidates.map(c => nameById.get(c.product_id) ?? c.product_id).sort(),
          })
        } else {
          const c = decision.candidates[0]
          lowConfidence.push({
            title,
            product: nameById.get(c.product_id) ?? c.product_id,
            detail: decision.detail,
          })
        }
        continue
      }

      safeMatches += 1
      const name = nameById.get(decision.best.product_id) ?? decision.best.product_id
      byProduct.set(name, (byProduct.get(name) ?? 0) + 1)
    }

    // ── output ────────────────────────────────────────────────────────────
    console.log('──────────────────────────────────────────────────────────────')
    console.log(`  SOURCE: ${source}`)
    console.log('──────────────────────────────────────────────────────────────')
    console.log(`  Active listings                  ${listings.length}`)
    console.log(`  Already in listing_product_match ${listings.length - unmatched.length}`)
    console.log(`  Currently unmatched              ${unmatched.length}`)
    console.log()
    console.log('  DISJOINT OUTCOMES (each unmatched listing counted exactly once):')
    console.log(`    PROPOSED safe automatic matches ${safeMatches}   (not production matches)`)
    console.log(`    Hard brand-collision rejections ${rejections.length}`)
    console.log(`    Deferred — non-product intent   ${nonProduct.length}`)
    console.log(`    Deferred — brand mismatch       ${brandMismatch.length}`)
    console.log(`    Deferred — product-data conflict ${dataConflict.length}`)
    console.log(`    Deferred — shared-identifier conflict ${sharedIdent.length}`)
    console.log(`    Deferred — copy/reference        ${copyRef.length}`)
    console.log(`    Deferred — ambiguous tie        ${ambiguous.length}`)
    console.log(`    Deferred — low confidence       ${lowConfidence.length}`)
    console.log(`    No candidate at all             ${noCandidate}`)
    const disjointTotal = safeMatches + rejections.length + brandMismatch.length +
                          ambiguous.length + lowConfidence.length + noCandidate +
                          nonProduct.length + dataConflict.length + sharedIdent.length + copyRef.length
    console.log(`    ${'─'.repeat(46)}`)
    console.log(`    SUM                             ${disjointTotal}` +
                (disjointTotal === unmatched.length ? '   ✓ equals unmatched' : '   ✗ MISMATCH'))
    console.log()
    console.log(`  SEPARATE (overlaps the above by design — a price property, not an outcome):`)
    console.log(`    Implausible legacy price        ${implausiblePrice.length}   (excluded from price stats on read)`)
    console.log()

    if (CHECK_ORDER_INDEPENDENCE) {
      const forward = classify(index)
      const reversed = classify(buildMatchIndex(
        [...products].reverse(), [...idents].reverse(), [...synonyms].reverse(),
      ))
      const same = JSON.stringify(forward) === JSON.stringify(reversed)
      console.log(`  ORDER INDEPENDENCE: reversing product/identifier/synonym order → ` +
                  `${same ? '✓ identical aggregate decisions' : '✗ DECISIONS CHANGED'}`)
      if (!same) {
        console.log(`    forward:  ${JSON.stringify(forward)}`)
        console.log(`    reversed: ${JSON.stringify(reversed)}`)
        process.exitCode = 1
      }
      console.log()
    }

    if (byProduct.size > 0) {
      console.log('  PROPOSED safe automatic matches by product:')
      for (const [name, n] of [...byProduct.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${pad(name, 42)} ${String(n).padStart(5)}`)
      }
      console.log()
    }

    const classes: Array<[string, string[]]> = [
      ['REJECTED — hard brand collision (row written, is_valid=false)',
        rejections.map(r => `[${r.reason}] → ${r.product} :: ${r.title}`)],
      ['DEFERRED — non-product intent (NO ROW)',
        nonProduct.map(n => `[${n.detail} → would have matched ${n.candidate}] :: ${n.title}`)],
      ['DEFERRED — product-data conflict / duplicate KG rows (NO ROW)',
        dataConflict.map(d => `[${d.products.join(' | ')}] :: ${d.title}`)],
      ['DEFERRED — copy/reference: another maker\'s product (NO ROW)',
        copyRef.map(c => `[${c.detail} → would have matched ${c.product}] :: ${c.title}`)],
      ['DEFERRED — shared-identifier conflict (NO ROW)',
        sharedIdent.map(s => `[${s.products.join(' | ')}] :: ${s.title}`)],
      ['DEFERRED — brand mismatch (NO ROW)',
        brandMismatch.map(b => `[${b.detail}] :: ${b.title}`)],
      ['DEFERRED — ambiguous tie (NO ROW)',
        ambiguous.map(a => `[${a.products.join(' | ')}] :: ${a.title}`)],
      ['DEFERRED — low confidence (NO ROW)',
        lowConfidence.map(c => `[→ ${c.product}; ${c.detail}] :: ${c.title}`)],
      ['IMPLAUSIBLE LEGACY PRICE (separate axis)',
        implausiblePrice.map(p => `[raw=${p.price}] :: ${p.title}`)],
    ]
    for (const [label, rows] of classes) {
      if (rows.length === 0) continue
      console.log(`  ${label} — showing ${Math.min(rows.length, MAX_SAMPLES)} of ${rows.length}:`)
      for (const row of rows.slice(0, MAX_SAMPLES)) console.log(`    · ${row.slice(0, 150)}`)
      console.log()
    }

    // ── Contamination review ──────────────────────────────────────────────
    // Independent audit of the SAFE set, using probe patterns that are NOT the
    // guard's own token lists. "Before" = what the matcher would have accepted
    // without the intent guard; "after" = what it still accepts. A non-zero
    // "after" is residual contamination that must be disclosed, not hidden.
    const PROBES: Array<[string, RegExp]> = [
      ['parts (pickup/neck/body/bridge)', /(?<![\w-])(pickups?|pickupper|picupper|tonabnehmer|neck|hals|body|korpus|krop|bridge|br(ü|ue)cke)(?![\w-])/i],
      ['consumables (strings/chips/psu)', /(?<![\w-])(strings|saiten|strenge|chips?|netzteil)(?![\w-])/i],
      ['wanted / non-sale',               /(?<![\w-])(s(ø|o)ge[rs]|k(ø|o)bes|(ø|o)nskes|suche[nt]?|gesucht|wanted|wtb)(?![\w-])/i],
      ['accessory-inclusion (must stay)', /(?<![\w-])(case|koffer|kasse|gigbag|zubeh(ö|oe)r|tilbeh(ø|o)r|manual|incl|inkl)(?![\w-])/i],
    ]
    const beforeGuard = unmatched.filter(l => {
      const d = decideMatch(l.title ?? '', index)
      return d.kind === 'matched' ||
             (d.kind === 'deferred' && d.reason === 'non_product_intent')
    })
    const afterGuard = unmatched.filter(l => decideMatch(l.title ?? '', index).kind === 'matched')

    // ── Inactive-exclusion delta ──────────────────────────────────────────
    // Every listing whose outcome changes SOLELY because the inactive products
    // are no longer candidates. A legitimate loss here is a review finding,
    // not a reason to weaken the filter.
    const lost: Array<{ title: string; was: string; now: string }> = []
    const gained: Array<{ title: string; was: string; now: string }> = []
    const fmtDecision = (d: ReturnType<typeof decideMatch>) =>
      d.kind === 'matched'
        ? `matched:${nameById.get(d.best.product_id) ?? d.best.product_id}`
        : d.kind === 'deferred' ? `deferred:${d.reason}` : d.kind
    for (const l of unmatched) {
      const before = decideMatch(l.title ?? '', legacyIndex)
      const after  = decideMatch(l.title ?? '', index)
      const b = fmtDecision(before), a = fmtDecision(after)
      if (b === a) continue
      const row = { title: l.title ?? '', was: b, now: a }
      if (before.kind === 'matched' && after.kind !== 'matched') lost.push(row)
      else gained.push(row)
    }
    console.log('  ACTIVE-ONLY ELIGIBILITY DELTA (vs also indexing inactive products):')
    console.log(`    safe proposals LOST      ${lost.length}`)
    console.log(`    outcomes GAINED/changed  ${gained.length}`)
    for (const r of lost.slice(0, MAX_SAMPLES)) {
      console.log(`      - was ${r.was} -> now ${r.now} :: ${r.title.slice(0, 95)}`)
    }
    for (const r of gained.slice(0, MAX_SAMPLES)) {
      console.log(`      + was ${r.was} -> now ${r.now} :: ${r.title.slice(0, 95)}`)
    }
    console.log()

    console.log('  CONTAMINATION REVIEW of proposed safe automatic matches:')
    console.log(`    ${'probe'.padEnd(34)} before-guard   after-guard`)
    for (const [label, re] of PROBES) {
      const b = beforeGuard.filter(l => re.test(l.title ?? '')).length
      const a = afterGuard.filter(l => re.test(l.title ?? '')).length
      console.log(`    ${label.padEnd(34)} ${String(b).padStart(11)}   ${String(a).padStart(11)}`)
    }
    console.log(`    ${'TOTAL proposed safe'.padEnd(34)} ${String(beforeGuard.length).padStart(11)}   ${String(afterGuard.length).padStart(11)}`)
    const residual = afterGuard.filter(l =>
      PROBES.slice(0, 3).some(([, re]) => re.test(l.title ?? '')))
    if (residual.length > 0) {
      console.log(`    RESIDUAL contamination still accepted (${residual.length}):`)
      residual.slice(0, MAX_SAMPLES).forEach(l => console.log(`      ! ${(l.title ?? '').slice(0, 120)}`))
    } else {
      console.log('    RESIDUAL contamination still accepted: none')
    }
    console.log()
  }

  console.log('══════════════════════════════════════════════════════════════')
  console.log('  END OF REPORT — no rows were written. Read-only run.')
  console.log('══════════════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('❌ report-match-backlog failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
