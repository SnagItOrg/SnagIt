/**
 * scripts/pan154-line-cleanup.ts — PAN-154. DRY RUN unless --apply.
 *
 * Applies the matcher's line boundaries (LINE_BOUNDARIES in
 * frontend/lib/matching/match-listings.ts) to the rows written before them.
 * REASSIGN FIRST, never a blanket override (owner decision 2026-09-28: "Why
 * would you remove all the work that I did?"). For every match row the
 * boundary refuses:
 *
 *   a  the title names another member the KG holds as a clean row (REASSIGN)
 *      -> move `product_id` there; `is_valid` is kept, so a human approval and
 *         an unreviewed row both stay exactly what they were.
 *   b  the title names a member the KG does not hold
 *      -> human-approved: is_valid=false, 'PAN-154 redefinition: <what the
 *         title names>', and a line in pan154-candidates.txt;
 *      -> otherwise:      is_valid=false, 'PAN-154 line boundary: <cue>'.
 *   c  the title carries no cue for this product (a fail-closed `requires`)
 *      -> human-approved: LEFT APPROVED, listed in pan154-review.txt;
 *      -> otherwise:      is_valid=false, as b.
 *
 * A reassignment onto a listing the target already holds cannot move (the
 * (listing_id, product_id) pair is unique). The source row is then refused
 * with 'PAN-154 redefinition: already matched to <target>', and a human
 * approval moves onto the target row if that row is unreviewed. A target row
 * someone rejected is never flipped: both rows are left and listed for review.
 *
 * Sold history (`reverb_price_history.kg_product_id`) follows the same rules
 * without the human axis: re-pointed to the member it names, else null. It has
 * one extra, sold-only cue — a "Brand New" or "B-Stock" sale on a vintage-only
 * product is current production.
 *
 * `moog-model-d` is the 2016 reissue, but its `reverb_csp_id` is the VINTAGE
 * Model D (2442). The plan resolves the reissue CSP with ONE read-only call to
 * the Reverb CSP API and re-points it only if exactly one 2016 reissue CSP is
 * found; otherwise it nulls the anchor and says so.
 *
 * Owner-authorised production write (PAN-154, 2026-09-26/28). The manager runs
 * --apply after reading the dry-run report. Idempotent: a second run finds
 * nothing to change.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan154-line-cleanup.ts [--dry-run] [--out-dir=DIR] [--only=slug,slug]
 *   npx tsx scripts/pan154-line-cleanup.ts --apply --out-dir=DIR [--only=…]
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

/** The products this script cleans: every line boundary on a supported product. */
const SOURCES = Object.keys(LINE_BOUNDARIES).filter((s) => s !== 'sequential-circuits-prophet-10')

/**
 * Products whose page is the vintage original only (owner decisions
 * 2026-09-26/28; the Thinline and Mustang bases are the audit's 1968–79 and
 * 1966–81 originals).
 */
const VINTAGE_ONLY = new Set([
  'moog-minimoog', 'fender-telecaster-thinline', 'fender-mustang-bass',
])
const CURRENT_PRODUCTION_CONDITIONS = new Set(['brand new', 'b-stock'])

// ── where a refused row goes ────────────────────────────────────────────────

/**
 * Per source product, first match wins: a title pattern and the clean KG row it
 * names, or null where the member exists but the KG holds no clean row for it.
 * Every target is an existing row, SELECT-verified 2026-09-28 (merge-not-create).
 * A target is taken only if its own line boundary accepts the title too.
 */
type Rule = [RegExp, string | null]

const MOOG_VOYAGER: Rule[] = [
  [/voyager\s+xl/i, 'moog-minimoog-voyager-xl'],
  [/voyager.*(?:\brme\b|rack)|(?:\brme\b|rack).*voyager/i, 'moog-minimoog-voyager-rme'],
  // The Old School is its own model and the editions are limited runs; the KG
  // holds no clean row for either, so they are candidates, not Voyagers.
  [/voyager.*(?:old\s*school|electric\s+blue|select|signature|anniversary|limited|special|gold)|(?:old\s*school|anniversary|limited|special).*voyager/i, null],
  [/voyager/i, 'moog-minimoog-voyager'],
]

