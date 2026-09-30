/**
 * scripts/pan195-fender-rematch.ts — PAN-195. DRY RUN unless --apply.
 *
 * Re-decides two cohorts against the Fender series models PAN-195 creates:
 *
 *   held      — listings whose live match (is_valid NULL or true) sits on a
 *               Fender family LABEL row (`fender-stratocaster`, …). A label is
 *               never a match target (PAN-84), so these are stranded there.
 *   unmatched — active listings whose title names one of the seven lines and
 *               that hold no live match anywhere.
 *
 * Every decision is `decideMatch`'s. Nothing here scores a title.
 *
 * TWO COLUMNS, BECAUSE SUPPORT IS NOT OURS TO WIDEN. `isMatchableProduct` lets
 * only `supported` rows receive automatic matches, and PAN-195 creates the new
 * models as `known`. So the dry run prints, for every listing:
 *
 *   now        — the decision against the real index (`loadMatchIndex`). This
 *                is exactly what --apply writes.
 *   supported  — the decision if the families' children were `supported`. A
 *                forecast for the owner's promotion decision. Never written.
 *
 * --apply: an owner-authorised production write. It writes the rollback file
 * BEFORE the first write (start time, the listing ids, and every held label
 * row's prior is_valid / rejected_reason), then:
 *   1. hands every listing to `matchListings`, the one writer, which writes
 *      what `decideMatch` decides against the real index;
 *   2. for a held listing that step 1 gave a live row on another product,
 *      marks its label row is_valid=false, rejected_reason
 *      'pan195_moved_to_model', guarded on the prior is_valid it read.
 *
 * --rollback=FILE: deletes the match rows created for those listings at or
 * after the recorded start, except any a person has approved since
 * (is_valid=true), and restores each label row's prior is_valid and
 * rejected_reason. Also a dry run without --apply.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan195-fender-rematch.ts [--show=N]
 *   npx tsx scripts/pan195-fender-rematch.ts --apply [--out-dir=DIR]
 *   npx tsx scripts/pan195-fender-rematch.ts --rollback=DIR/pan195-rollback-<ts>.json [--apply]
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
import { getFamily } from '../frontend/lib/families'
import {
  PRODUCT_SELECT,
  buildMatchIndex,
  decideMatch,
  isMatchableProduct,
  loadMatchIndex,
  matchListings,
  normalizeProductRow,
  type MatchIndex,
  type Product,
} from '../frontend/lib/matching/match-listings'

/**
 * The seven Fender lines: the family slug, the label row it guards (null for
 * `mustang-short-scale-bass`, which has none) and the title test that says a
 * listing names the line. Squier listings are kept in scope on purpose:
 * `decideMatch` rejects them against Fender rows, which is the auditable
 * outcome, and filtering them here would hide that.
 */
export const LINES: ReadonlyArray<{ family: string; label: string | null; names: RegExp; ilike: string[] }> = [
  { family: 'fender-stratocaster', label: 'fender-stratocaster', names: /stratocaster|\bstrat\b/i, ilike: ['%strat%'] },
  { family: 'fender-telecaster', label: 'fender-telecaster', names: /telecaster|\btele\b/i, ilike: ['%tele%'] },
  { family: 'fender-jazzmaster', label: 'fender-jazzmaster', names: /jazz ?master/i, ilike: ['%jazzmaster%', '%jazz master%'] },
  { family: 'fender-jaguar', label: 'fender-jaguar', names: /jaguar/i, ilike: ['%jaguar%'] },
  { family: 'fender-precision-bass', label: 'fender-precision-bass', names: /precision|\bp-?bass\b/i, ilike: ['%precision%', '%p-bass%', '%pbass%', '%p bass%'] },
  { family: 'fender-jazz-bass', label: 'fender-jazz-bass', names: /jazz ?bass|\bj-?bass\b/i, ilike: ['%jazzbass%', '%jazz bass%', '%j-bass%', '%jbass%', '%j bass%'] },
  { family: 'mustang-short-scale-bass', label: null, names: /mustang/i, ilike: ['%mustang%'] },
]

export const REJECTED_REASON = 'pan195_moved_to_model'

export interface PoolListing {
  id: string
  title: string
  cohort: 'held' | 'unmatched'
  family: string
  /** held only: the label row's prior state, restored exactly by --rollback. */
  prior_is_valid?: boolean | null
  prior_rejected_reason?: string | null
}

export type Outcome = { key: string; slug: string | null }

/** One listing's decision, keyed the way the report counts it. */
export function outcome(title: string, index: MatchIndex): Outcome {
  const d = decideMatch(title, index)
  const slug = d.kind === 'matched' || d.kind === 'rejected' ? index.productById.get(d.best.product_id)?.slug ?? null : null
  if (d.kind === 'deferred') return { key: `deferred:${d.reason}`, slug: null }
  return { key: slug ? `${d.kind}:${slug}` : d.kind, slug }
}

