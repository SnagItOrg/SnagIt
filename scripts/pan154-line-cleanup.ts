/**
 * scripts/pan154-line-cleanup.ts — PAN-154. DRY RUN unless --apply.
 *
 * Applies the matcher's line boundaries (LINE_BOUNDARIES in
 * frontend/lib/matching/match-listings.ts) to the rows written before them,
 * so production holds exactly what the matcher would write today:
 *
 *   listing_product_match  a row whose listing title the boundary refuses gets
 *                          is_valid=false and rejected_reason 'PAN-154 …'.
 *                          Rows already false are never touched.
 *   reverb_price_history   a sold row the boundary refuses is re-pointed to the
 *                          line member it names when that member is a clean KG
 *                          row (SOLD_TARGETS), otherwise kg_product_id=null.
 *
 * Sold history carries a `condition` column that listings do not, so it has
 * one extra, sold-only cue: a "Brand New" or "B-Stock" sale on a vintage-only
 * product is current production. Every other decision is lineBoundaryRefusal,
 * the function the matcher itself calls, so the cleanup cannot drift from it.
 *
 * Owner-authorised production write (PAN-154, 2026-09-26). The manager runs
 * --apply after reading the dry-run report. Idempotent: a second run finds
 * nothing to change.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan154-line-cleanup.ts [--dry-run] [--out-dir=DIR] [--only=slug,slug]
 *   npx tsx scripts/pan154-line-cleanup.ts --apply --out-dir=DIR
 *   npx tsx scripts/pan154-line-cleanup.ts --rollback=DIR/pan154-rollback-<ts>.json [--apply]
 *
 * --apply writes the rollback file (every row id and its old values) BEFORE the
 * first write. --rollback restores those values, but only on rows that still
 * hold what this script wrote, and is itself a dry run without --apply.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { LINE_BOUNDARIES, lineBoundaryRefusal } from '../frontend/lib/matching/match-listings'

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const APPLY = args.includes('--apply')
const OUT_DIR = flag('out-dir') ?? path.join(os.tmpdir(), 'pan154')
const ONLY = flag('only')?.split(',').filter(Boolean)
const ROLLBACK = flag('rollback')

const REASON_PREFIX = 'PAN-154 line boundary'

/** Products whose page is the vintage original only (owner decisions 2026-09-26). */
const VINTAGE_ONLY = new Set(['moog-minimoog', 'sequential-prophet-10'])
const CURRENT_PRODUCTION_CONDITIONS = new Set(['brand new', 'b-stock'])

/**
 * Where a refused sold row goes. Only clean, existing KG rows (merge-not-create);
 * a member the KG does not hold as a clean row is null and goes to the report.
 * The Voyager editions without a row — Old School, Electric Blue, Select,
 * Signature, the anniversary and limited runs — are null for that reason.
 */
function soldTarget(slug: string, title: string, refusal: string): string | null {
  if (!slug.startsWith('moog-')) return null
  if (refusal.startsWith('accessory:')) return null
  const t = title.toLowerCase()
  if (/voyager/.test(t)) {
    if (/voyager\s+xl/.test(t)) return 'moog-minimoog-voyager-xl'
    if (/(?<![\w-])rme(?![\w-])|rack\s*mount/.test(t)) return 'moog-minimoog-voyager-rme'
    if (/old\s*school|electric\s+blue|select|signature|anniversary|limited|special/.test(t)) return null
    return 'moog-minimoog-voyager'
  }
  if (/geddy\s+lee/.test(t)) return 'moog-minimoog-model-d-geddy-lee'
  return slug === 'moog-minimoog' ? 'moog-model-d' : 'moog-minimoog'
}
const SOLD_TARGETS = [
  'moog-minimoog', 'moog-model-d', 'moog-minimoog-model-d-geddy-lee',
  'moog-minimoog-voyager', 'moog-minimoog-voyager-xl', 'moog-minimoog-voyager-rme',
]

// ── plumbing ────────────────────────────────────────────────────────────────

function client(): SupabaseClient {
  for (const p of [path.resolve(__dirname, '../.env.local'), path.resolve(__dirname, '../frontend/.env.local')]) {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll<T>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data as T[]))
    if (data.length < 1000) return rows
  }
}

/** Deterministic sample, so two dry runs print the same titles. */
function sample<T>(rows: T[], n: number, seed = 154): T[] {
  let s = seed
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const copy = rows.slice()
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]] }
  return copy.slice(0, n)
}