const REASSIGN: Record<string, Rule[]> = {
  'moog-minimoog': [...MOOG_VOYAGER, [/geddy\s+lee/i, 'moog-minimoog-model-d-geddy-lee'], [/(?:)/, 'moog-model-d']],
  'moog-model-d': [...MOOG_VOYAGER, [/geddy\s+lee/i, 'moog-minimoog-model-d-geddy-lee'], [/(?:)/, 'moog-minimoog']],
  'sequential-prophet-10': [[/(?:)/, 'sequential-circuits-prophet-10']],
  // PAN-154 (2/2). The only other members the KG holds as clean rows.
  'gibson-hummingbird': [[/hummingbird\s+(?:\d{4}\s+)?original|original\s+hummingbird/i, 'gibson-hummingbird-original']],
  'ua-1176ln': [
    [/6176|2-1176|channel\s+strip/i, null],
    [/urei|urie|vintage|blue\s*stripe|blackface|silverface|black\s+panel|silver\s+panel|\brev\.?\s*[a-h]\b|19[6-8]\d/i, 'universal-audio-urei-1176ln'],
  ],
  'korg-ms-20': [[/\bmini\b/i, 'korg-ms-20-mini'], [/arturia|ms-?20\s+v\b/i, 'arturia-ms-20-v']],
}

const TARGETS = Array.from(new Set(Object.values(REASSIGN).flat().map(([, t]) => t).filter((t): t is string => !!t)))

/** The clean row a refused title names, or null. Parts and fail-closed refusals never move. */
function targetFor(slug: string, title: string, refusal: string): string | null {
  if (!refusal.startsWith('other_member:') && !refusal.startsWith('condition:')) return null
  const rule = (REASSIGN[slug] ?? []).find(([re]) => re.test(title))
  const target = rule?.[1] ?? null
  return target && lineBoundaryRefusal(title, target) === null ? target : null
}

/** What the title names, for a rejected_reason: the cue without its kind. */
const named = (refusal: string) => refusal.replace(/^[a-z_]+:/, '')

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

// ── the plan ────────────────────────────────────────────────────────────────

type Explain = Record<string, unknown> | null
interface Row { id: string; listing_id: string; product_id: string; is_valid: boolean | null; rejected_reason: string | null; explain: Explain }
interface Base { product: string; title: string; price: number | null; active: boolean; human: boolean; reason: string }

/** a: move the row; is_valid untouched. */
interface Reassign extends Base {
  table: 'listing_product_match'; action: 'reassign'; id: string; target: string
  old: { product_id: string; explain: Explain }
  new: { product_id: string; explain: Explain }
}
/** b/c/conflict: refuse the row where it is. */
interface Refuse extends Base {
  table: 'listing_product_match'; action: 'refuse'; id: string; product_id: string
  old: { is_valid: boolean | null; rejected_reason: string | null }
  new: { is_valid: false; rejected_reason: string }
}
/** A human approval moving onto the unreviewed row the listing already has on the target. */
interface Approve extends Base {
  table: 'listing_product_match'; action: 'approve'; id: string; target: string
  old: { is_valid: null }
  new: { is_valid: true }
}
interface Sold extends Base {
  table: 'reverb_price_history'; action: 'repoint'; id: string; target: string | null
  old: { kg_product_id: string }
  new: { kg_product_id: string | null }
}
interface Csp {
  table: 'kg_product'; action: 'csp'; id: string; product: string; reason: string
  old: { reverb_csp_id: number | null; attributes: Explain }
  new: { reverb_csp_id: number | null; attributes: Explain }
}
type Change = Reassign | Refuse | Approve | Sold | Csp

/** Rows the plan deliberately leaves alone and a person should look at. */
interface Review { product: string; kind: string; human: boolean; title: string; price: number | null; reason: string; note: string }

const isHuman = (r: Row) => r.is_valid === true && !!(r.explain as { admin_decision?: unknown } | null)?.admin_decision

