/**
 * scripts/pan222-rickenbacker-rematch.ts — PAN-222. DRY RUN unless --apply.
 * A copy of scripts/pan220-prs-rematch.ts for the Rickenbacker pass.
 *
 * Re-decides two cohorts against the Rickenbacker models PAN-222 creates and promotes (no Rickenbacker
 * navigation family exists, so the Gibson `held` cohort is empty here):
 *
 *   stale     — listings whose UNREVIEWED live match (is_valid NULL) sits on one of the PROMOTED rows.
 *               Empty today: no Rickenbacker row held a match before this pass. A match a person decided
 *               (`admin_decision`, HUMAN_DECISION) or the AI pass confirmed (`is_valid=true`, AI_TRUE)
 *               is never re-decided, released or rewritten; the dry run counts both.
 *   unmatched — active listings whose title names Rickenbacker and that hold no live match anywhere.
 *
 * Every decision is `decideMatch`'s. Nothing here scores a title.
 *
 * TWO COLUMNS, BECAUSE SUPPORT IS NOT OURS TO WIDEN. Only `supported` rows
 * receive automatic matches, so the dry run prints, for every listing:
 *
 *   now        — the decision against the real index (`loadMatchIndex`). This
 *                is exactly what --apply writes. After the promote SQL has run,
 *                it IS the promoted state.
 *   supported  — the decision if every PROMOTED row were `supported`. A
 *                forecast for the promotion. Never written.
 *
 * --apply: an owner-authorised production write, run only after the promote
 * SQL. It writes the rollback file BEFORE the first write (start time, the
 * listing ids, and every held row's prior is_valid / rejected_reason), then:
 *   1. hands every listing to `matchListings`, the one writer, which writes
 *      what `decideMatch` decides against the real index;
 *   2. for a stale listing that step 1 gave a live row on ANOTHER product, marks
 *      the old row is_valid=false, rejected_reason 'pan222_moved_to_model',
 *      guarded on the prior is_valid it read. A stale listing that lands nowhere
 *      keeps its row and is listed for review: undecidable is not wrong.
 * A listing whose live match is human-decided is in neither cohort, so --apply
 * never hands it to `matchListings`.
 *
 * --rollback=FILE: deletes the match rows created for those listings at or
 * after the recorded start, except any a person has approved since
 * (is_valid=true), and restores each released row's prior is_valid and
 * rejected_reason. Also a dry run without --apply.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/pan222-rickenbacker-rematch.ts [--show=N]
 *   npx tsx scripts/pan222-rickenbacker-rematch.ts --apply [--out-dir=DIR]
 *   npx tsx scripts/pan222-rickenbacker-rematch.ts --rollback=DIR/pan222-rollback-<ts>.json [--apply]
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import dotenv from 'dotenv'
import type { SupabaseClient } from '../frontend/node_modules/@supabase/supabase-js'
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
import { filterByIlike, readActiveTitles } from './lib/rematch-active-titles'
import { AI_TRUE, HUMAN_DECISION } from './lib/rematch-verdicts'

/** Rickenbacker has no family label rows, so no held cohort. */
export const LABELS: readonly string[] = []

/**
 * The rows the PAN-222 promote SQL moves from `known` to `supported`: the same reviewed list,
 * verbatim. The three rows Rickenbacker had (4001, 4003, 360/12) and the 4003S PAN-222 step 2 created.
 */
export const PROMOTED: readonly string[] = ['rickenbacker-360-12', 'rickenbacker-4001', 'rickenbacker-4003', 'rickenbacker-4003s']

/** No Rickenbacker row is supported today. */
export const SUPPORTED_TODAY: readonly string[] = []

/** Every row this script re-decides stale matches on. */
export const RE_DECIDED: readonly string[] = [...PROMOTED, ...SUPPORTED_TODAY]

/** The unmatched cohort: active titles that name Rickenbacker (the boundary's RICKENBACKER_NAMED). */
export const LINES: ReadonlyArray<{ line: string; names: RegExp; ilike: string[] }> = [
  { line: 'rickenbacker', names: /(?<![a-z])rickenbacker/i, ilike: ['%rickenbacker%'] },
]