interface MatchChange {
  table: 'listing_product_match'; id: string; product: string; product_id: string
  title: string; price_dkk: number | null; active: boolean; reason: string
  old: { is_valid: boolean | null; rejected_reason: string | null }
  new: { is_valid: false; rejected_reason: string }
}
interface SoldChange {
  table: 'reverb_price_history'; id: string; product: string
  title: string; price: number | null; condition: string | null; reason: string
  old: { kg_product_id: string }
  new: { kg_product_id: string | null; target: string | null }
}
type Change = MatchChange | SoldChange

// ── plan ────────────────────────────────────────────────────────────────────

async function plan(db: SupabaseClient): Promise<Change[]> {
  const scope = Object.keys(LINE_BOUNDARIES).filter((s) => !ONLY || ONLY.includes(s))
  const slugs = Array.from(new Set([...scope, ...SOLD_TARGETS]))
  const { data: prods, error } = await db.from('kg_product').select('id, slug, status').in('slug', slugs)
  if (error) throw new Error(error.message)
  const idOf = new Map<string, string>((prods ?? []).map((p) => [p.slug as string, p.id as string]))
  for (const s of slugs) if (!idOf.has(s)) throw new Error(`kg_product '${s}' not found — refusing to plan`)

  const changes: Change[] = []
  for (const slug of scope) {
    const productId = idOf.get(slug)!

    type M = { id: string; is_valid: boolean | null; rejected_reason: string | null
      listings: { title: string | null; price_dkk: number | null; is_active: boolean | null } | null }
    const matches = await readAll<M>(() => db.from('listing_product_match')
      .select('id, is_valid, rejected_reason, listings(title, price_dkk, is_active)')
      .eq('product_id', productId).not('is_valid', 'is', false).order('id'))
    for (const m of matches) {
      const title = m.listings?.title ?? ''
      const reason = lineBoundaryRefusal(title, slug)
      if (!reason) continue
      changes.push({
        table: 'listing_product_match', id: m.id, product: slug, product_id: productId,
        title, price_dkk: m.listings?.price_dkk ?? null, active: m.listings?.is_active !== false, reason,
        old: { is_valid: m.is_valid, rejected_reason: m.rejected_reason },
        new: { is_valid: false, rejected_reason: `${REASON_PREFIX}: ${reason}` },
      })
    }

    type S = { id: string; listing_title: string | null; price: number | null; condition: string | null }
    const sold = await readAll<S>(() => db.from('reverb_price_history')
      .select('id, listing_title, price, condition').eq('kg_product_id', productId).order('id'))
    for (const r of sold) {
      const title = r.listing_title ?? ''
      const reason = lineBoundaryRefusal(title, slug) ??
        (VINTAGE_ONLY.has(slug) && CURRENT_PRODUCTION_CONDITIONS.has((r.condition ?? '').trim().toLowerCase())
          ? `condition:${(r.condition ?? '').trim().toLowerCase()}` : null)
      if (!reason) continue
      const target = soldTarget(slug, title, reason)
      changes.push({
        table: 'reverb_price_history', id: r.id, product: slug,
        title, price: r.price, condition: r.condition, reason,
        old: { kg_product_id: productId },
        new: { kg_product_id: target ? idOf.get(target)! : null, target },
      })
    }
  }
  return changes
}