async function plan(db: SupabaseClient): Promise<{ changes: Change[]; review: Review[] }> {
  const scope = SOURCES.filter((s) => !ONLY || ONLY.includes(s))
  const slugs = Array.from(new Set([...scope, ...TARGETS]))
  const { data: prods, error } = await db.from('kg_product').select('id, slug, reverb_csp_id, attributes').in('slug', slugs)
  if (error) throw new Error(error.message)
  const bySlug = new Map((prods ?? []).map((p) => [p.slug as string, p]))
  for (const s of slugs) if (!bySlug.has(s)) throw new Error(`kg_product '${s}' not found — refusing to plan`)
  const idOf = (slug: string) => bySlug.get(slug)!.id as string

  const changes: Change[] = []
  const review: Review[] = []
  /** listing_id|product_id pairs that exist now or that this plan creates. */
  const held = new Map<string, Row>()
  const key = (listingId: string, productId: string) => `${listingId}|${productId}`

  type M = Row & { listings: { title: string | null; price_dkk: number | null; is_active: boolean | null } | null }
  const rowsOf = new Map<string, M[]>()
  for (const slug of Array.from(new Set([...scope, ...TARGETS]))) {
    const rows = await readAll<M>(() => db.from('listing_product_match')
      .select('id, listing_id, product_id, is_valid, rejected_reason, explain, listings(title, price_dkk, is_active)')
      .eq('product_id', idOf(slug)).order('id'))
    rowsOf.set(slug, rows)
    for (const r of rows) held.set(key(r.listing_id, r.product_id), r)
  }

  for (const slug of scope) {
    for (const m of rowsOf.get(slug)!) {
      if (m.is_valid === false) continue
      const title = m.listings?.title ?? ''
      const reason = lineBoundaryRefusal(title, slug)
      if (!reason) continue
      const base: Base = {
        product: slug, title, price: m.listings?.price_dkk ?? null,
        active: m.listings?.is_active !== false, human: isHuman(m), reason,
      }
      const refuse = (why: string): Refuse => ({
        ...base, table: 'listing_product_match', action: 'refuse', id: m.id, product_id: m.product_id,
        old: { is_valid: m.is_valid, rejected_reason: m.rejected_reason },
        new: { is_valid: false, rejected_reason: why },
      })

      const target = targetFor(slug, title, reason)
      if (target) {
        const existing = held.get(key(m.listing_id, idOf(target)))
        if (!existing) {
          held.set(key(m.listing_id, idOf(target)), m)
          changes.push({
            ...base, table: 'listing_product_match', action: 'reassign', id: m.id, target,
            old: { product_id: m.product_id, explain: m.explain },
            new: { product_id: idOf(target), explain: { ...(m.explain ?? {}), pan154_reassigned: { from: slug, cue: reason } } },
          })
        } else if (existing.is_valid === false) {
          review.push({ ...base, kind: 'conflict', note: `listing already rejected on ${target}; both rows left as they are` })
        } else {
          changes.push(refuse(`PAN-154 redefinition: already matched to ${target}`))
          if (base.human && existing.is_valid === null) {
            changes.push({
              ...base, table: 'listing_product_match', action: 'approve', id: existing.id, target,
              old: { is_valid: null }, new: { is_valid: true },
            })
          }
        }
        continue
      }

      if (reason === 'no_member_cue') {
        if (base.human) review.push({ ...base, kind: 'c', note: 'human-approved, no cue either way: left approved' })
        else changes.push(refuse(`PAN-154 line boundary: ${reason}`))
        continue
      }
      changes.push(refuse(base.human ? `PAN-154 redefinition: ${named(reason)}` : `PAN-154 line boundary: ${reason}`))
    }

    type S = { id: string; listing_title: string | null; price: number | null; condition: string | null }
    const sold = await readAll<S>(() => db.from('reverb_price_history')
      .select('id, listing_title, price, condition').eq('kg_product_id', idOf(slug)).order('id'))
    for (const r of sold) {
      const title = r.listing_title ?? ''
      const condition = (r.condition ?? '').trim().toLowerCase()
      const reason = lineBoundaryRefusal(title, slug) ??
        (VINTAGE_ONLY.has(slug) && CURRENT_PRODUCTION_CONDITIONS.has(condition) ? `condition:${condition}` : null)
      if (!reason) continue
      const target = targetFor(slug, title, reason)
      changes.push({
        product: slug, title, price: r.price, active: true, human: false, reason,
        table: 'reverb_price_history', action: 'repoint', id: r.id, target,
        old: { kg_product_id: idOf(slug) }, new: { kg_product_id: target ? idOf(target) : null },
      })
    }
  }

  if (scope.includes('moog-model-d')) {
    const change = await modelDCsp(bySlug.get('moog-model-d')! as { id: string; reverb_csp_id: number | null; attributes: Explain })
    if (change) changes.push(change)
  }
  return { changes, review }
}

/**
 * The 2016 reissue's CSP, by ONE read-only call. Verified only when exactly one
 * CSP titled "Minimoog Model D Reissue … 2016" comes back; otherwise the
 * vintage anchor is removed and nothing is guessed.
 */