export const REJECTED_REASON = 'pan222_moved_to_model'

export interface PoolListing {
  id: string
  title: string
  cohort: 'held' | 'stale' | 'unmatched'
  /** The label or promoted row the listing is held on, or its line when unmatched. */
  group: string
  /** held/stale only: the held row's product and prior state, restored exactly by --rollback. */
  product_id?: string
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
 * The forecast index: the real candidates plus every PROMOTED row, with
 * support forced to `supported` IN MEMORY ONLY. It answers "what would move if
 * the promotion ran", and nothing built from it is ever written.
 */
export function forecastIndex(real: Product[], promoted: Product[], idents: MatchIndex['idents'], synonyms: MatchIndex['synonyms'], brands: Iterable<string>): MatchIndex {
  const byId = new Map(real.map((p) => [p.id, p]))
  for (const c of promoted) if (c.status === 'active') byId.set(c.id, { ...c, support_state: 'supported' })
  return buildMatchIndex(Array.from(byId.values()), idents, synonyms, brands)
}

/* ── I/O ─────────────────────────────────────────────────────────────────── */

// The frontend copy of supabase-js, because the client is handed to
// frontend/lib/matching (the pattern scripts/pan195-fender-rematch.ts uses).
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

/** slug -> id for the re-decided rows; every one must exist. */
async function heldRowIds(db: SupabaseClient): Promise<Map<string, string>> {
  const slugs = [...LABELS, ...RE_DECIDED]
  const out = new Map<string, string>()
  for (const group of chunks(slugs)) {
    const { data, error } = await db.from('kg_product').select('id, slug').in('slug', group)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) out.set(r.slug as string, r.id as string)
  }
  if (out.size !== slugs.length) throw new Error(`held rows missing: expected ${slugs.length}, found ${out.size}`)
  return out
}

/**
 * Held and stale rows are one entry per (listing, row) — a listing can sit on
 * two rows, and each is released and restored on its own. Unmatched listings
 * are one entry per listing.
 */
/** Live rows on the re-decided rows that a person decided, skipped by `pool` (printed by the dry run). */
const humanDecided: string[] = []
/** Live rows the AI pass confirmed (is_valid=true), skipped by `pool` (counted by the dry run). */
const aiTrue: string[] = []

async function pool(db: SupabaseClient, ids: Map<string, string>): Promise<PoolListing[]> {
  const held: PoolListing[] = []
  for (const slug of [...LABELS, ...RE_DECIDED]) {
    type H = {
      listing_id: string
      is_valid: boolean | null
      rejected_reason: string | null
      explain: unknown
      listings: { title: string | null } | { title: string | null }[] | null
    }
    const productId = ids.get(slug)!
    const rows = await readAll<H>(() => db.from('listing_product_match')
      .select('listing_id, is_valid, rejected_reason, explain, listings!inner(title)')
      .eq('product_id', productId).or('is_valid.is.null,is_valid.eq.true').order('listing_id'))
    for (const r of rows) {
      const l = Array.isArray(r.listings) ? r.listings[0] : r.listings
      if (!l?.title) continue
      // A person's verdict stands: never re-decided, never released (and its listing, which holds a
      // live match, is not in the unmatched cohort either).
      if (HUMAN_DECISION(r.explain)) { humanDecided.push(`${slug} | ${l.title}`); continue }
      // An AI-confirmed verdict stands too (decision 8): listed, never moved or released.
      if (AI_TRUE(r.is_valid)) { aiTrue.push(`${slug} | ${l.title}`); continue }
      held.push({
        id: r.listing_id, title: l.title, cohort: LABELS.includes(slug) ? 'held' : 'stale', group: slug,
        product_id: productId, prior_is_valid: r.is_valid, prior_rejected_reason: r.rejected_reason,
      })
    }
  }

  const out = new Map<string, PoolListing>()
  const heldIds = new Set(held.map((l) => l.id))
  // One plan-proof keyset read of every active title; the ILIKE patterns are applied in memory.
  const active = await readActiveTitles(db)
  for (const line of LINES) {
    const rows = filterByIlike(active, line.ilike)
      .filter((l) => line.names.test(l.title) && !heldIds.has(l.id) && !out.has(l.id))
    const live = new Set<string>()
    for (const group of chunks(rows.map((l) => l.id))) {
      const { data, error } = await db.from('listing_product_match').select('listing_id')
        .in('listing_id', group).or('is_valid.is.null,is_valid.eq.true')
      if (error) throw new Error(error.message)
      for (const r of data ?? []) live.add(r.listing_id as string)
    }
    for (const l of rows) if (!live.has(l.id)) out.set(l.id, { id: l.id, title: l.title, cohort: 'unmatched', group: line.line })
  }
  return [...held, ...Array.from(out.values())]
}