function report(changes: Change[]): string {
  const lines: string[] = [`PAN-154 line cleanup — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${new Date().toISOString()}`, '']
  const products = Array.from(new Set(changes.map((c) => c.product))).sort()
  for (const product of Object.keys(LINE_BOUNDARIES).filter((s) => !ONLY || ONLY.includes(s))) {
    if (!products.includes(product)) { lines.push(`== ${product}: nothing to change`, ''); continue }
    const lpm = changes.filter((c): c is MatchChange => c.table === 'listing_product_match' && c.product === product)
    const rph = changes.filter((c): c is SoldChange => c.table === 'reverb_price_history' && c.product === product)
    const count = (rows: Change[], key: (c: Change) => string) => {
      const out: Record<string, number> = {}
      for (const c of rows) out[key(c)] = (out[key(c)] ?? 0) + 1
      return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ')
    }
    lines.push(`== ${product}`)
    lines.push(`listing_product_match -> is_valid=false: ${lpm.length}`)
    lines.push(`  was evidence (is_valid=true): ${lpm.filter((c) => c.old.is_valid === true).length}` +
      ` (active listing ${lpm.filter((c) => c.old.is_valid === true && c.active).length})` +
      `   was unreviewed (null): ${lpm.filter((c) => c.old.is_valid === null).length}` +
      ` (active listing ${lpm.filter((c) => c.old.is_valid === null && c.active).length})`)
    lines.push(`  by reason: ${count(lpm, (c) => c.reason.replace(/:.*/, ''))}`)
    lines.push(`  by cue:    ${count(lpm, (c) => c.reason)}`)
    lines.push(`  10 random titles (seed 154):`)
    for (const c of sample(lpm, 10)) {
      const m = c as MatchChange
      lines.push(`    [${m.old.is_valid}${m.active ? '' : ', inactive'}] ${Math.round(m.price_dkk ?? 0)} DKK | ${m.reason} | ${m.title}`)
    }
    lines.push(`reverb_price_history re-pointed: ${rph.length}`)
    lines.push(`  by target: ${count(rph, (c) => (c as SoldChange).new.target ?? 'null')}`)
    lines.push(`  by cue:    ${count(rph, (c) => c.reason)}`)
    lines.push(`  10 random titles (seed 154):`)
    for (const c of sample(rph, 10)) {
      const s = c as SoldChange
      lines.push(`    ${s.price} DKK ${s.condition ?? ''} | ${s.reason} -> ${s.new.target ?? 'null'} | ${s.title}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ── write ───────────────────────────────────────────────────────────────────

async function write(db: SupabaseClient, changes: Change[]): Promise<void> {
  const rollbackPath = path.join(OUT_DIR, `pan154-rollback-${Date.now()}.json`)
  const fd = fs.openSync(rollbackPath, 'wx')
  fs.writeSync(fd, JSON.stringify(changes, null, 1))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${rollbackPath}`)

  let written = 0
  for (const c of changes) {
    // Each update is guarded by the value the plan read, so a row a person
    // changed in between is left alone and reported, never overwritten.
    const res = c.table === 'listing_product_match'
      ? await db.from('listing_product_match').update(c.new).eq('id', c.id)
          .eq('product_id', c.product_id).not('is_valid', 'is', false).select('id')
      : await db.from('reverb_price_history').update({ kg_product_id: c.new.kg_product_id }).eq('id', c.id)
          .eq('kg_product_id', c.old.kg_product_id).select('id')
    if (res.error) throw new Error(`${c.table} ${c.id}: ${res.error.message} (stopped; ${written} written, rollback at ${rollbackPath})`)
    if ((res.data ?? []).length === 1) written += 1
    else console.warn(`skipped ${c.table} ${c.id}: changed since the plan was read`)
  }
  console.log(`written: ${written} of ${changes.length}`)
}

async function rollback(db: SupabaseClient, file: string): Promise<void> {
  const changes = JSON.parse(fs.readFileSync(file, 'utf8')) as Change[]
  let restored = 0
  for (const c of changes) {
    if (!APPLY) continue
    const res = c.table === 'listing_product_match'
      ? await db.from('listing_product_match').update(c.old).eq('id', c.id)
          .eq('rejected_reason', c.new.rejected_reason).select('id')
      : c.new.kg_product_id === null
        ? await db.from('reverb_price_history').update(c.old).eq('id', c.id).is('kg_product_id', null).select('id')
        : await db.from('reverb_price_history').update(c.old).eq('id', c.id).eq('kg_product_id', c.new.kg_product_id).select('id')
    if (res.error) throw new Error(`${c.table} ${c.id}: ${res.error.message}`)
    if ((res.data ?? []).length === 1) restored += 1
    else console.warn(`not restored ${c.table} ${c.id}: no longer holds what PAN-154 wrote`)
  }
  console.log(APPLY ? `restored: ${restored} of ${changes.length}` : `DRY RUN: would restore ${changes.length} rows from ${file}; pass --apply`)
}

async function main() {
  const db = client()
  if (ROLLBACK) return rollback(db, ROLLBACK)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const changes = await plan(db)
  const text = report(changes)
  fs.writeFileSync(path.join(OUT_DIR, 'pan154-report.txt'), text)
  fs.writeFileSync(path.join(OUT_DIR, 'pan154-plan.json'), JSON.stringify(changes, null, 1))
  console.log(text)
  console.log(`report: ${path.join(OUT_DIR, 'pan154-report.txt')}\nplan:   ${path.join(OUT_DIR, 'pan154-plan.json')}`)
  if (!APPLY) { console.log('DRY RUN — nothing written. Pass --apply to write.'); return }
  await write(db, changes)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