async function modelDCsp(p: { id: string; reverb_csp_id: number | null; attributes: Explain }): Promise<Csp | null> {
  const VINTAGE_MODEL_D_CSP = 2442
  if (p.reverb_csp_id !== VINTAGE_MODEL_D_CSP) return null
  type C = { id: number; slug: string; title: string; used_total?: number; photos?: Array<{ _links?: { full?: { href?: string } } }> }
  let found: C[] = []
  try {
    const res = await fetch('https://api.reverb.com/api/csps?query=Moog%20Minimoog%20Model%20D%20Reissue&make=moog', {
      headers: { 'Accept-Version': '3.0', Accept: 'application/hal+json', 'Content-Type': 'application/hal+json' },
    })
    if (res.ok) found = ((await res.json()) as { comparison_shopping_pages?: C[] }).comparison_shopping_pages ?? []
  } catch { /* fall through to null */ }
  const reissue = found.filter((c) => /minimoog model d reissue/i.test(c.title) && /2016/.test(c.title))
  const attributes = { ...(p.attributes ?? {}) } as Record<string, unknown>
  if (reissue.length === 1) {
    const c = reissue[0]
    attributes.reverb_csp = {
      csp_id: c.id, slug: c.slug, title: c.title,
      image_url: c.photos?.[0]?._links?.full?.href ?? null, used_total: c.used_total ?? 0,
      confidence: 'high', resolved_at: new Date().toISOString(), verified_by: 'PAN-154',
    }
    const others = found.filter((x) => /model d reissue/i.test(x.title) && x.id !== c.id).map((x) => `${x.id} "${x.title}"`)
    return {
      table: 'kg_product', action: 'csp', id: p.id, product: 'moog-model-d',
      reason: `reissue CSP ${c.id} "${c.title}"${others.length ? `; other reissue CSPs, not taken: ${others.join(', ')}` : ''}`,
      old: { reverb_csp_id: p.reverb_csp_id, attributes: p.attributes },
      new: { reverb_csp_id: c.id, attributes },
    }
  }
  delete attributes.reverb_csp
  return {
    table: 'kg_product', action: 'csp', id: p.id, product: 'moog-model-d',
    reason: `no single 2016 reissue CSP found (${found.length} results): vintage anchor removed`,
    old: { reverb_csp_id: p.reverb_csp_id, attributes: p.attributes },
    new: { reverb_csp_id: null, attributes },
  }
}

// ── report ──────────────────────────────────────────────────────────────────

function count<T>(rows: T[], keyOf: (r: T) => string): string {
  const out: Record<string, number> = {}
  for (const r of rows) out[keyOf(r)] = (out[keyOf(r)] ?? 0) + 1
  return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ') || '-'
}