async function loadPromoted(db: SupabaseClient): Promise<Product[]> {
  const rows = await readAll<Parameters<typeof normalizeProductRow>[0]>(() =>
    db.from('kg_product').select(PRODUCT_SELECT).in('slug', [...PROMOTED]).order('id'))
  return rows.map(normalizeProductRow)
}

async function rematch(db: SupabaseClient, apply: boolean, outDir: string, show: number): Promise<void> {
  const ids = await heldRowIds(db)
  const [listings, index, promoted] = await Promise.all([pool(db, ids), loadMatchIndex(db), loadPromoted(db)])
  const brands = index.catalogueBrands
  const forecast = forecastIndex(index.products, promoted, index.idents, index.synonyms, brands)
  const notMatchable = promoted.filter((c) => !isMatchableProduct(c)).length

  // A stale listing that decides to the row it already sits on "stays": re-deciding
  // it writes nothing, so it is counted apart from the ones that move.
  const slugOf = new Map(Array.from(ids.entries()).map(([s, id]) => [id, s]))
  const counts = new Map<string, { now: number; supported: number }>()
  const bump = (k: string, col: 'now' | 'supported') => {
    const c = counts.get(k) ?? { now: 0, supported: 0 }
    c[col] += 1
    counts.set(k, c)
  }
  const lines: string[] = []
  const strandedStale: string[] = []
  for (const l of listings) {
    const now = outcome(l.title, index)
    const fc = outcome(l.title, forecast)
    const own = l.product_id ? slugOf.get(l.product_id) : undefined
    const tag = (o: Outcome) => (l.cohort === 'stale' && o.slug === own && o.key.startsWith('matched:') ? 'stays' : o.key)
    bump(`${l.group} ${l.cohort} ${tag(now)}`, 'now')
    bump(`${l.group} ${l.cohort} ${tag(fc)}`, 'supported')
    if (l.cohort === 'stale' && tag(fc) !== 'stays' && !fc.key.startsWith('matched:')) {
      strandedStale.push(`  ${own} | supported=${fc.key} | ${l.title}`)
    }
    if (tag(now) !== tag(fc) || (now.slug && tag(now) !== 'stays')) {
      lines.push(`  ${l.cohort} ${l.group} | now=${tag(now)} | supported=${tag(fc)} | ${l.title}`)
    }
  }

  console.log(`PAN-222 Rickenbacker re-match — ${apply ? 'APPLY' : 'DRY RUN'}`)
  console.log(`  ${humanDecided.length} live rows skipped: a person decided them (admin_decision), never re-decided`)
  if (show > 0 && humanDecided.length) console.log(humanDecided.map((h) => `  skipped ${h}`).join('\n'))
  console.log(`  ${aiTrue.length} live rows skipped: the AI pass confirmed them (is_valid=true), never re-decided`)
  console.log(`  ${listings.filter((l) => l.cohort === 'held').length} held on label rows, ` +
    `${listings.filter((l) => l.cohort === 'stale').length} held on promoted or re-decided supported rows, ` +
    `${listings.filter((l) => l.cohort === 'unmatched').length} unmatched`)
  console.log(`  ${promoted.length} promoted rows loaded; ${notMatchable} are not match targets today, so "now" cannot reach them`)
  console.log('group cohort outcome: now | if the promoted rows were supported')
  for (const [k, c] of Array.from(counts.entries()).sort()) console.log(`  ${k}: ${c.now} | ${c.supported}`)
  if (show > 0) console.log(lines.sort().slice(0, show).join('\n'))
  console.log(`stale rows no model would take (kept, for review): ${strandedStale.length}`)
  if (show > 0) console.log(strandedStale.sort().slice(0, show).join('\n'))
  if (!apply) return

  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `pan222-rollback-${Date.now()}.json`)
  const held = listings.filter((l) => l.cohort !== 'unmatched')
  const listingIds = Array.from(new Set(listings.map((l) => l.id)))
  const fd = fs.openSync(file, 'wx')
  fs.writeSync(fd, JSON.stringify({
    started_at: new Date().toISOString(),
    listing_ids: listingIds,
    held_rows: held.map((l) => ({
      listing_id: l.id,
      product_id: l.product_id,
      is_valid: l.prior_is_valid ?? null,
      rejected_reason: l.prior_rejected_reason ?? null,
    })),
  }))
  fs.fsyncSync(fd)
  fs.closeSync(fd)
  console.log(`rollback written first: ${file}`)

  for (const group of chunks(listingIds)) console.log(await matchListings(db, group))

  // A held or stale listing moves only if step 1 gave it a live row on a real
  // product other than the one it is held on.
  const labelIds = new Set(LABELS.map((s) => ids.get(s)!))
  let moved = 0
  for (const group of chunks(held)) {
    const { data, error } = await db.from('listing_product_match').select('listing_id, product_id')
      .in('listing_id', group.map((l) => l.id)).or('is_valid.is.null,is_valid.eq.true')
    if (error) throw new Error(error.message)
    const live = (data ?? []) as Array<{ listing_id: string; product_id: string }>
    for (const l of group) {
      const landed = live.some((r) => r.listing_id === l.id && r.product_id !== l.product_id && !labelIds.has(r.product_id))
      if (!landed) continue
      let q = db.from('listing_product_match').update({ is_valid: false, rejected_reason: REJECTED_REASON })
        .eq('listing_id', l.id).eq('product_id', l.product_id!)
      q = l.prior_is_valid === null || l.prior_is_valid === undefined ? q.is('is_valid', null) : q.eq('is_valid', l.prior_is_valid)
      const { error: uErr } = await q
      if (uErr) throw new Error(uErr.message)
      moved += 1
    }
  }
  console.log(`held rows released: ${moved}`)
}