/**
 * The forecast index: the real candidates plus every child of the seven
 * families, with support forced to `supported` IN MEMORY ONLY. It exists to
 * answer "what would move if the owner promoted them", and nothing built from
 * it is ever written.
 */
export function forecastIndex(real: Product[], children: Product[], idents: MatchIndex['idents'], synonyms: MatchIndex['synonyms'], brands: Iterable<string>): MatchIndex {
  const byId = new Map(real.map((p) => [p.id, p]))
  for (const c of children) if (c.status === 'active') byId.set(c.id, { ...c, support_state: 'supported' })
  return buildMatchIndex(Array.from(byId.values()), idents, synonyms, brands)
}

export function familyChildSlugs(): string[] {
  const out = new Set<string>()
  for (const line of LINES) for (const c of getFamily(line.family)?.children ?? []) out.add(c)
  return Array.from(out)
}

/* ── I/O ─────────────────────────────────────────────────────────────────── */

// The frontend copy of supabase-js, because the client is handed to
// frontend/lib/matching (the pattern scripts/pan193-jupiter-rematch.ts uses).
const CHUNK = 100

function client(): SupabaseClient {
  const { createClient } = require('../frontend/node_modules/@supabase/supabase-js') as typeof import('../frontend/node_modules/@supabase/supabase-js')
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

const chunks = <T>(xs: T[]): T[][] =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

async function labelIds(db: SupabaseClient): Promise<Map<string, string>> {
  const slugs = LINES.map((l) => l.label).filter((s): s is string => !!s)
  const { data, error } = await db.from('kg_product').select('id, slug').in('slug', slugs)
  if (error) throw new Error(error.message)
  const out = new Map<string, string>()
  for (const r of data ?? []) out.set(r.slug as string, r.id as string)
  if (out.size !== slugs.length) throw new Error(`label rows missing: expected ${slugs.length}, found ${out.size}`)
  return out
}

/**
 * Held rows are one entry per (listing, label) — a listing can sit on two
 * labels, and each label row is released and restored on its own. Unmatched
 * listings are one entry per listing.
 */
async function pool(db: SupabaseClient, labels: Map<string, string>): Promise<PoolListing[]> {
  const held: PoolListing[] = []
  for (const line of LINES) {
    if (!line.label) continue
    type H = {
      listing_id: string
      is_valid: boolean | null
      rejected_reason: string | null
      listings: { title: string | null } | { title: string | null }[] | null
    }
    const rows = await readAll<H>(() => db.from('listing_product_match')
      .select('listing_id, is_valid, rejected_reason, listings!inner(title)')
      .eq('product_id', labels.get(line.label!)!).or('is_valid.is.null,is_valid.eq.true').order('listing_id'))
    for (const r of rows) {
      const l = Array.isArray(r.listings) ? r.listings[0] : r.listings
      if (!l?.title) continue
      held.push({
        id: r.listing_id, title: l.title, cohort: 'held', family: line.family,
        prior_is_valid: r.is_valid, prior_rejected_reason: r.rejected_reason,
      })
    }
  }

  const out = new Map<string, PoolListing>()
  const heldIds = new Set(held.map((l) => l.id))
  type L = { id: string; title: string | null }
  for (const line of LINES) {
    const rows = (await readAll<L>(() => db.from('listings').select('id, title').eq('is_active', true)
      .or(line.ilike.map((p) => `title.ilike.${p}`).join(',')).order('id')))
      .filter((l): l is { id: string; title: string } =>
        !!l.title && line.names.test(l.title) && !heldIds.has(l.id) && !out.has(l.id))
    const live = new Set<string>()
    for (const ids of chunks(rows.map((l) => l.id))) {
      const { data, error } = await db.from('listing_product_match').select('listing_id')
        .in('listing_id', ids).or('is_valid.is.null,is_valid.eq.true')
      if (error) throw new Error(error.message)
      for (const r of data ?? []) live.add(r.listing_id as string)
    }
    for (const l of rows) if (!live.has(l.id)) out.set(l.id, { id: l.id, title: l.title, cohort: 'unmatched', family: line.family })
  }
  return [...held, ...Array.from(out.values())]
}

async function loadChildren(db: SupabaseClient): Promise<Product[]> {
  const rows = await readAll<Parameters<typeof normalizeProductRow>[0]>(() =>
    db.from('kg_product').select(PRODUCT_SELECT).in('slug', familyChildSlugs()).order('id'))
  return rows.map(normalizeProductRow)
}

async function rematch(db: SupabaseClient, apply: boolean, outDir: string, show: number): Promise<void> {
  const labels = await labelIds(db)
  const [listings, index, children] = await Promise.all([pool(db, labels), loadMatchIndex(db), loadChildren(db)])
  const brands = index.catalogueBrands
  const forecast = forecastIndex(index.products, children, index.idents, index.synonyms, brands)
  const notMatchable = children.filter((c) => !isMatchableProduct(c)).length

  const counts = new Map<string, { now: number; supported: number }>()
  const bump = (k: string, col: 'now' | 'supported') => {
    const c = counts.get(k) ?? { now: 0, supported: 0 }
    c[col] += 1
    counts.set(k, c)
  }
  const lines: string[] = []
  for (const l of listings) {
    const now = outcome(l.title, index)
    const fc = outcome(l.title, forecast)
    bump(`${l.family} ${l.cohort} ${now.key}`, 'now')
    bump(`${l.family} ${l.cohort} ${fc.key}`, 'supported')
    if (now.key !== fc.key || now.slug) lines.push(`  ${l.cohort} | now=${now.key} | supported=${fc.key} | ${l.title}`)
  }

  console.log(`PAN-195 Fender re-match — ${apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`  ${listings.filter((l) => l.cohort === 'held').length} held on label rows, ${listings.filter((l) => l.cohort === 'unmatched').length} unmatched`)
  console.log(`  ${children.length} family children loaded; ${notMatchable} are not match targets today (known/qa_only), so "now" cannot reach them`)
  console.log('family cohort outcome: now | if children were supported')
  for (const [k, c] of Array.from(counts.entries()).sort()) console.log(`  ${k}: ${c.now} | ${c.supported}`)
  if (show > 0) console.log(lines.sort().slice(0, show).join('\n'))
  if (!apply) return

  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `pan195-rollback-${Date.now()}.json`)
  const held = listings.filter((l) => l.cohort === 'held')
  const listingIds = Array.from(new Set(listings.map((l) => l.id)))
  const fd = fs.openSync(file, 'wx')
  fs.writeSync(fd, JSON.stringify({
    started_at: new Date().toISOString(),
    listing_ids: listingIds,
    label_rows: held.map((l) => ({
      listing_id: l.id,
      product_id: labels.get(l.family),
      is_valid: l.prior_is_valid ?? null,
      rejected_reason: l.prior_rejected_reason ?? null,
    })),
  }))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${file}`)

  for (const ids of chunks(listingIds)) console.log(await matchListings(db, ids))

  // A held listing moves only if step 1 gave it a live row on a real product.
  const labelIdSet = new Set(labels.values())
  let moved = 0
  for (const group of chunks(held)) {
    const { data, error } = await db.from('listing_product_match').select('listing_id, product_id')
      .in('listing_id', group.map((l) => l.id)).or('is_valid.is.null,is_valid.eq.true')
    if (error) throw new Error(error.message)
    const landed = new Set((data ?? []).filter((r) => !labelIdSet.has(r.product_id as string)).map((r) => r.listing_id as string))
    for (const l of group) {
      if (!landed.has(l.id)) continue
      let q = db.from('listing_product_match').update({ is_valid: false, rejected_reason: REJECTED_REASON })
        .eq('listing_id', l.id).eq('product_id', labels.get(l.family)!)
      q = l.prior_is_valid === null || l.prior_is_valid === undefined ? q.is('is_valid', null) : q.eq('is_valid', l.prior_is_valid)
      const { error: uErr } = await q
      if (uErr) throw new Error(uErr.message)
      moved += 1
    }
  }
  console.log(`label rows released: ${moved}`)
}

async function rollback(db: SupabaseClient, file: string, apply: boolean): Promise<void> {
  const { started_at, listing_ids, label_rows } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    started_at: string
    listing_ids: string[]
    label_rows: Array<{ listing_id: string; product_id: string; is_valid: boolean | null; rejected_reason: string | null }>
  }
  const labelIdSet = new Set(label_rows.map((r) => r.product_id))
  const created: Array<{ id: string; product_id: string }> = []
  for (const ids of chunks(listing_ids)) {
    const { data, error } = await db.from('listing_product_match').select('id, product_id')
      .in('listing_id', ids).gte('created_at', started_at).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
    created.push(...((data ?? []) as Array<{ id: string; product_id: string }>).filter((r) => !labelIdSet.has(r.product_id)))
  }
  console.log(`PAN-195 rollback — ${apply ? 'APPLY' : 'DRY RUN'} — ${created.length} rows created since ${started_at}; ${label_rows.length} label rows to restore`)
  if (!apply) return
  for (const ids of chunks(created.map((r) => r.id))) {
    const { error } = await db.from('listing_product_match').delete().in('id', ids).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
  }
  for (const r of label_rows) {
    const { error } = await db.from('listing_product_match').update({ is_valid: r.is_valid, rejected_reason: r.rejected_reason })
      .eq('listing_id', r.listing_id).eq('product_id', r.product_id).eq('rejected_reason', REJECTED_REASON)
    if (error) throw new Error(error.message)
  }
  console.log('restored')
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const APPLY = args.includes('--apply')
  const ROLLBACK = flag('rollback')
  const db = client()
  ;(ROLLBACK
    ? rollback(db, ROLLBACK, APPLY)
    : rematch(db, APPLY, flag('out-dir') ?? path.join(os.tmpdir(), 'pan195'), Number(flag('show') ?? 200))
  ).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