function report(changes: Change[], review: Review[]): string {
  const lines = [`PAN-154 line cleanup — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${new Date().toISOString()}`, '']
  for (const product of SOURCES.filter((s) => !ONLY || ONLY.includes(s))) {
    const mine = changes.filter((c) => c.product === product)
    const rev = review.filter((r) => r.product === product)
    const lpm = mine.filter((c): c is Reassign | Refuse => c.action === 'reassign' || c.action === 'refuse')
    const human = lpm.filter((c) => c.human)
    const sold = mine.filter((c): c is Sold => c.action === 'repoint')
    lines.push(`== ${product}`)
    lines.push(`human-approved: a reassigned ${human.filter((c) => c.action === 'reassign').length}` +
      `  b refused ${human.filter((c) => c.action === 'refuse' && !c.new.rejected_reason.includes('already matched')).length}` +
      `  c left for review ${rev.filter((r) => r.human && r.kind === 'c').length}` +
      `  duplicate of a target row ${human.filter((c) => c.action === 'refuse' && c.new.rejected_reason.includes('already matched')).length}`)
    const other = lpm.filter((c) => !c.human)
    lines.push(`other rows: reassigned ${other.filter((c) => c.action === 'reassign').length}` +
      `  refused ${other.filter((c) => c.action === 'refuse').length}` +
      ` (were evidence ${other.filter((c) => c.action === 'refuse' && c.old.is_valid === true).length},` +
      ` active ${other.filter((c) => c.action === 'refuse' && c.active).length})`)
    lines.push(`  reassigned to: ${count(lpm.filter((c): c is Reassign => c.action === 'reassign'), (c) => c.target)}`)
    lines.push(`  refused by:    ${count(lpm.filter((c): c is Refuse => c.action === 'refuse'), (c) => c.reason)}`)
    lines.push(`  approvals moved onto an existing target row: ${mine.filter((c) => c.action === 'approve').length}`)
    lines.push(`  conflicts left for review: ${rev.filter((r) => r.kind === 'conflict').length}`)
    lines.push(`  10 random titles (seed 154):`)
    for (const c of sample(lpm, 10)) {
      lines.push(`    ${c.action === 'reassign' ? `-> ${c.target}` : `refuse (was ${c.old.is_valid})`}${c.human ? ' [human]' : ''} ${Math.round(c.price ?? 0)} DKK | ${c.reason} | ${c.title}`)
    }
    lines.push(`reverb_price_history: ${sold.length}  to: ${count(sold, (c) => c.target ?? 'null')}`)
    for (const c of sample(sold, 10)) lines.push(`    -> ${c.target ?? 'null'} ${c.price} DKK | ${c.reason} | ${c.title}`)
    for (const c of mine.filter((c): c is Csp => c.action === 'csp')) {
      lines.push(`kg_product.reverb_csp_id: ${c.old.reverb_csp_id} -> ${c.new.reverb_csp_id} (${c.reason})`)
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
    // Every update is guarded by the value the plan read, so a row a person
    // changed in between is left alone and reported, never overwritten.
    const lpm = () => db.from('listing_product_match')
    const res =
      c.action === 'reassign' ? await lpm().update(c.new).eq('id', c.id).eq('product_id', c.old.product_id).not('is_valid', 'is', false).select('id')
      : c.action === 'refuse' ? await lpm().update(c.new).eq('id', c.id).eq('product_id', c.product_id).not('is_valid', 'is', false).select('id')
      : c.action === 'approve' ? await lpm().update(c.new).eq('id', c.id).is('is_valid', null).select('id')
      : c.action === 'repoint' ? await db.from('reverb_price_history').update(c.new).eq('id', c.id).eq('kg_product_id', c.old.kg_product_id).select('id')
      : await db.from('kg_product').update(c.new).eq('id', c.id).eq('reverb_csp_id', c.old.reverb_csp_id!).select('id')
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
    const lpm = () => db.from('listing_product_match')
    const res =
      c.action === 'reassign' ? await lpm().update(c.old).eq('id', c.id).eq('product_id', c.new.product_id).select('id')
      : c.action === 'refuse' ? await lpm().update(c.old).eq('id', c.id).eq('rejected_reason', c.new.rejected_reason).select('id')
      : c.action === 'approve' ? await lpm().update(c.old).eq('id', c.id).eq('is_valid', true).select('id')
      : c.action === 'repoint'
        ? (c.new.kg_product_id === null
          ? await db.from('reverb_price_history').update(c.old).eq('id', c.id).is('kg_product_id', null).select('id')
          : await db.from('reverb_price_history').update(c.old).eq('id', c.id).eq('kg_product_id', c.new.kg_product_id).select('id'))
      : c.new.reverb_csp_id === null
        ? await db.from('kg_product').update(c.old).eq('id', c.id).is('reverb_csp_id', null).select('id')
        : await db.from('kg_product').update(c.old).eq('id', c.id).eq('reverb_csp_id', c.new.reverb_csp_id).select('id')
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
  const { changes, review } = await plan(db)
  const text = report(changes, review)
  const out = (name: string) => path.join(OUT_DIR, name)
  fs.writeFileSync(out('pan154-report.txt'), text)
  fs.writeFileSync(out('pan154-plan.json'), JSON.stringify(changes, null, 1))
  const candidates = changes.filter((c): c is Refuse => c.action === 'refuse' && c.human && c.new.rejected_reason.startsWith('PAN-154 redefinition:') && !c.new.rejected_reason.includes('already matched'))
  fs.writeFileSync(out('pan154-candidates.txt'),
    '# Human-approved rows whose title names a member the KG does not hold (b). One line each: product | what the title names | DKK | title\n' +
    candidates.map((c) => `${c.product} | ${named(c.reason)} | ${Math.round(c.price ?? 0)} | ${c.title}`).sort().join('\n') + '\n')
  fs.writeFileSync(out('pan154-review.txt'),
    '# Rows the plan leaves as they are, for the owner: (c) human-approved with no cue either way; (conflict) the target already rejects the listing.\n' +
    review.map((r) => `${r.kind} | ${r.product} | ${Math.round(r.price ?? 0)} | ${r.title} | ${r.note}`).sort().join('\n') + '\n')
  console.log(text)
  for (const f of ['pan154-report.txt', 'pan154-plan.json', 'pan154-candidates.txt', 'pan154-review.txt']) console.log(out(f))
  if (!APPLY) { console.log('DRY RUN — nothing written. Pass --apply to write.'); return }
  await write(db, changes)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