async function rollback(db: SupabaseClient, file: string, apply: boolean): Promise<void> {
  const { started_at, listing_ids, held_rows } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    started_at: string
    listing_ids: string[]
    held_rows: Array<{ listing_id: string; product_id: string; is_valid: boolean | null; rejected_reason: string | null }>
  }
  // A held row existed before the run, so it is restored below, never deleted.
  const heldPairs = new Set(held_rows.map((r) => `${r.listing_id}|${r.product_id}`))
  const created: Array<{ id: string }> = []
  for (const group of chunks(listing_ids)) {
    const { data, error } = await db.from('listing_product_match').select('id, listing_id, product_id')
      .in('listing_id', group).gte('created_at', started_at).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
    created.push(...((data ?? []) as Array<{ id: string; listing_id: string; product_id: string }>)
      .filter((r) => !heldPairs.has(`${r.listing_id}|${r.product_id}`)))
  }
  console.log(`PAN-222 rollback — ${apply ? 'APPLY' : 'DRY RUN'} — ${created.length} rows created since ${started_at}; ${held_rows.length} held rows to restore`)
  if (!apply) return
  for (const group of chunks(created.map((r) => r.id))) {
    const { error } = await db.from('listing_product_match').delete().in('id', group).or('is_valid.is.null,is_valid.eq.false')
    if (error) throw new Error(error.message)
  }
  for (const r of held_rows) {
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
    : rematch(db, APPLY, flag('out-dir') ?? path.join(os.tmpdir(), 'pan222'), Number(flag('show') ?? 200))
  ).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
